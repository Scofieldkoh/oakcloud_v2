import { randomUUID } from 'node:crypto';
import { createAuditLog } from '@/lib/audit';
import { DeadlineApiError, ErrorCodes, NotFoundError, ValidationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import { companyPeriodFacts, normalizeCompanyRuleSource } from '@/services/service-schedule';
import { compareDateOnly, parseDateOnly } from '@/services/service-schedule/date-only';
import { hashConfiguration } from '@/services/service-schedule/hash';
import type { BusinessCalendarSnapshot, DateOnly } from '@/services/service-schedule';
import { ROLLING_PLAN_VERSION } from './planner';
import { projectDeadlineRule } from './projection';
import type {
  DeadlineOccurrenceRemediationAction,
  DeadlineOccurrenceRemediationApplyInput,
  DeadlineOccurrenceRemediationApplyResult,
  DeadlineOccurrenceRemediationCounts,
  DeadlineOccurrenceRemediationInput,
  DeadlineOccurrenceRemediationPreview,
  DeadlineRuleProjection,
  DeadlineRuleProjectionInput,
  ProjectedDeadline,
  StoredDeadline,
} from './types';

const MAX_SELECTED_SERVICES = 25;
const MIN_REASON_LENGTH = 10;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeDateOnly(value: unknown): DateOnly | null {
  if (typeof value === 'string') {
    const trimmed = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed as DateOnly;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10) as DateOnly;
  }
  return null;
}

function defaultCalendar(id = 'default'): BusinessCalendarSnapshot {
  return {
    id,
    timeZone: 'Asia/Singapore',
    revision: 1,
    weekendDays: new Set([0, 6]),
    holidays: new Set(),
  };
}

function preserveReason(stored: StoredDeadline): 'MANUAL_TRIGGER' | 'COMPLETED' | 'WAIVED' | 'CANCELLED' | 'OVERRIDDEN' | 'HISTORICAL' {
  if (stored.origin !== 'RULE') return 'MANUAL_TRIGGER';
  if (stored.status === 'COMPLETED') return 'COMPLETED';
  if (stored.status === 'WAIVED') return 'WAIVED';
  if (stored.status === 'CANCELLED') return 'CANCELLED';
  if (stored.dateOverridden) return 'OVERRIDDEN';
  return 'HISTORICAL';
}

function isRepairable(stored: StoredDeadline): boolean {
  return stored.origin === 'RULE' && stored.status === 'OPEN' && stored.dateOverridden === false;
}

function identityKey(ruleId: string, periodKey: string, milestoneKey: string, scheduleEntryKey: string): string {
  return [ruleId, periodKey, milestoneKey, scheduleEntryKey].join('|');
}

type StoredCycleForRemediation = {
  id: string;
  ruleId: string;
  periodKey: string;
  occurrences: Array<StoredDeadline & { id: string }>;
};

function toStoredDeadline(occurrence: {
  id: string;
  milestoneKey: string;
  scheduleEntryKey: string;
  deadlineType: string;
  calculatedDueDate: Date | string;
  operativeDueDate: Date | string;
  dateOverridden: boolean;
  status: string;
  origin: string;
  ruleVersionId: string;
}): StoredDeadline & { id: string } {
  return {
    id: occurrence.id,
    cycleId: '',
    milestoneKey: occurrence.milestoneKey,
    scheduleEntryKey: occurrence.scheduleEntryKey,
    deadlineType: occurrence.deadlineType,
    calculatedDueDate: safeDateOnly(occurrence.calculatedDueDate)!,
    operativeDueDate: safeDateOnly(occurrence.operativeDueDate)!,
    dateOverridden: occurrence.dateOverridden,
    status: occurrence.status,
    origin: occurrence.origin,
    ruleVersionId: occurrence.ruleVersionId,
  };
}

export type ServiceRemediationClassification = {
  actions: DeadlineOccurrenceRemediationAction[];
  recalculateRuleVersionIds: Record<string, string>;
  createPeriodBounds: Record<string, { start: DateOnly; end: DateOnly }>;
};

/**
 * Pure classification of stored rows against canonical projections. It never
 * mutates and its output order is deterministic for fingerprints.
 */
