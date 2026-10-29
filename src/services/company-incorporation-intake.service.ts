/**
 * Submission-time handling for guided form templates: the bounded server-side
 * company-name recheck used by advisory name-check fields, and the Singapore
 * Company Incorporation profile, definition snapshot and staff issue summary.
 */

import { createHash, randomUUID } from 'crypto';
import type { FormField } from '@/generated/prisma';
import {
  CompanyNameCheckUnavailableError,
  checkCompanyNameAvailability,
} from '@/lib/external/company-name-check';
import {
  evaluateCompanyIncorporationAnswers,
  selectedNameSuffix,
  type IncorporationEvaluation,
} from '@/lib/forms/company-incorporation-profile';
import {
  getNameCheckMode,
  type NameCheckResultValue,
} from '@/lib/forms/name-check-result';
import { parseFormTemplateBinding, type FormTemplateBinding } from '@/lib/form-templates';
import {
  INCORPORATION_KEYS,
  SG_COMPANY_INCORPORATION_TEMPLATE_KEY,
} from '@/lib/form-templates/sg-company-incorporation';
import { parseChoiceOptions, parseObject } from '@/lib/form-utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('company-incorporation-intake');

export const NAME_RECHECK_TIMEOUT_MS = 5_000;
export const COMPANY_INCORPORATION_PROFILE_VERSION = 4;

class NameRecheckTimeoutError extends Error {
  constructor() {
    super('Company name check timed out');
    this.name = 'NameRecheckTimeoutError';
  }
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NameRecheckTimeoutError()), timeoutMs);
  });
  // A late rejection after the deadline must not surface as an unhandled rejection.
  promise.catch(() => undefined);
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function unresolvedResult(name: string, reasonCode: string): NameCheckResultValue {
  return {
    name,
    available: false,
    assessment: 'UNAVAILABLE',
    checkedAt: new Date().toISOString(),
    dataAsOf: null,
    records: [],
    reasonCodes: [reasonCode],
    source: 'server',
  };
}

/**
 * Re-run the canonical checker once for every visible advisory name-check field.
 * Client-supplied results are ignored. A recognised outage or timeout records an
 * unresolved result for staff review; any other error propagates.
 */
export async function recheckAdvisoryCompanyNames(
  fields: Pick<FormField, 'key' | 'type' | 'validation'>[],
  answers: Record<string, unknown>,
  options: { timeoutMs?: number; check?: typeof checkCompanyNameAvailability } = {}
): Promise<Record<string, NameCheckResultValue>> {
  const check = options.check ?? checkCompanyNameAvailability;
  const timeoutMs = options.timeoutMs ?? NAME_RECHECK_TIMEOUT_MS;
  const results: Record<string, NameCheckResultValue> = {};
  const targets = fields.flatMap((field) => {
    if (field.type !== 'COMPANY_NAME_CHECK' || getNameCheckMode(field.validation) !== 'advisory') return [];
    const value = answers[field.key];
    const name = typeof value === 'string' ? value.trim() : '';
    return name ? [{ field, name }] : [];
  });

  // The proposed and alternative names are checked together so the total wait stays within one deadline.
  await Promise.all(targets.map(async ({ field, name }) => {
    try {
      const result = await withDeadline(check(name), timeoutMs);
      results[field.key] = {
        name,
        available: result.assessment === 'AVAILABLE',
        assessment: result.assessment,
        checkedAt: result.checkedAt,
        dataAsOf: result.dataAsOf,
        records: result.records.slice(0, 10).map((record) => ({
          uen: record.uen,
          entityName: record.entityName,
          entityStatus: record.entityStatus,
          ...(record.matchType ? { matchType: record.matchType } : {}),
        })),
        reasonCodes: result.reasonCodes,
        source: 'server',
      };
    } catch (error) {
      if (error instanceof NameRecheckTimeoutError) {
        log.warn('Company name recheck timed out; recording for staff review', { fieldKey: field.key });
        results[field.key] = unresolvedResult(name, 'CHECK_TIMED_OUT');
        return;
      }
      if (error instanceof CompanyNameCheckUnavailableError) {
        results[field.key] = unresolvedResult(name, 'CHECK_UNAVAILABLE');
        return;
      }
      throw error;
    }
  }));

  return results;
}

// ---------------------------------------------------------------------------
// Definition snapshot
// ---------------------------------------------------------------------------

type SnapshotField = Pick<FormField,
  'key' | 'type' | 'inputType' | 'label' | 'isRequired' | 'condition' | 'optionPresetId' | 'options' | 'validation' | 'position'>
  & Partial<Pick<FormField, 'subtext' | 'helpText'>>;

function snapshotField(field: SnapshotField) {
  const options = parseChoiceOptions(field.options);
  return {
    key: field.key,
    type: field.type,
    inputType: field.inputType,
    label: field.label,
    isRequired: field.isRequired,
    condition: field.condition ?? null,
    ...(field.optionPresetId
      ? { optionPresetId: field.optionPresetId, optionCount: options.length }
      : options.length > 0
        ? { options: options.map((option) => ({ value: option.value, label: option.label })) }
        : {}),
  };
}

