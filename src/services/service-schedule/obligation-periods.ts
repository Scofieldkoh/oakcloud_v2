import {
  addCalendarDays,
  compareDateOnly,
  parseDateOnly,
} from './date-only';
import type { DateOnly, MilestoneExpression, ObligationPeriodInput } from './types';

/**
 * Period planning for statutory obligations that belong to an actual
 * financial period (ECI) or Year of Assessment (annual tax return).
 *
 * The recurring Company FYE month/day is only a preference used to derive
 * provisional periods. Confirmed periods always win, and anything the
 * derivation cannot know (a first period after incorporation, a changed FYE)
 * is returned as provisional with a review reason instead of being guessed.
 */

export type ObligationPeriodBasis = 'FINANCIAL_PERIOD' | 'YEAR_OF_ASSESSMENT';

export type FinancialPeriodSource = 'CONFIRMED' | 'DERIVED';

export type PeriodReviewReason =
  | 'FIRST_FINANCIAL_PERIOD_UNCONFIRMED'
  | 'FINANCIAL_PERIOD_GAP_AFTER_FYE_CHANGE'
  | 'YEAR_OF_ASSESSMENT_UNCONFIRMED'
  | 'MULTIPLE_YEARS_OF_ASSESSMENT';

export type FinancialPeriodFact = {
  id?: string | null;
  start: DateOnly;
  end: DateOnly;
  /** Explicit basis allocation. Empty/undefined means the normal mapping. */
  yearsOfAssessment?: number[] | null;
  source: FinancialPeriodSource;
};

export type CompanyPeriodFacts = {
  financialYearEndMonth?: number | null;
  financialYearEndDay?: number | null;
  incorporationDate?: DateOnly | null;
  confirmedPeriods?: FinancialPeriodFact[];
};

export type PlannedFinancialPeriod = FinancialPeriodFact & {
  yearsOfAssessment: number[];
  provisional: boolean;
  reviewReasons: PeriodReviewReason[];
};

export type PlannedObligationPeriod = {
  periodKey: string;
  basis: ObligationPeriodBasis;
  start: DateOnly;
  end: DateOnly;
  yearOfAssessment: number | null;
  financialPeriods: Array<{ start: DateOnly; end: DateOnly; source: FinancialPeriodSource; id: string | null }>;
  provisional: boolean;
  reviewReasons: PeriodReviewReason[];
};