export function classifyRemediationActions(input: {
  projected: ProjectedDeadline[];
  projectedRuleIds: Set<string>;
  cycles: StoredCycleForRemediation[];
  periodBounds?: Array<{ ruleId: string; periodKey: string; start: DateOnly; end: DateOnly }>;
}): ServiceRemediationClassification {
  const projectedByIdentity = new Map<string, ProjectedDeadline>();
  for (const projected of input.projected) {
    const key = identityKey(projected.ruleId, projected.periodKey, projected.milestoneKey, projected.scheduleEntryKey);
    if (!projectedByIdentity.has(key)) projectedByIdentity.set(key, projected);
  }
  const matchedIdentityKeys = new Set<string>();
  const actions: DeadlineOccurrenceRemediationAction[] = [];
  const recalculateRuleVersionIds: Record<string, string> = {};
  const createPeriodBounds: Record<string, { start: DateOnly; end: DateOnly }> = {};

  for (const cycle of input.cycles) {
    if (!input.projectedRuleIds.has(cycle.ruleId)) {
      for (const occurrence of cycle.occurrences) {
        actions.push({ action: 'PRESERVE', occurrenceId: occurrence.id, reason: 'NOT_SELECTED' });
      }
      continue;
    }
    for (const occurrence of cycle.occurrences) {
      const key = identityKey(cycle.ruleId, cycle.periodKey, occurrence.milestoneKey, occurrence.scheduleEntryKey);
      const match = projectedByIdentity.get(key);
      if (match) matchedIdentityKeys.add(key);
      const repairable = isRepairable(occurrence);
      if (!match) {
        if (repairable) {
          actions.push({
            action: 'CANCEL',
            occurrenceId: occurrence.id,
            oldDate: occurrence.operativeDueDate,
            reason: 'Deadline projection repair',
          });
        } else {
          actions.push({ action: 'PRESERVE', occurrenceId: occurrence.id, reason: preserveReason(occurrence) });
        }
        continue;
      }
      if (!repairable) {
        actions.push({ action: 'PRESERVE', occurrenceId: occurrence.id, reason: preserveReason(occurrence) });
        continue;
      }
      if (
        occurrence.calculatedDueDate !== match.calculatedDueDate
        || occurrence.operativeDueDate !== match.calculatedDueDate
        || occurrence.ruleVersionId !== match.ruleVersionId
      ) {
        recalculateRuleVersionIds[occurrence.id] = match.ruleVersionId;
        actions.push({
          action: 'RECALCULATE',
          occurrenceId: occurrence.id,
          oldDate: occurrence.operativeDueDate,
          newDate: match.calculatedDueDate,
        });
      }
    }
  }

  for (const [key, projected] of projectedByIdentity) {
    if (matchedIdentityKeys.has(key)) continue;
    actions.push({
      action: 'CREATE',
      identity: {
        ruleId: projected.ruleId,
        ruleVersionId: projected.ruleVersionId,
        periodKey: projected.periodKey,
        milestoneKey: projected.milestoneKey,
        scheduleEntryKey: projected.scheduleEntryKey,
      },
      newDate: projected.calculatedDueDate,
    });
    const bounds = input.periodBounds?.find(
      (period) => period.ruleId === projected.ruleId && period.periodKey === projected.periodKey,
    );
    createPeriodBounds[key] = bounds
      ? { start: bounds.start, end: bounds.end }
      : { start: projected.calculatedDueDate, end: projected.calculatedDueDate };
  }

  actions.sort(compareRemediationActions);
  return { actions, recalculateRuleVersionIds, createPeriodBounds };
}

function compareRemediationActions(left: DeadlineOccurrenceRemediationAction, right: DeadlineOccurrenceRemediationAction): number {
  const leftKey = 'occurrenceId' in left
    ? left.occurrenceId
    : `${left.identity.ruleId}|${left.identity.periodKey}|${left.identity.milestoneKey}|${left.identity.scheduleEntryKey}`;
  const rightKey = 'occurrenceId' in right
    ? right.occurrenceId
    : `${right.identity.ruleId}|${right.identity.periodKey}|${right.identity.milestoneKey}|${right.identity.scheduleEntryKey}`;
  return leftKey.localeCompare(rightKey);
}

