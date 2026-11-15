import {
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  EventType,
  PaymentKind,
  PaymentStatus,
  VehicleStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { toTariffValues } from '../bookings/bookings.service';
import { EARLY_START_MS } from '../bookings/constants';
import { AuthUser } from '../common/decorators';
import { num, round2 } from '../common/money';
import { LiveGateway } from '../live/live.gateway';
import { DeviceAck, DeviceAction, MqttService } from '../mqtt/mqtt.service';
import { calculateFinal } from '../pricing/pricing';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderAccessService } from '../providers/provider-access.service';
import { ReviewDto } from './dto';

@Injectable()
export class RentalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProviderAccessService,
    private readonly mqtt: MqttService,
    private readonly live: LiveGateway,
  ) {}

  private async command(serial: string, actions: DeviceAction[]): Promise<DeviceAck> {
    try {
      return await this.mqtt.sendCommand(serial, actions);
    } catch (e) {
      throw new GatewayTimeoutException(`Модуль автомобиля недоступен: ${e.message}`);
    }
  }

  /**
   * Начало аренды (диаграмма последовательности 7):
   * проверка брони → команда unlock + allowStart → показания модуля сохраняются как стартовые.
   */
  async start(user: AuthUser, bookingId: string) {
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { vehicle: { include: { device: true } } },
    });
    if (!b) throw new NotFoundException('Бронь не найдена');
    if (b.renterId !== user.id) throw new ForbiddenException('Это не ваша бронь');
    if (b.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(`Бронь в статусе ${b.status}: начать аренду нельзя`);
    }
    const now = Date.now();
    if (now < b.startAt.getTime() - EARLY_START_MS) {
      throw new ConflictException('Аренду можно начать не раньше чем за 30 минут до начала брони');
    }
    if (now >= b.endAt.getTime()) throw new ConflictException('Срок брони истёк');
    const device = b.vehicle.device;
    if (!device) throw new ConflictException('Автомобиль не оснащён аппаратным модулем');

    const ack = await this.command(device.serial, ['unlock', 'allowStart']);

    const rental = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.booking.updateMany({
        where: { id: b.id, status: BookingStatus.CONFIRMED },
        data: { status: BookingStatus.ACTIVE },
      });
      if (!upd.count) throw new ConflictException('Аренда уже начата');
      await tx.vehicle.update({ where: { id: b.vehicleId }, data: { status: VehicleStatus.RENTED } });
      return tx.rental.create({
        data: { bookingId: b.id, startMileage: ack.mileage, startFuel: ack.fuel },
      });
    });

    this.live.toProvider(b.vehicle.providerId, 'rental-started', {
      rentalId: rental.id,
      vehicleId: b.vehicleId,
      startFuel: ack.fuel,
      startMileage: ack.mileage,
    });
    return this.get(user, rental.id);
  }

  /**
   * Завершение аренды (диаграмма последовательности 8):
   * машина стоит и двигатель заглушен → lock + blockStart → финальные показания → расчёт итога.
   */
  async finish(user: AuthUser, rentalId: string) {
    const r = await this.prisma.rental.findUnique({
      where: { id: rentalId },
      include: {
        booking: {
          include: { vehicle: { include: { device: true, tariff: true } }, payments: true },
        },
      },
    });
    if (!r) throw new NotFoundException('Аренда не найдена');
    const { booking } = r;
    const { vehicle } = booking;
    if (booking.renterId !== user.id) throw new ForbiddenException('Это не ваша аренда');
    if (booking.status !== BookingStatus.ACTIVE) {
      throw new ConflictException(`Аренда в статусе ${booking.status}: завершить нельзя`);
    }
    if (!vehicle.device || !vehicle.tariff) {
      throw new ConflictException('У автомобиля нет модуля или тарифа');
    }

    // 1. Безопасность: модуль никогда не глушит двигатель на ходу, поэтому сначала проверяем, что машина стоит
    const reading = await this.command(vehicle.device.serial, ['readNow']);
    if ((reading.rpm ?? 0) > 0 || (reading.speed ?? 0) > 0) {
      throw new ConflictException('Остановите автомобиль и заглушите двигатель, затем завершите аренду');
    }

    // 2. ACTIVE → FINISHING (защита от двойного завершения)
    const locked = await this.prisma.booking.updateMany({
      where: { id: booking.id, status: BookingStatus.ACTIVE },
      data: { status: BookingStatus.FINISHING },
    });
    if (!locked.count) throw new ConflictException('Аренда уже завершается');

    let ack: DeviceAck;
    try {
      ack = await this.command(vehicle.device.serial, ['lock', 'blockStart']);
    } catch (e) {
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.ACTIVE },
      });
      throw e;
    }

    // 3. Расчёт
    const finishedAt = new Date();
    const counts = await this.prisma.vehicleEvent.groupBy({
      by: ['type'],
      where: { rentalId },
      _count: { _all: true },
    });
    const count = (t: EventType) => counts.find((c) => c.type === t)?._count._all ?? 0;
    const calc = calculateFinal(toTariffValues(vehicle.tariff), {
      startedAt: r.startedAt,
      finishedAt,
      startMileage: r.startMileage,
      endMileage: ack.mileage,
      startFuel: r.startFuel,
      endFuel: ack.fuel,
      harshEvents: count(EventType.HARSH_BRAKE) + count(EventType.HARSH_ACCEL),
      overspeedEvents: count(EventType.OVERSPEED),
    });
    const depositPaid = booking.payments
      .filter((p) => p.kind === PaymentKind.DEPOSIT && p.status === PaymentStatus.SUCCEEDED)
      .reduce((s, p) => s + num(p.amount), 0);
    // > 0 — доплата клиента, < 0 — возврат части депозита
    const finalAmount = round2(calc.total - depositPaid);

    await this.prisma.$transaction([
      this.prisma.rental.update({
        where: { id: rentalId },
        data: {
          finishedAt,
          endMileage: ack.mileage,
          endFuel: ack.fuel,
          drivingScore: calc.drivingScore,
          totalPrice: calc.total,
        },
      }),
      this.prisma.rentalCharge.createMany({
        data: calc.charges.map((c) => ({ ...c, rentalId })),
      }),
      this.prisma.payment.create({
        data: {
          bookingId: booking.id,
          kind: PaymentKind.FINAL,
          amount: finalAmount,
          status: PaymentStatus.SUCCEEDED,
          providerRef: `mock_${randomUUID()}`,
        },
      }),
      this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.COMPLETED },
      }),
      this.prisma.vehicle.update({
        where: { id: vehicle.id },
        data: { status: VehicleStatus.AVAILABLE },
      }),
    ]);

    this.live.toProvider(vehicle.providerId, 'rental-finished', {
      rentalId,
      vehicleId: vehicle.id,
      total: calc.total,
      distanceKm: calc.distanceKm,
      drivingScore: calc.drivingScore,
    });

    return {
      ...(await this.get(user, rentalId)),
      summary: { ...calc, depositPaid, finalAmount },
    };
  }

  async active(user: AuthUser) {
    return this.prisma.rental.findFirst({
      where: { finishedAt: null, booking: { renterId: user.id } },
      include: {
        booking: { include: { vehicle: { include: { tariff: true } } } },
        telemetry: { orderBy: { ts: 'desc' }, take: 1 },
      },
    });
  }

  async my(user: AuthUser) {
    return this.prisma.rental.findMany({
      where: { booking: { renterId: user.id } },
      orderBy: { startedAt: 'desc' },
      include: {
        booking: {
          select: {
            id: true,
            startAt: true,
            endAt: true,
            vehicle: { select: { id: true, brand: true, model: true, plateNumber: true } },
          },
        },
        charges: true,
      },
    });
  }

  /** Доступ: арендатор или сотрудник арендодателя. */
  private async assertCanView(user: AuthUser, rentalId: string) {
    const r = await this.prisma.rental.findUnique({
      where: { id: rentalId },
      select: { booking: { select: { renterId: true, vehicle: { select: { providerId: true } } } } },
    });
    if (!r) throw new NotFoundException('Аренда не найдена');
    if (r.booking.renterId !== user.id) {
      await this.access.assertMember(user, r.booking.vehicle.providerId);
    }
  }

  async get(user: AuthUser, id: string) {
    await this.assertCanView(user, id);
    return this.prisma.rental.findUniqueOrThrow({
      where: { id },
      include: {
        booking: {
          include: {
            vehicle: {
              select: {
                id: true,
                brand: true,
                model: true,
                plateNumber: true,
                provider: { select: { id: true, displayName: true } },
              },
            },
            renter: { select: { id: true, fullName: true } },
            payments: true,
          },
        },
        charges: true,
        review: true,
      },
    });
  }

  async track(user: AuthUser, id: string) {
    await this.assertCanView(user, id);
    return this.prisma.telemetryPoint.findMany({
      where: { rentalId: id },
      orderBy: { ts: 'asc' },
      select: { ts: true, lat: true, lon: true, speed: true, fuelLevel: true, rpm: true },
    });
  }

  async events(user: AuthUser, id: string) {
    await this.assertCanView(user, id);
    return this.prisma.vehicleEvent.findMany({ where: { rentalId: id }, orderBy: { ts: 'asc' } });
  }

  async review(user: AuthUser, id: string, dto: ReviewDto) {
    const r = await this.prisma.rental.findUnique({
      where: { id },
      include: { booking: { include: { vehicle: true } }, review: true },
    });
    if (!r) throw new NotFoundException('Аренда не найдена');
    if (r.booking.renterId !== user.id) throw new ForbiddenException('Это не ваша аренда');
    if (!r.finishedAt) throw new ConflictException('Отзыв можно оставить после завершения аренды');
    if (r.review) throw new ConflictException('Отзыв уже оставлен');

    const providerId = r.booking.vehicle.providerId;
    const review = await this.prisma.review.create({
      data: { rentalId: id, authorId: user.id, rating: dto.rating, comment: dto.comment },
    });
    const agg = await this.prisma.review.aggregate({
      where: { rental: { booking: { vehicle: { providerId } } } },
      _avg: { rating: true },
    });
    await this.prisma.rentalProvider.update({
      where: { id: providerId },
      data: { rating: round2(agg._avg.rating ?? 0) },
    });
    return review;
  }
}
