import { hashConfiguration } from '@/services/service-schedule/hash';
import {
  formatDateOnly,
  parseDateOnly,
  type BusinessCalendarSnapshot,
  type DateOnly,
} from '@/services/service-schedule';
import { prisma } from '@/lib/prisma';
import { getCompanyDisplayLabel } from '@/lib/company-display-label';
import { Prisma, type Prisma as PrismaTypes } from '@/generated/prisma';
import { canonicalizeBillingSchedule, evaluateBillingSchedule } from './schedule';
import type { BillingScheduleConfigV1, EvaluatedBillingOccurrence } from './types';

export type BillingCoverageIssueType =
  | 'MISSING_DISPOSITION'
  | 'MISSING_FEE_LINES'
  | 'MISSING_START_DATE'
  | 'INVALID_CUSTOM_SCHEDULE'
  | 'MISSING_SCHEDULE_PARAMETER'
  | 'OCCURRENCE_GAP'
  | 'INVALID_AMOUNT_OR_CURRENCY';

export type BillingCoverageIssueSeverity = 'ERROR' | 'WARNING';

export type BillingCoverageIssueSummary = {
  issueKey: string;
  type: BillingCoverageIssueType;
  severity: BillingCoverageIssueSeverity;
  feeLineId: string | null;
  message: string;
};

type CoverageIssueWithDetails = BillingCoverageIssueSummary & {
  details: Record<string, unknown>;
};

export type BillingCoverageResult = {
  clientServiceId: string;
  opened: number;
  refreshed: number;
  resolved: number;
  openIssues: BillingCoverageIssueSummary[];
};

export type ReconcileBillingCoverageInput = {
  tenantId: string;
  clientServiceId: string;
  today: DateOnly;
  horizonEnd: DateOnly;
  writeMode: 'OBSERVE' | 'APPLY';
};

export type BillingCoverageListInput = {
  tenantId: string;
  companyIds?: readonly string[];
  types?: readonly BillingCoverageIssueType[];
  severities?: readonly BillingCoverageIssueSeverity[];
};

export type BillingCoverageSummary = {
  openIssueCount: number;
  affectedServiceCount: number;
  healthyActiveServiceCount: number;
  issues: Array<{
    id: string;
    type: BillingCoverageIssueType;
    severity: BillingCoverageIssueSeverity;
    company: { id: string; name: string; displayLabel: string };
    service: { id: string; name: string; familyName: string; familyColor: string };
    feeLine: { id: string; description: string } | null;
    message: string;
  }>;
};

type CoverageDb = PrismaTypes.TransactionClient | typeof prisma;

type CoverageFeeLine = {
  id: string;
  description?: string | null;
  amount?: unknown;
  currency?: string | null;
  billingFrequency?: string | null;
  customFrequencyLabel?: string | null;
  billingStartDate?: Date | string | null;
  scheduleConfig?: unknown;
  billingTiming?: string | null;
  isActive?: boolean;
  deletedAt?: Date | string | null;
};

type CoverageService = {
  id: string;
  tenantId: string;
  companyId: string;
  status?: string | null;
  deletedAt?: Date | string | null;
  billingDisposition?: string | null;
  billingNotRequiredReason?: string | null;
  feeLines?: CoverageFeeLine[];
};

type CoverageIssueRecord = {
  id?: string;
  issueKey: string;
  type: BillingCoverageIssueType | string;
  severity: BillingCoverageIssueSeverity | string;
  feeLineId?: string | null;
  details?: unknown;
  company?: { id?: string; tenantId?: string; name?: string | null; displayAlias?: string | null } | null;
  clientService?: {
    id?: string;
    tenantId?: string;
    serviceName?: string | null;
    familyName?: string | null;
    serviceVariant?: {
      id?: string;
      family?: { id?: string; name?: string | null; displayColor?: string | null } | null;
    } | null;
  } | null;
  feeLine?: { id?: string; description?: string | null } | null;
};

type CoverageOccurrence = {
  feeLineId: string;
  billingPeriodKey: string;
  scheduleEntryKey: string;
  generationKey: string;
  status?: string;
};

