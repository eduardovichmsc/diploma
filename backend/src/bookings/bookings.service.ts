import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  PaymentKind,
  PaymentStatus,
  Prisma,
  ProviderStatus,
  VehicleStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthUser } from '../common/decorators';
import { num } from '../common/money';
import { estimatePrice, TariffValues } from '../pricing/pricing';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderAccessService } from '../providers/provider-access.service';
import { BLOCKING_BOOKING_STATUSES, PAYMENT_TIMEOUT_MS } from './constants';
import { CreateBookingDto, ProviderBookingsQueryDto } from './dto';

export const toTariffValues = (t: {
  pricePerHour: Prisma.Decimal;
  pricePerDay: Prisma.Decimal;
  kmLimitPerDay: number;
  overmileagePrice: Prisma.Decimal;
  fuelPricePerPercent: Prisma.Decimal;
  deposit: Prisma.Decimal;
}): TariffValues => ({
  pricePerHour: num(t.pricePerHour),
  pricePerDay: num(t.pricePerDay),
  kmLimitPerDay: t.kmLimitPerDay,
  overmileagePrice: num(t.overmileagePrice),
  fuelPricePerPercent: num(t.fuelPricePerPercent),
  deposit: num(t.deposit),
});

const bookingView = {
  vehicle: {
    select: {
      id: true,
      brand: true,
      model: true,
      year: true,
      plateNumber: true,
      city: true,
      photoUrls: true,
      provider: { select: { id: true, displayName: true } },
    },
  },
  rental: true,
  payments: true,
} satisfies Prisma.BookingInclude;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProviderAccessService,
  ) {}

  /** Отменяет неоплаченные брони старше PAYMENT_TIMEOUT_MS, чтобы они не держали машину. */
  private expireUnpaid(tx: Prisma.TransactionClient, vehicleId?: string) {
    return tx.booking.updateMany({
      where: {
        status: BookingStatus.PENDING_PAYMENT,
        createdAt: { lt: new Date(Date.now() - PAYMENT_TIMEOUT_MS) },
        ...(vehicleId && { vehicleId }),
      },
      data: { status: BookingStatus.CANCELLED },
    });
  }

  async create(user: AuthUser, dto: CreateBookingDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt.getTime() - startAt.getTime() < 60 * 60 * 1000) {
      throw new BadRequestException('Минимальный срок аренды — 1 час');
    }
    if (startAt.getTime() < Date.now() - 5 * 60 * 1000) {
      throw new BadRequestException('Начало аренды не может быть в прошлом');
    }

    // Serializable: две параллельные брони на один интервал не пройдут обе
    return this.prisma.$transaction(
      async (tx) => {
        const vehicle = await tx.vehicle.findUnique({
          where: { id: dto.vehicleId },
          include: { tariff: true, provider: true },
        });
        if (!vehicle || !vehicle.tariff) throw new NotFoundException('Автомобиль не найден');
        if (vehicle.provider.status !== ProviderStatus.ACTIVE) {
          throw new ConflictException('Арендодатель сейчас не принимает бронирования');
        }
        if (vehicle.status === VehicleStatus.MAINTENANCE) {
          throw new ConflictException('Автомобиль на обслуживании');
        }

        await this.expireUnpaid(tx, vehicle.id);
        const overlap = await tx.booking.findFirst({
          where: {
            vehicleId: vehicle.id,
            status: { in: BLOCKING_BOOKING_STATUSES },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        });
        if (overlap) throw new ConflictException('Машина уже забронирована на это время');

        return tx.booking.create({
          data: {
            renterId: user.id,
            vehicleId: vehicle.id,
            startAt,
            endAt,
            estimatedPrice: estimatePrice(toTariffValues(vehicle.tariff), startAt, endAt),
          },
          include: bookingView,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  my(user: AuthUser) {
    return this.prisma.booking.findMany({
      where: { renterId: user.id },
      orderBy: { startAt: 'desc' },
      include: bookingView,
    });
  }

  async get(user: AuthUser, id: string) {
    const b = await this.prisma.booking.findUnique({
      where: { id },
      include: { ...bookingView, renter: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
    if (!b) throw new NotFoundException('Бронь не найдена');
    if (b.renterId !== user.id) await this.access.assertMember(user, b.vehicle.provider.id);
    return b;
  }

  private async ownBooking(user: AuthUser, id: string) {
    const b = await this.prisma.booking.findUnique({
      where: { id },
      include: { vehicle: { include: { tariff: true } } },
    });
    if (!b) throw new NotFoundException('Бронь не найдена');
    if (b.renterId !== user.id) throw new ForbiddenException('Это не ваша бронь');
    return b;
  }

  /** Оплата депозита (заглушка платёжного шлюза): PENDING_PAYMENT → CONFIRMED. */
  async pay(user: AuthUser, id: string) {
    const b = await this.ownBooking(user, id);
    if (b.status !== BookingStatus.PENDING_PAYMENT) {
      throw new ConflictException(`Бронь в статусе ${b.status}, оплата не требуется`);
    }
    if (b.createdAt.getTime() < Date.now() - PAYMENT_TIMEOUT_MS) {
      await this.prisma.booking.update({ where: { id }, data: { status: BookingStatus.CANCELLED } });
      throw new ConflictException('Время на оплату истекло, бронь отменена');
    }
    await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          bookingId: id,
          kind: PaymentKind.DEPOSIT,
          amount: b.vehicle.tariff?.deposit ?? 0,
          status: PaymentStatus.SUCCEEDED,
          providerRef: `mock_${randomUUID()}`,
        },
      }),
      this.prisma.booking.update({ where: { id }, data: { status: BookingStatus.CONFIRMED } }),
    ]);
    return this.get(user, id);
  }

  async cancel(user: AuthUser, id: string) {
    const b = await this.ownBooking(user, id);
    const cancellable: BookingStatus[] = [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED];
    if (!cancellable.includes(b.status)) {
      throw new ConflictException(`Бронь в статусе ${b.status} нельзя отменить`);
    }
    await this.prisma.$transaction([
      // возврат депозита (заглушка)
      this.prisma.payment.updateMany({
        where: { bookingId: id, kind: PaymentKind.DEPOSIT, status: PaymentStatus.SUCCEEDED },
        data: { status: PaymentStatus.REFUNDED },
      }),
      this.prisma.booking.update({ where: { id }, data: { status: BookingStatus.CANCELLED } }),
    ]);
    return this.get(user, id);
  }

  async providerBookings(user: AuthUser, providerId: string, q: ProviderBookingsQueryDto) {
    await this.access.assertMember(user, providerId);
    await this.expireUnpaid(this.prisma);
    return this.prisma.booking.findMany({
      where: {
        vehicle: { providerId },
        ...(q.status && { status: q.status }),
        ...(q.vehicleId && { vehicleId: q.vehicleId }),
      },
      orderBy: { startAt: 'desc' },
      include: {
        ...bookingView,
        renter: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    });
  }
}
