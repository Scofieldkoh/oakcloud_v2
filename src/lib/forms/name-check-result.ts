/**
 * Browser-safe shape for company-name check results carried in form metadata.
 *
 * Shared by the public renderer, draft save/resume, submission sanitising and the
 * staff response view so every layer keeps the same fields (assessment, reason codes,
 * match type and data date) instead of collapsing the result to `available`.
 */

export type NameCheckAssessment = 'AVAILABLE' | 'SIMILAR_WARNING' | 'IDENTICAL' | 'REVIEW_REQUIRED' | 'UNAVAILABLE';
export type NameCheckMode = 'strict' | 'advisory';

export const NAME_CHECK_RECORD_LIMIT = 10;
export const NAME_CHECK_NAME_MAX_LENGTH = 300;

const ASSESSMENTS: NameCheckAssessment[] = ['AVAILABLE', 'SIMILAR_WARNING', 'IDENTICAL', 'REVIEW_REQUIRED', 'UNAVAILABLE'];
const MATCH_TYPES = ['SIMILAR_WARNING', 'IDENTICAL'] as const;

export interface NameCheckRecordValue {
  uen: string;
  entityName: string;
  entityStatus: string;
  matchType?: (typeof MATCH_TYPES)[number];
}

export interface NameCheckResultValue {
  name: string;
  available: boolean;
  assessment: NameCheckAssessment;
  checkedAt: string;
  dataAsOf: string | null;
  records: NameCheckRecordValue[];
  reasonCodes: string[];
  /** 'server' when the result came from the submission-time recheck. */
  source?: 'client' | 'server';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function getNameCheckMode(validation: unknown): NameCheckMode {
  return isRecord(validation) && validation.nameCheckMode === 'advisory' ? 'advisory' : 'strict';
}

/**
 * Normalise a stored or client-supplied result. Legacy results without an
 * assessment are read as AVAILABLE / SIMILAR_WARNING from `available`.
 */
export function parseNameCheckResultValue(value: unknown): NameCheckResultValue | null {
  if (!isRecord(value)) return null;

  const name = text(value.name, NAME_CHECK_NAME_MAX_LENGTH);
  const checkedAt = text(value.checkedAt, 64);
  if (!name || !checkedAt) return null;

  const rawAssessment = typeof value.assessment === 'string' ? value.assessment : '';
  const assessment: NameCheckAssessment | null = (ASSESSMENTS as string[]).includes(rawAssessment)
    ? rawAssessment as NameCheckAssessment
    : typeof value.available === 'boolean'
      ? (value.available ? 'AVAILABLE' : 'SIMILAR_WARNING')
      : null;
  if (!assessment) return null;

  const records: NameCheckRecordValue[] = [];
  if (Array.isArray(value.records)) {
    for (const entry of value.records.slice(0, NAME_CHECK_RECORD_LIMIT)) {
      if (!isRecord(entry)) continue;
      const uen = text(entry.uen, 32);
      const entityName = text(entry.entityName, 500);
      const entityStatus = text(entry.entityStatus, 200);
      if (!uen && !entityName) continue;
      const matchType = (MATCH_TYPES as readonly string[]).includes(entry.matchType as string)
        ? entry.matchType as NameCheckRecordValue['matchType']
        : undefined;
      records.push({ uen, entityName, entityStatus, ...(matchType ? { matchType } : {}) });
    }
  }

  const reasonCodes = Array.isArray(value.reasonCodes)
    ? value.reasonCodes
      .filter((code): code is string => typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code))
      .slice(0, 10)
    : [];
  const dataAsOf = text(value.dataAsOf, 64) || null;

  return {
    name,
    available: assessment === 'AVAILABLE',
    assessment,
    checkedAt,
    dataAsOf,
    records,
    reasonCodes,
    ...(value.source === 'server' || value.source === 'client' ? { source: value.source } : {}),
  };
}

export function parseNameCheckResultMap(value: unknown): Record<string, NameCheckResultValue> {
  if (!isRecord(value)) return {};
  const results: Record<string, NameCheckResultValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseNameCheckResultValue(entry);
    if (parsed) results[key] = parsed;
  }
  return results;
}

/** Plain-language outcome for the advisory name check. */
export function describeNameCheckAssessment(assessment: NameCheckAssessment): { title: string; tone: 'success' | 'warning' } {
  switch (assessment) {
    case 'AVAILABLE':
      return {
        title: 'No matching registered name was found in the available data. ACRA approval and name reservation are still required.',
        tone: 'success',
      };
    case 'SIMILAR_WARNING':
      return {
        title: 'Potentially similar names found. Review the matches or submit the proposed name for our team’s assessment.',
        tone: 'warning',
      };
    case 'IDENTICAL':
      return {
        title: 'An identical or equivalent registered name was found. A different name is recommended. If you have an existing reservation or grounds for a name review, provide the details.',
        tone: 'warning',
      };
    case 'REVIEW_REQUIRED':
      return { title: 'Further name review is required.', tone: 'warning' };
    case 'UNAVAILABLE':
    default:
      return { title: 'Name check unavailable. Retry or continue for staff review.', tone: 'warning' };
  }
}

const REASON_CODE_TEXT: Record<string, string> = {
  RESTRICTED_OR_PROHIBITED_TERM: 'The name contains a word that ACRA restricts or reviews.',
  IDENTICAL_AFTER_ACRA_NORMALIZATION: 'The name matches an existing name once suffixes and common words are ignored.',
  CURATED_LEXICAL_FAMILY_MATCH: 'The name closely resembles an existing name.',
  CHECK_TIMED_OUT: 'The check did not finish in time.',
  CHECK_UNAVAILABLE: 'The name register could not be reached.',
  NOT_CHECKED: 'The name was not checked before submission.',
};

export function describeNameCheckReason(code: string): string | null {
  return REASON_CODE_TEXT[code] ?? null;
}
