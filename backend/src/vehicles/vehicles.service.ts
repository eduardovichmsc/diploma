import {
  ConflictException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProviderStatus, VehicleStatus } from '@prisma/client';
import { BLOCKING_BOOKING_STATUSES } from '../bookings/constants';
import { AuthUser } from '../common/decorators';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderAccessService } from '../providers/provider-access.service';
import {
  CatalogQueryDto,
  CreateVehicleDto,
  TariffDto,
  TimeRangeQueryDto,
  UpdateVehicleDto,
  VehicleCommandDto,
} from './dto';

const publicProvider = { select: { id: true, displayName: true, rating: true, type: true } } as const;

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProviderAccessService,
    private readonly mqtt: MqttService,
  ) {}

  // ───── Публичный каталог ─────

  async catalog(q: CatalogQueryDto) {
    const where: Prisma.VehicleWhereInput = {
      provider: { status: ProviderStatus.ACTIVE },
      status: { not: VehicleStatus.MAINTENANCE },
      tariff: { isNot: null },
      ...(q.city && { city: { contains: q.city, mode: 'insensitive' } }),
      ...(q.transmission && { transmission: q.transmission }),
      ...(q.fuelType && { fuelType: q.fuelType }),
      ...(q.providerId && { providerId: q.providerId }),
    };
    if (q.minPrice != null || q.maxPrice != null) {
      where.tariff = { is: { pricePerDay: { gte: q.minPrice, lte: q.maxPrice } } };
    }
    if (q.from && q.to) {
      // свободна на интервале: нет пересекающихся активных броней
      where.bookings = {
        none: {
          status: { in: BLOCKING_BOOKING_STATUSES },
          startAt: { lt: new Date(q.to) },
          endAt: { gt: new Date(q.from) },
        },
      };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        include: { tariff: true, provider: publicProvider },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async publicCard(id: string) {
    const v = await this.prisma.vehicle.findFirst({
      where: { id, provider: { status: ProviderStatus.ACTIVE } },
      include: {
        tariff: true,
        provider: publicProvider,
        device: { select: { id: true } },
        bookings: {
          where: { status: { in: BLOCKING_BOOKING_STATUSES }, endAt: { gt: new Date() } },
          select: { startAt: true, endAt: true },
          orderBy: { startAt: 'asc' },
        },
      },
    });
    if (!v) throw new NotFoundException('Автомобиль не найден');
    const { bookings, device, ...rest } = v;
    return { ...rest, busy: bookings, hasTelematics: !!device };
  }

  // ───── Управление автопарком ─────

  async create(user: AuthUser, providerId: string, dto: CreateVehicleDto) {
    await this.access.assertActiveMember(user, providerId);
    const { tariff, ...data } = dto;
    try {
      return await this.prisma.vehicle.create({
        data: { ...data, providerId, tariff: { create: tariff } },
        include: { tariff: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Автомобиль с таким госномером или VIN уже есть');
      }
      throw e;
    }
  }

  async providerFleet(user: AuthUser, providerId: string) {
    await this.access.assertMember(user, providerId);
    return this.prisma.vehicle.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
      include: {
        tariff: true,
        device: {
          select: {
            id: true,
            serial: true,
            online: true,
            lastSeenAt: true,
            telemetry: { orderBy: { ts: 'desc' }, take: 1 },
          },
        },
        dtcRecords: { where: { resolvedAt: null } },
        bookings: {
          where: { status: { in: BLOCKING_BOOKING_STATUSES }, endAt: { gt: new Date() } },
          orderBy: { startAt: 'asc' },
          take: 3,
          select: { id: true, startAt: true, endAt: true, status: true },
        },
      },
    });
  }

  /** Возвращает машину, проверив, что пользователь — сотрудник её арендодателя. */
  private async ownVehicle(user: AuthUser, id: string) {
    const v = await this.prisma.vehicle.findUnique({ where: { id }, include: { device: true } });
    if (!v) throw new NotFoundException('Автомобиль не найден');
    await this.access.assertMember(user, v.providerId);
    return v;
  }

  async update(user: AuthUser, id: string, dto: UpdateVehicleDto) {
    const v = await this.ownVehicle(user, id);
    if (dto.status && v.status === VehicleStatus.RENTED) {
      throw new ConflictException('Нельзя менять статус машины во время аренды');
    }
    return this.prisma.vehicle.update({ where: { id }, data: dto, include: { tariff: true } });
  }

  async setTariff(user: AuthUser, id: string, dto: TariffDto) {
    await this.ownVehicle(user, id);
    return this.prisma.tariff.upsert({
      where: { vehicleId: id },
      create: { ...dto, vehicleId: id },
      update: dto,
    });
  }

  // ───── Телематика ─────

  async telemetry(user: AuthUser, id: string, q: TimeRangeQueryDto) {
    const v = await this.ownVehicle(user, id);
    if (!v.device) return [];
    return this.prisma.telemetryPoint.findMany({
      where: { deviceId: v.device.id, ts: this.range(q) },
      orderBy: { ts: 'desc' },
      take: q.limit,
    });
  }

  async events(user: AuthUser, id: string, q: TimeRangeQueryDto) {
    const v = await this.ownVehicle(user, id);
    if (!v.device) return [];
    return this.prisma.vehicleEvent.findMany({
      where: { deviceId: v.device.id, ts: this.range(q) },
      orderBy: { ts: 'desc' },
      take: q.limit,
    });
  }

  async dtc(user: AuthUser, id: string) {
    await this.ownVehicle(user, id);
    return this.prisma.dtcRecord.findMany({
      where: { vehicleId: id },
      orderBy: [{ resolvedAt: { sort: 'asc', nulls: 'first' } }, { detectedAt: 'desc' }],
    });
  }

  async resolveDtc(user: AuthUser, id: string, dtcId: string) {
    await this.ownVehicle(user, id);
    const r = await this.prisma.dtcRecord.updateMany({
      where: { id: dtcId, vehicleId: id, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    if (!r.count) throw new NotFoundException('Открытая ошибка не найдена');
    return { ok: true };
  }

  /** Ручная команда арендодателя: открыть или закрыть машину. */
  async command(user: AuthUser, id: string, dto: VehicleCommandDto) {
    const v = await this.ownVehicle(user, id);
    if (!v.device) throw new ConflictException('Автомобиль не оснащён аппаратным модулем');
    try {
      return await this.mqtt.sendCommand(v.device.serial, [dto.action]);
    } catch (e) {
      throw new GatewayTimeoutException(e.message);
    }
  }

  private range(q: TimeRangeQueryDto): Prisma.DateTimeFilter | undefined {
    if (!q.from && !q.to) return undefined;
    return {
      ...(q.from && { gte: new Date(q.from) }),
      ...(q.to && { lte: new Date(q.to) }),
    };
  }
}
