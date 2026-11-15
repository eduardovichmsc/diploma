import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BookingStatus, EventType, Prisma } from '@prisma/client';
import { LiveGateway } from '../live/live.gateway';
import { DeviceMessageKind, MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';

interface DeviceInfo {
  id: string;
  vehicleId: string | null;
  providerId: string | null;
}

const OVERHEAT_C = 105;
const LOW_BATTERY_V = 11.8;
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Обработка сообщений от аппаратных модулей: сохранение телеметрии и событий,
 * фиксация кодов ошибок, рассылка данных в реальном времени через WebSocket.
 */
@Injectable()
export class TelemetryService implements OnModuleInit {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly cache = new Map<string, { info: DeviceInfo; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly live: LiveGateway,
  ) {}

  onModuleInit() {
    this.mqtt.addListener((serial, kind, payload) => this.handle(serial, kind, payload));
  }

  /** Сбрасывает кэш, например после привязки модуля к другой машине. */
  invalidate(serial?: string) {
    if (serial) this.cache.delete(serial);
    else this.cache.clear();
  }

  private async device(serial: string): Promise<DeviceInfo | null> {
    const hit = this.cache.get(serial);
    if (hit && Date.now() - hit.at < 60_000) return hit.info;
    const d = await this.prisma.device.findUnique({
      where: { serial },
      select: { id: true, vehicleId: true, vehicle: { select: { providerId: true } } },
    });
    if (!d) return null;
    const info = { id: d.id, vehicleId: d.vehicleId, providerId: d.vehicle?.providerId ?? null };
    this.cache.set(serial, { info, at: Date.now() });
    return info;
  }

  private async activeRental(vehicleId: string | null) {
    if (!vehicleId) return null;
    return this.prisma.rental.findFirst({
      where: {
        finishedAt: null,
        booking: { vehicleId, status: { in: [BookingStatus.ACTIVE, BookingStatus.FINISHING] } },
      },
      select: { id: true, booking: { select: { renterId: true } } },
    });
  }

  private emit(info: DeviceInfo, renterId: string | undefined, event: string, data: unknown) {
    if (info.providerId) this.live.toProvider(info.providerId, event, data);
    if (renterId) this.live.toUser(renterId, event, data);
  }

  async handle(serial: string, kind: DeviceMessageKind, p: Record<string, unknown>) {
    if (kind === 'ack') return; // ack обрабатывает MqttService
    const info = await this.device(serial);
    if (!info) {
      this.logger.warn(`Сообщение от незарегистрированного модуля ${serial}`);
      return;
    }

    if (kind === 'status') {
      const online = p.online === true;
      await this.prisma.device.update({
        where: { id: info.id },
        data: { online, lastSeenAt: new Date() },
      });
      this.emit(info, undefined, 'device-status', { serial, vehicleId: info.vehicleId, online });
      return;
    }

    await this.prisma.device.update({
      where: { id: info.id },
      data: { online: true, lastSeenAt: new Date() },
    });
    const rental = await this.activeRental(info.vehicleId);
    const ts = num(p.ts) ? new Date(num(p.ts)! * 1000) : new Date();

    if (kind === 'telemetry') {
      const lat = num(p.lat);
      const lon = num(p.lon);
      if (lat == null || lon == null) return;
      const point = await this.prisma.telemetryPoint.create({
        data: {
          deviceId: info.id,
          rentalId: rental?.id,
          ts,
          lat,
          lon,
          speed: num(p.speed) ?? 0,
          rpm: num(p.rpm) != null ? Math.round(num(p.rpm)!) : null,
          fuelLevel: num(p.fuel),
          coolantTemp: num(p.coolant),
          batteryVoltage: num(p.voltage),
          mileage: num(p.mileage),
        },
      });
      this.emit(info, rental?.booking.renterId, 'telemetry', {
        ...point,
        vehicleId: info.vehicleId,
        serial,
      });

      // Серверные оповещения по порогам (не чаще раза в 10 минут на тип)
      const coolant = num(p.coolant);
      const voltage = num(p.voltage);
      if (coolant != null && coolant > OVERHEAT_C) {
        await this.alertEvent(info, rental, EventType.OVERHEAT, ts, { coolant });
      }
      if (voltage != null && voltage < LOW_BATTERY_V && (num(p.rpm) ?? 0) > 0) {
        await this.alertEvent(info, rental, EventType.LOW_BATTERY, ts, { voltage });
      }
      return;
    }

    if (kind === 'events') {
      const type = String(p.type ?? '') as EventType;
      if (!Object.values(EventType).includes(type)) {
        this.logger.warn(`Неизвестный тип события ${type} от ${serial}`);
        return;
      }
      const data = (p.data ?? null) as Prisma.InputJsonValue | null;
      const event = await this.prisma.vehicleEvent.create({
        data: {
          deviceId: info.id,
          rentalId: rental?.id,
          type,
          ts,
          payload: data ?? undefined,
        },
      });
      this.emit(info, rental?.booking.renterId, 'vehicle-event', {
        ...event,
        vehicleId: info.vehicleId,
        serial,
      });

      if (type === EventType.DTC_DETECTED && info.vehicleId) {
        const codes = Array.isArray((p.data as { codes?: unknown })?.codes)
          ? ((p.data as { codes: unknown[] }).codes.map(String) as string[])
          : [];
        for (const code of codes) {
          const open = await this.prisma.dtcRecord.findFirst({
            where: { vehicleId: info.vehicleId, code, resolvedAt: null },
          });
          if (!open) {
            await this.prisma.dtcRecord.create({ data: { vehicleId: info.vehicleId, code } });
            this.emit(info, undefined, 'alert', {
              type: 'DTC',
              vehicleId: info.vehicleId,
              code,
              message: `Обнаружена ошибка ${code}`,
            });
          }
        }
      }
    }
  }

  private async alertEvent(
    info: DeviceInfo,
    rental: { id: string; booking: { renterId: string } } | null,
    type: EventType,
    ts: Date,
    payload: Prisma.InputJsonValue,
  ) {
    const recent = await this.prisma.vehicleEvent.findFirst({
      where: { deviceId: info.id, type, ts: { gt: new Date(ts.getTime() - ALERT_COOLDOWN_MS) } },
    });
    if (recent) return;
    await this.prisma.vehicleEvent.create({
      data: { deviceId: info.id, rentalId: rental?.id, type, ts, payload },
    });
    this.emit(info, undefined, 'alert', { type, vehicleId: info.vehicleId, ...(payload as object) });
  }
}
