import { ChargeType } from '@prisma/client';
import { round2 } from '../common/money';

/**
 * Расчёт стоимости аренды. Чистые функции без доступа к БД, чтобы их было легко тестировать.
 *
 * Итог = базовая стоимость (время × тариф)
 *      + перепробег × цена за км
 *      + недолив топлива × цена за %
 *      + штраф за стиль вождения
 */
export interface TariffValues {
  pricePerHour: number;
  pricePerDay: number;
  kmLimitPerDay: number;
  overmileagePrice: number;
  fuelPricePerPercent: number;
  deposit: number;
}

export interface TripFacts {
  startedAt: Date;
  finishedAt: Date;
  startMileage: number;
  endMileage: number;
  startFuel: number;
  endFuel: number;
  harshEvents: number; // резкие торможения и разгоны
  overspeedEvents: number;
}

export interface ChargeLine {
  type: ChargeType;
  amount: number;
  description: string;
}

const HOUR = 3_600_000;

/** Оплачиваемые часы: округление вверх, минимум 1 час. */
export function billableHours(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / HOUR));
}

/** Полные сутки по суточному тарифу, остаток по часовому, но не дороже суток. */
export function basePrice(t: TariffValues, hours: number): number {
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return round2(days * t.pricePerDay + Math.min(rest * t.pricePerHour, t.pricePerDay));
}

export function estimatePrice(t: TariffValues, start: Date, end: Date): number {
  return basePrice(t, billableHours(start, end));
}

/** 100 баллов минус 5 за каждое резкое действие и 10 за каждое превышение скорости. */
export function drivingScore(harsh: number, overspeed: number): number {
  return Math.max(0, 100 - 5 * harsh - 10 * overspeed);
}

/** Штраф в процентах от базовой стоимости в зависимости от оценки вождения. */
export function penaltyRate(score: number): number {
  if (score < 30) return 0.25;
  if (score < 60) return 0.1;
  return 0;
}

export function calculateFinal(t: TariffValues, f: TripFacts) {
  const hours = billableHours(f.startedAt, f.finishedAt);
  const base = basePrice(t, hours);
  const charges: ChargeLine[] = [
    { type: ChargeType.BASE, amount: base, description: `Аренда: ${hours} ч` },
  ];

  const distanceKm = round2(Math.max(0, f.endMileage - f.startMileage));
  const kmLimit = Math.max(1, Math.ceil(hours / 24)) * t.kmLimitPerDay;
  const overKm = round2(Math.max(0, distanceKm - kmLimit));
  if (overKm > 0) {
    charges.push({
      type: ChargeType.OVERMILEAGE,
      amount: round2(overKm * t.overmileagePrice),
      description: `Перепробег ${overKm} км сверх лимита ${kmLimit} км`,
    });
  }

  const fuelDeficit = Math.round(Math.max(0, f.startFuel - f.endFuel) * 10) / 10;
  if (fuelDeficit > 0) {
    charges.push({
      type: ChargeType.FUEL,
      amount: round2(fuelDeficit * t.fuelPricePerPercent),
      description: `Недолив топлива ${fuelDeficit}% (выдача ${f.startFuel}%, возврат ${f.endFuel}%)`,
    });
  }

  const score = drivingScore(f.harshEvents, f.overspeedEvents);
  const rate = penaltyRate(score);
  if (rate > 0) {
    charges.push({
      type: ChargeType.PENALTY,
      amount: round2(base * rate),
      description: `Стиль вождения: ${score}/100 (резких манёвров ${f.harshEvents}, превышений ${f.overspeedEvents})`,
    });
  }

  const total = round2(charges.reduce((s, c) => s + c.amount, 0));
  return { hours, distanceKm, drivingScore: score, charges, total };
}
