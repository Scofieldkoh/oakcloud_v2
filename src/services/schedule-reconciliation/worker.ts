import { randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { currentDateInSingapore, addMonthsClamped } from '@/services/service-schedule/date-only';
import type { DateOnly } from '@/services/service-schedule';
import { getServiceWorkspaceFlagsForTenant } from './settings';
import { reconcileClientServiceDeadlines } from './deadline-reconciler';
import { enqueueScheduleReconciliation } from './queue';
import { reconcileBillingCoverage, reconcileClientServiceBilling } from '@/services/billing';
import { monitoredCompanyIds, reconcileCompanyObligations } from '@/services/compliance-monitoring/writer';
import type {
  BillingCoverageResult,
  BillingReconciliationPreservedCounts,
  BillingReconciliationResult,
  BillingReconciliationWarning,
} from '@/services/billing';
import type {
  DeadlineReconciliationCounts,
  DeadlineReconciliationPreservedCounts,
  DeadlineReconciliationWarning,
  ServiceScheduleReconciliationSummary,
} from './types';

const log = createLogger('schedule-reconciliation-worker');

const BACKOFF_MINUTES = [1, 5, 15, 60, 240] as const;
const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000; // 5 minutes
const PERMANENT_ERROR_CODES = new Set([
  'MISSING_RULE_INPUT',
  'RULE_NOT_APPLICABLE',
  'VALIDATION_ERROR',
  'SCHEDULE_LIMIT_EXCEEDED',
  'DUPLICATE_SCHEDULE_ENTRY',
]);
const PUBLIC_RECONCILIATION_CODES = new Set([
  ...PERMANENT_ERROR_CODES,
  'MISSING_INPUT',
  'CLIENT_SERVICE_NOT_FOUND',
  'RULE_VERSION_MISSING',
  'WORKSPACE_DISABLED',
  'LEASE_LOST',
  'RULE_WARNING',
  'RECONCILIATION_FAILED',
  'CANCELLATION_ACTOR_REQUIRED',
  'CLIENT_SERVICE_NOT_FOUND',
  'MISSING_DISPOSITION',
  'MISSING_FEE_LINES',
  'INVALID_SCHEDULE',
  'INVALID_AMOUNT_OR_CURRENCY',
  'BILLING_RECONCILIATION_CONFLICT',
  'COMPANY_MONITORING_OWNS_RULE',
]);
const SAFE_TRANSIENT_ERROR_MESSAGE = 'Reconciliation failed and will retry';
const SAFE_PERMANENT_ERROR_MESSAGE = 'Reconciliation request completed with a permanent configuration error';
const MAX_LOG_TEXT_LENGTH = 200;
const MAX_LOG_WARNINGS = 50;
const MAX_WARNING_MISSING_FIELDS = 20;
const MAX_METRIC_COUNT = 1_000_000;
const MAX_DURATION_MS = 86_400_000;

type SafeReconciliationWarning = {
  code: string;
  ruleId?: string;
  ruleVersionId?: string;
  missingFields?: string[];
  feeLineId?: string;
  permanent?: boolean;
};

export type ReconciliationLogMetrics = {
  billing: Pick<BillingReconciliationResult, 'created' | 'recalculated' | 'cancelled' | 'preserved'>;
  coverage: Pick<BillingCoverageResult, 'opened' | 'resolved'>;
  servicesMissingDisposition: number;
  invalidScheduleCount: number;
  occurrenceGaps: number;
};

export type ReconciliationLogEventInput = {
  tenantId: string;
  requestId: string;
  correlationId: string;
  durationMs: number;
  counts: DeadlineReconciliationCounts;
  preservedByReason: DeadlineReconciliationPreservedCounts;
  warnings: Array<DeadlineReconciliationWarning | BillingReconciliationWarning>;
  billing?: Pick<BillingReconciliationResult, 'created' | 'recalculated' | 'cancelled' | 'preserved'>;
  billingPreservedByReason?: BillingReconciliationPreservedCounts;
  coverage?: Pick<BillingCoverageResult, 'opened' | 'refreshed' | 'resolved'> & { openIssueCount?: number };
  metrics?: ReconciliationLogMetrics;
  attempt: number;
  writeMode: 'OBSERVE' | 'APPLY';
};

export type ReconciliationLogEvent = {
  event: 'reconciliation_request';
  tenantId: string;
  requestId: string;
  correlationId: string;
  durationMs: number;
  counts: DeadlineReconciliationCounts;
  preservedByReason: DeadlineReconciliationPreservedCounts;
  warnings: SafeReconciliationWarning[];
  billing?: Pick<BillingReconciliationResult, 'created' | 'recalculated' | 'cancelled' | 'preserved'>;
  billingPreservedByReason?: BillingReconciliationPreservedCounts;
  coverage?: Pick<BillingCoverageResult, 'opened' | 'refreshed' | 'resolved'> & { openIssueCount?: number };
  metrics: ReconciliationLogMetrics;
  attempt: number;
  writeMode: 'OBSERVE' | 'APPLY';
};

export type ReconciliationLogger = {
  info: (message: string, ...args: unknown[]) => void;
};

function publicReconciliationCode(code: unknown): string {
  return typeof code === 'string' && PUBLIC_RECONCILIATION_CODES.has(code)
    ? code
    : 'RECONCILIATION_FAILED';
}

function safeLogText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_LOG_TEXT_LENGTH) : '';
}

