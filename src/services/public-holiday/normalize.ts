/**
 * Normalization of the MOM public holiday dataset (data.gov.sg CSV).
 *
 * The external rows are reduced to one holiday per Singapore civil date.
 * Observed/substitute holidays are taken exactly as MOM publishes them.
 */

import { createHash } from 'node:crypto';
import { parseString } from 'fast-csv';
import { formatDateOnly, parseDateOnly } from '@/services/service-schedule/date-only';
import type { DateOnly } from '@/services/service-schedule';

export type PublicHolidayRecord = {
  date: DateOnly;
  name: string;
  description: string | null;
  /** Stable key of the source row; the civil date is the natural key. */
  recordKey: string;
};

const MAX_NAME_LENGTH = 100;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeHeader(value: string): string {
  return value.replace(/^﻿/, '').trim().toLowerCase();
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function toCivilDate(value: string, rowNumber: number): DateOnly {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`Public holiday row ${rowNumber} has an invalid date "${value}"`);
  }
  try {
    // Round-trip through the UTC-backed DateOnly helpers so an impossible
    // date (2027-02-30) is rejected and no time zone can shift the day.
    return formatDateOnly(parseDateOnly(value as DateOnly));
  } catch {
    throw new Error(`Public holiday row ${rowNumber} has an invalid date "${value}"`);
  }
}

function joinNames(names: string[]): string {
  const joined = [...new Set(names)].sort((left, right) => left.localeCompare(right)).join(' / ');
  return joined.length > MAX_NAME_LENGTH ? `${joined.slice(0, MAX_NAME_LENGTH - 1)}…` : joined;
}

async function parseCsvRows(csv: string): Promise<Array<Record<string, string>>> {
  return new Promise((resolve, reject) => {
    const rows: Array<Record<string, string>> = [];
    parseString(csv, {
      headers: (headers) => headers.map((header) => (header === null || header === undefined ? header : normalizeHeader(header))),
      ignoreEmpty: true,
      trim: true,
    })
      .on('error', reject)
      .on('data', (row: Record<string, string>) => rows.push(row))
      .on('end', () => resolve(rows));
  });
}

/**
 * Parse and validate the MOM CSV (columns: date, day, holiday). Throws on any
 * invalid row so a partial or malformed dataset is never imported.
 */
export async function normalizeMomPublicHolidayCsv(csv: string): Promise<PublicHolidayRecord[]> {
  const rows = await parseCsvRows(csv);
  if (rows.length === 0) throw new Error('Public holiday dataset is empty');
  const first = rows[0];
  if (!('date' in first) || !('holiday' in first)) {
    throw new Error('Public holiday dataset is missing the date or holiday column');
  }

  const namesByDate = new Map<DateOnly, string[]>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const date = toCivilDate(normalizeText(row.date), rowNumber);
    const name = normalizeText(row.holiday);
    if (!name) throw new Error(`Public holiday row ${rowNumber} has no holiday name`);
    namesByDate.set(date, [...(namesByDate.get(date) ?? []), name]);
  });

  return [...namesByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, names]) => ({ date, name: joinNames(names), description: null, recordKey: date }));
}

/** Stable content hash of a normalized snapshot. */
export function hashPublicHolidayRecords(records: PublicHolidayRecord[]): string {
  const canonical = records.map(({ date, name, description }) => [date, name, description]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * The years a snapshot is authoritative for: 1 Jan of its first year through
 * 31 Dec of its last year. Holidays outside this range are never removed.
 */
export function publicHolidayCoverage(records: Array<{ date: DateOnly }>): { start: DateOnly; end: DateOnly } | null {
  if (records.length === 0) return null;
  const dates = records.map((record) => record.date).sort();
  return {
    start: `${dates[0].slice(0, 4)}-01-01` as DateOnly,
    end: `${dates[dates.length - 1].slice(0, 4)}-12-31` as DateOnly,
  };
}
