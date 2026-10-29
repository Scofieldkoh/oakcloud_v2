import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  BIZFILE_REVIEW_SECTIONS,
  bizFileReviewSchema,
  normalizeBizFileReviewDraft,
  type BizFileReviewSectionId,
} from '@/lib/validations/bizfile-review';
import type { ReviewResult } from '@/services/business-assistant/contracts';
import {
  canonicalizeCompanyStatus,
  canonicalizeEntityType,
  canonicalizeIdentificationType,
  canonicalizeOfficerRole,
} from '../canonical-values';
import {
  type BizFileBaselineSnapshot,
  type BizFileChange,
} from '../change-plan';
import type {
  BizFileExtractionOptions,
  BizFileExtractionResult,
  BizFileVisionInput,
  ExtractedBizFileData,
} from '../types';
import {
  bizFileIndependentSourceCoverageSchema,
  extractBizFileForIndependentReview,
  validateBizFileIndependentSourceCoverage,
  type BizFileIndependentSourceCoverage,
} from './source-review-extraction';

export { bizFileIndependentSourceCoverageSchema } from './source-review-extraction';
export type { BizFileIndependentSourceCoverage } from './source-review-extraction';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REVIEW_SECTIONS = ['entity', 'addresses', 'activities', 'capital', 'officers', 'shareholders', 'auditor', 'compliance', 'charges', 'document'] as const;
const reviewSectionSchema = z.enum(REVIEW_SECTIONS);

const reviewFindingSchema = z.object({
  id: z.string().regex(/^bizfile\.review\.[a-z0-9._-]+$/),
  code: z.string().trim().min(1).max(100),
  severity: z.enum(['ERROR', 'WARNING', 'INFO']),
  message: z.string().trim().min(1).max(500),
  path: z.string().trim().min(1).max(200).optional(),
  changeId: z.string().trim().min(1).max(300).optional(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
}).strict();

const fieldComparisonSchema = z.object({
  changeId: z.string().trim().min(1).max(300),
  path: z.string().trim().min(1).max(200),
  sourceValue: z.unknown().optional(),
  persistedValue: z.unknown().optional(),
  approvedValue: z.unknown().optional(),
  approvedMatches: z.boolean(),
  matches: z.boolean(),
}).strict();

const sourceEvidenceSchema = z.object({
  expectedHash: z.string().regex(SHA256_PATTERN).nullable(),
  observedHash: z.string().regex(SHA256_PATTERN).nullable(),
  hashVerified: z.boolean(),
  extractionStatus: z.enum(['COMPLETE', 'MISSING', 'INVALID', 'FAILED']),
  provider: z.string().trim().min(1).max(100).nullable(),
  model: z.string().trim().min(1).max(200).nullable(),
}).strict();

const coverageSchema = z.object({
  requiredSections: z.array(reviewSectionSchema),
  assessedSections: z.array(reviewSectionSchema),
  reviewedSections: z.array(reviewSectionSchema),
  missingSections: z.array(reviewSectionSchema),
  sourceCoverageAvailable: z.boolean(),
  sourceCoverageComplete: z.boolean(),
  selectedChangeCount: z.number().int().nonnegative(),
  comparedChangeCount: z.number().int().nonnegative(),
  missingSourceFieldCount: z.number().int().nonnegative(),
  missingPersistedFieldCount: z.number().int().nonnegative(),
  sourceCoverage: bizFileIndependentSourceCoverageSchema.nullable(),
  comparisonScope: z.literal('SELECTED_CHANGES_ONLY'),
  fullSourceReviewComplete: z.literal(false),
  complete: z.boolean(),
}).strict();

/**
 * The review artifact is deliberately stricter than the generic ReviewResult.
 * It records the byte-level source proof, fresh extractor identity, coverage,
 * and the exact selected fields that were compared. No receipt or effect
 * metadata can make this artifact PASS by itself.
 */
export const bizFileIndependentReviewReportSchema = z.object({
  schemaVersion: z.literal('1'),
  verdict: z.enum(['PASS', 'PASS_WITH_WARNINGS', 'NEEDS_REVIEW', 'REVIEW_FAILED']),
  executionConformance: z.enum(['PASS', 'FAIL', 'UNVERIFIABLE']),
  sourceAlignment: z.enum(['NO_UNEXPLAINED_DIFFERENCE', 'DIFFERENCES_PRESENT', 'INCOMPLETE']),
  commitStatus: z.enum(['COMMITTED', 'NO_COMMIT', 'UNKNOWN']),
  source: sourceEvidenceSchema,
  selectedChanges: z.array(fieldComparisonSchema),
  findings: z.array(reviewFindingSchema),
  coverage: coverageSchema,
  observedAt: z.string().datetime(),
}).strict();

export type BizFileIndependentReviewReport = z.infer<typeof bizFileIndependentReviewReportSchema>;
export type BizFileIndependentReviewResult = BizFileIndependentReviewReport & ReviewResult;
export interface BizFileIndependentExtractionResult extends BizFileExtractionResult {
  /** Coverage must come from the dedicated independent extractor contract. */
  sourceCoverage?: BizFileIndependentSourceCoverage;
  /** Raw coverage is retained so the reviewer can revalidate it from bytes. */
  sourceCoverageAttestation?: unknown;
}
export type BizFileIndependentExtractor = (
  input: BizFileVisionInput,
  options?: BizFileExtractionOptions,
) => Promise<BizFileIndependentExtractionResult>;

export interface BizFileIndependentReviewInput {
  beforeProviderDispatch?: () => Promise<void>;
  /** The immutable source bytes read for this review attempt. */
  sourceBytes: Uint8Array;
  /** Hash recorded in the prepared source manifest. */
  expectedSourceHash?: string | null;
  mimeType: string;
  /** Selected plan changes only; unselected changes are intentionally ignored. */
  selectedChanges: readonly BizFileChange[];
  /** Actual company snapshot read after the canonical operation. */
  persisted: BizFileBaselineSnapshot;
  commitStatus: 'COMMITTED' | 'NO_COMMIT' | 'UNKNOWN';
  /** Defaults to every importer section so missing source coverage cannot PASS. */
  requiredSections?: readonly BizFileReviewSectionId[];
  /** Defaults to the existing connector-aware BizFile vision abstraction. */
  extractor?: BizFileIndependentExtractor;
  extractionOptions?: BizFileExtractionOptions;
  now?: Date;
}

type AnyRecord = Record<string, unknown>;
type ExtractionStatus = z.infer<typeof sourceEvidenceSchema>['extractionStatus'];

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : {};
}