function safeLogIdentifier(value: unknown): string | undefined {
  const text = safeLogText(value);
  return text.length > 0 ? text : undefined;
}

function safeReconciliationWarning(warning: DeadlineReconciliationWarning | BillingReconciliationWarning): SafeReconciliationWarning {
  const code = publicReconciliationCode(warning.code);
  const ruleId = 'ruleId' in warning ? safeLogIdentifier(warning.ruleId) : undefined;
  const ruleVersionId = 'ruleVersionId' in warning ? safeLogIdentifier(warning.ruleVersionId) : undefined;
  const feeLineId = 'feeLineId' in warning ? safeLogIdentifier(warning.feeLineId) : undefined;
  const rawMissingFields = 'missingFields' in warning ? warning.missingFields : undefined;
  const missingFields = Array.isArray(rawMissingFields)
    ? rawMissingFields
      .filter((field): field is string => typeof field === 'string')
      .slice(0, MAX_WARNING_MISSING_FIELDS)
      .map((field) => safeLogText(field))
    : undefined;
  return {
    code,
    ...(ruleId ? { ruleId } : {}),
    ...(ruleVersionId ? { ruleVersionId } : {}),
    ...('missingFields' in warning && missingFields ? { missingFields } : {}),
    ...(feeLineId ? { feeLineId } : {}),
    ...(warning.permanent !== undefined ? { permanent: warning.permanent } : {}),
  };
}

function boundedLogCount(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value === Number.POSITIVE_INFINITY) return MAX_METRIC_COUNT;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  return Math.min(MAX_METRIC_COUNT, Math.max(0, Math.trunc(value)));
}

function boundedDuration(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value === Number.POSITIVE_INFINITY) return MAX_DURATION_MS;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.round(value * 10) / 10));
}

function safeReconciliationCounts(value: DeadlineReconciliationCounts): DeadlineReconciliationCounts {
  return {
    created: boundedLogCount(value.created),
    recalculated: boundedLogCount(value.recalculated),
    cancelled: boundedLogCount(value.cancelled),
    preserved: boundedLogCount(value.preserved),
    noChange: boundedLogCount(value.noChange),
  };
}

function safeDeadlinePreservedCounts(value: DeadlineReconciliationPreservedCounts): DeadlineReconciliationPreservedCounts {
  return {
    MANUAL_TRIGGER: boundedLogCount(value.MANUAL_TRIGGER),
    HISTORICAL: boundedLogCount(value.HISTORICAL),
    COMPLETED: boundedLogCount(value.COMPLETED),
    WAIVED: boundedLogCount(value.WAIVED),
    CANCELLED: boundedLogCount(value.CANCELLED),
    OVERRIDDEN: boundedLogCount(value.OVERRIDDEN),
  };
}

function safeBillingPreservedCounts(value: BillingReconciliationPreservedCounts): BillingReconciliationPreservedCounts {
  return {
    MANUAL_TRIGGER: boundedLogCount(value.MANUAL_TRIGGER),
    HISTORICAL: boundedLogCount(value.HISTORICAL),
    BILLED: boundedLogCount(value.BILLED),
    WAIVED: boundedLogCount(value.WAIVED),
    CANCELLED: boundedLogCount(value.CANCELLED),
    OVERRIDDEN: boundedLogCount(value.OVERRIDDEN),
  };
}

function safeBillingCounts(value: Pick<BillingReconciliationResult, 'created' | 'recalculated' | 'cancelled' | 'preserved'>) {
  return {
    created: boundedLogCount(value.created),
    recalculated: boundedLogCount(value.recalculated),
    cancelled: boundedLogCount(value.cancelled),
    preserved: boundedLogCount(value.preserved),
  };
}