export function emptyRemediationCounts(): DeadlineOccurrenceRemediationCounts {
  return { CREATE: 0, RECALCULATE: 0, CANCEL: 0, PRESERVE: 0 };
}

export function aggregateRemediationCounts(
  actions: DeadlineOccurrenceRemediationAction[],
): DeadlineOccurrenceRemediationCounts {
  const counts = emptyRemediationCounts();
  for (const action of actions) counts[action.action] += 1;
  return counts;
}

function validateRemediationInput(input: DeadlineOccurrenceRemediationInput): void {
  if (typeof input.tenantId !== 'string' || input.tenantId.trim().length === 0) {
    throw new ValidationError('Remediation requires a tenant ID');
  }
  if (!Array.isArray(input.clientServiceIds) || input.clientServiceIds.length === 0) {
    throw new ValidationError('Remediation requires at least one client-service ID');
  }
  const normalized = input.clientServiceIds.map((id) => id.trim());
  if (normalized.some((id) => id.length === 0)) {
    throw new ValidationError('Client-service IDs must not be blank');
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new ValidationError('Client-service IDs must be unique');
  }
  if (normalized.length > MAX_SELECTED_SERVICES) {
    throw new ValidationError(`Remediation supports at most ${MAX_SELECTED_SERVICES} client services per invocation`);
  }
  parseDateOnly(input.today);
  parseDateOnly(input.horizonEnd);
  if (compareDateOnly(input.today, input.horizonEnd) > 0) {
    throw new ValidationError('Remediation horizon must not precede today');
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length < MIN_REASON_LENGTH) {
    throw new ValidationError(`Remediation reason must be at least ${MIN_REASON_LENGTH} characters`);
  }
}

type RemediationProjection = {
  projection: DeadlineRuleProjection;
  ruleId: string;
};

