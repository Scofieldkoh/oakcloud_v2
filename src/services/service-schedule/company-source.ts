import { parseDateOnly } from './date-only';
import type { CompanyRuleSource, DateOnly } from './types';
import type { CompanyPeriodFacts } from './obligation-periods';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeDateOnly(value: unknown): DateOnly | null {
  if (typeof value === 'string') {
    try {
      parseDateOnly(value as DateOnly);
      return value as DateOnly;
    } catch {
      return null;
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10) as DateOnly;
  }
  return null;
}

/** Normalize persisted Company fields into the evaluator's date-only source shape. */
export function normalizeCompanyRuleSource(value: unknown, today?: DateOnly): CompanyRuleSource {
  const source = asRecord(value);
  const result: Record<string, unknown> = {};
  const dateFields = new Set([
    'financialYearEnd',
    'accountsDueDate',
    'incorporationDate',
    'registrationDate',
  ]);
  const supported = new Set([
    'isGstRegistered',
    'isRegisteredCharity',
    'isIPC',
    'hasCharges',
    'currentOfficerCount',
    'currentShareholderCount',
    'annualReceiptsOrExpenditure',
    ...dateFields,
    'entityType',
    'status',
    'primarySsicCode',
    'secondarySsicCode',
    'uen',
    'name',
  ]);
  for (const [key, raw] of Object.entries(source)) {
    if (!supported.has(key) || raw === null || raw === undefined) continue;
    if (dateFields.has(key)) {
      const date = safeDateOnly(raw);
      if (date) result[key] = date;
    } else if (typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
      result[key] = raw;
    }
  }

  if (!result.financialYearEnd && today) {
    const day = source.financialYearEndDay;
    const month = source.financialYearEndMonth;
    if (
      typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31
      && typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= 12
    ) {
      const candidate = `${today.slice(0, 4)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as DateOnly;
      if (safeDateOnly(candidate)) result.financialYearEnd = candidate;
    }
  }
  return result as CompanyRuleSource;
}

/**
 * Period facts for period-based statutory rules. Confirmed financial periods
 * are passed by callers that load them; the FYE month/day is only the
 * recurring preference used to derive provisional periods.
 */
export function companyPeriodFacts(
  value: unknown,
  confirmedPeriods: CompanyPeriodFacts['confirmedPeriods'] = [],
): CompanyPeriodFacts {
  const source = asRecord(value);
  const month = source.financialYearEndMonth;
  const day = source.financialYearEndDay;
  return {
    financialYearEndMonth: typeof month === 'number' ? month : null,
    financialYearEndDay: typeof day === 'number' ? day : null,
    incorporationDate: safeDateOnly(source.incorporationDate),
    confirmedPeriods,
  };
}
