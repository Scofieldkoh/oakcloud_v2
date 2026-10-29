import { ValidationError } from '@/lib/errors';
import { compareDateOnly, parseDateOnly } from '@/services/service-schedule/date-only';
import type { DateOnly } from '@/services/service-schedule';
import type { DeadlineMaterializationPolicy } from './types';
import type { RollingPeriod } from './planner';

/**
 * Stable rule codes whose automatic materialization may generate an
 * authoritative annual backlog from Company.accountsDueDate. Resolution is
 * exact and case-sensitive; names, milestone labels, and near-match codes
 * never enable backlog behavior.
 */
export const AUTHORITATIVE_BACKLOG_RULE_CODES = new Set([
  'SG_AGM_DUE',
  'SG_ANNUAL_RETURN',
] as const);

export const MAX_AUTHORITATIVE_BACKLOG_CYCLES = 20;

export function deadlineMaterializationPolicyForRule(
  ruleCode: string,
): DeadlineMaterializationPolicy {
  return AUTHORITATIVE_BACKLOG_RULE_CODES.has(ruleCode as never)
    ? 'AUTHORITATIVE_ANNUAL_BACKLOG'
    : 'ROLLING_HORIZON';
}

export type AuthoritativeBacklogPlan = {
  periods: RollingPeriod[];
  excludedCycleCount: number;
  oldestRetainedYear: number | null;
};

/**
 * Plan inclusive calendar-year periods from the authoritative source year
 * through the horizon year. Calendar-year periods keep the June AGM and July
 * Annual Return derived from the same July source in one statutory cycle.
 */
export function planAuthoritativeAnnualBacklog(
  sourceDate: DateOnly,
  horizonEnd: DateOnly,
  maxCycles: number = MAX_AUTHORITATIVE_BACKLOG_CYCLES,
): AuthoritativeBacklogPlan {
  parseDateOnly(sourceDate);
  parseDateOnly(horizonEnd);
  if (!Number.isSafeInteger(maxCycles) || maxCycles < 1) {
    throw new ValidationError('Backlog cycle cap must be a positive safe integer', { maxCycles });
  }
  if (compareDateOnly(sourceDate, horizonEnd) > 0) {
    return { periods: [], excludedCycleCount: 0, oldestRetainedYear: null };
  }

  const sourceYear = Number(sourceDate.slice(0, 4));
  const horizonYear = Number(horizonEnd.slice(0, 4));
  const years: number[] = [];
  for (let year = sourceYear; year <= horizonYear; year += 1) years.push(year);

  const excludedCycleCount = Math.max(0, years.length - maxCycles);
  const retained = years.slice(-maxCycles);
  const periods: RollingPeriod[] = retained.map((year, index) => {
    const start = `${year}-01-01` as DateOnly;
    const end = index === retained.length - 1 && year === horizonYear
      ? horizonEnd
      : `${year}-12-31` as DateOnly;
    return { periodKey: String(year), start, end };
  });

  return {
    periods,
    excludedCycleCount,
    oldestRetainedYear: retained[0] ?? null,
  };
}