/** Stable hash of the resolved definition, including preset option lists. */
export function computeFormDefinitionHash(fields: SnapshotField[]): string {
  const ordered = [...fields].sort((left, right) => left.position - right.position);
  const payload = ordered.map((field) => ({
    ...snapshotField(field),
    subtext: field.subtext ?? null,
    helpText: field.helpText ?? null,
    validation: field.validation ?? null,
    options: parseChoiceOptions(field.options).map((option) => [option.value, option.label]),
  }));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function buildFormDefinitionSnapshot(fields: SnapshotField[]) {
  return [...fields]
    .sort((left, right) => left.position - right.position)
    .filter((field) => field.type !== 'PARAGRAPH' && field.type !== 'HTML')
    .map(snapshotField);
}

// ---------------------------------------------------------------------------
// Company incorporation profile
// ---------------------------------------------------------------------------

export interface CompanyIncorporationSubmissionRecord {
  templateKey: string;
  templateVersion: number;
  profileVersion: number;
  definitionHash: string;
  evaluatedAt: string;
  issues: IncorporationEvaluation['issues'];
  ownershipTotal: string;
  companyType?: string | null;
  /** Name ending chosen by the respondent (profile version 3). */
  nameSuffix?: string | null;
  shareCount?: string | null;
  /** Profile version 1 only. */
  ownershipFullyDecided?: boolean;
  partyRows: Array<{
    partyRowId: string;
    rowIndex: number;
    kind: string;
    name: string;
    roles: string[];
    ownershipPercent: string | null;
    shares?: string | null;
    resident?: boolean;
    nomineeShareholder?: boolean;
    nomineeDirector?: boolean;
    shareholderNominator?: string | null;
    directorNominator?: string | null;
    /** Profile version 3 and earlier. */
    nominator?: string | null;
    /** Profile version 2 only. */
    otherControl?: boolean;
    /** Profile version 1 only. */
    ownershipUndecided?: boolean;
  }>;
  ssic: {
    catalogue: string;
    primary: { code: string; label: string } | null;
    secondary: { code: string; label: string } | null;
  };
  definitionSnapshot: ReturnType<typeof buildFormDefinitionSnapshot>;
}

function textAnswer(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findField<T extends { key: string }>(fields: T[], key: string): T | undefined {
  return fields.find((field) => field.key === key);
}

function optionLabels(field: SnapshotField | undefined): Map<string, string> {
  return new Map(parseChoiceOptions(field?.options).map((option) => [option.value, option.label]));
}

export function isTemplateBoundTo(settings: unknown, templateKey: string): FormTemplateBinding | null {
  const binding = parseFormTemplateBinding(settings);
  return binding && binding.key === templateKey ? binding : null;
}

/**
 * Evaluate a company incorporation submission. Throws with the first blocking
 * issue; otherwise returns the record stored under `metadata.companyIncorporation`.
 */
export function evaluateCompanyIncorporationSubmission(input: {
  settings: unknown;
  fields: SnapshotField[];
  answers: Record<string, unknown>;
  nameChecks: Record<string, NameCheckResultValue>;
  today?: string;
}): CompanyIncorporationSubmissionRecord | null {
  const binding = isTemplateBoundTo(input.settings, SG_COMPANY_INCORPORATION_TEMPLATE_KEY);
  if (!binding) return null;

  const primaryField = findField(input.fields, INCORPORATION_KEYS.primarySsic);
  const secondaryField = findField(input.fields, INCORPORATION_KEYS.secondarySsic);
  const primaryLabels = optionLabels(primaryField);
  const secondaryLabels = optionLabels(secondaryField);
  const ssicCodes = new Set(primaryLabels.keys());

  const evaluation = evaluateCompanyIncorporationAnswers(input.answers, {
    nameChecks: input.nameChecks,
    ssicCodes: ssicCodes.size > 0 ? ssicCodes : null,
    today: input.today,
  });

  const blocking = evaluation.issues.find((issue) => issue.severity === 'error');
  if (blocking) {
    throw new Error(blocking.message);
  }

  const primaryCode = textAnswer(input.answers[INCORPORATION_KEYS.primarySsic]);
  const secondaryCode = textAnswer(input.answers[INCORPORATION_KEYS.secondarySsic]);
  const presetName = primaryField?.optionPresetId ? 'SSIC 2025 (tenant preset)' : 'SSIC (form options)';

  return {
    templateKey: binding.key,
    templateVersion: binding.version,
    profileVersion: COMPANY_INCORPORATION_PROFILE_VERSION,
    definitionHash: computeFormDefinitionHash(input.fields),
    evaluatedAt: new Date().toISOString(),
    issues: evaluation.issues,
    ownershipTotal: evaluation.ownershipTotal,
    companyType: textAnswer(input.answers[INCORPORATION_KEYS.companyType]) || null,
    nameSuffix: selectedNameSuffix(input.answers),
    shareCount: textAnswer(input.answers[INCORPORATION_KEYS.shareCount]) || null,
    partyRows: evaluation.parties.map((party) => ({
      partyRowId: `party_${randomUUID()}`,
      rowIndex: party.rowIndex,
      kind: party.kind,
      name: party.name,
      roles: party.roles,
      ownershipPercent: party.ownershipPercent,
      shares: party.shares,
      resident: party.resident,
      nomineeShareholder: party.nomineeShareholder,
      nomineeDirector: party.nomineeDirector,
      shareholderNominator: party.shareholderNominator,
      directorNominator: party.directorNominator,
    })),
    ssic: {
      catalogue: presetName,
      primary: primaryCode ? { code: primaryCode, label: primaryLabels.get(primaryCode) ?? primaryCode } : null,
      secondary: secondaryCode ? { code: secondaryCode, label: secondaryLabels.get(secondaryCode) ?? secondaryCode } : null,
    },
    definitionSnapshot: buildFormDefinitionSnapshot(input.fields),
  };
}

export function parseCompanyIncorporationSubmissionRecord(metadata: unknown): CompanyIncorporationSubmissionRecord | null {
  const root = parseObject(metadata);
  const record = parseObject(root?.companyIncorporation);
  if (!record || record.templateKey !== SG_COMPANY_INCORPORATION_TEMPLATE_KEY) return null;
  return record as unknown as CompanyIncorporationSubmissionRecord;
}