function safeCoverageCounts(value: Pick<BillingCoverageResult, 'opened' | 'refreshed' | 'resolved'> & { openIssueCount?: number }) {
  return {
    opened: boundedLogCount(value.opened),
    refreshed: boundedLogCount(value.refreshed),
    resolved: boundedLogCount(value.resolved),
    openIssueCount: boundedLogCount(value.openIssueCount),
  };
}

function emptyReconciliationLogMetrics(): ReconciliationLogMetrics {
  return {
    billing: { created: 0, recalculated: 0, cancelled: 0, preserved: 0 },
    coverage: { opened: 0, resolved: 0 },
    servicesMissingDisposition: 0,
    invalidScheduleCount: 0,
    occurrenceGaps: 0,
  };
}

function safeReconciliationLogMetrics(
  input: ReconciliationLogEventInput,
): ReconciliationLogMetrics {
  const source = input.metrics;
  return {
    billing: {
      created: boundedLogCount(source?.billing?.created ?? input.billing?.created),
      recalculated: boundedLogCount(source?.billing?.recalculated ?? input.billing?.recalculated),
      cancelled: boundedLogCount(source?.billing?.cancelled ?? input.billing?.cancelled),
      preserved: boundedLogCount(source?.billing?.preserved ?? input.billing?.preserved),
    },
    coverage: {
      opened: boundedLogCount(source?.coverage?.opened ?? input.coverage?.opened),
      resolved: boundedLogCount(source?.coverage?.resolved ?? input.coverage?.resolved),
    },
    servicesMissingDisposition: boundedLogCount(source?.servicesMissingDisposition),
    invalidScheduleCount: boundedLogCount(source?.invalidScheduleCount),
    occurrenceGaps: boundedLogCount(source?.occurrenceGaps),
  };
}

/**
 * Build the one safe structured event emitted for a reconciliation request.
 * Warning messages are intentionally discarded: rule text, notes, uploaded
 * documents, and other free-form values must never enter operational logs.
 */
export function buildReconciliationLogEvent(
  input: ReconciliationLogEventInput,
): ReconciliationLogEvent {
  return {
    event: 'reconciliation_request',
    tenantId: safeLogText(input.tenantId),
    requestId: safeLogText(input.requestId),
    correlationId: safeLogText(input.correlationId),
    durationMs: boundedDuration(input.durationMs),
    counts: safeReconciliationCounts(input.counts),
    preservedByReason: safeDeadlinePreservedCounts(input.preservedByReason),
    warnings: input.warnings.slice(0, MAX_LOG_WARNINGS).map(safeReconciliationWarning),
    ...(input.billing ? { billing: safeBillingCounts(input.billing) } : {}),
    ...(input.billingPreservedByReason ? { billingPreservedByReason: safeBillingPreservedCounts(input.billingPreservedByReason) } : {}),
    ...(input.coverage ? { coverage: safeCoverageCounts(input.coverage) } : {}),
    metrics: safeReconciliationLogMetrics(input),
    attempt: boundedLogCount(input.attempt),
    writeMode: input.writeMode,
  };
}

/**
 * Structured reconciliation logging is observational only. A logger/sink
 * failure must never change the already-finalized request outcome.
 */
export function emitReconciliationLogEvent(
  logger: ReconciliationLogger,
  input: ReconciliationLogEventInput,
): void {
  try {
    logger.info('reconciliation_request', buildReconciliationLogEvent(input));
  } catch {
    // Logging is best effort; request state is persisted independently.
  }
}

function emptyReconciliationCounts(): DeadlineReconciliationCounts {
  return {
    created: 0,
    recalculated: 0,
    cancelled: 0,
    preserved: 0,
    noChange: 0,
  };
}

function emptyPreservedCounts(): DeadlineReconciliationPreservedCounts {
  return {
    MANUAL_TRIGGER: 0,
    HISTORICAL: 0,
    COMPLETED: 0,
    WAIVED: 0,
    CANCELLED: 0,
    OVERRIDDEN: 0,
  };
}

class LeaseLostError extends Error {
  readonly code = 'LEASE_LOST';

  constructor() {
    super('Reconciliation lease is no longer owned by this worker');
  }
}

export type ProcessBatchOptions = {
  limit?: number;
  concurrency?: number;
  now?: Date;
  leaseMs?: number;
};