type CoverageIssueDelegate = {
  findMany?: (args: unknown) => Promise<unknown>;
  findFirst?: (args: unknown) => Promise<unknown>;
  create?: (args: unknown) => Promise<unknown>;
  update?: (args: unknown) => Promise<unknown>;
  updateMany?: (args: unknown) => Promise<{ count: number }>;
};

type RawCoverageClient = {
  $queryRaw?: <T>(query: PrismaTypes.Sql) => Promise<T>;
};

type CoverageOccurrenceDelegate = {
  findMany?: (args: unknown) => Promise<unknown>;
};

const COVERAGE_OCCURRENCE_STATUSES = new Set(['OPEN', 'BILLED', 'WAIVED']);
const MAX_COVERAGE_CONFLICT_RETRIES = 3;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asCoverageDb(db: CoverageDb): CoverageDb & {
  billingCoverageIssue?: CoverageIssueDelegate;
  billingOccurrence?: CoverageOccurrenceDelegate;
  clientService?: { findFirst?: (args: unknown) => Promise<unknown> };
  businessCalendar?: { findFirst?: (args: unknown) => Promise<unknown> };
} {
  return db as CoverageDb & {
    billingCoverageIssue?: CoverageIssueDelegate;
    billingOccurrence?: CoverageOccurrenceDelegate;
    clientService?: { findFirst?: (args: unknown) => Promise<unknown> };
    businessCalendar?: { findFirst?: (args: unknown) => Promise<unknown> };
  };
}

