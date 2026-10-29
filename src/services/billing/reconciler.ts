import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { addCalendarDays, compareDateOnly, formatDateOnly, parseDateOnly, type BusinessCalendarSnapshot, type DateOnly } from '@/services/service-schedule';
import { hashConfiguration } from '@/services/service-schedule/hash';
import { canonicalizeBillingSchedule, evaluateBillingSchedule } from './schedule';
import { isPostpaidGenerationKey, syncPostpaidBilling } from './postpaid';
import type {
  BillingReconciliationPreservedCounts,
  BillingReconciliationResult,
  BillingReconciliationWarning,
  BillingScheduleConfigV1,
  ReconcileClientServiceBillingInput,
} from './types';

type BillingDb = Prisma.TransactionClient | typeof prisma;

type BillingFeeLine = {
  id: string;
  amount: unknown;
  currency: string;
  billingFrequency?: string;
  customFrequencyLabel?: string | null;
  billingStartDate?: Date | string | null;
  scheduleConfig?: unknown;
  billingTiming?: string;
  isActive?: boolean;
  deletedAt?: Date | string | null;
};

type BillingService = {
  id: string;
  tenantId: string;
  companyId: string;
  status: string;
  deletedAt?: Date | string | null;
  endDate?: Date | string | null;
  billingDisposition?: string;
  feeLines?: BillingFeeLine[];
};

type StoredBillingOccurrence = {
  id: string;
  tenantId?: string;
  companyId?: string;
  clientServiceId?: string;
  feeLineId: string;
  billingPeriodKey: string;
  scheduleEntryKey: string;
  generationKey: string;
  calculatedExpectedDate: Date | string;
  operativeExpectedDate: Date | string;
  updatedAt: Date | string;
  dateOverridden: boolean;
  valueOverridden?: boolean;
  status: string;
  origin?: string;
  baseAmount?: unknown;
  baseCurrency?: string;
  operativeAmount?: unknown;
  operativeCurrency?: string;
  cancelledAt?: Date | string | null;
  cancelledById?: string | null;
  cancellationReason?: string | null;
  cancellationReconciliationRequestId?: string | null;
};

type EvaluatedProposal = {
  feeLine: BillingFeeLine;
  feeLineId: string;
  billingPeriodKey: string;
  scheduleEntryKey: string;
  generationKey: string;
  calculatedExpectedDate: DateOnly;
  operativeExpectedDate: DateOnly;
  amount: string;
  currency: string;
};

type BillingOccurrenceDelegate = {
  findMany?: (args: unknown) => Promise<unknown>;
  findFirst?: (args: unknown) => Promise<unknown>;
  createMany?: (args: unknown) => Promise<{ count: number }>;
  upsert?: (args: unknown) => Promise<unknown>;
  updateMany?: (args: unknown) => Promise<{ count: number }>;
};

const MAX_OPTIMISTIC_WRITE_ATTEMPTS = 3;
const MAX_HISTORICAL_BACKFILL_OCCURRENCES = 50;

class BillingReconciliationConflictError extends Error {
  readonly code = 'BILLING_RECONCILIATION_CONFLICT';

