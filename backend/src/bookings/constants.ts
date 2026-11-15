import { BookingStatus } from '@prisma/client';

/** Статусы, при которых бронь занимает машину на свой интервал. */
export const BLOCKING_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.ACTIVE,
  BookingStatus.FINISHING,
];

/** Неоплаченная бронь автоматически отменяется через это время. */
export const PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;

/** Начать аренду можно не раньше, чем за столько до startAt. */
export const EARLY_START_MS = 30 * 60 * 1000;