function hashBytes(value: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(value)).digest('hex');
}

function uniqueSections(value: readonly BizFileReviewSectionId[] | undefined): BizFileReviewSectionId[] {
  const requested = value && value.length > 0 ? value : BIZFILE_REVIEW_SECTIONS;
  return [...new Set(requested)].filter((section): section is BizFileReviewSectionId => REVIEW_SECTIONS.includes(section as typeof REVIEW_SECTIONS[number]));
}

function findingId(code: string, suffix = ''): string {
  const normalized = `${code}.${suffix}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/\.+$/g, '');
  return `bizfile.review.${normalized}`;
}

function finding(
  code: string,
  message: string,
  options: Partial<z.infer<typeof reviewFindingSchema>> = {},
): z.infer<typeof reviewFindingSchema> {
  return {
    id: findingId(code, options.changeId ?? options.path ?? ''),
    code,
    severity: 'ERROR',
    message,
    ...options,
  };
}

function directPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as AnyRecord)[key];
  }, value);
}

const sourcePathAliases: Record<string, string> = {
  'addresses.registered': 'registeredAddress',
  'addresses.mailing': 'mailingAddress',
};

const sourceCollectionPaths = new Set(['formerNames', 'shareCapital', 'officers', 'shareholders', 'charges']);

function sourceCollectionRows(data: ExtractedBizFileData, path: string): AnyRecord[] {
  const value = path === 'formerNames' ? directPath(data, 'entityDetails.formerNames') : directPath(data, path);
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function hasCollectionIdentity(path: string, value: AnyRecord): boolean {
  if (path === 'formerNames') return value.name != null || value.formerName != null;
  if (path === 'shareCapital') return value.shareClass != null || value.numberOfShares != null;
  if (path === 'officers' || path === 'shareholders') return value.name != null || value.identificationNumber != null;
  if (path === 'charges') return value.chargeNumber != null || value.chargeHolderName != null;
  return false;
}

function sourceValueForChange(data: ExtractedBizFileData, change: BizFileChange): unknown {
  const alias = sourcePathAliases[change.path];
  if (alias) return projectAddress(directPath(data, alias));
  if (change.path === 'auditor') {
    const row = asRecord(directPath(data, change.path));
    return Object.keys(row).length > 0 ? projectAuditor(row) : undefined;
  }
  if (sourceCollectionPaths.has(change.path)) {
    const rows = sourceCollectionRows(data, change.path);
    let row: AnyRecord | undefined;
    if (change.sourceRecordId) {
      const index = Number(change.sourceRecordId.split('.').at(-1));
      if (Number.isInteger(index) && index >= 0) row = rows[index];
    }
    if (!row) {
      const after = asRecord(change.after);
      const before = asRecord(change.before);
      const reference = hasCollectionIdentity(change.path, after) ? after : before;
      if (Object.keys(reference).length > 0) row = rows.find((candidate) => rowMatches(change.path, candidate, reference, change));
    }
    return projectCollection(change.path, row, false);
  }
  if (change.path === 'paidUpCapital' || change.path === 'issuedCapital') {
    return projectCapital(directPath(data, change.path));
  }
  if (change.path === 'treasuryShares') {
    const row = asRecord(directPath(data, change.path));
    return Object.keys(row).length > 0 ? { numberOfShares: row.numberOfShares, currency: optional(row.currency) } : undefined;
  }
  return directPath(data, change.path);
}

const numericKeys = new Set([
  'amount', 'numberOfShares', 'parValue', 'totalValue', 'percentageHeld',
  'endDay', 'endMonth',
]);
const enumCanonicalizers: Record<string, (value: unknown) => unknown> = {
  entityType: canonicalizeEntityType,
  status: canonicalizeCompanyStatus,
  role: canonicalizeOfficerRole,
  identificationType: canonicalizeIdentificationType,
};

function numericComparable(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return numericComparable(String(value));
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
    const normalized = value.trim();
    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [integerPart, fractionPart = ''] = unsigned.split('.');
    const integer = integerPart.replace(/^0+(?=\d)/, '') || '0';
    const fraction = fractionPart.replace(/0+$/, '');
    if (integer === '0' && fraction === '') return '0';
    return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
  }
  if (value && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') return numericComparable((value as { toJSON: () => unknown }).toJSON());
  return undefined;
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return value.slice(0, 10);
  if (value && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') return comparable((value as { toJSON: () => unknown }).toJSON());
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as AnyRecord)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [
          key,
          numericKeys.has(key)
            ? numericComparable(child) ?? comparable(child)
            : enumCanonicalizers[key]
              ? comparable(enumCanonicalizers[key](child))
              : comparable(child),
        ]),
    );
  }
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function isPlainRecord(value: unknown): value is AnyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
  return typeof (value as { toJSON?: unknown }).toJSON !== 'function';
}

/**
 * A change can intentionally approve only a subset of a persisted row (for
 * example a CEASE change only approves cessationDate). Compare every approved
 * key while still using the canonical scalar/date/Decimal comparison above.
 */
function matchesExpected(expected: unknown, actual: unknown, key?: string): boolean {
  if (key && numericKeys.has(key)) {
    const left = numericComparable(expected) ?? comparable(expected);
    const right = numericComparable(actual) ?? comparable(actual);
    return JSON.stringify(left) === JSON.stringify(right);
  }
  if (key && enumCanonicalizers[key]) {
    return matchesExpected(enumCanonicalizers[key](expected), enumCanonicalizers[key](actual));
  }
  if (isPlainRecord(expected) && isPlainRecord(actual)) {
    return Object.entries(expected).every(([childKey, value]) => matchesExpected(value, actual[childKey], childKey));
  }
  return equal(expected, actual);
}

function projectAddress(value: unknown): AnyRecord | undefined {
  const row = asRecord(value);
  if (Object.keys(row).length === 0) return undefined;
  return {
    block: row.block == null ? undefined : row.block,
    streetName: row.streetName,
    level: row.level == null ? undefined : row.level,
    unit: row.unit == null ? undefined : row.unit,
    buildingName: row.buildingName == null ? undefined : row.buildingName,
    postalCode: row.postalCode,
    country: row.country == null || row.country === '' ? 'Singapore' : row.country,
    ...(row.effectiveFrom != null ? { effectiveFrom: row.effectiveFrom } : {}),
  };
}

function projectCapital(value: unknown): AnyRecord | undefined {
  const row = asRecord(value);
  if (row.amount == null && row.currency == null) return undefined;
  return { amount: row.amount, currency: row.currency };
}

function projectAuditor(value: unknown): AnyRecord | undefined {
  const row = asRecord(value);
  if (row.name == null && row.address == null && row.appointmentDate == null) return undefined;
  return { name: row.name, address: row.address, appointmentDate: row.appointmentDate };
}

function optional(value: unknown): unknown {
  return value == null ? undefined : value;
}

function projectCollection(path: string, value: unknown, persisted: boolean): AnyRecord | undefined {
  const row = asRecord(value);
  if (Object.keys(row).length === 0) return undefined;
  if (path === 'formerNames') return { name: persisted ? row.formerName ?? row.name : row.name, effectiveFrom: optional(row.effectiveFrom), effectiveTo: optional(row.effectiveTo) };
  if (path === 'shareCapital') return { shareClass: row.shareClass, currency: row.currency, numberOfShares: row.numberOfShares, parValue: optional(row.parValue), totalValue: row.totalValue, isPaidUp: row.isPaidUp, isTreasury: row.isTreasury ?? false };
  if (path === 'officers') return { name: row.name, role: row.role, identificationType: optional(row.identificationType), identificationNumber: optional(row.identificationNumber), nationality: optional(row.nationality), address: optional(row.address), appointmentDate: optional(row.appointmentDate), cessationDate: optional(row.cessationDate) };
  if (path === 'shareholders') return { name: row.name, type: persisted ? row.shareholderType ?? row.type : row.type, isNominee: row.isNominee ?? false, identificationType: optional(row.identificationType), identificationNumber: optional(row.identificationNumber), nationality: optional(row.nationality), placeOfOrigin: optional(row.placeOfOrigin), address: optional(row.address), shareClass: row.shareClass, numberOfShares: row.numberOfShares, percentageHeld: optional(row.percentageHeld), currency: row.currency ?? 'SGD' };
  if (path === 'charges') return { chargeNumber: optional(row.chargeNumber), chargeType: optional(row.chargeType), description: optional(row.description), chargeHolderName: row.chargeHolderName, amountSecured: optional(row.amountSecured), amountSecuredText: optional(row.amountSecuredText), currency: optional(row.currency), registrationDate: optional(row.registrationDate), dischargeDate: optional(row.dischargeDate) };
  return undefined;
}

function collectionRows(baseline: BizFileBaselineSnapshot, path: string): AnyRecord[] {
  const key = path as keyof BizFileBaselineSnapshot;
  const rows = baseline[key];
  return Array.isArray(rows) ? rows.map(asRecord) : [];
}

function rowMatches(path: string, row: AnyRecord, source: AnyRecord, change: BizFileChange): boolean {
  if (change.targetId && row.id === change.targetId) return true;
  if (path === 'formerNames') return row.formerName === source.name || row.name === source.name;
  if (path === 'shareCapital') return row.shareClass === source.shareClass && row.numberOfShares === source.numberOfShares;
  if (path === 'officers' || path === 'shareholders') {
    if (source.identificationNumber && row.identificationNumber === source.identificationNumber) return true;
    return row.name === source.name && (!source.role || row.role === source.role) && (!source.shareClass || row.shareClass === source.shareClass);
  }
  if (path === 'charges') return Boolean(source.chargeNumber && row.chargeNumber === source.chargeNumber) || row.chargeHolderName === source.chargeHolderName;
  return false;
}

function persistedValueForChange(baseline: BizFileBaselineSnapshot, change: BizFileChange, sourceValue: unknown): unknown {
  const company = asRecord(baseline.company);
  const scalarFields: Record<string, unknown> = {
    'entityDetails.uen': company.uen,
    'entityDetails.name': company.name,
    'entityDetails.displayAlias': company.displayAlias,
    'entityDetails.formerName': company.formerName,
    'entityDetails.dateOfNameChange': company.dateOfNameChange,
    'entityDetails.entityType': company.entityType,
    'entityDetails.status': company.status,
    'entityDetails.statusDate': company.statusDate,
    'entityDetails.incorporationDate': company.incorporationDate,
    'entityDetails.registrationDate': company.registrationDate,
    'ssicActivities.primary.code': company.primarySsicCode,
    'ssicActivities.primary.description': company.primarySsicDescription,
    'ssicActivities.secondary.code': company.secondarySsicCode,
    'ssicActivities.secondary.description': company.secondarySsicDescription,
    'financialYear.endDay': company.financialYearEndDay,
    'financialYear.endMonth': company.financialYearEndMonth,
    'compliance.lastAgmDate': company.lastAgmDate,
    'compliance.lastArFiledDate': company.lastArFiledDate,
    'compliance.accountsDueDate': company.accountsDueDate,
    'compliance.fyeAsAtLastAr': company.fyeAsAtLastAr,
    homeCurrency: company.homeCurrency,
  };
  if (Object.prototype.hasOwnProperty.call(scalarFields, change.path)) return scalarFields[change.path];
  if (change.path === 'paidUpCapital' || change.path === 'issuedCapital') {
    const prefix = change.path === 'paidUpCapital' ? 'paidUpCapital' : 'issuedCapital';
    return projectCapital({ amount: company[`${prefix}Amount`], currency: company[`${prefix}Currency`] });
  }
  if (change.path === 'addresses.registered' || change.path === 'addresses.mailing') {
    const addressType = change.path.endsWith('registered') ? 'REGISTERED_OFFICE' : 'MAILING';
    return projectAddress((baseline.addresses ?? []).find((row) => row.addressType === addressType));
  }
  if (change.path === 'auditor') {
    const row = asRecord(baseline.auditor);
    return projectAuditor(row);
  }
  if (change.path === 'treasuryShares') {
    const row = (baseline.shareCapital ?? []).find((candidate) => candidate.isTreasury === true);
    return row ? { numberOfShares: row.numberOfShares, currency: row.currency } : undefined;
  }
  const collectionPaths = new Set(['formerNames', 'shareCapital', 'officers', 'shareholders', 'charges']);
  if (collectionPaths.has(change.path)) {
    const sourceRow = asRecord(sourceValue ?? change.after);
    const row = collectionRows(baseline, change.path).find((candidate) => rowMatches(change.path, candidate, sourceRow, change));
    return projectCollection(change.path, row, true);
  }
  return undefined;
}

function emptyReport(
  input: BizFileIndependentReviewInput,
  source: z.infer<typeof sourceEvidenceSchema>,
  findings: z.infer<typeof reviewFindingSchema>[],
  extractionStatus: ExtractionStatus,
  observedAt: string,
): BizFileIndependentReviewReport {
  const requiredSections = uniqueSections(input.requiredSections);
  const reviewedSections: BizFileReviewSectionId[] = [];
  const missingSections = [...requiredSections];
  const coverage = {
    requiredSections,
    assessedSections: [],
    reviewedSections,
    missingSections,
    sourceCoverageAvailable: false,
    sourceCoverageComplete: false,
    selectedChangeCount: input.selectedChanges.length,
    comparedChangeCount: 0,
    missingSourceFieldCount: input.selectedChanges.length,
    missingPersistedFieldCount: input.selectedChanges.length,
    sourceCoverage: null,
    comparisonScope: 'SELECTED_CHANGES_ONLY',
    fullSourceReviewComplete: false,
    complete: false,
  };
  return bizFileIndependentReviewReportSchema.parse({
    schemaVersion: '1',
    verdict: extractionStatus === 'FAILED' ? 'REVIEW_FAILED' : 'NEEDS_REVIEW',
    executionConformance: 'UNVERIFIABLE',
    sourceAlignment: 'INCOMPLETE',
    commitStatus: input.commitStatus,
    source,
    selectedChanges: input.selectedChanges.map((change) => ({
      changeId: change.id,
      path: change.path,
      approvedMatches: false,
      matches: false,
    })),
    findings,
    coverage,
    observedAt,
  });
}

function coverageAttestationForExtraction(extracted: BizFileIndependentExtractionResult): unknown {
  if (extracted.sourceCoverageAttestation !== undefined) return extracted.sourceCoverageAttestation;
  const coverage = extracted.sourceCoverage;
  if (!coverage?.sourceHash || !Array.isArray(coverage.sections)) return undefined;
  return {
    schemaVersion: coverage.schemaVersion,
    sourceHash: coverage.sourceHash,
    sections: coverage.sections,
  };
}

/**
 * Independently assess a committed BizFile operation against its original
 * bytes. This function only reads bytes/extraction output and a persisted
 * snapshot; it never calls a writer or changes effect completion state.
 */
export async function assessBizFileIndependentSourceReview(
  input: BizFileIndependentReviewInput,
): Promise<BizFileIndependentReviewReport> {
  const observedAt = (input.now ?? new Date()).toISOString();
  const observedHash = input.sourceBytes.length > 0 ? hashBytes(input.sourceBytes) : null;
  const expectedHash = typeof input.expectedSourceHash === 'string' && SHA256_PATTERN.test(input.expectedSourceHash)
    ? input.expectedSourceHash
    : null;
  const sourceBase = {
    expectedHash,
    observedHash,
    hashVerified: Boolean(expectedHash && observedHash && expectedHash === observedHash),
    extractionStatus: 'MISSING' as ExtractionStatus,
    provider: null,
    model: null,
  };
  if (!expectedHash) return emptyReport(input, sourceBase, [finding('SOURCE_HASH_UNAVAILABLE', 'The prepared BizFile source hash is missing or malformed.')], 'MISSING', observedAt);
  if (!observedHash) return emptyReport(input, sourceBase, [finding('SOURCE_BYTES_MISSING', 'The original BizFile bytes are unavailable for independent review.')], 'MISSING', observedAt);
  if (observedHash !== expectedHash) {
    return bizFileIndependentReviewReportSchema.parse({
      ...emptyReport(input, { ...sourceBase, extractionStatus: 'FAILED' }, [finding('SOURCE_HASH_MISMATCH', 'The original BizFile bytes do not match the prepared source hash.')], 'FAILED', observedAt),
      verdict: 'REVIEW_FAILED',
    });
  }

  let extracted: BizFileIndependentExtractionResult;
  try {
    const visionInput: BizFileVisionInput = {
      base64: Buffer.from(input.sourceBytes).toString('base64'),
      mimeType: input.mimeType,
    };
    extracted = input.extractor
      ? await input.extractor(visionInput, input.extractionOptions)
      : await extractBizFileForIndependentReview({
        sourceBytes: input.sourceBytes,
        expectedSourceHash: expectedHash,
        mimeType: input.mimeType,
        requiredSections: input.requiredSections,
        extractionOptions: input.extractionOptions,
        beforeProviderDispatch: input.beforeProviderDispatch,
      });
  } catch {
    return emptyReport(input, { ...sourceBase, extractionStatus: 'FAILED' }, [finding('INDEPENDENT_EXTRACTION_FAILED', 'Independent BizFile source extraction did not complete; retry the review.')], 'FAILED', observedAt);
  }

  const parsed = bizFileReviewSchema.safeParse(extracted?.data);
  if (!parsed.success) {
    return emptyReport(input, { ...sourceBase, extractionStatus: 'INVALID', provider: extracted?.providerUsed ?? null, model: extracted?.modelUsed ?? null }, [finding('INDEPENDENT_EXTRACTION_INVALID', 'Independent BizFile extraction did not satisfy the reviewed data contract.')], 'INVALID', observedAt);
  }
  const independent = normalizeBizFileReviewDraft(parsed.data);
  const requiredSections = uniqueSections(input.requiredSections);
  const coverageValidation = await validateBizFileIndependentSourceCoverage({
    sourceBytes: input.sourceBytes,
    expectedSourceHash: expectedHash,
    mimeType: input.mimeType,
    requiredSections,
    reportedCoverage: coverageAttestationForExtraction(extracted),
  });
  const sourceCoverage = coverageValidation.coverage;
  const sourceCoverageAvailable = coverageValidation.contractValid;
  const assessedSections = sourceCoverage.assessedSections;
  const reviewed = sourceCoverage.reviewedSections;
  const missingSections = sourceCoverage.missingSections;
  const findings: z.infer<typeof reviewFindingSchema>[] = [];
  if (!sourceCoverageAvailable) {
    findings.push(finding('SOURCE_COVERAGE_INVALID', 'Independent extraction did not return the strict source coverage contract; full-source review cannot pass.'));
  }
  findings.push(...missingSections.map((section) => ({
    ...finding('SOURCE_SECTION_MISSING', `Independent source extraction did not cover the ${section} section.`, { path: section }),
    severity: 'WARNING' as const,
  })));
  findings.push(...sourceCoverage.validationErrors.map((error) => ({
    ...finding(
      error.startsWith('SOURCE_PAGE_REFERENCE_') ? 'SOURCE_PAGE_REFERENCE_INVALID' : 'SOURCE_COVERAGE_INVALID',
      `Independent source coverage validation failed: ${error}.`,
    ),
    severity: 'WARNING' as const,
  })));
  findings.push(...sourceCoverage.unreadableSections.map((section) => ({
    ...finding('SOURCE_SECTION_UNREADABLE', `The ${section} section could not be read independently.`, { path: section }),
    severity: 'WARNING' as const,
  })));
  findings.push(...sourceCoverage.unsupportedSections.map((section) => ({
    ...finding('SOURCE_SECTION_UNSUPPORTED', `The ${section} section is unsupported by the independent reviewer.`, { path: section }),
    severity: 'WARNING' as const,
  })));
  if (sourceCoverage.missingPages.length > 0) {
    findings.push({
      ...finding('SOURCE_PAGE_MISSING', `Independent source coverage did not reference page(s): ${sourceCoverage.missingPages.join(', ')}.`),
      severity: 'WARNING' as const,
    });
  }
  findings.push(finding(
    'SOURCE_REVIEW_SELECTED_ONLY',
    'Independent comparison covers selected approved fields only; unselected source differences remain unreviewed.',
    { severity: 'WARNING' },
  ));
  const comparisons: z.infer<typeof fieldComparisonSchema>[] = [];
  let missingSourceFieldCount = 0;
  let missingPersistedFieldCount = 0;
  let sourceMismatchCount = 0;
  let approvedMismatchCount = 0;
  if (input.selectedChanges.length === 0) {
    findings.push(finding('NO_SELECTED_CHANGES', 'Independent review has no approved selected changes to verify.', { severity: 'ERROR' }));
  }
  for (const change of input.selectedChanges) {
    const sourceValue = sourceValueForChange(independent, change);
    const persistedValue = persistedValueForChange(input.persisted, change, sourceValue);
    const sourceMissing = sourceValue === undefined;
    const approvedValue = change.operation === 'CLEAR' || change.operation === 'REMOVE' ? null : change.after;
    if (sourceMissing) {
      missingSourceFieldCount += 1;
      findings.push(finding('SOURCE_FIELD_MISSING', `Independent source extraction did not provide ${change.path}.`, { path: change.path, changeId: change.id }));
    }
    const matches = !sourceMissing && persistedValue !== undefined && matchesExpected(sourceValue, persistedValue);
    const approvedMatches = persistedValue !== undefined && matchesExpected(approvedValue, persistedValue);
    comparisons.push({
      changeId: change.id,
      path: change.path,
      ...(sourceValue !== undefined ? { sourceValue } : {}),
      ...(persistedValue !== undefined ? { persistedValue } : {}),
      ...(approvedValue !== undefined ? { approvedValue } : {}),
      approvedMatches,
      matches,
    });
    if (persistedValue === undefined) {
      missingPersistedFieldCount += 1;
      approvedMismatchCount += 1;
      findings.push(finding('PERSISTED_FIELD_MISSING', `Persisted read-back did not contain ${change.path}.`, { path: change.path, changeId: change.id, expected: approvedValue }));
    } else if (!approvedMatches) {
      approvedMismatchCount += 1;
      findings.push(finding('APPROVED_FIELD_MISMATCH', `Persisted ${change.path} does not match the approved change outcome.`, { path: change.path, changeId: change.id, expected: approvedValue, actual: persistedValue }));
    }
    if (!sourceMissing && persistedValue !== undefined && !matches) {
      sourceMismatchCount += 1;
      findings.push(finding('SELECTED_FIELD_MISMATCH', `Persisted ${change.path} does not match the independently extracted source.`, { path: change.path, changeId: change.id, expected: sourceValue, actual: persistedValue }));
    }
  }
  if (input.commitStatus !== 'COMMITTED') findings.push(finding('COMMIT_NOT_CONFIRMED', 'Independent factual review requires a committed canonical outcome.', { severity: 'WARNING' }));
  const sourceCoverageComplete = sourceCoverageAvailable && sourceCoverage.complete;
  const complete = input.selectedChanges.length > 0
    && sourceCoverageComplete
    && missingSections.length === 0
    && missingSourceFieldCount === 0
    && missingPersistedFieldCount === 0
    && sourceBase.hashVerified
    && input.commitStatus === 'COMMITTED';
  const sourceAlignment = !sourceBase.hashVerified || !sourceCoverageComplete || missingSourceFieldCount > 0
    ? 'INCOMPLETE'
    : sourceMismatchCount > 0 || missingPersistedFieldCount > 0 ? 'DIFFERENCES_PRESENT' : 'NO_UNEXPLAINED_DIFFERENCE';
  const executionConformance = input.commitStatus !== 'COMMITTED'
    ? 'UNVERIFIABLE'
      : approvedMismatchCount > 0 ? 'FAIL'
        : complete ? 'PASS' : 'UNVERIFIABLE';
  const fullSourceReviewComplete = false;
  const verdict = input.commitStatus !== 'COMMITTED' || !complete || sourceMismatchCount > 0 || approvedMismatchCount > 0
    || !fullSourceReviewComplete
    ? 'NEEDS_REVIEW'
    : findings.some((entry) => entry.severity === 'WARNING') ? 'PASS_WITH_WARNINGS' : 'PASS';
  return bizFileIndependentReviewReportSchema.parse({
    schemaVersion: '1',
    verdict,
    executionConformance,
    sourceAlignment,
    commitStatus: input.commitStatus,
    source: { ...sourceBase, extractionStatus: 'COMPLETE', provider: extracted.providerUsed, model: extracted.modelUsed },
    selectedChanges: comparisons,
    findings,
    coverage: {
      requiredSections,
      assessedSections,
      reviewedSections: reviewed,
      missingSections,
      sourceCoverageAvailable,
      sourceCoverageComplete,
      selectedChangeCount: input.selectedChanges.length,
      comparedChangeCount: comparisons.length,
      missingSourceFieldCount,
      missingPersistedFieldCount,
      sourceCoverage,
      comparisonScope: 'SELECTED_CHANGES_ONLY',
      fullSourceReviewComplete,
      complete,
    },
    observedAt,
  });
}
