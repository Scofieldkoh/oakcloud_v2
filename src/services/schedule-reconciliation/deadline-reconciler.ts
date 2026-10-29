import { compareDateOnly, parseDateOnly } from '@/services/service-schedule/date-only';
import type { DeadlineRuleEvaluationInput } from '@/services/service-schedule/evaluator';
import { hashConfiguration } from '@/services/service-schedule/hash';
import type {
  BusinessCalendarSnapshot,
  DateOnly,
} from '@/services/service-schedule';
import { companyPeriodFacts, normalizeCompanyRuleSource } from '@/services/service-schedule';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma';
import { OBLIGATION_CATALOG } from '@/services/compliance-monitoring/catalog';
import { ROLLING_PLAN_VERSION } from './planner';
import { projectDeadlineRule } from './projection';
import type {
  ClassifyDeadlineChangeResult,
  DeadlineReconciliationCounts,
  DeadlineReconciliationPreservedCounts,
  DeadlineReconciliationResult,
  DeadlineRuleProjectionInput,
  EvaluatedDeadlineForDiff,
  PreserveReason,
  ProjectedDeadline,
  ReconcileClientServiceDeadlinesInput,
  StoredDeadline,
  DeadlineReconciliationWarning,
} from './types';

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

function cycleSourceSnapshot(evaluation: {
  sourceSnapshot: Record<string, unknown>;
  occurrences: Array<{ milestoneKey: string; scheduleEntryKey: string; explanation: string[] }>;
}): Record<string, unknown> {
  return {
    ...evaluation.sourceSnapshot,
    explanations: Object.fromEntries(
      evaluation.occurrences.map((occurrence) => [
        `${occurrence.milestoneKey}|${occurrence.scheduleEntryKey}`,
        occurrence.explanation,
      ]),
    ),
  };
}
async function updateOccurrence(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  clientServiceId: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  // updateMany keeps the tenant and client-service predicates in the SQL
  // write. The fallback only supports lightweight unit-test doubles.
  if (typeof db.deadlineOccurrence.updateMany === 'function') {
    await db.deadlineOccurrence.updateMany({
      where: { id, tenantId, clientServiceId },
      data: data as never,
    });
  } else {
    await db.deadlineOccurrence.update({ where: { id }, data: data as never });
  }
}

type PersistedOccurrence = {
  occurrence: { id: string; [key: string]: unknown };
  inserted: boolean;
};

async function persistOccurrence(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  cycleId: string,
  data: Record<string, unknown>,
): Promise<PersistedOccurrence> {
  const identity = {
    tenantId,
    cycleId,
    milestoneKey: String(data.milestoneKey),
    scheduleEntryKey: String(data.scheduleEntryKey ?? ''),
  };

  // createMany(skipDuplicates) is an INSERT ... ON CONFLICT DO NOTHING on
  // PostgreSQL. Its count tells us whether this transaction won the stable
  // identity race; the follow-up read supplies the row for subsequent diffing.
  if (
    typeof db.deadlineOccurrence.createMany === 'function'
    && typeof db.deadlineOccurrence.findUnique === 'function'
  ) {
    const created = await db.deadlineOccurrence.createMany({
      data: data as never,
      skipDuplicates: true,
    });
    const occurrence = await db.deadlineOccurrence.findUnique({
      where: { tenantId_cycleId_milestoneKey_scheduleEntryKey: identity },
    });
    if (!occurrence) {
      throw new Error('Stable deadline occurrence insert was not readable after persistence');
    }
    return {
      occurrence: occurrence as { id: string; [key: string]: unknown },
      inserted: created.count === 1,
    };
  }

  if (typeof db.deadlineOccurrence.upsert === 'function') {
    const occurrence = await db.deadlineOccurrence.upsert({
      where: {
        tenantId_cycleId_milestoneKey_scheduleEntryKey: identity,
      },
      create: data as never,
      update: {},
    });
    return {
      occurrence: occurrence as { id: string; [key: string]: unknown },
      inserted: true,
    };
  }

  const occurrence = await db.deadlineOccurrence.create({ data: data as never });
  return {
    occurrence: occurrence as { id: string; [key: string]: unknown },
    inserted: true,
  };
}