function dateOnly(value: unknown): DateOnly | null {
  try {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDateOnly(value);
    if (typeof value === 'string') {
      const candidate = value.slice(0, 10) as DateOnly;
      parseDateOnly(candidate);
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

function amountString(value: unknown): string {
  if (value && typeof value === 'object' && 'toFixed' in value && typeof value.toFixed === 'function') {
    return value.toFixed(2);
  }
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function validAmount(value: unknown): boolean {
  const normalized = amountString(value);
  if (!normalized || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return false;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0;
}

function validCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

function feeLineIsActive(line: CoverageFeeLine): boolean {
  return line.isActive !== false && line.deletedAt == null;
}

function serviceIsActive(service: CoverageService): boolean {
  return service.status === 'ACTIVE' && service.deletedAt == null;
}

function issueMessage(type: BillingCoverageIssueType, feeLineId: string | null, details: Record<string, unknown>): string {
  switch (type) {
    case 'MISSING_DISPOSITION': return 'Review the billing disposition for this service';
    case 'MISSING_FEE_LINES': return 'Configured billing requires at least one active fee line';
    case 'MISSING_START_DATE': return `Set a billing start date${feeLineId ? ' for this fee line' : ''}`;
    case 'INVALID_CUSTOM_SCHEDULE': return 'Review the custom billing schedule definition';
    case 'MISSING_SCHEDULE_PARAMETER': return 'Complete the billing schedule parameters';
    case 'OCCURRENCE_GAP': return `Expected billing occurrences are missing (${String(details.missingCount ?? 0)})`;
    case 'INVALID_AMOUNT_OR_CURRENCY': return 'Set a non-negative amount and a three-letter ISO currency code';
  }
}

function issueSeverity(type: BillingCoverageIssueType): BillingCoverageIssueSeverity {
  return type === 'OCCURRENCE_GAP' ? 'WARNING' : 'ERROR';
}

function safeIssueDetails(details: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (typeof details.scheduleKey === 'string' && details.scheduleKey.length <= 100) {
    safe.scheduleKey = details.scheduleKey;
  }
  if (typeof details.missingCount === 'number'
    && Number.isSafeInteger(details.missingCount)
    && details.missingCount >= 0
    && details.missingCount <= 10_000) {
    safe.missingCount = details.missingCount;
  }
  if (typeof details.firstMissingPeriod === 'string' && details.firstMissingPeriod.length <= 100) {
    safe.firstMissingPeriod = details.firstMissingPeriod;
  }
  if (typeof details.message === 'string' && details.message.length <= 500) {
    safe.message = details.message;
  }
  return safe;
}

/** Build the deterministic SHA-256 identity for one coverage issue. */
export function billingCoverageIssueKey(input: {
  tenantId: string;
  clientServiceId: string;
  feeLineId: string | null;
  type: BillingCoverageIssueType;
  scheduleKey: string;
}): string {
  return hashConfiguration({
    tenantId: input.tenantId,
    clientServiceId: input.clientServiceId,
    feeLineId: input.feeLineId,
    type: input.type,
    scheduleKey: input.scheduleKey,
  });
}

function calendarFromRecord(record: unknown): BusinessCalendarSnapshot {
  const value = asRecord(record);
  const holidays = Array.isArray(value.holidays)
    ? value.holidays.map((holiday) => dateOnly(asRecord(holiday).date ?? holiday)).filter((date): date is DateOnly => date !== null)
    : [];
  const weekendDays = Array.isArray(value.weekendDays)
    ? value.weekendDays.filter((day): day is number => typeof day === 'number')
    : [0, 6];
  return {
    id: typeof value.id === 'string' ? value.id : 'default',
    timeZone: typeof value.timeZone === 'string' ? value.timeZone : 'Asia/Singapore',
    revision: typeof value.revision === 'number' ? value.revision : 1,
    weekendDays: new Set(weekendDays),
    holidays: new Set(holidays),
  };
}

async function loadCalendar(db: CoverageDb, tenantId: string): Promise<BusinessCalendarSnapshot> {
  const delegate = asCoverageDb(db).businessCalendar;
  if (!delegate?.findFirst) return calendarFromRecord(null);
  const record = await delegate.findFirst({
    where: { tenantId, isActive: true, archivedAt: null },
    include: { holidays: { where: { tenantId, isActive: true } } },
  });
  return calendarFromRecord(record);
}

async function loadOpenIssues(db: CoverageDb, tenantId: string, clientServiceId: string): Promise<CoverageIssueRecord[]> {
  const delegate = asCoverageDb(db).billingCoverageIssue;
  if (!delegate?.findMany) return [];
  const rows = await delegate.findMany({
    where: { tenantId, clientServiceId, resolvedAt: null },
    orderBy: [{ lastDetectedAt: 'desc' }, { id: 'asc' }],
  });
  return (Array.isArray(rows) ? rows : []) as CoverageIssueRecord[];
}

async function loadOpenIssueByKey(
  db: CoverageDb,
  tenantId: string,
  clientServiceId: string,
  issueKey: string,
): Promise<CoverageIssueRecord | null> {
  const delegate = asCoverageDb(db).billingCoverageIssue;
  const where = { tenantId, clientServiceId, issueKey, resolvedAt: null };
  if (delegate?.findFirst) {
    const row = await delegate.findFirst({ where });
    return row ? row as CoverageIssueRecord : null;
  }
  if (delegate?.findMany) {
    const rows = await delegate.findMany({ where, take: 1 });
    return Array.isArray(rows) && rows[0] ? rows[0] as CoverageIssueRecord : null;
  }
  return null;
}

async function loadOccurrences(db: CoverageDb, tenantId: string, clientServiceId: string): Promise<CoverageOccurrence[]> {
  const delegate = asCoverageDb(db).billingOccurrence;
  if (!delegate?.findMany) return [];
  const rows = await delegate.findMany({
    where: { tenantId, clientServiceId },
    select: { feeLineId: true, billingPeriodKey: true, scheduleEntryKey: true, generationKey: true, status: true },
  });
  return (Array.isArray(rows) ? rows : []) as CoverageOccurrence[];
}

function issueSummary(issue: BillingCoverageIssueSummary | CoverageIssueRecord): CoverageIssueWithDetails {
  if ('message' in issue) {
    const details = 'details' in issue ? asRecord(issue.details) : {};
    return { ...issue, details: safeIssueDetails(details) };
  }
  const details = asRecord(issue.details);
  return {
    issueKey: issue.issueKey,
    type: issue.type as BillingCoverageIssueType,
    severity: issue.severity as BillingCoverageIssueSeverity,
    feeLineId: issue.feeLineId ?? null,
    message: typeof details.message === 'string'
      ? details.message
      : issueMessage(issue.type as BillingCoverageIssueType, issue.feeLineId ?? null, details),
    details: safeIssueDetails(details),
  };
}

function publicIssue(issue: CoverageIssueWithDetails): BillingCoverageIssueSummary {
  const { details: _details, ...summary } = issue;
  return summary;
}

function expectedIdentity(value: Pick<EvaluatedBillingOccurrence, 'feeLineId' | 'billingPeriodKey' | 'scheduleEntryKey' | 'generationKey'>): string {
  return [value.feeLineId, value.billingPeriodKey, value.scheduleEntryKey, value.generationKey].join('|');
}

function occurrenceIdentity(value: CoverageOccurrence): string {
  return [value.feeLineId, value.billingPeriodKey, value.scheduleEntryKey, value.generationKey].join('|');
}

function scheduleConfigFor(line: CoverageFeeLine): { config: BillingScheduleConfigV1 | null; issueType: BillingCoverageIssueType | null } {
  if (!line.billingFrequency) return { config: null, issueType: 'MISSING_SCHEDULE_PARAMETER' };
  const raw = line.scheduleConfig !== null && line.scheduleConfig !== undefined ? asRecord(line.scheduleConfig) : null;
  const rawCadence = typeof raw?.cadence === 'string' ? raw.cadence : line.billingFrequency;
  if (raw) {
    if (!hasOwn(raw, 'startDate') || raw.startDate === null) return { config: null, issueType: 'MISSING_START_DATE' };
    if (!hasOwn(raw, 'scheduleEntries') || raw.scheduleEntries === null || (Array.isArray(raw.scheduleEntries) && raw.scheduleEntries.length === 0)) {
      return { config: null, issueType: 'MISSING_SCHEDULE_PARAMETER' };
    }
    if (rawCadence === 'CUSTOM') {
      if (!hasOwn(raw, 'customInterval') || raw.customInterval === null) return { config: null, issueType: 'MISSING_SCHEDULE_PARAMETER' };
      if (typeof raw.customInterval !== 'object' || Array.isArray(raw.customInterval)) return { config: null, issueType: 'INVALID_CUSTOM_SCHEDULE' };
      const interval = asRecord(raw.customInterval);
      if (!hasOwn(interval, 'unit') || !hasOwn(interval, 'count') || interval.unit === null || interval.count === null) return { config: null, issueType: 'MISSING_SCHEDULE_PARAMETER' };
    }
  }
  let config: BillingScheduleConfigV1 | null;
  try {
    config = canonicalizeBillingSchedule({
      billingFrequency: line.billingFrequency,
      billingStartDate: line.billingStartDate ?? null,
      customFrequencyLabel: line.customFrequencyLabel ?? null,
      scheduleConfig: line.scheduleConfig,
    });
  } catch {
    return { config: null, issueType: rawCadence === 'CUSTOM' ? 'INVALID_CUSTOM_SCHEDULE' : 'MISSING_SCHEDULE_PARAMETER' };
  }
  if (!config) return { config: null, issueType: rawCadence === 'CUSTOM' ? 'INVALID_CUSTOM_SCHEDULE' : 'MISSING_SCHEDULE_PARAMETER' };
  if (!config.startDate) return { config, issueType: 'MISSING_START_DATE' };
  if (config.scheduleEntries.length === 0) return { config, issueType: 'MISSING_SCHEDULE_PARAMETER' };
  return { config, issueType: null };
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function buildIssue(
  input: ReconcileBillingCoverageInput,
  type: BillingCoverageIssueType,
  feeLineId: string | null,
  scheduleKey: string,
  details: Record<string, unknown> = {},
): CoverageIssueWithDetails {
  const issueDetails = { ...details, message: issueMessage(type, feeLineId, details), scheduleKey };
  return {
    issueKey: billingCoverageIssueKey({
      tenantId: input.tenantId,
      clientServiceId: input.clientServiceId,
      feeLineId,
      type,
      scheduleKey,
    }),
    type,
    severity: issueSeverity(type),
    feeLineId,
    message: issueDetails.message,
    details: safeIssueDetails(issueDetails),
  };
}

function detailsForIssue(
  issue: CoverageIssueWithDetails,
  input: ReconcileBillingCoverageInput,
): Record<string, unknown> {
  return {
    ...safeIssueDetails(issue.details ?? {}),
    message: issue.message,
    detectedOn: input.today,
    issueType: issue.type,
    feeLineId: issue.feeLineId,
  };
}

function isUniqueIssueConflict(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  if (value?.code === 'P2002') return true;
  return typeof value?.message === 'string'
    && /unique constraint|duplicate key/i.test(value.message);
}

async function persistDetectedIssueAtomically(
  db: CoverageDb,
  input: ReconcileBillingCoverageInput,
  companyId: string,
  issue: CoverageIssueWithDetails,
): Promise<'opened' | 'refreshed' | null> {
  const client = db as CoverageDb & RawCoverageClient;
  if (typeof client.$queryRaw !== 'function') return null;
  const now = new Date();
  const details = JSON.stringify(detailsForIssue(issue, input));
  const rows = await client.$queryRaw<Array<{ inserted: boolean }>>(Prisma.sql`
    INSERT INTO "billing_coverage_issues" (
      "tenant_id", "company_id", "client_service_id", "fee_line_id",
      "issue_type", "severity", "issue_key", "details",
      "first_detected_at", "last_detected_at", "resolved_at", "created_at", "updated_at"
    ) VALUES (
      ${input.tenantId}, ${companyId}, ${input.clientServiceId}, ${issue.feeLineId},
      CAST(${issue.type} AS "BillingCoverageIssueType"),
      CAST(${issue.severity} AS "BillingCoverageIssueSeverity"),
      ${issue.issueKey}, CAST(${details} AS jsonb),
      ${now}, ${now}, NULL, ${now}, ${now}
    )
    ON CONFLICT ("tenant_id", "issue_key") WHERE "resolved_at" IS NULL
    DO UPDATE SET
      "issue_type" = EXCLUDED."issue_type",
      "severity" = EXCLUDED."severity",
      "fee_line_id" = EXCLUDED."fee_line_id",
      "details" = EXCLUDED."details",
      "last_detected_at" = EXCLUDED."last_detected_at",
      "resolved_at" = NULL,
      "updated_at" = EXCLUDED."updated_at"
    RETURNING ("xmax" = 0) AS "inserted"
  `);
  const row = rows[0];
  if (!row) throw new Error('Billing coverage issue upsert returned no row');
  return row.inserted ? 'opened' : 'refreshed';
}

async function persistDetectedIssue(
  db: CoverageDb,
  input: ReconcileBillingCoverageInput,
  companyId: string,
  issue: CoverageIssueWithDetails,
  existing: CoverageIssueRecord | undefined,
): Promise<'opened' | 'refreshed'> {
  const atomicOutcome = await persistDetectedIssueAtomically(db, input, companyId, issue);
  if (atomicOutcome) return atomicOutcome;

  const delegate = asCoverageDb(db).billingCoverageIssue;
  let current = existing;
  let lastConflict: unknown;

  for (let attempt = 0; attempt < MAX_COVERAGE_CONFLICT_RETRIES; attempt += 1) {
    if (current?.id && delegate?.update) {
      try {
        await delegate.update({
          where: {
            id: current.id,
            tenantId: input.tenantId,
            clientServiceId: input.clientServiceId,
            resolvedAt: null,
          },
          data: {
            type: issue.type,
            severity: issue.severity,
            feeLineId: issue.feeLineId,
            details: detailsForIssue(issue, input),
            lastDetectedAt: new Date(),
            resolvedAt: null,
          },
        });
        return 'refreshed';
      } catch (error) {
        if (!isUniqueIssueConflict(error)) throw error;
        lastConflict = error;
      }
    } else if (delegate?.create) {
      try {
        await delegate.create({
          data: {
            tenantId: input.tenantId,
            companyId,
            clientServiceId: input.clientServiceId,
            feeLineId: issue.feeLineId,
            type: issue.type,
            severity: issue.severity,
            issueKey: issue.issueKey,
            details: detailsForIssue(issue, input),
            firstDetectedAt: new Date(),
            lastDetectedAt: new Date(),
            resolvedAt: null,
          },
        });
        return 'opened';
      } catch (error) {
        if (!isUniqueIssueConflict(error)) throw error;
        lastConflict = error;
      }
    } else {
      return 'opened';
    }

    // A concurrent transaction won the partial unique open-issue index. Once
    // it commits, reload the row and refresh it instead of failing the whole
    // worker transaction. The bounded retry also prevents an endless race.
    current = (await loadOpenIssueByKey(db, input.tenantId, input.clientServiceId, issue.issueKey)) ?? undefined;
  }

  throw lastConflict ?? new Error('Billing coverage issue persistence conflict');
}

async function persistIssues(
  db: CoverageDb,
  input: ReconcileBillingCoverageInput,
  companyId: string,
  issues: CoverageIssueWithDetails[],
  existing: CoverageIssueRecord[],
): Promise<Pick<BillingCoverageResult, 'opened' | 'refreshed' | 'resolved'>> {
  const delegate = asCoverageDb(db).billingCoverageIssue;
  const existingByKey = new Map(existing.map((issue) => [issue.issueKey, issue]));
  const detectedKeys = [...new Set(issues.map((issue) => issue.issueKey))];
  const now = new Date();
  let opened = 0;
  let refreshed = 0;
  for (const issue of issues) {
    const outcome = await persistDetectedIssue(db, input, companyId, issue, existingByKey.get(issue.issueKey));
    if (outcome === 'opened') opened += 1;
    else refreshed += 1;
  }

  let resolved = existing.filter((issue) => !detectedKeys.includes(issue.issueKey)).length;
  if (delegate?.updateMany) {
    const result = await delegate.updateMany({
      where: {
        tenantId: input.tenantId,
        clientServiceId: input.clientServiceId,
        resolvedAt: null,
        issueKey: { notIn: detectedKeys },
      },
      data: { resolvedAt: now },
    });
    resolved = result?.count ?? resolved;
  }
  return { opened, refreshed, resolved };
}

/** Materialize billing configuration issues for one client service. */
export async function reconcileBillingCoverage(
  input: ReconcileBillingCoverageInput,
  db: CoverageDb = prisma,
): Promise<BillingCoverageResult> {
  parseDateOnly(input.today);
  parseDateOnly(input.horizonEnd);
  const result: BillingCoverageResult = {
    clientServiceId: input.clientServiceId,
    opened: 0,
    refreshed: 0,
    resolved: 0,
    openIssues: [],
  };
  const database = asCoverageDb(db);
  const serviceRecord = await database.clientService?.findFirst?.({
    where: { id: input.clientServiceId, tenantId: input.tenantId },
    include: { feeLines: true },
  });
  const service = serviceRecord as CoverageService | null | undefined;
  if (!service) return result;

  const existing = await loadOpenIssues(db, input.tenantId, input.clientServiceId);
  if (service.status === 'PAUSED') {
    result.openIssues = existing.map(issueSummary).map(publicIssue);
    return result;
  }

  if (!serviceIsActive(service)) {
    // Inactive services do not receive new rolling coverage issues. Genuine
    // unresolved issues remain visible, while any still-open occurrences are
    // surfaced by the billing-occurrence projection itself.
    const inactiveGapKey = billingCoverageIssueKey({
      tenantId: input.tenantId,
      clientServiceId: input.clientServiceId,
      feeLineId: null,
      type: 'OCCURRENCE_GAP',
      scheduleKey: 'ended-open-occurrences',
    });
    const staleSynthetic = existing.filter((issue) => issue.issueKey === inactiveGapKey);
    const retained = existing.filter((issue) => issue.issueKey !== inactiveGapKey);
    if (staleSynthetic.length > 0) {
      const staleKeys = staleSynthetic.map((issue) => issue.issueKey);
      result.resolved = staleSynthetic.length;
      if (input.writeMode === 'APPLY') {
        const delegate = asCoverageDb(db).billingCoverageIssue;
        if (delegate?.updateMany) {
          const resolved = await delegate.updateMany({
            where: {
              tenantId: input.tenantId,
              clientServiceId: input.clientServiceId,
              resolvedAt: null,
              issueKey: { in: staleKeys },
            },
            data: { resolvedAt: new Date() },
          });
          result.resolved = resolved?.count ?? result.resolved;
        }
      }
    }
    result.openIssues = retained.map(issueSummary).map(publicIssue);
    return result;
  }

  const issues: CoverageIssueWithDetails[] = [];
  const disposition = service.billingDisposition;
  if (disposition !== 'CONFIGURED' && disposition !== 'NOT_REQUIRED') {
    issues.push(buildIssue(input, 'MISSING_DISPOSITION', null, 'service'));
  } else if (disposition === 'NOT_REQUIRED') {
    // No issues when billing is not required
  } else {
    const activeFeeLines = (service.feeLines ?? []).filter(feeLineIsActive);
    if (activeFeeLines.length === 0) {
      issues.push(buildIssue(input, 'MISSING_FEE_LINES', null, 'service'));
    } else {
      const calendar = await loadCalendar(db, input.tenantId);
      const occurrences = await loadOccurrences(db, input.tenantId, input.clientServiceId);
      const occurrenceKeys = new Set(occurrences
        .filter((occurrence) => COVERAGE_OCCURRENCE_STATUSES.has(occurrence.status ?? ''))
        .map(occurrenceIdentity));
      for (const line of activeFeeLines) {
        if (!validAmount(line.amount) || !validCurrency(line.currency)) {
          issues.push(buildIssue(input, 'INVALID_AMOUNT_OR_CURRENCY', line.id, 'fee-line'));
          continue;
        }
        // Postpaid lines bill when their trigger filing is Filed, so there is
        // no schedule to cover.
        if (line.billingTiming === 'POSTPAID') continue;
        const schedule = scheduleConfigFor(line);
        if (schedule.issueType) {
          const scheduleKey = schedule.config?.scheduleEntries?.[0]?.key ?? 'schedule';
          issues.push(buildIssue(input, schedule.issueType, line.id, scheduleKey));
          continue;
        }
        if (!schedule.config) {
          issues.push(buildIssue(input, 'MISSING_SCHEDULE_PARAMETER', line.id, 'schedule'));
          continue;
        }
        let evaluated: EvaluatedBillingOccurrence[];
        try {
          evaluated = evaluateBillingSchedule({
            config: schedule.config,
            feeLine: { id: line.id, amount: amountString(line.amount), currency: line.currency },
            calendar,
            from: input.today,
            to: input.horizonEnd,
            generationKey: `billing-v1-${hashConfiguration({ feeLineId: line.id })}`,
          });
        } catch {
          issues.push(buildIssue(input, 'INVALID_CUSTOM_SCHEDULE', line.id, 'schedule'));
          continue;
        }
        const missing = evaluated.filter((proposal) => !occurrenceKeys.has(expectedIdentity(proposal)));
        if (missing.length > 0) {
          issues.push(buildIssue(input, 'OCCURRENCE_GAP', line.id, 'rolling-horizon', {
            missingCount: missing.length,
            firstMissingPeriod: missing[0]?.billingPeriodKey ?? null,
          }));
        }
      }
    }
  }

  const existingByKey = new Set(existing.map((issue) => issue.issueKey));
  const detectedKeys = new Set(issues.map((issue) => issue.issueKey));
  if (input.writeMode === 'APPLY') {
    const persisted = await persistIssues(db, input, service.companyId, issues, existing);
    result.opened = persisted.opened;
    result.refreshed = persisted.refreshed;
    result.resolved = persisted.resolved;
  } else {
    result.opened = issues.filter((issue) => !existingByKey.has(issue.issueKey)).length;
    result.refreshed = issues.filter((issue) => existingByKey.has(issue.issueKey)).length;
    result.resolved = existing.filter((issue) => !detectedKeys.has(issue.issueKey)).length;
  }
  result.openIssues = issues.map(publicIssue);
  return result;
}

function issueWhere(input: BillingCoverageListInput): Record<string, unknown> {
  const companyIds = input.companyIds === undefined ? undefined : [...input.companyIds];
  return {
    tenantId: input.tenantId,
    resolvedAt: null,
    ...(input.types && input.types.length > 0 ? { type: { in: [...input.types] } } : {}),
    ...(input.severities && input.severities.length > 0 ? { severity: { in: [...input.severities] } } : {}),
    ...(companyIds === undefined ? {} : { companyId: { in: companyIds } }),
    company: {
      tenantId: input.tenantId,
      deletedAt: null,
      ...(companyIds === undefined ? {} : { id: { in: companyIds } }),
    },
  };
}

function toListIssue(row: CoverageIssueRecord): BillingCoverageSummary['issues'][number] {
  const company = row.company ?? {};
  const clientService = row.clientService ?? {};
  const variant = clientService.serviceVariant ?? {};
  const family = variant.family ?? {};
  const companyName = company.name ?? '';
  const familyName = family.name ?? clientService.familyName ?? '';
  const details = asRecord(row.details);
  return {
    id: row.id ?? row.issueKey,
    type: row.type as BillingCoverageIssueType,
    severity: row.severity as BillingCoverageIssueSeverity,
    company: {
      id: company.id ?? '',
      name: companyName,
      displayLabel: getCompanyDisplayLabel({ name: companyName, displayAlias: company.displayAlias ?? null }),
    },
    service: {
      id: clientService.id ?? '',
      name: clientService.serviceName ?? '',
      familyName,
      familyColor: family.displayColor ?? '#2F6F5E',
    },
    feeLine: row.feeLine?.id
      ? { id: row.feeLine.id, description: row.feeLine.description ?? '' }
      : row.feeLineId ? { id: row.feeLineId, description: '' } : null,
    message: typeof details.message === 'string'
      ? details.message
      : issueMessage(row.type as BillingCoverageIssueType, row.feeLineId ?? null, details),
  };
}

/** Return open coverage issues and compact healthy-service counts in SQL scope. */
export async function listBillingCoverage(
  input: BillingCoverageListInput,
  db: CoverageDb = prisma,
): Promise<BillingCoverageSummary> {
  const database = asCoverageDb(db) as CoverageDb & {
    billingCoverageIssue?: {
      findMany?: (args: unknown) => Promise<unknown>;
    };
    clientService?: {
      count?: (args: unknown) => Promise<number>;
    };
  };
  const where = issueWhere(input);
  const rows = database.billingCoverageIssue?.findMany
    ? await database.billingCoverageIssue.findMany({
      where,
      orderBy: [{ severity: 'asc' }, { lastDetectedAt: 'asc' }, { id: 'asc' }],
      include: {
        company: { select: { id: true, tenantId: true, name: true, displayAlias: true } },
        clientService: {
          select: {
            id: true,
            tenantId: true,
            serviceName: true,
            familyName: true,
            serviceVariant: { select: { id: true, family: { select: { id: true, name: true, displayColor: true } } } },
          },
        },
        feeLine: { select: { id: true, description: true } },
      },
    })
    : [];
  const safeRows = (Array.isArray(rows) ? rows : []) as CoverageIssueRecord[];
  const activeServiceWhere = {
    tenantId: input.tenantId,
    status: 'ACTIVE',
    deletedAt: null,
    ...(input.companyIds === undefined ? {} : { companyId: { in: [...input.companyIds] } }),
    company: {
      tenantId: input.tenantId,
      deletedAt: null,
      ...(input.companyIds === undefined ? {} : { id: { in: [...input.companyIds] } }),
    },
    billingCoverageIssues: { none: { tenantId: input.tenantId, resolvedAt: null } },
  };
  const healthyActiveServiceCount = database.clientService?.count
    ? await database.clientService.count({ where: activeServiceWhere })
    : 0;
  return {
    openIssueCount: safeRows.length,
    affectedServiceCount: new Set(safeRows
      .map((row) => row.clientService?.id)
      .filter((id): id is string => Boolean(id))).size,
    healthyActiveServiceCount,
    issues: safeRows.map(toListIssue),
  };
}
