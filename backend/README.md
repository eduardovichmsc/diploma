# Backend: платформа аренды автомобилей

NestJS 11 + Prisma 6 + PostgreSQL + MQTT + Socket.IO.

## Запуск

```bash
# 1. PostgreSQL и MQTT-брокер (из корня diploma/)
docker compose up -d

# 2. Зависимости, миграции, демо-данные (из backend/)
npm install
npx prisma migrate dev
npm run seed

# 3. API
npm run start:dev
```

- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs
- Health: http://localhost:3000/api/health

Без Docker MQTT-брокер можно поднять встроенный: `npm run broker`. PostgreSQL тогда нужен локальный, а `DATABASE_URL` в `.env` надо поправить.

### Симулятор аппаратного модуля

```bash
npm run sim -- SIM-0001
```

Симулятор работает по тому же MQTT-протоколу, что и прошивка ESP32: шлёт телеметрию, отвечает на команды, генерирует события. Клавиши: `p` — парковка, `d` — ехать, `b` — резкое торможение, `s` — превышение, `e` — ошибка DTC, `f` — заправка, `q` — выход.

Тестовые учётные записи перечислены в шапке `prisma/seed.ts`.

## Структура

| Модуль | Назначение |
|---|---|
| `auth` | Регистрация, вход, JWT (access + refresh) |
| `users` | Профиль пользователя |
| `providers` | Арендодатели. Регистрация через паттерн «Стратегия»: BUSINESS реализован, INDIVIDUAL заложен |
| `vehicles` | Каталог, автопарк, тарифы, телеметрия машины, DTC, команды lock/unlock |
| `bookings` | Бронирование с проверкой пересечений, оплата депозита (mock), отмена |
| `rentals` | Начало и завершение аренды через модуль, расчёт итога, трек, отзывы |
| `pricing` | Расчёт стоимости (чистые функции) |
| `devices` | Регистрация модулей и привязка к машинам (админ) |
| `mqtt` | Клиент MQTT: подписка на топики модулей, отправка команд с ожиданием ack |
| `telemetry` | Обработка телеметрии и событий, DTC, пороговые оповещения |
| `live` | WebSocket `/live`: телеметрия и оповещения в реальном времени |
| `admin` | Модерация арендодателей, пользователи, статистика |

## Протокол MQTT

| Топик | Направление | Содержимое |
|---|---|---|
| `devices/{serial}/telemetry` | модуль → сервер | `ts, lat, lon, speed, rpm, fuel, mileage, coolant, voltage` |
| `devices/{serial}/events` | модуль → сервер | `type` (ENGINE_START, HARSH_BRAKE, OVERSPEED, DTC_DETECTED…), `data` |
| `devices/{serial}/status` | модуль → сервер | `online` (в том числе last will) |
| `devices/{serial}/cmd` | сервер → модуль | `commandId, actions: lock / unlock / allowStart / blockStart / readNow` |
| `devices/{serial}/ack` | модуль → сервер | `commandId, ok`, текущие показания |

## Сценарий аренды через API

1. `POST /api/auth/login` под арендатором.
2. `GET /api/vehicles`, затем `POST /api/bookings` → `PENDING_PAYMENT`.
3. `POST /api/bookings/{id}/pay` → `CONFIRMED` (депозит, mock).
4. `POST /api/rentals/start` → модуль открывает машину, стартовые показания сохраняются.
5. Поездка: телеметрия в БД и в WebSocket.
6. `POST /api/rentals/{id}/finish` → машина должна стоять с заглушенным двигателем. Модуль закрывает машину, сервер считает итог: время, перепробег, топливо, стиль вождения.

## Расчёт стоимости

`src/pricing/pricing.ts`:

- **База.** Полные сутки по суточному тарифу, остаток по часовому, но не дороже суток. Минимум 1 час.
- **Перепробег.** Километры сверх `kmLimitPerDay × сутки` × `overmileagePrice`.
- **Топливо.** Недолив в процентах × `fuelPricePerPercent`.
- **Стиль вождения.** Оценка = 100 − 5 × резкие манёвры − 10 × превышения. Ниже 60 — штраф 10 % от базы, ниже 30 — 25 %.
- **Итог** минус оплаченный депозит = доплата (или возврат, если сумма отрицательная).