async function updateClientRule(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  clientServiceId: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (typeof db.clientServiceDeadlineRule.updateMany === 'function') {
    await db.clientServiceDeadlineRule.updateMany({
      where: { id, tenantId, clientServiceId },
      data: data as never,
    });
  } else {
    await db.clientServiceDeadlineRule.update({ where: { id }, data: data as never });
  }
}

async function updateCycleSnapshot(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  clientServiceId: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (typeof db.serviceCycle.updateMany === 'function') {
    await db.serviceCycle.updateMany({
      where: { id, tenantId, clientServiceId },
      data: data as never,
    });
  } else {
    await db.serviceCycle.update({ where: { id }, data: data as never });
  }
}

/**
 * The cycle's recurrence anchor. Period-based rules also record their explicit
 * financial period and YA so impact previews can re-evaluate the same period.
 */
export function recurrenceAnchorFor(
  periodKey: string,
  obligationPeriod: ProjectedDeadline['obligationPeriod'],
): Prisma.InputJsonValue {
  if (!obligationPeriod) return { periodKey };
  return {
    periodKey,
    obligationPeriod: {
      basis: obligationPeriod.basis,
      start: obligationPeriod.start,
      end: obligationPeriod.end,
      yearOfAssessment: obligationPeriod.yearOfAssessment,
    },
  };
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

const STATUTORY_PRESET_RULE_CODES = OBLIGATION_CATALOG
  .map((definition) => definition.ruleCode)
  .filter((code): code is string => code !== null);

/** Statutory rule codes the company obligation writer owns for a monitored company. */
async function companyOwnedStatutoryRuleCodes(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  companyId: string,
): Promise<Set<string>> {
  const [coverages, scopes] = await Promise.all([
    db.companyMonitoringCoverage.count({ where: { tenantId, companyId } }),
    db.clientServiceObligationScope.count({ where: { tenantId, companyId } }),
  ]);
  return coverages + scopes > 0 ? new Set(STATUTORY_PRESET_RULE_CODES) : new Set();
}

/** The tenant's active business calendar, or the default Singapore weekend calendar. */
export async function loadActiveBusinessCalendar(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
): Promise<{ record: { id: string; revision: number } | null; snapshot: BusinessCalendarSnapshot }> {
  const record = await db.businessCalendar.findFirst({
    where: { tenantId, isActive: true, archivedAt: null },
    include: {
      holidays: {
        where: { tenantId, isActive: true },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      },
    },
  });
  if (!record) return { record: null, snapshot: defaultCalendar() };
  return {
    record,
    snapshot: {
      id: record.id,
      timeZone: record.timeZone,
      revision: record.revision,
      weekendDays: new Set(record.weekendDays),
      holidays: new Set(
        record.holidays
          .map((h) => safeDateOnly(h.date))
          .filter((d): d is DateOnly => d !== null),
      ),
    },
  };
}

function missingInputWarning(
  ruleId: string,
  ruleVersionId: string,
  message: string,
  missingFields: string[],
): DeadlineReconciliationWarning {
  return {
    code: 'MISSING_INPUT',
    message,
    ruleId,
    ruleVersionId,
    missingFields,
    permanent: true,
  };
}

export function classifyDeadlineChange(
  existing: StoredDeadline | null,
  proposed: EvaluatedDeadlineForDiff,
  today: DateOnly,
): ClassifyDeadlineChangeResult {
  if (!existing) {
    return { action: 'CREATE' };
  }

  if (existing.origin !== 'RULE') {
    return { action: 'PRESERVE', reason: 'MANUAL_TRIGGER' };
  }

  if (compareDateOnly(existing.operativeDueDate, today) < 0) {
    return { action: 'PRESERVE', reason: 'HISTORICAL' };
  }

  if (existing.status === 'COMPLETED') {
    return { action: 'PRESERVE', reason: 'COMPLETED' };
  }

  if (existing.status === 'WAIVED') {
    return { action: 'PRESERVE', reason: 'WAIVED' };
  }

  if (existing.status === 'CANCELLED') {
    return { action: 'PRESERVE', reason: 'CANCELLED' };
  }

  if (existing.dateOverridden) {
    return { action: 'PRESERVE', reason: 'OVERRIDDEN' };
  }

  if (
    existing.calculatedDueDate !== proposed.dueDate ||
    existing.operativeDueDate !== proposed.dueDate ||
    existing.ruleVersionId !== proposed.ruleVersionId
  ) {
    return { action: 'RECALCULATE' };
  }

  return { action: 'NO_CHANGE' };
}

function classifyExistingPreserveReason(existing: StoredDeadline, today: DateOnly): PreserveReason {
  if (existing.origin !== 'RULE') return 'MANUAL_TRIGGER';
  if (compareDateOnly(existing.operativeDueDate, today) < 0) return 'HISTORICAL';
  if (existing.status === 'COMPLETED') return 'COMPLETED';
  if (existing.status === 'WAIVED') return 'WAIVED';
  if (existing.status === 'CANCELLED') return 'CANCELLED';
  if (existing.dateOverridden) return 'OVERRIDDEN';
  return 'HISTORICAL';
}

function toStoredDeadline(occurrence: {
  id: string;
  cycleId: string;
  milestoneKey: string;
  scheduleEntryKey: string;
  deadlineType: string;
  calculatedDueDate: Date | string;
  operativeDueDate: Date | string;
  dateOverridden: boolean;
  status: string;
  origin: string;
  ruleVersionId: string;
}): StoredDeadline {
  return {
    id: occurrence.id,
    cycleId: occurrence.cycleId,
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

export async function reconcileClientServiceDeadlines(
  input: ReconcileClientServiceDeadlinesInput,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<DeadlineReconciliationResult> {
  const { tenantId, clientServiceId, today, horizonEnd, writeMode, reconciliationRequestId } = input;
  const operation = input.operation ?? 'PUBLISH';
  parseDateOnly(today);
  parseDateOnly(horizonEnd);

  const counts: DeadlineReconciliationCounts = {
    created: 0,
    recalculated: 0,
    cancelled: 0,
    preserved: 0,
    noChange: 0,
  };

  const preservedByReason: DeadlineReconciliationPreservedCounts = {
    MANUAL_TRIGGER: 0,
    HISTORICAL: 0,
    COMPLETED: 0,
    WAIVED: 0,
    CANCELLED: 0,
    OVERRIDDEN: 0,
  };

  const warnings: DeadlineReconciliationWarning[] = [];
  const skipCleanupRuleIds = new Set<string>();
  const skipCleanupCycleIds = new Set<string>();

  await input.assertLease?.();

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
    warnings.push({ code: 'CLIENT_SERVICE_NOT_FOUND', message: `Client service ${clientServiceId} not found`, permanent: true });
    return {
      tenantId,
      clientServiceId,
      reconciliationRequestId,
      writeMode,
      counts,
      preservedByReason,
      warnings,
    };
  }

  // Load existing cycles and occurrences for this client service
  const existingCycles = await db.serviceCycle.findMany({
    where: { tenantId, clientServiceId },
    include: {
      occurrences: true,
    },
  });

  const processedOccurrenceIds = new Set<string>();

  const serviceEndDate = safeDateOnly(clientService.endDate);
  const isClientServiceInactive =
    clientService.deletedAt !== null
    || clientService.status === 'ENDED'
    || (serviceEndDate !== null && compareDateOnly(serviceEndDate, today) < 0);

  if (isClientServiceInactive) {
    for (const cycle of existingCycles) {
      await input.assertLease?.();
      for (const occ of cycle.occurrences) {
        processedOccurrenceIds.add(occ.id);
        const stored = toStoredDeadline(occ);
        const isOpenFutureRule =
          stored.status === 'OPEN' &&
          stored.origin === 'RULE' &&
          !stored.dateOverridden &&
          compareDateOnly(stored.operativeDueDate, today) >= 0;

        if (isOpenFutureRule) {
          counts.cancelled += 1;
          if (writeMode === 'APPLY') {
            await updateOccurrence(db, tenantId, clientServiceId, occ.id, {
              status: 'CANCELLED',
              cancelledAt: new Date(),
              cancelledById: null,
              cancellationReason: 'Client service archived or deleted',
            });
          }
        } else {
          counts.preserved += 1;
          const reason = classifyExistingPreserveReason(stored, today);
          preservedByReason[reason] += 1;
        }
      }
    }

    return {
      tenantId,
      clientServiceId,
      reconciliationRequestId,
      writeMode,
      counts,
      preservedByReason,
      warnings,
    };
  }

  const { record: activeCalendarRecord, snapshot: businessCalendar } = await loadActiveBusinessCalendar(db, tenantId);
  const companyOwnedRuleCodes = input.companyMonitoringEnabled
    ? await companyOwnedStatutoryRuleCodes(db, tenantId, clientService.companyId)
    : new Set<string>();

  const companySource = normalizeCompanyRuleSource(clientService.company, today);

  // Group existing occurrences by cycleId
  const occurrencesByCycleId = new Map<string, typeof existingCycles[number]['occurrences']>();
  for (const cycle of existingCycles) {
    occurrencesByCycleId.set(cycle.id, cycle.occurrences);
  }

  // Find or map cycles by cycle identity: clientServiceId|ruleId|periodKey|generationKey|origin
  const cycleByKey = new Map<string, typeof existingCycles[number]>();
  for (const cycle of existingCycles) {
    const key = `${cycle.ruleId}|${cycle.periodKey}|${cycle.generationKey}|${cycle.origin}`;
    cycleByKey.set(key, cycle);
  }

  for (const clientRule of clientService.deadlineRules) {
    await input.assertLease?.();
    const rule = clientRule.rule;
    if (input.ruleId && rule.id !== input.ruleId) continue;

    const archiveMode = (!input.ruleId || rule.id === input.ruleId)
      && (operation === 'ARCHIVE' || rule.isActive === false || (rule.archivedAt !== null && rule.archivedAt !== undefined));
    if (archiveMode) {
      for (const cycle of existingCycles.filter((candidate) => candidate.ruleId === rule.id)) {
        for (const occ of cycle.occurrences) {
          processedOccurrenceIds.add(occ.id);
          const stored = toStoredDeadline(occ);
          const eligible = stored.status === 'OPEN'
            && stored.origin === 'RULE'
            && !stored.dateOverridden
            && compareDateOnly(stored.operativeDueDate, today) >= 0;
          if (eligible) {
            counts.cancelled += 1;
            if (writeMode === 'APPLY') {
              await updateOccurrence(db, tenantId, clientServiceId, occ.id, {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancelledById: null,
                cancellationReason: 'Rule archive cancels eligible future occurrences',
              });
            }
          } else {
            counts.preserved += 1;
            const reason = classifyExistingPreserveReason(stored, today);
            preservedByReason[reason] += 1;
          }
        }
      }
      continue;
    }
    if (rule.isActive === false || (rule.archivedAt !== null && rule.archivedAt !== undefined)) continue;
    if (companyOwnedRuleCodes.has(rule.code)) {
      // Existing service-owned rows stay untouched until a reviewed migration
      // links them to the company obligation.
      skipCleanupRuleIds.add(rule.id);
      warnings.push({
        code: 'COMPANY_MONITORING_OWNS_RULE',
        message: `Rule ${rule.code} is tracked as a company obligation for this company`,
        ruleId: rule.id,
        permanent: false,
      });
      continue;
    }
    if (!clientRule.enabled) {
      if (writeMode === 'APPLY') {
        await updateClientRule(db, tenantId, clientServiceId, clientRule.id, {
          applicabilityState: 'NOT_APPLICABLE',
          applicabilityReason: 'Rule disabled for client service',
        });
      }
      continue;
    }

    const version = rule.currentVersion;
    if (!version) {
      warnings.push({ code: 'RULE_VERSION_MISSING', message: `Rule ${rule.id} (${rule.name}) has no published version`, ruleId: rule.id, permanent: true });
      continue;
    }

    const milestonesInput: DeadlineRuleEvaluationInput['milestones'] = (
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

    const projectionInput: DeadlineRuleProjectionInput = {
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleVersionId: version.id,
      recurrence: version.recurrence as never,
      applicability: version.applicability as never,
      parameters: asRecord(clientRule.parameterValues),
      scheduleEntries: Array.isArray(clientRule.scheduleEntries)
        ? (clientRule.scheduleEntries as never)
        : [],
      milestones: milestonesInput,
      company: companySource,
      periodFacts: companyPeriodFacts(clientService.company),
      calendar: businessCalendar,
      today,
      horizonEnd,
    };
    const projection = projectDeadlineRule(projectionInput);

    if (
      projection.applicability.state === 'NOT_APPLICABLE' ||
      projection.applicability.state === 'MISSING_INPUT'
    ) {
      if (projection.applicability.state === 'MISSING_INPUT') {
        skipCleanupRuleIds.add(rule.id);
        warnings.push(missingInputWarning(
          rule.id,
          version.id,
          projection.applicability.reason,
          projection.applicability.missingFields ?? [],
        ));
      }
      if (writeMode === 'APPLY') {
        await updateClientRule(db, tenantId, clientServiceId, clientRule.id, {
          applicabilityState: projection.applicability.state,
          applicabilityReason: projection.applicability.reason,
          lastEvaluatedVersionId: version.id,
        });
      }
      continue;
    }

    if (writeMode === 'APPLY') {
      await updateClientRule(db, tenantId, clientServiceId, clientRule.id, {
        applicabilityState: 'APPLICABLE',
        applicabilityReason: null,
        lastEvaluatedVersionId: version.id,
        configHash: version.configHash,
      });
    }

    const periodEvaluationsByKey = new Map(
      projection.periodEvaluations.map((evaluation) => [evaluation.periodKey, evaluation]),
    );

    for (const period of projection.periods) {
      await input.assertLease?.();
      const proposedDeadlines = projection.occurrences.filter(
        (deadline) => deadline.periodKey === period.periodKey,
      );
      if (proposedDeadlines.length === 0) continue;

      const cycleKey = `${rule.id}|${period.periodKey}|${ROLLING_PLAN_VERSION}|RULE`;
      let cycle: typeof existingCycles[number] | undefined = cycleByKey.get(cycleKey);
      const periodEvaluation = periodEvaluationsByKey.get(period.periodKey);
      const sourceSnapshot = cycleSourceSnapshot({
        sourceSnapshot: periodEvaluation?.sourceSnapshot ?? {},
        occurrences: proposedDeadlines,
      });
      const evaluationHash = periodEvaluation?.evaluationHash ?? hashConfiguration(sourceSnapshot);

      if (!cycle && writeMode === 'APPLY') {
        await input.assertLease?.();
        cycle = await db.serviceCycle.upsert({
          where: {
            tenantId_clientServiceId_ruleId_periodKey_generationKey_origin: {
              tenantId,
              clientServiceId,
              ruleId: rule.id,
              periodKey: period.periodKey,
              generationKey: ROLLING_PLAN_VERSION,
              origin: 'RULE',
            },
          },
          create: {
            tenantId,
            companyId: clientService.companyId,
            clientServiceId,
            ruleId: rule.id,
            ruleVersionId: version.id,
            businessCalendarId: activeCalendarRecord?.id ?? null,
            businessCalendarRevision: activeCalendarRecord?.revision ?? null,
            periodKey: period.periodKey,
            periodStart: new Date(`${period.start}T00:00:00.000Z`),
            periodEnd: new Date(`${period.end}T00:00:00.000Z`),
            generationKey: ROLLING_PLAN_VERSION,
            origin: 'RULE',
            evaluationHash,
            recurrenceAnchor: recurrenceAnchorFor(period.periodKey, proposedDeadlines[0]?.obligationPeriod),
            sourceSnapshot: sourceSnapshot as Prisma.InputJsonValue,
          },
          update: {
            ruleVersionId: version.id,
            evaluationHash,
            businessCalendarRevision: activeCalendarRecord?.revision ?? null,
            sourceSnapshot: sourceSnapshot as Prisma.InputJsonValue,
          },
          include: { occurrences: true },
        }) as typeof existingCycles[number];
        cycleByKey.set(cycleKey, cycle);
        occurrencesByCycleId.set(cycle.id, cycle.occurrences ?? []);
      } else if (cycle && writeMode === 'APPLY') {
        await input.assertLease?.();
        await updateCycleSnapshot(db, tenantId, clientServiceId, cycle.id, {
          ruleVersionId: version.id,
          evaluationHash,
          sourceSnapshot,
          businessCalendarRevision: activeCalendarRecord?.revision ?? null,
        });
      }

      const existingOccurrences = cycle ? (occurrencesByCycleId.get(cycle.id) ?? []) : [];
      const occMap = new Map<string, typeof existingOccurrences[number]>();
      for (const occ of existingOccurrences) {
        occMap.set(`${occ.milestoneKey}|${occ.scheduleEntryKey}`, occ);
      }

      const activeEvaluatedOccKeys = new Set<string>();

      for (const proposedDeadline of proposedDeadlines) {
        const occKey = `${proposedDeadline.milestoneKey}|${proposedDeadline.scheduleEntryKey}`;
        activeEvaluatedOccKeys.add(occKey);

        const existingOcc = occMap.get(occKey);
        const stored = existingOcc ? toStoredDeadline(existingOcc) : null;
        if (existingOcc) {
          processedOccurrenceIds.add(existingOcc.id);
        }

        const proposedForDiff: EvaluatedDeadlineForDiff = {
          milestoneKey: proposedDeadline.milestoneKey,
          scheduleEntryKey: proposedDeadline.scheduleEntryKey,
          deadlineType: proposedDeadline.deadlineType,
          dueDate: proposedDeadline.calculatedDueDate,
          ruleVersionId: version.id,
          explanation: proposedDeadline.explanation,
        };

        const decision = classifyDeadlineChange(stored, proposedForDiff, today);

        switch (decision.action) {
          case 'CREATE': {
            if (writeMode === 'APPLY' && cycle) {
              await input.assertLease?.();
              const persisted = await persistOccurrence(db, tenantId, cycle.id, {
                  tenantId,
                  companyId: clientService.companyId,
                  clientServiceId,
                  cycleId: cycle.id,
                  ruleVersionId: version.id,
                  milestoneKey: proposedDeadline.milestoneKey,
                  scheduleEntryKey: proposedDeadline.scheduleEntryKey,
                  deadlineType: proposedDeadline.deadlineType,
                  calculatedDueDate: new Date(`${proposedDeadline.calculatedDueDate}T00:00:00.000Z`),
                  operativeDueDate: new Date(`${proposedDeadline.calculatedDueDate}T00:00:00.000Z`),
                  dateOverridden: false,
                  status: 'OPEN',
                  origin: 'RULE',
              });
              if (persisted.inserted) counts.created += 1;
              else counts.noChange += 1;
              const createdOcc = persisted.occurrence;
              occMap.set(occKey, createdOcc as typeof existingOccurrences[number]);
              processedOccurrenceIds.add(createdOcc.id);
            } else counts.created += 1;
            break;
          }
          case 'RECALCULATE': {
            counts.recalculated += 1;
            if (writeMode === 'APPLY' && existingOcc) {
              await input.assertLease?.();
              await updateOccurrence(db, tenantId, clientServiceId, existingOcc.id, {
                calculatedDueDate: new Date(`${proposedDeadline.calculatedDueDate}T00:00:00.000Z`),
                operativeDueDate: new Date(`${proposedDeadline.calculatedDueDate}T00:00:00.000Z`),
                ruleVersionId: version.id,
              });
            }
            break;
          }
          case 'PRESERVE': {
            counts.preserved += 1;
            preservedByReason[decision.reason] += 1;
            if (decision.reason === 'OVERRIDDEN' && writeMode === 'APPLY' && existingOcc) {
              await input.assertLease?.();
              await updateOccurrence(db, tenantId, clientServiceId, existingOcc.id, {
                calculatedDueDate: new Date(`${proposedDeadline.calculatedDueDate}T00:00:00.000Z`),
              });
            }
            break;
          }
          case 'NO_CHANGE': {
            counts.noChange += 1;
            break;
          }
        }
      }

      // Any remaining occurrences in this cycle that are not in evaluated deadlines
      await input.assertLease?.();
      for (const occ of existingOccurrences) {
        const occKey = `${occ.milestoneKey}|${occ.scheduleEntryKey}`;
        if (!activeEvaluatedOccKeys.has(occKey)) {
          processedOccurrenceIds.add(occ.id);
          const stored = toStoredDeadline(occ);
          const isOpenFutureRule =
            stored.status === 'OPEN' &&
            stored.origin === 'RULE' &&
            !stored.dateOverridden &&
            compareDateOnly(stored.operativeDueDate, today) >= 0;

          if (isOpenFutureRule) {
            counts.cancelled += 1;
            if (writeMode === 'APPLY') {
              await input.assertLease?.();
              await updateOccurrence(db, tenantId, clientServiceId, occ.id, {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancelledById: null,
                cancellationReason: 'Rule reconciliation changed',
              });
            }
          } else {
            counts.preserved += 1;
            const reason = classifyExistingPreserveReason(stored, today);
            preservedByReason[reason] += 1;
          }
        }
      }
    }
  }

  // Check any remaining unprocessed occurrences for this client service
  for (const cycle of existingCycles) {
    if (input.ruleId && cycle.ruleId !== input.ruleId) continue;
    if (skipCleanupRuleIds.has(cycle.ruleId) || skipCleanupCycleIds.has(cycle.id)) continue;
    await input.assertLease?.();
    for (const occ of cycle.occurrences) {
      if (!processedOccurrenceIds.has(occ.id)) {
        processedOccurrenceIds.add(occ.id);
        const stored = toStoredDeadline(occ);
        const isOpenFutureRule =
          stored.status === 'OPEN' &&
          stored.origin === 'RULE' &&
          !stored.dateOverridden &&
          compareDateOnly(stored.operativeDueDate, today) >= 0;

        if (isOpenFutureRule) {
          counts.cancelled += 1;
          if (writeMode === 'APPLY') {
            await input.assertLease?.();
            await updateOccurrence(db, tenantId, clientServiceId, occ.id, {
              status: 'CANCELLED',
              cancelledAt: new Date(),
              cancelledById: null,
              cancellationReason: 'Removed during reconciliation',
            });
          }
        } else {
          counts.preserved += 1;
          const reason = classifyExistingPreserveReason(stored, today);
          preservedByReason[reason] += 1;
        }
      }
    }
  }

  return {
    tenantId,
    clientServiceId,
    reconciliationRequestId,
    writeMode,
    counts,
    preservedByReason,
    warnings,
  };
}
