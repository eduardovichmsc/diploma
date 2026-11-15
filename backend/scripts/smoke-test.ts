/**
 * Сквозная проверка сценария аренды через API.
 * Требует: запущенный API, MQTT-брокер и симулятор модуля SIM-0001 с AUTO_PARK_S ≈ 10.
 *   npx tsx scripts/smoke-test.ts
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';

async function call<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

const login = async (email: string, password: string) =>
  (await call('POST', '/auth/login', undefined, { email, password })).accessToken as string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('health:', await call('GET', '/health'));

  // учётные записи из prisma/seed.ts
  const renter = await login('renter@rental.local', 'Renter12345!');
  const owner = await login('owner@rental.local', 'Owner12345!');
  const admin = await login('admin@rental.local', 'Admin12345!');

  const catalog = await call('GET', '/vehicles?city=Москва');
  console.log(`каталог: ${catalog.total} машин`);
  const camry = catalog.items.find((v: any) => v.model === 'Camry');

  const start = new Date(Date.now() + 60_000);
  const end = new Date(start.getTime() + 3 * 3600_000);
  const booking = await call('POST', '/bookings', renter, {
    vehicleId: camry.id,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  });
  console.log(`бронь ${booking.id.slice(0, 8)}: ${booking.status}, оценка ${booking.estimatedPrice}`);

  try {
    await call('POST', '/bookings', renter, {
      vehicleId: camry.id,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    });
    console.log('ОШИБКА: пересекающаяся бронь прошла');
  } catch (e) {
    console.log('пересечение отклонено:', (e as Error).message.split('→')[1]?.trim().slice(0, 60));
  }

  const paid = await call('POST', `/bookings/${booking.id}/pay`, renter);
  console.log(`оплата депозита → ${paid.status}`);

  const rental = await call('POST', '/rentals/start', renter, { bookingId: booking.id });
  console.log(`аренда начата: топливо ${rental.startFuel}%, пробег ${rental.startMileage} км`);

  console.log('поездка… (ждём, пока симулятор проедет и припаркуется)');
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    try {
      const done = await call('POST', `/rentals/${rental.id}/finish`, renter);
      console.log('аренда завершена:', JSON.stringify(done.summary, null, 2));
      break;
    } catch (e) {
      console.log('  ', (e as Error).message.split('→')[1]?.trim().slice(0, 90));
    }
  }

  const track = await call('GET', `/rentals/${rental.id}/track`, renter);
  console.log(`точек трека: ${track.length}`);

  const me = await call('GET', '/users/me', owner);
  const providerId = me.memberships[0].provider.id;
  const fleet = await call('GET', `/providers/${providerId}/vehicles`, owner);
  console.log(
    'автопарк:',
    fleet.map((v: any) => `${v.model} [${v.status}] модуль=${v.device?.serial ?? '—'} online=${v.device?.online ?? '—'}`),
  );

  console.log('статистика:', await call('GET', '/admin/stats', admin));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