export type ProcessBatchResult = {
  claimed: number;
  completed: number;
  failed: number;
  leaseLost: number;
  summaries: ServiceScheduleReconciliationSummary[];
};

type ProcessRequestResult = {
  outcome: 'COMPLETED' | 'FAILED' | 'LEASE_LOST';
  summaries: ServiceScheduleReconciliationSummary[];
};

/** Queue one tenant-scoped rolling-horizon pass for each active workspace. */
export async function enqueueDailyRollingHorizonRequests(now: Date = new Date()): Promise<number> {
  const today = currentDateInSingapore(now);
  const tenants = await prisma.workspace.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });

  for (const tenant of tenants) {
    await prisma.$transaction((tx) => enqueueScheduleReconciliation(tx, {
      tenantId: tenant.id,
      scopeType: 'TENANT',
      scopeId: tenant.id,
      triggerType: 'ROLLING_HORIZON',
      correlationId: `rolling-horizon-${today}`,
      requestedById: null,
      notBefore: now,
    }));
  }
  return tenants.length;
}

type ClaimedRequest = {
  id: string;
  tenantId: string;
  scopeType: 'TENANT' | 'COMPANY' | 'CLIENT_SERVICE' | 'RULE' | 'BUSINESS_CALENDAR';
  scopeId: string;
  triggerType: string;
  correlationId: string;
  requestedById: string | null;
  attemptCount: number;
  leaseOwner: string;
};

export type WorkerServiceReconciliationInput = {
  tenantId: string;
  clientServiceId: string;
  ruleId?: string;
  operation: 'PUBLISH' | 'ARCHIVE';
  today: DateOnly;
  horizonEnd: DateOnly;
  writeMode: 'OBSERVE' | 'APPLY';
  reconciliationRequestId: string;
  includeHistoricalBillingStart?: boolean;
  cancellationActorId?: string | null;
  companyMonitoringEnabled?: boolean;
  assertLease: () => Promise<void>;
};

/**
 * Reconcile one client service through the worker's leased transaction path.
 * Deadlines and billing share one per-service transaction so their request
 * provenance, write mode, horizon, and lease checks stay aligned.
 */
export async function reconcileClientServiceThroughWorkerTransaction(
  db: typeof prisma,
  input: WorkerServiceReconciliationInput,
): Promise<ServiceScheduleReconciliationSummary> {
  await input.assertLease();
  return db.$transaction(async (tx) => {
    const deadlines = await reconcileClientServiceDeadlines({
      tenantId: input.tenantId,
      clientServiceId: input.clientServiceId,
      ruleId: input.ruleId,
      operation: input.operation,
      today: input.today,
      horizonEnd: input.horizonEnd,
      writeMode: input.writeMode,
      reconciliationRequestId: input.reconciliationRequestId,
      assertLease: input.assertLease,
      companyMonitoringEnabled: input.companyMonitoringEnabled,
    }, tx);
    const billing = await reconcileClientServiceBilling({
      tenantId: input.tenantId,
      clientServiceId: input.clientServiceId,
      today: input.today,
      horizonEnd: input.horizonEnd,
      writeMode: input.writeMode,
      reconciliationRequestId: input.reconciliationRequestId,
      ...(input.includeHistoricalBillingStart ? { includeHistoricalStart: true } : {}),
      cancellationActorId: input.cancellationActorId,
      assertLease: input.assertLease,
    }, tx);
    const coverage = await reconcileBillingCoverage({
      tenantId: input.tenantId,
      clientServiceId: input.clientServiceId,
      today: input.today,
      horizonEnd: input.horizonEnd,
      writeMode: input.writeMode,
    }, tx);
    return { deadlines, billing, coverage };
  });
}

