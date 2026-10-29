import { z } from 'zod';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/** Strict, timezone-free calendar date used by authoritative schedule inputs. */
export const dateOnlySchema = z.string().refine(isCalendarDate, {
  message: 'Expected a valid calendar date in YYYY-MM-DD format',
});

export const optionalDateOnlySchema = dateOnlySchema.nullable().optional();