export type FinancialPeriodPlan = {
  periods: PlannedFinancialPeriod[];
  missingFinancialYearEnd: boolean;
};

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The FYE landmark in a given year. A 29 February (or any day past the
 * month's length) FYE is read as the month end, so leap-year FYEs stay month
 * ends instead of drifting to 28 February forever.
 */
export function financialYearEndInYear(year: number, month: number, day: number): DateOnly {
  const lastDay = daysInMonth(year, month);
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(day, lastDay))}` as DateOnly;
}

function isValidFye(month: unknown, day: unknown): month is number {
  return typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= 12
    && typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31;
}

function overlaps(left: { start: DateOnly; end: DateOnly }, right: { start: DateOnly; end: DateOnly }): boolean {
  return compareDateOnly(left.start, right.end) <= 0 && compareDateOnly(right.start, left.end) <= 0;
}

/** Normal Singapore mapping: YA is the year after the financial year ends. */
export function normalYearOfAssessment(periodEnd: DateOnly): number {
  return Number(periodEnd.slice(0, 4)) + 1;
}

/**
 * Plan every financial period whose end falls in [fromEnd, toEnd].
 * Confirmed periods are authoritative; derived periods fill the rest.
 */
export function planFinancialPeriods(
  facts: CompanyPeriodFacts,
  fromEnd: DateOnly,
  toEnd: DateOnly,
): FinancialPeriodPlan {
  parseDateOnly(fromEnd);
  parseDateOnly(toEnd);
  const confirmed = [...(facts.confirmedPeriods ?? [])]
    .map((period) => {
      parseDateOnly(period.start);
      parseDateOnly(period.end);
      return { ...period, source: 'CONFIRMED' as const };
    })
    .sort((left, right) => compareDateOnly(left.end, right.end));

  const planned: PlannedFinancialPeriod[] = confirmed
    .filter((period) => compareDateOnly(period.end, fromEnd) >= 0 && compareDateOnly(period.end, toEnd) <= 0)
    .map((period) => {
      const explicit = period.yearsOfAssessment?.filter((year) => Number.isSafeInteger(year)) ?? [];
      const yearsOfAssessment = explicit.length > 0 ? [...new Set(explicit)].sort((left, right) => left - right) : [normalYearOfAssessment(period.end)];
      return {
        ...period,
        yearsOfAssessment,
        provisional: false,
        reviewReasons: yearsOfAssessment.length > 1 ? ['MULTIPLE_YEARS_OF_ASSESSMENT' as const] : [],
      };
    });

  const month = facts.financialYearEndMonth;
  const day = facts.financialYearEndDay;
  if (!isValidFye(month, day)) {
    return { periods: planned, missingFinancialYearEnd: planned.length === 0 };
  }

  const incorporation = facts.incorporationDate ?? null;
  if (incorporation) parseDateOnly(incorporation);

  const firstYear = Number(fromEnd.slice(0, 4)) - 1;
  const lastYear = Number(toEnd.slice(0, 4)) + 1;
  for (let year = firstYear; year <= lastYear; year += 1) {
    const end = financialYearEndInYear(year, month, day as number);
    const previousEnd = financialYearEndInYear(year - 1, month, day as number);
    let start = addCalendarDays(previousEnd, 1);
    const reviewReasons: PeriodReviewReason[] = [];

    if (compareDateOnly(end, fromEnd) < 0 || compareDateOnly(end, toEnd) > 0) continue;
    // No obligation for a period that ended before the company existed.
    if (incorporation && compareDateOnly(end, incorporation) < 0) continue;
    if (incorporation && compareDateOnly(start, incorporation) <= 0) {
      start = incorporation;
      reviewReasons.push('FIRST_FINANCIAL_PERIOD_UNCONFIRMED');
    }

    const candidate = { start, end };
    if (confirmed.some((period) => overlaps(period, candidate))) {
      // A confirmed period that ends inside this derived period means the FYE
      // changed. Keep the remainder visible as a provisional gap period.
      const covering = confirmed.filter((period) => overlaps(period, candidate));
      const lastCoveredEnd = covering.reduce<DateOnly>(
        (latest, period) => (compareDateOnly(period.end, latest) > 0 ? period.end : latest),
        covering[0]!.end,
      );
      if (compareDateOnly(lastCoveredEnd, end) >= 0) continue;
      start = addCalendarDays(lastCoveredEnd, 1);
      reviewReasons.push('FINANCIAL_PERIOD_GAP_AFTER_FYE_CHANGE');
    }

    const provisionalMapping = reviewReasons.length > 0;
    planned.push({
      id: null,
      start,
      end,
      source: 'DERIVED',
      yearsOfAssessment: [normalYearOfAssessment(end)],
      provisional: true,
      reviewReasons: provisionalMapping
        ? [...reviewReasons, 'YEAR_OF_ASSESSMENT_UNCONFIRMED']
        : reviewReasons,
    });
  }

  planned.sort((left, right) => compareDateOnly(left.end, right.end));
  return { periods: planned, missingFinancialYearEnd: false };
}

export function financialPeriodKey(end: DateOnly): string {
  return `FY${end}`;
}

export function assessmentYearKey(yearOfAssessment: number): string {
  return `YA${yearOfAssessment}`;
}

/** Group planned financial periods into obligation periods for one basis. */
export function planObligationPeriods(
  basis: ObligationPeriodBasis,
  financialPeriods: PlannedFinancialPeriod[],
): PlannedObligationPeriod[] {
  if (basis === 'FINANCIAL_PERIOD') {
    return financialPeriods.map((period) => ({
      periodKey: financialPeriodKey(period.end),
      basis,
      start: period.start,
      end: period.end,
      yearOfAssessment: period.yearsOfAssessment.length === 1 ? period.yearsOfAssessment[0]! : null,
      financialPeriods: [{ start: period.start, end: period.end, source: period.source, id: period.id ?? null }],
      provisional: period.provisional,
      reviewReasons: [...period.reviewReasons],
    }));
  }

  const byYear = new Map<number, PlannedObligationPeriod>();
  for (const period of financialPeriods) {
    for (const yearOfAssessment of period.yearsOfAssessment) {
      const existing = byYear.get(yearOfAssessment);
      const segment = { start: period.start, end: period.end, source: period.source, id: period.id ?? null };
      if (!existing) {
        byYear.set(yearOfAssessment, {
          periodKey: assessmentYearKey(yearOfAssessment),
          basis,
          start: period.start,
          end: period.end,
          yearOfAssessment,
          financialPeriods: [segment],
          provisional: period.provisional,
          reviewReasons: [...period.reviewReasons],
        });
        continue;
      }
      existing.financialPeriods.push(segment);
      if (compareDateOnly(period.start, existing.start) < 0) existing.start = period.start;
      if (compareDateOnly(period.end, existing.end) > 0) existing.end = period.end;
      existing.provisional = existing.provisional || period.provisional;
      for (const reason of period.reviewReasons) {
        if (!existing.reviewReasons.includes(reason)) existing.reviewReasons.push(reason);
      }
    }
  }
  return [...byYear.values()].sort((left, right) => (left.yearOfAssessment ?? 0) - (right.yearOfAssessment ?? 0));
}

export function toObligationPeriodInput(period: PlannedObligationPeriod): ObligationPeriodInput {
  return { start: period.start, end: period.end, yearOfAssessment: period.yearOfAssessment };
}

type ExpressionNode = MilestoneExpression | Record<string, unknown>;

function expressionUses(expression: ExpressionNode, predicate: (node: Record<string, unknown>) => boolean): boolean {
  const stack: unknown[] = [expression];
  let visited = 0;
  while (stack.length > 0 && visited < 10_000) {
    visited += 1;
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    const record = node as Record<string, unknown>;
    if (predicate(record)) return true;
    stack.push(...Object.values(record));
  }
  return false;
}

/**
 * The obligation-period basis a rule's milestones require, or null for a
 * legacy rolling rule. Assessment-year dates imply YA periods; explicit
 * obligation-period sources imply financial periods.
 */
export function obligationPeriodBasisForExpressions(
  expressions: ExpressionNode[],
): ObligationPeriodBasis | null {
  if (expressions.some((expression) => expressionUses(expression, (node) => node.kind === 'FIXED_DATE_IN_ASSESSMENT_YEAR'))) {
    return 'YEAR_OF_ASSESSMENT';
  }
  if (expressions.some((expression) => expressionUses(
    expression,
    (node) => node.kind === 'OBLIGATION_PERIOD_START' || node.kind === 'OBLIGATION_PERIOD_END',
  ))) {
    return 'FINANCIAL_PERIOD';
  }
  return null;
}

/**
 * Rebuild a stored cycle's obligation period from its key and dates. Keys are
 * written by planObligationPeriods: `YA<year>` or `FY<period end>`. Legacy
 * keys return null so rolling rules keep their existing evaluation.
 */
export function obligationPeriodFromCycle(
  periodKey: string,
  start: DateOnly,
  end: DateOnly,
): ObligationPeriodInput | null {
  const assessment = /^YA(\d{4})$/.exec(periodKey);
  if (assessment) return { start, end, yearOfAssessment: Number(assessment[1]) };
  const financial = /^FY(\d{4}-\d{2}-\d{2})$/.exec(periodKey);
  if (financial) return { start, end, yearOfAssessment: normalYearOfAssessment(financial[1] as DateOnly) };
  return null;
}