async function claimRequests(
  limit: number,
  now: Date,
  leaseMs: number,
): Promise<ClaimedRequest[]> {
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const workerId = randomUUID();

  return prisma.$transaction(async (tx) => {
    // Claim pending or expired-processing requests using FOR UPDATE SKIP LOCKED
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        tenantId: string;
        scopeType: 'TENANT' | 'COMPANY' | 'CLIENT_SERVICE' | 'RULE' | 'BUSINESS_CALENDAR';
        scopeId: string;
        triggerType: string;
        correlationId: string;
        requestedById: string | null;
        attemptCount: number;
      }>
    >(Prisma.sql`
      SELECT
        "id",
        "tenant_id" AS "tenantId",
        "scope_type" AS "scopeType",
        "scope_id" AS "scopeId",
        "trigger_type" AS "triggerType",
        "correlation_id" AS "correlationId",
        "requested_by_id" AS "requestedById",
        "attempt_count" AS "attemptCount"
      FROM "service_schedule_reconciliation_requests"
      WHERE ("status" = 'PENDING' AND "next_attempt_at" <= ${now})
         OR ("status" = 'PROCESSING' AND "lease_expires_at" <= ${now})
      ORDER BY "next_attempt_at" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);

    const claimed: ClaimedRequest[] = [];

    for (const row of rows) {
      const result = await tx.serviceScheduleReconciliationRequest.updateMany({
        where: {
          id: row.id,
          tenantId: row.tenantId,
          OR: [
            { status: 'PENDING', nextAttemptAt: { lte: now } },
            { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: 'PROCESSING',
          startedAt: now,
          leaseOwner: workerId,
          leaseExpiresAt,
          attemptCount: { increment: 1 },
        },
      });

      if (result.count === 1) {
        claimed.push({
          ...row,
          attemptCount: row.attemptCount + 1,
          leaseOwner: workerId,
        });
      }
    }

    return claimed;
  });
}

async function resolveClientServiceIds(
  req: ClaimedRequest,
): Promise<string[]> {
  switch (req.scopeType) {
    case 'CLIENT_SERVICE':
      return [req.scopeId];

    case 'COMPANY': {
      const services = await prisma.clientService.findMany({
        // Archived services remain in scope so reconciliation can cancel
        // eligible future occurrences while preserving historical lineage.
        where: { tenantId: req.tenantId, companyId: req.scopeId },
        select: { id: true },
      });
      return services.map((s) => s.id);
    }

    case 'RULE': {
      const services = await prisma.clientService.findMany({
        where: {
          tenantId: req.tenantId,
          deadlineRules: { some: { ruleId: req.scopeId } },
        },
        select: { id: true },
      });
      return services.map((s) => s.id);
    }

    case 'BUSINESS_CALENDAR':
    case 'TENANT': {
      const services = await prisma.clientService.findMany({
        // Include archived rows for lifecycle cancellation; the billing and
        // deadline reconcilers themselves stop new generation for them.
        where: { tenantId: req.tenantId },
        select: { id: true },
      });
      return services.map((s) => s.id);
    }

    default:
      return [];
  }
}

/**
 * Companies whose statutory obligations a request re-evaluates. Only companies
 * with monitoring coverage or a contracted filing scope are candidates.
 */
async function resolveMonitoredCompanyIds(req: ClaimedRequest): Promise<string[]> {
  const monitored = await monitoredCompanyIds(prisma, req.tenantId);
  if (monitored.length === 0) return [];
  switch (req.scopeType) {
    case 'COMPANY':
      return monitored.includes(req.scopeId) ? [req.scopeId] : [];
    case 'CLIENT_SERVICE': {
      const service = await prisma.clientService.findFirst({
        where: { id: req.scopeId, tenantId: req.tenantId },
        select: { companyId: true },
      });
      return service && monitored.includes(service.companyId) ? [service.companyId] : [];
    }
    case 'RULE':
    case 'BUSINESS_CALENDAR':
    case 'TENANT':
      return monitored;
    default:
      return [];
  }
}

async function renewLease(req: ClaimedRequest, leaseMs: number, clock: () => Date): Promise<void> {
  const now = clock();
  const renewed = await prisma.serviceScheduleReconciliationRequest.updateMany({
    where: {
      id: req.id,
      tenantId: req.tenantId,
      status: 'PROCESSING',
      leaseOwner: req.leaseOwner,
      leaseExpiresAt: { gt: now },
    },
    data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) },
  });
  if (renewed.count !== 1) throw new LeaseLostError();
}

async function processSingleRequest(
  req: ClaimedRequest,
  now: Date,
  leaseMs: number,
  leaseClock: () => Date,
): Promise<ProcessRequestResult> {
  const startedAt = performance.now();
  let eventCounts = emptyReconciliationCounts();
  let eventPreservedByReason = emptyPreservedCounts();
  let eventWarnings: Array<DeadlineReconciliationWarning | BillingReconciliationWarning> = [];
  let eventBilling: Pick<BillingReconciliationResult, 'created' | 'recalculated' | 'cancelled' | 'preserved'> = {
    created: 0,
    recalculated: 0,
    cancelled: 0,
    preserved: 0,
  };
  let eventBillingPreservedByReason: BillingReconciliationPreservedCounts = {
    MANUAL_TRIGGER: 0,
    HISTORICAL: 0,
    BILLED: 0,
    WAIVED: 0,
    CANCELLED: 0,
    OVERRIDDEN: 0,
  };
  let eventCoverage: Pick<BillingCoverageResult, 'opened' | 'refreshed' | 'resolved'> & { openIssueCount?: number } = {
    opened: 0,
    refreshed: 0,
    resolved: 0,
    openIssueCount: 0,
  };
  let eventMetrics = emptyReconciliationLogMetrics();
  let eventWriteMode: 'OBSERVE' | 'APPLY' = 'OBSERVE';
  let eventEmitted = false;
  const emitEvent = () => {
    if (eventEmitted) return;
    eventEmitted = true;
    emitReconciliationLogEvent(log, {
      tenantId: req.tenantId,
      requestId: req.id,
      correlationId: req.correlationId,
      durationMs: performance.now() - startedAt,
      counts: eventCounts,
      preservedByReason: eventPreservedByReason,
      warnings: eventWarnings,
      billing: eventBilling,
      billingPreservedByReason: eventBillingPreservedByReason,
      coverage: eventCoverage,
      metrics: eventMetrics,
      attempt: req.attemptCount,
      writeMode: eventWriteMode,
    });
  };

  try {
    const assertLease = () => renewLease(req, leaseMs, leaseClock);
    await assertLease();
    const flags = await getServiceWorkspaceFlagsForTenant(req.tenantId);
    if (!flags.workspaceEnabled) {
      eventWarnings.push({
        code: 'WORKSPACE_DISABLED',
        message: 'Services workspace is disabled',
        permanent: true,
      });
      const completed = await prisma.serviceScheduleReconciliationRequest.updateMany({
        where: { id: req.id, tenantId: req.tenantId, status: 'PROCESSING', leaseOwner: req.leaseOwner },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          summary: {
            warnings: [safeReconciliationWarning({
              code: 'WORKSPACE_DISABLED',
              message: 'Services workspace is disabled for this workspace',
              permanent: true,
            })],
          } as never,
        },
      });
      if (completed.count !== 1) {
        eventWarnings.push({ code: 'LEASE_LOST', message: 'Lease ownership changed' });
        return { outcome: 'LEASE_LOST', summaries: [] };
      }
      return { outcome: 'COMPLETED', summaries: [] };
    }
    const writeMode = flags.deadlineWritesEnabled ? 'APPLY' : 'OBSERVE';
    eventWriteMode = writeMode;
    const operation = req.triggerType === 'RULE_ARCHIVED' ? 'ARCHIVE' as const : 'PUBLISH' as const;
    const today = currentDateInSingapore(now);
    const horizonEnd = addMonthsClamped(today, 12);
    const includeHistoricalBillingStart = req.triggerType === 'CLIENT_SERVICE_CREATED'
      || req.triggerType === 'SERVICE_AGREEMENT_ACTIVATED';

    const clientServiceIds = await resolveClientServiceIds(req);
    const summaries: ServiceScheduleReconciliationSummary[] = [];

    const aggregatedCounts = emptyReconciliationCounts();
    const aggregatedPreserved = emptyPreservedCounts();

    const allWarnings: Array<DeadlineReconciliationWarning | BillingReconciliationWarning> = [];
    const billingCounts = {
      created: 0,
      recalculated: 0,
      cancelled: 0,
      preserved: 0,
    };
    const coverageCounts = {
      opened: 0,
      refreshed: 0,
      resolved: 0,
      openIssueCount: 0,
    };
    const billingPreservedByReason: BillingReconciliationPreservedCounts = {
      MANUAL_TRIGGER: 0,
      HISTORICAL: 0,
      BILLED: 0,
      WAIVED: 0,
      CANCELLED: 0,
      OVERRIDDEN: 0,
    };
    const metrics = emptyReconciliationLogMetrics();

    for (const clientServiceId of clientServiceIds) {
      const summary = await reconcileClientServiceThroughWorkerTransaction(prisma, {
        tenantId: req.tenantId,
        clientServiceId,
        ruleId: req.scopeType === 'RULE' ? req.scopeId : undefined,
        operation,
        today,
        horizonEnd,
        writeMode,
        reconciliationRequestId: req.id,
        includeHistoricalBillingStart,
        cancellationActorId: req.requestedById,
        companyMonitoringEnabled: flags.companyMonitoringWritesEnabled,
        assertLease,
      });
      summaries.push(summary);
      const result = summary.deadlines;
      const billing = summary.billing;
      const coverage = summary.coverage;

      aggregatedCounts.created += result.counts.created;
      aggregatedCounts.recalculated += result.counts.recalculated;
      aggregatedCounts.cancelled += result.counts.cancelled;
      aggregatedCounts.preserved += result.counts.preserved;
      aggregatedCounts.noChange += result.counts.noChange;

      for (const [reason, count] of Object.entries(result.preservedByReason)) {
        aggregatedPreserved[reason as keyof DeadlineReconciliationPreservedCounts] += count;
      }

      allWarnings.push(...result.warnings);
      billingCounts.created += billing.created;
      billingCounts.recalculated += billing.recalculated;
      billingCounts.cancelled += billing.cancelled;
      billingCounts.preserved += billing.preserved;
      for (const [reason, count] of Object.entries(billing.preservedByReason)) {
        billingPreservedByReason[reason as keyof BillingReconciliationPreservedCounts] += count;
      }
      allWarnings.push(...billing.warnings);
      coverageCounts.opened += coverage.opened;
      coverageCounts.refreshed += coverage.refreshed;
      coverageCounts.resolved += coverage.resolved;
      coverageCounts.openIssueCount += coverage.openIssues.length;
      metrics.servicesMissingDisposition += coverage.openIssues.some((issue) => issue.type === 'MISSING_DISPOSITION') ? 1 : 0;
      metrics.invalidScheduleCount += coverage.openIssues.filter((issue) => (
        issue.type === 'INVALID_CUSTOM_SCHEDULE' || issue.type === 'MISSING_SCHEDULE_PARAMETER'
      )).length;
      metrics.occurrenceGaps += coverage.openIssues.filter((issue) => issue.type === 'OCCURRENCE_GAP').length;
      metrics.billing = { ...billingCounts };
      metrics.coverage = {
        opened: coverageCounts.opened,
        resolved: coverageCounts.resolved,
      };
      // Publish aggregation state immediately after each committed service.
      // A subsequent service failure or lease loss must not erase prior work.
      eventCounts = { ...aggregatedCounts };
      eventPreservedByReason = { ...aggregatedPreserved };
      eventBilling = { ...billingCounts };
      eventBillingPreservedByReason = { ...billingPreservedByReason };
      eventCoverage = { ...coverageCounts };
      eventMetrics = {
        billing: { ...metrics.billing },
        coverage: { ...metrics.coverage },
        servicesMissingDisposition: metrics.servicesMissingDisposition,
        invalidScheduleCount: metrics.invalidScheduleCount,
        occurrenceGaps: metrics.occurrenceGaps,
      };
      eventWarnings = [...allWarnings];

      await assertLease();
    }

    // Company statutory obligations: one transaction per company, no billing.
    // Until the workspace enables company monitoring writes, this observes.
    const companyWriteMode = flags.companyMonitoringWritesEnabled ? 'APPLY' as const : 'OBSERVE' as const;
    const companyIds = await resolveMonitoredCompanyIds(req);
    const companyMonitoring = {
      writeMode: companyWriteMode,
      companyCount: companyIds.length,
      counts: emptyReconciliationCounts(),
      links: { attached: 0, released: 0 },
      responsibilityChanges: 0,
      issues: { opened: 0, refreshed: 0, resolved: 0, open: 0 },
    };
    for (const companyId of companyIds) {
      await assertLease();
      const result = await prisma.$transaction((tx) => reconcileCompanyObligations({
        tenantId: req.tenantId,
        companyId,
        today,
        writeMode: companyWriteMode,
        reconciliationRequestId: req.id,
        assertLease,
      }, tx));
      for (const key of Object.keys(companyMonitoring.counts) as Array<keyof DeadlineReconciliationCounts>) {
        companyMonitoring.counts[key] += result.counts[key];
      }
      companyMonitoring.links.attached += result.links.attached;
      companyMonitoring.links.released += result.links.released;
      companyMonitoring.responsibilityChanges += result.responsibilityChanges;
      companyMonitoring.issues.opened += result.issues.opened;
      companyMonitoring.issues.refreshed += result.issues.refreshed;
      companyMonitoring.issues.resolved += result.issues.resolved;
      companyMonitoring.issues.open += result.issues.open;
    }

    const completed = await prisma.serviceScheduleReconciliationRequest.updateMany({
      where: {
        id: req.id,
        tenantId: req.tenantId,
        status: 'PROCESSING',
        leaseOwner: req.leaseOwner,
      },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        summary: {
          clientServiceCount: clientServiceIds.length,
          companyMonitoring,
          counts: aggregatedCounts,
          preservedByReason: aggregatedPreserved,
          billing: billingCounts,
          billingPreservedByReason,
          coverage: coverageCounts,
          warnings: allWarnings.map(safeReconciliationWarning),
        } as never,
      },
    });

    if (completed.count !== 1) {
      eventWarnings.push({ code: 'LEASE_LOST', message: 'Lease ownership changed' });
      return { outcome: 'LEASE_LOST', summaries: [] };
    }
    return { outcome: 'COMPLETED', summaries };
  } catch (error) {
    const errorCode = publicReconciliationCode((error as { code?: unknown })?.code);

    const isPermanent = PERMANENT_ERROR_CODES.has(errorCode);
    const safeErrorMessage = isPermanent ? SAFE_PERMANENT_ERROR_MESSAGE : SAFE_TRANSIENT_ERROR_MESSAGE;
    eventWarnings.push({ code: errorCode, message: safeErrorMessage, permanent: isPermanent });

    if (errorCode === 'LEASE_LOST') return { outcome: 'LEASE_LOST', summaries: [] };

    const backoffIndex = Math.min(req.attemptCount - 1, BACKOFF_MINUTES.length - 1);
    const backoffMinutes = BACKOFF_MINUTES[Math.max(0, backoffIndex)] ?? 1;
    const nextAttemptAt = new Date(now.getTime() + backoffMinutes * 60_000);

    if (isPermanent) {
      const completed = await prisma.serviceScheduleReconciliationRequest.updateMany({
        where: {
          id: req.id,
          tenantId: req.tenantId,
          status: 'PROCESSING',
          leaseOwner: req.leaseOwner,
        },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
          lastErrorMessage: safeErrorMessage,
          summary: {
            warnings: [safeReconciliationWarning({ code: errorCode, message: safeErrorMessage, permanent: true })],
            permanent: true,
          } as never,
          nextAttemptAt: now,
        },
      });
      if (completed.count !== 1) {
        eventWarnings.push({ code: 'LEASE_LOST', message: 'Lease ownership changed' });
        return { outcome: 'LEASE_LOST', summaries: [] };
      }
      return { outcome: 'COMPLETED', summaries: [] };
    }

    const retryExhausted = req.attemptCount > MAX_ATTEMPTS;

    const retried = await prisma.serviceScheduleReconciliationRequest.updateMany({
      where: {
        id: req.id,
        tenantId: req.tenantId,
        status: 'PROCESSING',
        leaseOwner: req.leaseOwner,
      },
      data: {
        status: retryExhausted ? 'FAILED' : 'PENDING',
        completedAt: retryExhausted ? now : null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
        lastErrorMessage: safeErrorMessage,
        nextAttemptAt: retryExhausted ? now : nextAttemptAt,
      },
    });

    if (retried.count !== 1) {
      eventWarnings.push({ code: 'LEASE_LOST', message: 'Lease ownership changed' });
      return { outcome: 'LEASE_LOST', summaries: [] };
    }
    return { outcome: 'FAILED', summaries: [] };
  } finally {
    emitEvent();
  }
}

export async function processScheduleReconciliationBatch(
  options: ProcessBatchOptions = {},
): Promise<ProcessBatchResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const concurrency = Math.min(Math.max(options.concurrency ?? 4, 1), 20);
  const now = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? LEASE_MS;
  const leaseClock = options.now ? () => now : () => new Date();

  const claims = await claimRequests(limit, now, leaseMs);
  let completed = 0;
  let failed = 0;
  let leaseLost = 0;
  const allSummaries: ServiceScheduleReconciliationSummary[] = [];

  for (let offset = 0; offset < claims.length; offset += concurrency) {
    const chunk = claims.slice(offset, offset + concurrency);
    const results = await Promise.all(
      chunk.map((req) => processSingleRequest(req, now, leaseMs, leaseClock)),
    );

    for (const res of results) {
      if (res.outcome === 'COMPLETED') {
        completed += 1;
        allSummaries.push(...res.summaries);
      } else if (res.outcome === 'FAILED') {
        failed += 1;
      } else {
        leaseLost += 1;
      }
    }
  }

  return {
    claimed: claims.length,
    completed,
    failed,
    leaseLost,
    summaries: allSummaries,
  };
}
