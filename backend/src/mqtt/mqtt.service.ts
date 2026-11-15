import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { connect, MqttClient } from 'mqtt';

/**
 * Протокол обмена с аппаратным модулем (топики):
 *   devices/{serial}/telemetry  модуль → сервер  периодические показания
 *   devices/{serial}/events     модуль → сервер  события (запуск, резкое торможение, DTC…)
 *   devices/{serial}/status     модуль → сервер  online/offline (в т.ч. last will)
 *   devices/{serial}/ack        модуль → сервер  подтверждение команды + текущие показания
 *   devices/{serial}/cmd        сервер → модуль  команды
 */
export type DeviceAction = 'lock' | 'unlock' | 'allowStart' | 'blockStart' | 'readNow';

export interface DeviceCommand {
  commandId: string;
  actions: DeviceAction[];
  ts: number;
}

/** Ответ модуля на команду: показания в момент выполнения. */
export interface DeviceAck {
  commandId: string;
  ok: boolean;
  error?: string;
  ts?: number;
  fuel: number; // уровень топлива, %
  mileage: number; // одометр модуля, км
  lat?: number;
  lon?: number;
  speed?: number;
  rpm?: number;
  locked?: boolean;
  startAllowed?: boolean;
}

export type DeviceMessageKind = 'telemetry' | 'events' | 'status' | 'ack';
export type DeviceMessageListener = (
  serial: string,
  kind: DeviceMessageKind,
  payload: Record<string, unknown>,
) => void | Promise<void>;

export class DeviceTimeoutError extends Error {}

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client?: MqttClient;
  private readonly listeners: DeviceMessageListener[] = [];
  private readonly pending = new Map<
    string,
    { resolve: (a: DeviceAck) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get('MQTT_URL', 'mqtt://localhost:1883');
    this.client = connect(url, {
      clientId: `car-rental-api-${randomUUID().slice(0, 8)}`,
      reconnectPeriod: 3000,
      connectTimeout: 5000,
    });
    this.client.on('connect', () => {
      this.logger.log(`Подключено к MQTT-брокеру ${url}`);
      this.client!.subscribe(
        ['devices/+/telemetry', 'devices/+/events', 'devices/+/status', 'devices/+/ack'],
        { qos: 1 },
      );
    });
    this.client.on('error', (e) => this.logger.warn(`MQTT: ${e.message}`));
    this.client.on('message', (topic, buf) => this.onMessage(topic, buf));
  }

  async onModuleDestroy() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    await this.client?.endAsync();
  }

  isConnected() {
    return !!this.client?.connected;
  }

  addListener(listener: DeviceMessageListener) {
    this.listeners.push(listener);
  }

  /** Отправляет команду модулю и ждёт подтверждения (ack) с показаниями. */
  sendCommand(serial: string, actions: DeviceAction[], timeoutMs?: number): Promise<DeviceAck> {
    const timeout = timeoutMs ?? Number(this.config.get('DEVICE_ACK_TIMEOUT_MS', 15000));
    if (!this.isConnected()) {
      return Promise.reject(new DeviceTimeoutError('MQTT-брокер недоступен'));
    }
    const cmd: DeviceCommand = { commandId: randomUUID(), actions, ts: Math.floor(Date.now() / 1000) };
    return new Promise<DeviceAck>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmd.commandId);
        reject(new DeviceTimeoutError(`Модуль ${serial} не ответил за ${timeout} мс`));
      }, timeout);
      this.pending.set(cmd.commandId, { resolve, reject, timer });
      this.client!.publish(`devices/${serial}/cmd`, JSON.stringify(cmd), { qos: 1 });
      this.logger.log(`→ ${serial}: ${actions.join(', ')} (${cmd.commandId.slice(0, 8)})`);
    });
  }

  private onMessage(topic: string, buf: Buffer) {
    const [root, serial, kind] = topic.split('/');
    if (root !== 'devices' || !serial || !kind) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(buf.toString('utf8'));
    } catch {
      this.logger.warn(`Некорректный JSON в ${topic}`);
      return;
    }

    if (kind === 'ack') {
      const id = String(payload.commandId ?? '');
      const p = this.pending.get(id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        const ack = payload as unknown as DeviceAck;
        if (ack.ok === false) p.reject(new Error(ack.error ?? 'Модуль отклонил команду'));
        else p.resolve(ack);
      }
    }

    for (const l of this.listeners) {
      Promise.resolve(l(serial, kind as DeviceMessageKind, payload)).catch((e) =>
        this.logger.error(`Ошибка обработки ${topic}: ${e?.message ?? e}`),
      );
    }
  }
}