async function collectServiceRemediationClassification(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  clientServiceId: string,
  today: DateOnly,
  horizonEnd: DateOnly,
): Promise<{ classification: ServiceRemediationClassification; serviceName: string | null; companyId: string }> {
  const clientService = await db.clientService.findFirst({
    where: { id: clientServiceId, tenantId },
    include: {
      company: true,
      deadlineRules: {
        include: {
          rule: {
            include: {
              currentVersion: {
                include: {
                  parameterDefinitions: true,
                  milestoneTemplates: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!clientService) {
    throw new NotFoundError('Client service not found');
  }

  const activeCalendarRecord = await db.businessCalendar.findFirst({
    where: { tenantId, isActive: true, archivedAt: null },
    include: {
      holidays: { where: { tenantId, isActive: true }, orderBy: [{ date: 'asc' }, { id: 'asc' }] },
    },
  });
  const businessCalendar: BusinessCalendarSnapshot = activeCalendarRecord
    ? {
        id: activeCalendarRecord.id,
        timeZone: activeCalendarRecord.timeZone,
        revision: activeCalendarRecord.revision,
        weekendDays: new Set(activeCalendarRecord.weekendDays),
        holidays: new Set(
          activeCalendarRecord.holidays
            .map((h) => safeDateOnly(h.date))
            .filter((d): d is DateOnly => d !== null),
        ),
      }
    : defaultCalendar();

  const companySource = normalizeCompanyRuleSource(clientService.company, today);
  const projections: RemediationProjection[] = [];
  const projectedRuleIds = new Set<string>();

  for (const clientRule of clientService.deadlineRules) {
    const rule = clientRule.rule;
    if (!rule || rule.isActive === false || rule.archivedAt) continue;
    if (!clientRule.enabled) continue;
    const version = rule.currentVersion;
    if (!version) continue;
    if (!rule.code) continue;

    const milestonesInput: DeadlineRuleProjectionInput['milestones'] = (
      version.milestoneTemplates ?? []
    ).map((m, index) => ({
      key: m.milestoneKey,
      name: m.name,
      description: m.description,
      type: m.type as 'STATUTORY' | 'CLIENT' | 'INTERNAL',
      generationMode: m.generationMode as 'ONCE_PER_CYCLE' | 'ONCE_PER_SCHEDULE_ENTRY',
      expression: m.dateExpression as never,
      businessDayAdjustment: m.businessDayAdjustment as 'NONE' | 'PREVIOUS' | 'NEXT',
      displayOrder: m.displayOrder ?? index,
      isActive: m.isActive !== false,
    }));

    const projection = projectDeadlineRule({
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleVersionId: version.id,
      recurrence: version.recurrence as never,
      applicability: version.applicability as never,
      parameters: asRecord(clientRule.parameterValues),
      scheduleEntries: Array.isArray(clientRule.scheduleEntries) ? (clientRule.scheduleEntries as never) : [],
      milestones: milestonesInput,
      company: companySource,
      periodFacts: companyPeriodFacts(clientService.company),
      calendar: businessCalendar,
      today,
      horizonEnd,
    });
    if (projection.applicability.state !== 'APPLICABLE') continue;
    projectedRuleIds.add(rule.id);
    projections.push({ projection, ruleId: rule.id });
  }

  const existingCycles = await db.serviceCycle.findMany({
    where: { tenantId, clientServiceId },
    include: { occurrences: true },
  });

  const cycles: StoredCycleForRemediation[] = existingCycles.map((cycle) => ({
    id: cycle.id,
    ruleId: cycle.ruleId,
    periodKey: cycle.periodKey,
    occurrences: (cycle.occurrences ?? []).map((occ) => toStoredDeadline(occ)),
  }));

  const classification = classifyRemediationActions({
    projected: projections.flatMap(({ projection }) => projection.occurrences),
    projectedRuleIds,
    cycles,
    periodBounds: projections.flatMap(({ projection, ruleId }) => projection.periods.map((period) => ({
      ruleId,
      periodKey: period.periodKey,
      start: period.start,
      end: period.end,
    }))),
  });

  return {
    classification,
    serviceName: clientService.serviceName,
    companyId: clientService.companyId,
  };
}

type ServiceRemediationPreview = {
  clientServiceId: string;
  actions: DeadlineOccurrenceRemediationAction[];
  counts: DeadlineOccurrenceRemediationCounts;
  recalculateRuleVersionIds: Record<string, string>;
  createPeriodBounds: Record<string, { start: DateOnly; end: DateOnly }>;
  fingerprint: string;
  serviceName: string | null;
  companyId: string;
};

async function collectServiceRemediationPreview(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  clientServiceId: string,
  today: DateOnly,
  horizonEnd: DateOnly,
): Promise<ServiceRemediationPreview> {
  const { classification, serviceName, companyId } = await collectServiceRemediationClassification(
    db, tenantId, clientServiceId, today, horizonEnd,
  );
  const counts = aggregateRemediationCounts(classification.actions);
  const fingerprint = hashConfiguration({
    tenantId,
    clientServiceId,
    today,
    horizonEnd,
    actions: classification.actions,
  });
  return {
    clientServiceId,
    actions: classification.actions,
    counts,
    recalculateRuleVersionIds: classification.recalculateRuleVersionIds,
    createPeriodBounds: classification.createPeriodBounds,
    fingerprint,
    serviceName,
    companyId,
  };
}

/**
 * Dry-run remediation classification. This performs no writes and returns a
 * deterministic fingerprint over every proposed action.
 */
export async function previewDeadlineOccurrenceRemediation(
  input: DeadlineOccurrenceRemediationInput,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<DeadlineOccurrenceRemediationPreview> {
  validateRemediationInput(input);
  const sortedIds = [...input.clientServiceIds].sort();
  const perService: ServiceRemediationPreview[] = [];
  for (const clientServiceId of sortedIds) {
    perService.push(await collectServiceRemediationPreview(db, input.tenantId, clientServiceId, input.today, input.horizonEnd));
  }
  const actions = perService
    .flatMap((service) => service.actions)
    .sort(compareRemediationActions);
  return {
    tenantId: input.tenantId,
    clientServiceIds: sortedIds,
    today: input.today,
    horizonEnd: input.horizonEnd,
    fingerprint: hashConfiguration({
      tenantId: input.tenantId,
      clientServiceIds: sortedIds,
      today: input.today,
      horizonEnd: input.horizonEnd,
      actions,
    }),
    counts: aggregateRemediationCounts(actions),
    actions,
  };
}

async function persistRepairedOccurrence(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  clientServiceId: string,
  cycleId: string,
  data: Record<string, unknown>,
): Promise<{ inserted: boolean }> {
  const identity = {
    tenantId,
    cycleId,
    milestoneKey: String(data.milestoneKey),
    scheduleEntryKey: String(data.scheduleEntryKey ?? ''),
  };
  if (
    typeof db.deadlineOccurrence.createMany === 'function'
    && typeof db.deadlineOccurrence.findUnique === 'function'
  ) {
    const created = await db.deadlineOccurrence.createMany({
      data: [data as never],
      skipDuplicates: true,
    });
    const occurrence = await db.deadlineOccurrence.findUnique({
      where: { tenantId_cycleId_milestoneKey_scheduleEntryKey: identity },
    });
    if (!occurrence) {
      throw new Error('Stable deadline occurrence insert was not readable after persistence');
    }
    return { inserted: created.count === 1 };
  }
  if (typeof db.deadlineOccurrence.upsert === 'function') {
    await db.deadlineOccurrence.upsert({
      where: { tenantId_cycleId_milestoneKey_scheduleEntryKey: identity },
      create: data as never,
      update: {},
    });
    return { inserted: true };
  }
  await db.deadlineOccurrence.create({ data: data as never });
  return { inserted: true };
}

async function applyServiceRemediation(
  db: Prisma.TransactionClient | typeof prisma,
  input: DeadlineOccurrenceRemediationApplyInput,
  clientServiceId: string,
  expectedActions: string,
): Promise<DeadlineOccurrenceRemediationApplyResult['results'][number]> {
  const run = async (tx: Prisma.TransactionClient | typeof prisma): Promise<DeadlineOccurrenceRemediationApplyResult['results'][number]> => {
    const servicePreview = await collectServiceRemediationPreview(tx, input.tenantId, clientServiceId, input.today, input.horizonEnd);
    if (JSON.stringify(servicePreview.actions) !== expectedActions) {
      throw new DeadlineApiError(
        ErrorCodes.IMPACT_CHANGED,
        'The deadline remediation preview changed. Re-run the dry run and apply with the new fingerprint.',
        409,
        { clientServiceId },
      );
    }

    const mutating = servicePreview.actions.filter((action) => action.action !== 'PRESERVE');
    for (const action of mutating) {
      if (action.action === 'RECALCULATE') {
        await (tx.deadlineOccurrence.updateMany({
          where: { id: action.occurrenceId, tenantId: input.tenantId, clientServiceId },
          data: {
            calculatedDueDate: new Date(`${action.newDate}T00:00:00.000Z`),
            operativeDueDate: new Date(`${action.newDate}T00:00:00.000Z`),
            ruleVersionId: servicePreview.recalculateRuleVersionIds[action.occurrenceId],
            updatedAt: new Date(),
          },
        }) as Promise<unknown>);
      } else if (action.action === 'CANCEL') {
        await (tx.deadlineOccurrence.updateMany({
          where: { id: action.occurrenceId, tenantId: input.tenantId, clientServiceId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledById: null,
            cancellationReason: `Deadline projection repair: ${input.reason}`,
          },
        }) as Promise<unknown>);
      } else {
        const cycleId = randomUUID();
        const bounds = servicePreview.createPeriodBounds[identityKey(
          action.identity.ruleId,
          action.identity.periodKey,
          action.identity.milestoneKey,
          action.identity.scheduleEntryKey,
        )] ?? { start: action.newDate, end: action.newDate };
        const cycle = await tx.serviceCycle.upsert({
          where: {
            tenantId_clientServiceId_ruleId_periodKey_generationKey_origin: {
              tenantId: input.tenantId,
              clientServiceId,
              ruleId: action.identity.ruleId,
              periodKey: action.identity.periodKey,
              generationKey: ROLLING_PLAN_VERSION,
              origin: 'RULE',
            },
          },
          create: {
            id: cycleId,
            tenantId: input.tenantId,
            companyId: servicePreview.companyId,
            clientServiceId,
            ruleId: action.identity.ruleId,
            ruleVersionId: action.identity.ruleVersionId,
            periodKey: action.identity.periodKey,
            periodStart: new Date(`${bounds.start}T00:00:00.000Z`),
            periodEnd: new Date(`${bounds.end}T00:00:00.000Z`),
            generationKey: ROLLING_PLAN_VERSION,
            origin: 'RULE',
            evaluationHash: hashConfiguration({ remediation: 'v1', ...action.identity }),
            recurrenceAnchor: { periodKey: action.identity.periodKey },
          },
          update: {},
        });
        await persistRepairedOccurrence(tx, input.tenantId, clientServiceId, cycle.id, {
          tenantId: input.tenantId,
          companyId: servicePreview.companyId,
          clientServiceId,
          cycleId: cycle.id,
          ruleVersionId: action.identity.ruleVersionId,
          milestoneKey: action.identity.milestoneKey,
          scheduleEntryKey: action.identity.scheduleEntryKey,
          deadlineType: 'STATUTORY',
          calculatedDueDate: new Date(`${action.newDate}T00:00:00.000Z`),
          operativeDueDate: new Date(`${action.newDate}T00:00:00.000Z`),
          dateOverridden: false,
          status: 'OPEN',
          origin: 'RULE',
        });
      }
    }

    await createAuditLog({
      tenantId: input.tenantId,
      userId: input.actorId,
      companyId: servicePreview.companyId,
      entityType: 'ClientService',
      entityId: clientServiceId,
      entityName: servicePreview.serviceName ?? undefined,
      action: 'UPDATE',
      reason: input.reason,
      summary: 'Deadline occurrence repair applied',
      metadata: {
        correlationId: `deadline-repair-${clientServiceId}-${Date.now()}`,
        today: input.today,
        horizonEnd: input.horizonEnd,
        counts: servicePreview.counts,
        actions: servicePreview.actions,
      },
    }, tx);

    return {
      clientServiceId,
      fingerprint: servicePreview.fingerprint,
      counts: servicePreview.counts,
    };
  };

  const transactional = db as typeof prisma;
  if (typeof transactional.$transaction === 'function') {
    return transactional.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  return run(db as Prisma.TransactionClient);
}

/**
 * Apply a previously dry-run remediation. The global fingerprint must match
 * before any write, each service re-verifies inside its own serializable
 * transaction, and every service is audited independently.
 */
export async function applyDeadlineOccurrenceRemediation(
  input: DeadlineOccurrenceRemediationApplyInput,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<DeadlineOccurrenceRemediationApplyResult> {
  validateRemediationInput(input);
  if (typeof input.expectedFingerprint !== 'string' || input.expectedFingerprint.length === 0) {
    throw new ValidationError('Applying remediation requires the dry-run fingerprint');
  }
  if (typeof input.actorId !== 'string' || input.actorId.trim().length === 0) {
    throw new ValidationError('Applying remediation requires an actor ID');
  }

  const preview = await previewDeadlineOccurrenceRemediation(input, db);
  if (preview.fingerprint !== input.expectedFingerprint) {
    throw new DeadlineApiError(
      ErrorCodes.IMPACT_CHANGED,
      'The deadline remediation preview changed. Re-run the dry run and apply with the new fingerprint.',
      409,
      { fingerprint: preview.fingerprint },
    );
  }

  const perServiceActions = new Map<string, string>();
  const sortedIds = [...input.clientServiceIds].sort();
  for (const clientServiceId of sortedIds) {
    const servicePreview = await collectServiceRemediationPreview(db, input.tenantId, clientServiceId, input.today, input.horizonEnd);
    perServiceActions.set(clientServiceId, JSON.stringify(servicePreview.actions));
  }

  const results: DeadlineOccurrenceRemediationApplyResult['results'] = [];
  for (const clientServiceId of sortedIds) {
    results.push(await applyServiceRemediation(
      db,
      input,
      clientServiceId,
      perServiceActions.get(clientServiceId) ?? '[]',
    ));
  }

  return {
    tenantId: input.tenantId,
    fingerprint: preview.fingerprint,
    results,
  };
}
