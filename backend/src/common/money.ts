import { Prisma } from '@prisma/client';

/** Decimal из Prisma → number (для расчётов). */
export const num = (v: Prisma.Decimal | number | null | undefined): number =>
  v == null ? 0 : typeof v === 'number' ? v : v.toNumber();

/** Округление до копеек. */
export const round2 = (v: number): number => Math.round(v * 100) / 100;