  constructor() {
    super('Billing reconciliation encountered a concurrent update and will retry');
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toDateOnly(value: unknown): DateOnly | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDateOnly(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = value.slice(0, 10) as DateOnly;
    try {
      parseDateOnly(date);
      return date;
    } catch {
      return null;
    }
  }
  return null;
}

function dateValue(value: DateOnly): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function amountString(value: unknown): string {
  if (value && typeof value === 'object' && 'toFixed' in value && typeof value.toFixed === 'function') {
    return value.toFixed(2);
  }
  return String(value ?? '');
}

function calendarFromRecord(record: unknown): BusinessCalendarSnapshot {
  const value = asRecord(record);
  const holidays = Array.isArray(value.holidays)
    ? value.holidays
      .map((holiday) => toDateOnly(asRecord(holiday).date ?? holiday))
      .filter((date): date is DateOnly => date !== null)
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

function occurrenceIdentity(value: Pick<StoredBillingOccurrence, 'feeLineId' | 'billingPeriodKey' | 'scheduleEntryKey' | 'generationKey'>): string {
  return [value.feeLineId, value.billingPeriodKey, value.scheduleEntryKey, value.generationKey].join('|');
}

function emptyPreservedCounts(): BillingReconciliationPreservedCounts {
  return {
    MANUAL_TRIGGER: 0,
    HISTORICAL: 0,
    BILLED: 0,
    WAIVED: 0,
    CANCELLED: 0,
    OVERRIDDEN: 0,
  };
}

function preserveReason(occurrence: StoredBillingOccurrence, today: DateOnly): keyof BillingReconciliationPreservedCounts {
  if (occurrence.origin && occurrence.origin !== 'RULE') return 'MANUAL_TRIGGER';
  const operative = toDateOnly(occurrence.operativeExpectedDate);
  if (operative && compareDateOnly(operative, today) < 0) return 'HISTORICAL';
  switch (occurrence.status) {
    case 'BILLED': return 'BILLED';
    case 'WAIVED': return 'WAIVED';
    case 'CANCELLED': return 'CANCELLED';
  }
  if (occurrence.dateOverridden || occurrence.valueOverridden) return 'OVERRIDDEN';
  return 'HISTORICAL';
}

function isProtected(occurrence: StoredBillingOccurrence, today: DateOnly): boolean {
  const reason = preserveReason(occurrence, today);
  return reason !== 'HISTORICAL'
    || (toDateOnly(occurrence.operativeExpectedDate) !== null
      && compareDateOnly(toDateOnly(occurrence.operativeExpectedDate)!, today) < 0)
    || Boolean(occurrence.dateOverridden)
    || Boolean(occurrence.valueOverridden);
}

function isFutureOpenEligible(occurrence: StoredBillingOccurrence, today: DateOnly): boolean {
  const operative = toDateOnly(occurrence.operativeExpectedDate);
  return occurrence.status === 'OPEN'
    && Boolean(operative)
    && compareDateOnly(operative!, today) >= 0
    && !occurrence.dateOverridden
    && !occurrence.valueOverridden
    && occurrence.origin !== 'MANUAL_TRIGGER';
}

function warning(
  warnings: BillingReconciliationWarning[],
  code: string,
  message: string,
  feeLineId?: string,
  permanent = false,
): void {
  if (warnings.some((item) => item.code === code && item.feeLineId === feeLineId)) return;
  warnings.push({ code, message, ...(feeLineId ? { feeLineId } : {}), ...(permanent ? { permanent } : {}) });
}

function generationKey(feeLine: BillingFeeLine): string {
  // The fee-line row is the lifecycle identity. Schedule edits recalculate
  // this generation in place; archival/replacement creates a new fee-line row
  // and therefore a new generation without reopening archived occurrences.
  return `billing-v1-${hashConfiguration({
    feeLineId: feeLine.id,
  })}`;
}

function feeLineIsActive(feeLine: BillingFeeLine): boolean {
  return feeLine.isActive !== false && feeLine.deletedAt == null;
}

function scheduleConfigFor(feeLine: BillingFeeLine): BillingScheduleConfigV1 | null {
  if (!feeLine.billingFrequency) return null;
  let config: BillingScheduleConfigV1 | null;
  try {
    config = canonicalizeBillingSchedule({
      billingFrequency: feeLine.billingFrequency,
      billingStartDate: feeLine.billingStartDate ?? null,
      customFrequencyLabel: feeLine.customFrequencyLabel ?? null,
      scheduleConfig: feeLine.scheduleConfig,
    });
  } catch {
    return null;
  }
  // A schema-valid object still cannot generate a rolling occurrence without
  // an anchor date and at least one stable schedule entry. Treat this as an
  // invalid configuration so existing rows are preserved for review.
  if (!config?.startDate || !Array.isArray(config.scheduleEntries) || config.scheduleEntries.length === 0) return null;
  return config;
}

async function loadCalendar(db: BillingDb, tenantId: string): Promise<BusinessCalendarSnapshot> {
  const delegate = (db as unknown as { businessCalendar?: { findFirst?: (args: unknown) => Promise<unknown> } }).businessCalendar;
  if (!delegate?.findFirst) return calendarFromRecord(null);
  const record = await delegate.findFirst({
    where: { tenantId, isActive: true, archivedAt: null },
    include: { holidays: { where: { tenantId, isActive: true } } },
  });
  return calendarFromRecord(record);
}

async function loadExistingOccurrences(db: BillingDb, tenantId: string, clientServiceId: string): Promise<StoredBillingOccurrence[]> {
  const delegate = (db as unknown as { billingOccurrence?: BillingOccurrenceDelegate }).billingOccurrence;
  if (!delegate?.findMany) return [];
  const rows = await delegate.findMany({
    where: { tenantId, clientServiceId },
    orderBy: [{ operativeExpectedDate: 'asc' }, { id: 'asc' }],
  });
  return (Array.isArray(rows) ? rows : []) as StoredBillingOccurrence[];
}

async function loadOccurrence(
  db: BillingDb,
  tenantId: string,
  clientServiceId: string,
  occurrenceId: string,
): Promise<StoredBillingOccurrence | null> {
  const delegate = (db as unknown as { billingOccurrence?: BillingOccurrenceDelegate }).billingOccurrence;
  if (!delegate) return null;
  const where = { id: occurrenceId, tenantId, clientServiceId };
  if (delegate.findFirst) {
    const row = await delegate.findFirst({ where });
    return row && typeof row === 'object' ? row as StoredBillingOccurrence : null;
  }
  if (delegate.findMany) {
    const rows = await delegate.findMany({ where, take: 1 });
    const row = Array.isArray(rows) ? rows[0] : null;
    return row && typeof row === 'object' ? row as StoredBillingOccurrence : null;
  }
  return null;
}

async function updateOccurrence(
  db: BillingDb,
  tenantId: string,
  clientServiceId: string,
  occurrence: StoredBillingOccurrence,
  today: DateOnly,
  data: Record<string, unknown>,
): Promise<number> {
  const delegate = (db as unknown as { billingOccurrence?: BillingOccurrenceDelegate }).billingOccurrence;
  if (!delegate?.updateMany) return 0;
  const result = await delegate.updateMany({
    where: {
      id: occurrence.id,
      tenantId,
      clientServiceId,
      feeLineId: occurrence.feeLineId,
      billingPeriodKey: occurrence.billingPeriodKey,
      scheduleEntryKey: occurrence.scheduleEntryKey,
      generationKey: occurrence.generationKey,
      updatedAt: occurrence.updatedAt,
      status: 'OPEN',
      operativeExpectedDate: { gte: dateValue(today) },
      dateOverridden: Boolean(occurrence.dateOverridden),
      valueOverridden: Boolean(occurrence.valueOverridden),
    },
    data,
  });
  return result?.count ?? 0;
}

function recordPreserved(
  result: BillingReconciliationResult,
  occurrence: StoredBillingOccurrence,
  today: DateOnly,
): void {
  const reason = preserveReason(occurrence, today);
  result.preserved += 1;
  result.preservedByReason[reason] += 1;
}

function dateChanged(left: unknown, right: DateOnly): boolean {
  const date = toDateOnly(left);
  return date !== right;
}

function valueChanged(left: unknown, right: string): boolean {
  return amountString(left) !== right;
}

type MutationOutcome =
  | { kind: 'UPDATED' }
  | { kind: 'ALREADY_APPLIED' }
  | { kind: 'PRESERVED'; occurrence: StoredBillingOccurrence }
  | { kind: 'GONE' };

function sameOccurrenceIdentity(left: StoredBillingOccurrence, right: StoredBillingOccurrence): boolean {
  return occurrenceIdentity(left) === occurrenceIdentity(right);
}

function isGenuinelyProtected(
  occurrence: StoredBillingOccurrence,
  today: DateOnly,
  initial?: StoredBillingOccurrence,
): boolean {
  if (occurrence.origin && occurrence.origin !== 'RULE') return true;
  const operative = toDateOnly(occurrence.operativeExpectedDate);
  if (!operative || compareDateOnly(operative, today) < 0) return true;
  if (occurrence.status === 'BILLED' || occurrence.status === 'WAIVED' || occurrence.status === 'CANCELLED') return true;
  return initial
    ? Boolean(occurrence.dateOverridden) !== Boolean(initial.dateOverridden)
      || Boolean(occurrence.valueOverridden) !== Boolean(initial.valueOverridden)
    : Boolean(occurrence.dateOverridden) || Boolean(occurrence.valueOverridden);
}

function isMutationEligible(
  occurrence: StoredBillingOccurrence,
  initial: StoredBillingOccurrence,
  today: DateOnly,
): boolean {
  const operative = toDateOnly(occurrence.operativeExpectedDate);
  return sameOccurrenceIdentity(occurrence, initial)
    && occurrence.status === 'OPEN'
    && Boolean(operative)
    && compareDateOnly(operative!, today) >= 0
    && occurrence.origin !== 'MANUAL_TRIGGER'
    && Boolean(occurrence.dateOverridden) === Boolean(initial.dateOverridden)
    && Boolean(occurrence.valueOverridden) === Boolean(initial.valueOverridden);
}

function mutationValueMatches(current: unknown, desired: unknown, key: string): boolean {
  if (key === 'cancelledAt') return current != null;
  if (key === 'calculatedExpectedDate' || key === 'operativeExpectedDate') {
    const desiredDate = toDateOnly(desired);
    return desiredDate !== null && toDateOnly(current) === desiredDate;
  }
  if (key === 'baseAmount' || key === 'operativeAmount') return amountString(current) === amountString(desired);
  return current === desired;
}

function mutationAlreadyApplied(occurrence: StoredBillingOccurrence, data: Record<string, unknown>): boolean {
  if (data.status === 'CANCELLED') {
    return occurrence.status === 'CANCELLED'
      && occurrence.cancelledAt != null
      && occurrence.cancelledById === data.cancelledById
      && occurrence.cancellationReason === data.cancellationReason
      && occurrence.cancellationReconciliationRequestId === data.cancellationReconciliationRequestId;
  }
  return Object.entries(data).every(([key, desired]) => mutationValueMatches(occurrence[key as keyof StoredBillingOccurrence], desired, key));
}

function preservedMutationOutcome(occurrence: StoredBillingOccurrence): MutationOutcome {
  return { kind: 'PRESERVED', occurrence };
}

async function applyOccurrenceMutation(
  db: BillingDb,
  input: ReconcileClientServiceBillingInput,
  occurrence: StoredBillingOccurrence,
  data: Record<string, unknown>,
): Promise<MutationOutcome> {
  let candidate = occurrence;
  for (let attempt = 0; attempt < MAX_OPTIMISTIC_WRITE_ATTEMPTS; attempt += 1) {
    if (!isMutationEligible(candidate, occurrence, input.today)) return preservedMutationOutcome(candidate);
    if (mutationAlreadyApplied(candidate, data)) return { kind: 'ALREADY_APPLIED' };

    const updated = await updateOccurrence(
      db,
      input.tenantId,
      input.clientServiceId,
      candidate,
      input.today,
      data,
    );
    if (updated === 1) return { kind: 'UPDATED' };

    const fresh = await loadOccurrence(db, input.tenantId, input.clientServiceId, occurrence.id);
    if (!fresh) return { kind: 'GONE' };
    if (!sameOccurrenceIdentity(fresh, occurrence)) return preservedMutationOutcome(fresh);
    if (isGenuinelyProtected(fresh, input.today, occurrence)) return preservedMutationOutcome(fresh);
    if (!isMutationEligible(fresh, occurrence, input.today)) return preservedMutationOutcome(fresh);
    if (mutationAlreadyApplied(fresh, data)) return { kind: 'ALREADY_APPLIED' };
    candidate = fresh;
  }
  throw new BillingReconciliationConflictError();
}

async function cancelOccurrence(
  input: ReconcileClientServiceBillingInput,
  db: BillingDb,
  occurrence: StoredBillingOccurrence,
  reason: string,
): Promise<MutationOutcome> {
  if (input.writeMode !== 'APPLY') return { kind: 'GONE' };
  return applyOccurrenceMutation(db, input, occurrence, {
    status: 'CANCELLED',
    cancelledAt: new Date(),
    cancelledById: input.cancellationActorId ?? null,
    cancellationReason: reason.trim(),
    cancellationReconciliationRequestId: input.reconciliationRequestId,
  });
}

async function persistCreates(
  db: BillingDb,
  input: ReconcileClientServiceBillingInput,
  companyId: string,
  proposals: EvaluatedProposal[],
): Promise<number> {
  if (proposals.length === 0 || input.writeMode !== 'APPLY') return 0;
  const data = proposals.map((proposal) => ({
    tenantId: input.tenantId,
    companyId,
    clientServiceId: input.clientServiceId,
    feeLineId: proposal.feeLineId,
    billingPeriodKey: proposal.billingPeriodKey,
    scheduleEntryKey: proposal.scheduleEntryKey,
    generationKey: proposal.generationKey,
    calculatedExpectedDate: dateValue(proposal.calculatedExpectedDate),
    operativeExpectedDate: dateValue(proposal.operativeExpectedDate),
    dateOverridden: false,
    baseAmount: proposal.amount,
    baseCurrency: proposal.currency,
    operativeAmount: proposal.amount,
    operativeCurrency: proposal.currency,
    valueOverridden: false,
    status: 'OPEN',
  }));
  const delegate = (db as unknown as { billingOccurrence?: BillingOccurrenceDelegate }).billingOccurrence;
  if (!delegate) return 0;
  if (delegate.createMany) {
    const result = await delegate.createMany({ data, skipDuplicates: true });
    return result.count;
  }
  if (!delegate.upsert) return 0;
  let created = 0;
  for (const row of data) {
    await delegate.upsert({
      where: {
        tenantId_feeLineId_billingPeriodKey_scheduleEntryKey_generationKey: {
          tenantId: input.tenantId,
          feeLineId: row.feeLineId,
          billingPeriodKey: row.billingPeriodKey,
          scheduleEntryKey: row.scheduleEntryKey,
          generationKey: row.generationKey,
        },
      },
      create: row,
      update: {},
    });
    created += 1;
  }
  return created;
}

/**
 * Reconcile materialized billing tracking rows for one client service.
 * Billing is intentionally a tracking projection: this function never creates
 * invoices, payments, ledger entries, or external billing side effects.
 */
export async function reconcileClientServiceBilling(
  input: ReconcileClientServiceBillingInput,
  db: BillingDb = prisma,
): Promise<BillingReconciliationResult> {
  parseDateOnly(input.today);
  parseDateOnly(input.horizonEnd);

  const result: BillingReconciliationResult = {
    clientServiceId: input.clientServiceId,
    created: 0,
    recalculated: 0,
    cancelled: 0,
    preserved: 0,
    preservedByReason: emptyPreservedCounts(),
    warnings: [],
  };

  const clientServiceDelegate = (db as unknown as { clientService?: { findFirst?: (args: unknown) => Promise<unknown> } }).clientService;
  if (!clientServiceDelegate?.findFirst) return result;
  await input.assertLease?.();
  const serviceRecord = await clientServiceDelegate.findFirst({
    where: { id: input.clientServiceId, tenantId: input.tenantId },
    include: { feeLines: true, company: true },
  });
  const service = serviceRecord as BillingService | null;
  if (!service) {
    warning(result.warnings, 'CLIENT_SERVICE_NOT_FOUND', 'Client service was not found', undefined, true);
    return result;
  }

  const existingOccurrences = await loadExistingOccurrences(db, input.tenantId, input.clientServiceId);
  const occurrenceByIdentity = new Map(existingOccurrences.map((occurrence) => [occurrenceIdentity(occurrence), occurrence]));
  const processed = new Set<string>();
  const skipCleanupFeeLineIds = new Set<string>();
  const proposals: EvaluatedProposal[] = [];
  const historicalBackfillProposals: EvaluatedProposal[] = [];
  const calendar = await loadCalendar(db, input.tenantId);

  const serviceDeleted = service.deletedAt != null;
  const serviceEnded = service.status === 'ENDED'
    || (service.endDate != null && (() => {
      const endDate = toDateOnly(service.endDate);
      return endDate !== null && compareDateOnly(endDate, input.today) < 0;
    })());
  const servicePaused = service.status === 'PAUSED';
  const disposition = service.billingDisposition ?? 'UNREVIEWED';
  const shouldStopGeneration = serviceDeleted || serviceEnded || servicePaused || disposition !== 'CONFIGURED';
  const shouldCancelUnmatched = serviceDeleted || serviceEnded || disposition === 'NOT_REQUIRED';

  let effectiveHorizonEnd = input.horizonEnd;
  const serviceEndDate = toDateOnly(service.endDate);
  if (serviceEndDate && compareDateOnly(serviceEndDate, effectiveHorizonEnd) < 0) effectiveHorizonEnd = serviceEndDate;

  if (disposition === 'UNREVIEWED') {
    warning(result.warnings, 'MISSING_DISPOSITION', 'Billing disposition requires review', undefined, true);
  }

  const feeLines = Array.isArray(service.feeLines) ? service.feeLines : [];
  if (disposition === 'CONFIGURED' && feeLines.filter(feeLineIsActive).length === 0) {
    warning(result.warnings, 'MISSING_FEE_LINES', 'Configured billing requires an active fee line', undefined, true);
  }

  if (!shouldStopGeneration && compareDateOnly(input.today, effectiveHorizonEnd) <= 0) {
    for (const feeLine of feeLines) {
      await input.assertLease?.();
      if (!feeLineIsActive(feeLine)) continue;
      // Postpaid lines bill when their filing is Filed (synced below).
      if (feeLine.billingTiming === 'POSTPAID') continue;
      const amount = amountString(feeLine.amount);
      if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(amount) || !/^[A-Z]{3}$/.test(feeLine.currency)) {
        warning(result.warnings, 'INVALID_AMOUNT_OR_CURRENCY', 'Fee line amount or currency is invalid', feeLine.id, true);
        skipCleanupFeeLineIds.add(feeLine.id);
        continue;
      }
      let config: BillingScheduleConfigV1 | null;
      try {
        config = scheduleConfigFor(feeLine);
      } catch {
        warning(result.warnings, 'INVALID_SCHEDULE', 'Fee line schedule is missing or invalid', feeLine.id, true);
        skipCleanupFeeLineIds.add(feeLine.id);
        continue;
      }
      if (!config) {
        warning(result.warnings, 'INVALID_SCHEDULE', 'Fee line schedule is missing or invalid', feeLine.id, true);
        skipCleanupFeeLineIds.add(feeLine.id);
        continue;
      }
      const generation = generationKey(feeLine);
      try {
        const evaluationInput = {
          config,
          feeLine: { id: feeLine.id, amount, currency: feeLine.currency },
          calendar,
          generationKey: generation,
        };
        const startDate = config.startDate;
        const historicalBackfillOccurrences = input.includeHistoricalStart
          && startDate
          && compareDateOnly(startDate, input.today) < 0
          ? evaluateBillingSchedule({
            ...evaluationInput,
            from: startDate,
            to: addCalendarDays(input.today, -1),
          })
          : [];
        const evaluated = evaluateBillingSchedule({
          ...evaluationInput,
          from: input.today,
          to: effectiveHorizonEnd,
        });
        historicalBackfillProposals.push(...historicalBackfillOccurrences.map((occurrence) => ({
          feeLine,
          feeLineId: occurrence.feeLineId,
          billingPeriodKey: occurrence.billingPeriodKey,
          scheduleEntryKey: occurrence.scheduleEntryKey,
          generationKey: occurrence.generationKey,
          calculatedExpectedDate: occurrence.calculatedExpectedDate,
          operativeExpectedDate: occurrence.operativeExpectedDate,
          amount: occurrence.amount,
          currency: occurrence.currency,
        })));
        proposals.push(...evaluated.map((occurrence) => ({
          feeLine,
          feeLineId: occurrence.feeLineId,
          billingPeriodKey: occurrence.billingPeriodKey,
          scheduleEntryKey: occurrence.scheduleEntryKey,
          generationKey: occurrence.generationKey,
          calculatedExpectedDate: occurrence.calculatedExpectedDate,
          operativeExpectedDate: occurrence.operativeExpectedDate,
          amount: occurrence.amount,
          currency: occurrence.currency,
        })));
      } catch {
        warning(result.warnings, 'INVALID_SCHEDULE', 'Fee line schedule could not be evaluated', feeLine.id, true);
        skipCleanupFeeLineIds.add(feeLine.id);
      }
    }
  }

  const cappedHistoricalBackfill = historicalBackfillProposals.length > MAX_HISTORICAL_BACKFILL_OCCURRENCES
    ? historicalBackfillProposals
      .slice()
      .sort((left, right) => compareDateOnly(left.operativeExpectedDate, right.operativeExpectedDate))
      .slice(-MAX_HISTORICAL_BACKFILL_OCCURRENCES)
    : historicalBackfillProposals;
  if (historicalBackfillProposals.length > cappedHistoricalBackfill.length) {
    warning(
      result.warnings,
      'HISTORICAL_BACKFILL_CAPPED',
      `Historical billing backfill was capped at ${MAX_HISTORICAL_BACKFILL_OCCURRENCES} occurrences`,
    );
  }
  proposals.unshift(...cappedHistoricalBackfill);

  const createProposals: EvaluatedProposal[] = [];
  for (const proposal of proposals) {
    const identity = occurrenceIdentity(proposal);
    const existing = occurrenceByIdentity.get(identity);
    if (!existing) {
      createProposals.push(proposal);
      continue;
    }
    processed.add(existing.id);
    const operative = toDateOnly(existing.operativeExpectedDate);
    if (existing.origin && existing.origin !== 'RULE') {
      result.preserved += 1;
      result.preservedByReason.MANUAL_TRIGGER += 1;
      continue;
    }
    if (!operative || compareDateOnly(operative, input.today) < 0) {
      result.preserved += 1;
      result.preservedByReason.HISTORICAL += 1;
      continue;
    }
    if (existing.status === 'BILLED') {
      result.preserved += 1;
      result.preservedByReason.BILLED += 1;
      continue;
    }
    if (existing.status === 'WAIVED') {
      result.preserved += 1;
      result.preservedByReason.WAIVED += 1;
      continue;
    }
    if (existing.status === 'CANCELLED') {
      result.preserved += 1;
      result.preservedByReason.CANCELLED += 1;
      continue;
    }
    const dateOverride = Boolean(existing.dateOverridden);
    const valueOverride = Boolean(existing.valueOverridden);
    const data: Record<string, unknown> = {};
    if (dateChanged(existing.calculatedExpectedDate, proposal.calculatedExpectedDate)) {
      data.calculatedExpectedDate = dateValue(proposal.calculatedExpectedDate);
    }
    if (!dateOverride && dateChanged(existing.operativeExpectedDate, proposal.operativeExpectedDate)) {
      data.operativeExpectedDate = dateValue(proposal.operativeExpectedDate);
    }
    if (valueChanged(existing.baseAmount, proposal.amount)) data.baseAmount = proposal.amount;
    if (existing.baseCurrency !== proposal.currency) data.baseCurrency = proposal.currency;
    if (!valueOverride && valueChanged(existing.operativeAmount, proposal.amount)) data.operativeAmount = proposal.amount;
    if (!valueOverride && existing.operativeCurrency !== proposal.currency) data.operativeCurrency = proposal.currency;
    if (Object.keys(data).length > 0) {
      if (input.writeMode === 'OBSERVE') {
        if (dateOverride || valueOverride) {
          result.preserved += 1;
          result.preservedByReason.OVERRIDDEN += 1;
        } else {
          result.recalculated += 1;
        }
      } else {
        const mutation = await applyOccurrenceMutation(db, input, existing, data);
        if (mutation.kind === 'UPDATED') {
          if (dateOverride || valueOverride) {
            result.preserved += 1;
            result.preservedByReason.OVERRIDDEN += 1;
          } else {
            result.recalculated += 1;
          }
        } else if (mutation.kind === 'PRESERVED') {
          recordPreserved(result, mutation.occurrence, input.today);
        }
      }
    } else {
      // The row is still a valid future generated identity, even when no value changed.
      result.preserved += dateOverride || valueOverride ? 1 : 0;
      if (dateOverride || valueOverride) result.preservedByReason.OVERRIDDEN += 1;
    }
  }

  await input.assertLease?.();
  result.created += input.writeMode === 'OBSERVE'
    ? createProposals.length
    : await persistCreates(db, input, service.companyId, createProposals);

  // Any stored row not represented by the current active schedule is either an
  // archived generation or a source configuration that no longer applies.
  // Preserve protected history; only eligible future Open rows are cancelled.
  for (const occurrence of existingOccurrences) {
    if (processed.has(occurrence.id)) continue;
    // Postpaid entries follow filing status, not the schedule.
    if (isPostpaidGenerationKey(occurrence.generationKey)) continue;
    const reason = preserveReason(occurrence, input.today);
    if (skipCleanupFeeLineIds.has(occurrence.feeLineId)
      || isProtected(occurrence, input.today)
      || servicePaused
      || disposition === 'UNREVIEWED') {
      result.preserved += 1;
      result.preservedByReason[reason] += 1;
      continue;
    }
    if (isFutureOpenEligible(occurrence, input.today) && (shouldCancelUnmatched || disposition === 'CONFIGURED')) {
      const cancellationReason = serviceDeleted
        ? 'Client service archived or deleted'
        : serviceEnded
          ? 'Client service ended or expired'
        : disposition === 'NOT_REQUIRED'
          ? 'Billing marked not required'
          : 'Fee-line schedule removed or replaced';
      if (input.writeMode === 'OBSERVE') {
        result.cancelled += 1;
      } else {
        const mutation = await cancelOccurrence(input, db, occurrence, cancellationReason);
        if (mutation.kind === 'UPDATED') {
          result.cancelled += 1;
        } else if (mutation.kind === 'PRESERVED') {
          recordPreserved(result, mutation.occurrence, input.today);
        }
      }
      continue;
    }
    result.preserved += 1;
    result.preservedByReason[reason] += 1;
  }

  // Bill YAs already Filed, e.g. when a line has just become postpaid.
  if (input.writeMode === 'APPLY' && !shouldStopGeneration
    && feeLines.some((feeLine) => feeLineIsActive(feeLine) && feeLine.billingTiming === 'POSTPAID')
    && (db as unknown as { deadlineOccurrence?: unknown }).deadlineOccurrence) {
    await input.assertLease?.();
    const postpaid = await syncPostpaidBilling({
      tenantId: input.tenantId,
      companyId: service.companyId,
      clientServiceId: service.id,
      cancelledById: input.cancellationActorId ?? null,
      cancellationReconciliationRequestId: input.reconciliationRequestId,
    }, db);
    result.created += postpaid.created + postpaid.reopened;
    result.cancelled += postpaid.cancelled;
    result.recalculated += postpaid.updated;
  }

  return result;
}
