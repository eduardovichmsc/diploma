/**
 * Симулятор аппаратного модуля (ESP32 + OBD-II) для разработки и демонстрации без железа.
 * Говорит с сервером по тому же MQTT-протоколу, что и настоящая прошивка.
 *
 *   npm run sim -- SIM-0001
 *
 * Клавиши в консоли (затем Enter):
 *   p — припарковаться (скорость 0, двигатель заглушен)
 *   d — поехать (если запуск разрешён)
 *   b — резкое торможение
 *   s — превышение скорости
 *   e — ошибка двигателя (DTC P0301)
 *   f — заправить до 100 %
 *   q — выход
 */
import { connect } from 'mqtt';
import * as readline from 'readline';

const serial = process.argv[2] ?? 'SIM-0001';
const url = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const TELEMETRY_MS = Number(process.env.TELEMETRY_MS ?? 5000);
const AUTO_PARK_S = Number(process.env.AUTO_PARK_S ?? 120); // через сколько секунд езды машина сама паркуется

const s = {
  locked: true,
  startAllowed: false,
  engineOn: false,
  driving: false,
  drivingFor: 0,
  lat: 55.7558,
  lon: 37.6173,
  heading: Math.random() * 360,
  speed: 0,
  fuel: 80,
  mileage: 15230.4,
  coolant: 22,
  voltage: 12.6,
};

const now = () => Math.floor(Date.now() / 1000);
const r1 = (v: number) => Math.round(v * 10) / 10;
const rpm = () => (s.engineOn ? Math.round(800 + s.speed * 28) : 0);
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString()}] ${serial}: ${m}`);

const client = connect(url, {
  clientId: `sim-${serial}`,
  will: { topic: `devices/${serial}/status`, payload: Buffer.from(JSON.stringify({ online: false })), qos: 1, retain: false },
});

const pub = (kind: string, payload: object) =>
  client.publish(`devices/${serial}/${kind}`, JSON.stringify(payload), { qos: 1 });

const event = (type: string, data?: object) => {
  pub('events', { type, ts: now(), data });
  log(`событие ${type}${data ? ' ' + JSON.stringify(data) : ''}`);
};

const reading = () => ({
  ts: now(),
  lat: Number(s.lat.toFixed(6)),
  lon: Number(s.lon.toFixed(6)),
  speed: Math.round(s.speed),
  rpm: rpm(),
  fuel: r1(s.fuel),
  mileage: r1(s.mileage),
  coolant: Math.round(s.coolant),
  voltage: r1(s.voltage),
  locked: s.locked,
  startAllowed: s.startAllowed,
});

function park() {
  if (s.engineOn) event('ENGINE_STOP');
  s.driving = false;
  s.engineOn = false;
  s.speed = 0;
  s.drivingFor = 0;
}

function drive() {
  if (!s.startAllowed || s.locked) return log('запуск запрещён: нет активной аренды');
  if (!s.engineOn) {
    s.engineOn = true;
    event('ENGINE_START');
  }
  s.driving = true;
  s.drivingFor = 0;
}

client.on('connect', () => {
  log(`подключён к ${url}`);
  client.subscribe(`devices/${serial}/cmd`, { qos: 1 });
  pub('status', { online: true, firmware: 'sim-0.1.0' });
});

client.on('message', (_topic, buf) => {
  const cmd = JSON.parse(buf.toString()) as { commandId: string; actions: string[] };
  for (const a of cmd.actions) {
    if (a === 'unlock') s.locked = false;
    if (a === 'lock') s.locked = true;
    if (a === 'allowStart') s.startAllowed = true;
    if (a === 'blockStart') s.startAllowed = false; // работающий двигатель не глушится
  }
  log(`команда ${cmd.actions.join(', ')}`);
  pub('ack', { commandId: cmd.commandId, ok: true, ...reading() });
  // после разблокировки клиент через несколько секунд садится и едет
  if (cmd.actions.includes('allowStart')) setTimeout(drive, 4000);
});

// Физика: шаг 1 секунда
setInterval(() => {
  if (s.engineOn) s.coolant = Math.min(90, s.coolant + 1.5);
  else s.coolant = Math.max(22, s.coolant - 0.3);
  s.voltage = s.engineOn ? 13.9 : 12.6;

  if (s.driving) {
    s.drivingFor++;
    const target = 40 + Math.random() * 50;
    s.speed = Math.max(0, s.speed + (target - s.speed) * 0.15 + (Math.random() - 0.5) * 6);
    s.heading += (Math.random() - 0.5) * 20;
    const km = s.speed / 3600;
    s.mileage += km;
    s.fuel = Math.max(0, s.fuel - km * 0.12);
    const rad = (s.heading * Math.PI) / 180;
    s.lat += (km / 111) * Math.cos(rad);
    s.lon += (km / (111 * Math.cos((s.lat * Math.PI) / 180))) * Math.sin(rad);
    if (s.drivingFor >= AUTO_PARK_S) {
      log('доехали, паркуемся');
      park();
    }
  }
}, 1000);

setInterval(() => pub('telemetry', reading()), TELEMETRY_MS);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const k = line.trim().toLowerCase();
  if (k === 'p') park();
  if (k === 'd') drive();
  if (k === 'b') {
    const from = Math.round(s.speed);
    s.speed = Math.max(0, s.speed - 35);
    event('HARSH_BRAKE', { from, to: Math.round(s.speed) });
  }
  if (k === 's') {
    s.speed = 128;
    event('OVERSPEED', { speed: 128, limit: 110 });
  }
  if (k === 'e') event('DTC_DETECTED', { codes: ['P0301'] });
  if (k === 'f') s.fuel = 100;
  if (k === 'q') {
    pub('status', { online: false });
    client.end(false, {}, () => process.exit(0));
  }
});

log('клавиши: p — парковка, d — ехать, b — торможение, s — превышение, e — ошибка, f — заправка, q — выход');
