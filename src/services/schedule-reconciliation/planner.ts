import { ValidationError } from '@/lib/errors';
import {
  addCalendarDays,
  addMonthsClamped,
  compareDateOnly,
  parseDateOnly,
} from '@/services/service-schedule/date-only';
import type { DateOnly, RuleRecurrenceDefinition } from '@/services/service-schedule';

export const ROLLING_HORIZON_MONTHS = 12;
export const ROLLING_PLAN_VERSION = 'rolling-v1';

export type RollingPeriod = {
  periodKey: string;
  start: DateOnly;
  end: DateOnly;
};

export type RollingScopePlan = {
  tenantId: string;
  clientServiceId: string;
  ruleId: string;
  today: DateOnly;
  horizonEnd: DateOnly;
  periods: RollingPeriod[];
};

function monthStart(value: DateOnly): DateOnly {
  return `${value.slice(0, 7)}-01` as DateOnly;
}

function periodStepMonths(recurrence: RuleRecurrenceDefinition): number {
  switch (recurrence.kind) {
    case 'MONTHLY': return recurrence.interval ?? 1;
    case 'QUARTERLY': return (recurrence.interval ?? 1) * 3;
    case 'SEMI_ANNUALLY': return (recurrence.interval ?? 1) * 6;
    case 'ANNUALLY': return (recurrence.interval ?? 1) * 12;
    case 'CUSTOM': return recurrence.interval;
    case 'ONE_TIME': return 0;
    default: throw new ValidationError('Unsupported rule recurrence');
  }
}

function periodKey(start: DateOnly, recurrence: RuleRecurrenceDefinition): string {
  const year = start.slice(0, 4);
  const month = Number(start.slice(5, 7));
  switch (recurrence.kind) {
    case 'MONTHLY': return start.slice(0, 7);
    case 'QUARTERLY': return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    case 'SEMI_ANNUALLY': return `${year}-H${month <= 6 ? 1 : 2}`;
    case 'ANNUALLY': return year;
    case 'CUSTOM': return `${start.slice(0, 7)}+${recurrence.interval}M`;
    case 'ONE_TIME': return `ONE_TIME:${start}`;
    default: throw new ValidationError('Unsupported rule recurrence');
  }
}

/** Plan deterministic date-only cycles for preview and reconciliation. */
export function planRollingPeriods(
  recurrence: RuleRecurrenceDefinition,
  today: DateOnly,
  horizonEnd: DateOnly = addMonthsClamped(today, ROLLING_HORIZON_MONTHS),
  anchorStart?: DateOnly | null,
): RollingPeriod[] {
  parseDateOnly(today);
  parseDateOnly(horizonEnd);
  if (compareDateOnly(horizonEnd, today) < 0) throw new ValidationError('Rolling horizon must not precede today');

  if (recurrence.kind === 'ONE_TIME') {
    return [{ periodKey: periodKey(today, recurrence), start: today, end: horizonEnd }];
  }

  const step = periodStepMonths(recurrence);
  const periods: RollingPeriod[] = [];
  const startFrom = anchorStart && compareDateOnly(anchorStart, today) < 0
    ? monthStart(anchorStart)
    : monthStart(today);

  let cursor = startFrom;
  while (compareDateOnly(cursor, horizonEnd) <= 0) {
    const next = addMonthsClamped(cursor, step);
    const periodEnd = addCalendarDays(next, -1);
    periods.push({
      periodKey: periodKey(cursor, recurrence),
      start: cursor,
      end: compareDateOnly(periodEnd, horizonEnd) > 0 ? horizonEnd : periodEnd,
    });
    cursor = next;
  }
  return periods;
}

export function planRollingScope(input: {
  tenantId: string;
  clientServiceId: string;
  ruleId: string;
  recurrence: RuleRecurrenceDefinition;
  today: DateOnly;
  horizonEnd?: DateOnly;
}): RollingScopePlan {
  const horizonEnd = input.horizonEnd ?? addMonthsClamped(input.today, ROLLING_HORIZON_MONTHS);
  return {
    tenantId: input.tenantId,
    clientServiceId: input.clientServiceId,
    ruleId: input.ruleId,
    today: input.today,
    horizonEnd,
    periods: planRollingPeriods(input.recurrence, input.today, horizonEnd),
  };
}
