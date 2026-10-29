import { ValidationError } from '@/lib/errors';
import { Prisma, type Prisma as PrismaTypes } from '@/generated/prisma';
import { hashConfiguration } from '@/services/service-schedule/hash';
import type {
  EnqueueScheduleReconciliationInput,
  ScheduleReconciliationDb,
  ScheduleReconciliationRequestRef,
} from './types';

const MINUTE_MS = 60_000;
const PENDING = 'PENDING';

type QueueStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
type QueueRow = {
  id?: string;
  dedupeKey?: string;
  status?: QueueStatus | string;
  nextAttemptAt?: Date | string;
};
type QueueDelegate = ScheduleReconciliationDb['serviceScheduleReconciliationRequest'] & {
  findUnique?: (args: unknown) => Promise<QueueRow | null>;
};
type RawQueueClient = {
  $queryRaw?: <T>(query: PrismaTypes.Sql) => Promise<T>;
};

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a non-empty string`);
  }
}

function minuteContaining(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError('notBefore must be a valid date');
  }
  return new Date(Math.floor(value.getTime() / MINUTE_MS) * MINUTE_MS);
}

function earlierDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function rowDate(value: Date | string | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Build the stable identity for one UTC minute of source work. */
export function scheduleReconciliationDedupeKey(
  input: Pick<EnqueueScheduleReconciliationInput, 'tenantId' | 'scopeType' | 'scopeId' | 'triggerType'>,
  notBefore: Date,
): string {
  const minute = minuteContaining(notBefore);
  return hashConfiguration({
    tenantId: input.tenantId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    triggerType: input.triggerType,
    notBeforeMinute: minute.toISOString(),
  });
}

function followUpDedupeKey(
  canonicalKey: string,
  input: EnqueueScheduleReconciliationInput,
  requestedAt: Date,
  attempt = 0,
): string {
  return hashConfiguration({
    canonicalKey,
    followUp: true,
    correlationId: input.correlationId,
    // Coalesce source changes that arrive during the same minute while still
    // allowing a later minute to request another follow-up after a live
    // worker has claimed the canonical row.
    requestedAtMinute: minuteContaining(requestedAt).toISOString(),
    attempt,
  });
}

function createData(
  input: EnqueueScheduleReconciliationInput,
  dedupeKey: string,
  requestedAt: Date,
): PrismaTypes.ServiceScheduleReconciliationRequestUncheckedCreateInput {
  return {
    tenantId: input.tenantId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    triggerType: input.triggerType,
    correlationId: input.correlationId,
    dedupeKey,
    status: PENDING,
    nextAttemptAt: requestedAt,
    summary: {},
    requestedById: input.requestedById,
  };
}

function pendingUpdate(
  input: EnqueueScheduleReconciliationInput,
  nextAttemptAt: Date,
): PrismaTypes.ServiceScheduleReconciliationRequestUncheckedUpdateInput {
  // Do not touch status, lease, startedAt, completedAt, or error fields. A
  // live worker and completed history are never reset by a source mutation.
  return {
    correlationId: input.correlationId,
    requestedById: input.requestedById,
    nextAttemptAt,
  };
}

async function enqueueWithDelegate(
  delegate: QueueDelegate,
  input: EnqueueScheduleReconciliationInput,
  canonicalKey: string,
  requestedAt: Date,
): Promise<ScheduleReconciliationRequestRef> {
  if (typeof delegate.findUnique !== 'function') {
    throw new ValidationError('Transactional queue lifecycle inspection is unavailable');
  }

  const existing = await delegate.findUnique({ where: { dedupeKey: canonicalKey } });
  if (!existing) {
    const created = await delegate.upsert({
      where: { dedupeKey: canonicalKey },
      create: createData(input, canonicalKey, requestedAt),
      update: {},
    });
    return { id: typeof created?.id === 'string' ? created.id : canonicalKey, dedupeKey: canonicalKey };
  }

  if (existing.status === PENDING) {
    const existingNext = rowDate(existing.nextAttemptAt);
    const nextAttemptAt = existingNext ? earlierDate(existingNext, requestedAt) : requestedAt;
    const updated = await delegate.upsert({
      where: { dedupeKey: canonicalKey },
      create: createData(input, canonicalKey, requestedAt),
      update: pendingUpdate(input, nextAttemptAt),
    });
    return { id: typeof updated?.id === 'string' ? updated.id : (existing.id ?? canonicalKey), dedupeKey: canonicalKey };
  }

  const followUpKey = followUpDedupeKey(canonicalKey, input, requestedAt);
  const followUp = await delegate.findUnique({ where: { dedupeKey: followUpKey } });
  if (followUp?.status === PENDING) {
    const existingNext = rowDate(followUp.nextAttemptAt);
    const nextAttemptAt = existingNext ? earlierDate(existingNext, requestedAt) : requestedAt;
    const updated = await delegate.upsert({
      where: { dedupeKey: followUpKey },
      create: createData(input, followUpKey, requestedAt),
      update: pendingUpdate(input, nextAttemptAt),
    });
    return { id: typeof updated?.id === 'string' ? updated.id : (followUp.id ?? followUpKey), dedupeKey: followUpKey };
  }
  const created = await delegate.upsert({
    where: { dedupeKey: followUpKey },
    create: createData(input, followUpKey, requestedAt),
    update: {},
  });
  return { id: typeof created?.id === 'string' ? created.id : (followUp?.id ?? followUpKey), dedupeKey: followUpKey };
}

async function rawRows<T>(client: RawQueueClient, query: PrismaTypes.Sql): Promise<T[]> {
  if (typeof client.$queryRaw !== 'function') throw new ValidationError('Transactional queue persistence is unavailable');
  const result = await client.$queryRaw<T[]>(query);
  return Array.isArray(result) ? result : [];
}

function rawInsert(
  input: EnqueueScheduleReconciliationInput,
  dedupeKey: string,
  requestedAt: Date,
): PrismaTypes.Sql {
  return Prisma.sql`
    INSERT INTO "service_schedule_reconciliation_requests"
      ("tenant_id", "scope_type", "scope_id", "trigger_type", "correlation_id",
       "dedupe_key", "status", "next_attempt_at", "summary", "requested_by_id")
    VALUES
      (${input.tenantId}, CAST(${input.scopeType} AS "ScheduleReconciliationScopeType"),
       ${input.scopeId}, ${input.triggerType}, ${input.correlationId}, ${dedupeKey},
       CAST(${PENDING} AS "ScheduleReconciliationStatus"), ${requestedAt}, '{}'::jsonb,
       ${input.requestedById})
    ON CONFLICT ("dedupe_key") DO NOTHING
    RETURNING "id", "dedupe_key", "status", "next_attempt_at"
  `;
}

function rawPendingUpdate(
  input: EnqueueScheduleReconciliationInput,
  dedupeKey: string,
  requestedAt: Date,
): PrismaTypes.Sql {
  return Prisma.sql`
    UPDATE "service_schedule_reconciliation_requests"
    SET "next_attempt_at" = LEAST("next_attempt_at", ${requestedAt}),
        "correlation_id" = ${input.correlationId},
        "requested_by_id" = ${input.requestedById},
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "dedupe_key" = ${dedupeKey}
      AND "status" = CAST(${PENDING} AS "ScheduleReconciliationStatus")
    RETURNING "id", "dedupe_key", "status", "next_attempt_at"
  `;
}

function rawSelect(dedupeKey: string): PrismaTypes.Sql {
  return Prisma.sql`
    SELECT "id", "dedupe_key", "status", "next_attempt_at"
    FROM "service_schedule_reconciliation_requests"
    WHERE "dedupe_key" = ${dedupeKey}
    FOR UPDATE
  `;
}

async function enqueueWithRaw(
  client: RawQueueClient,
  input: EnqueueScheduleReconciliationInput,
  canonicalKey: string,
  requestedAt: Date,
): Promise<ScheduleReconciliationRequestRef> {
  const inserted = await rawRows<QueueRow>(client, rawInsert(input, canonicalKey, requestedAt));
  if (inserted[0]) return { id: inserted[0].id ?? canonicalKey, dedupeKey: canonicalKey };

  const updated = await rawRows<QueueRow>(client, rawPendingUpdate(input, canonicalKey, requestedAt));
  if (updated[0]) return { id: updated[0].id ?? canonicalKey, dedupeKey: canonicalKey };

  const existing = (await rawRows<QueueRow>(client, rawSelect(canonicalKey)))[0];
  if (!existing) throw new ValidationError('Reconciliation request disappeared during enqueue');

  const followUpKey = followUpDedupeKey(canonicalKey, input, requestedAt);
  const followUpInserted = await rawRows<QueueRow>(client, rawInsert(input, followUpKey, requestedAt));
  if (followUpInserted[0]) return { id: followUpInserted[0].id ?? followUpKey, dedupeKey: followUpKey };
  const followUpUpdated = await rawRows<QueueRow>(client, rawPendingUpdate(input, followUpKey, requestedAt));
  if (followUpUpdated[0]) return { id: followUpUpdated[0].id ?? followUpKey, dedupeKey: followUpKey };
  const existingFollowUp = (await rawRows<QueueRow>(client, rawSelect(followUpKey)))[0];
  if (existingFollowUp) return { id: existingFollowUp.id ?? followUpKey, dedupeKey: followUpKey };
  throw new ValidationError('Follow-up reconciliation request disappeared during enqueue');
}

/** Enqueue durable work in the caller's transaction. */
export async function enqueueScheduleReconciliation(
  tx: ScheduleReconciliationDb,
  input: EnqueueScheduleReconciliationInput,
): Promise<ScheduleReconciliationRequestRef> {
  assertNonEmpty(input.tenantId, 'tenantId');
  assertNonEmpty(input.scopeId, 'scopeId');
  assertNonEmpty(input.triggerType, 'triggerType');
  assertNonEmpty(input.correlationId, 'correlationId');
  if (input.requestedById !== null) assertNonEmpty(input.requestedById, 'requestedById');

  const requestedAt = input.notBefore ?? new Date();
  minuteContaining(requestedAt);
  const canonicalKey = scheduleReconciliationDedupeKey(input, requestedAt);
  const rawClient = tx as unknown as RawQueueClient;
  if (typeof rawClient.$queryRaw === 'function') {
    return enqueueWithRaw(rawClient, input, canonicalKey, requestedAt);
  }

  const delegate = (tx as ScheduleReconciliationDb | undefined)?.serviceScheduleReconciliationRequest as QueueDelegate | undefined;
  if (!delegate || typeof delegate.upsert !== 'function') {
    throw new ValidationError('Transactional queue delegate is unavailable');
  }
  return enqueueWithDelegate(delegate, input, canonicalKey, requestedAt);
}
