import { z } from 'zod';
import { createAuditLog } from '@/lib/audit';
import {
  DeadlineApiError,
  ErrorCodes,
  NotFoundError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import type { TenantAwareParams } from '@/lib/types';
import { evaluateDeadlineRule, type DeadlineRuleEvaluationInput } from '@/services/service-schedule/evaluator';
import {
  currentDateInSingapore,
  formatDateOnly,
  parseDateOnly,
  addMonthsClamped,
} from '@/services/service-schedule/date-only';
import { hashConfiguration } from '@/services/service-schedule/hash';
import type {
  BusinessCalendarSnapshot,
  DateOnly,
  EvaluatedDeadline,
} from '@/services/service-schedule';
import {
  companyPeriodFacts,
  normalizeCompanyRuleSource,
  obligationPeriodBasisForExpressions,
  obligationPeriodFromCycle,
  planFinancialPeriods,
  planObligationPeriods,
} from '@/services/service-schedule';
import { OBLIGATION_PERIOD_LOOKBACK_MONTHS } from '@/services/schedule-reconciliation/projection';
import { enqueueScheduleReconciliation } from '@/services/schedule-reconciliation';
import {
  planRollingPeriods,
  ROLLING_HORIZON_MONTHS,
  ROLLING_PLAN_VERSION,
} from '@/services/schedule-reconciliation/planner';
import type { DeadlineRuleDto } from './types';

const MAX_IMPACT_SAMPLES = 100;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

const identityFieldsSchema = z.object({
  operation: z.enum(['PUBLISH', 'ARCHIVE']),
  expectedCurrentVersion: z.number().int().min(0).nullable(),
  expectedDraftRevision: z.number().int().min(1),
  draftConfigHash: z.string().regex(HASH_PATTERN),
}).strict();

// Route schemas require a canonical SHA-256 preview fingerprint. Service
// apply paths intentionally accept any non-empty fingerprint so an old or
// malformed client value still reaches the fresh-impact comparison and is
// reported as IMPACT_CHANGED rather than hiding the useful 409 summary.
const servicePublishIdentitySchema = identityFieldsSchema.extend({
  operation: z.literal('PUBLISH'),
  previewFingerprint: z.string().trim().min(1),
}).strict();
const serviceArchiveInputSchema = identityFieldsSchema.extend({
  operation: z.literal('ARCHIVE'),
  previewFingerprint: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(1000),
}).strict();

export const deadlineRuleImpactPreviewSchema = identityFieldsSchema;
export const deadlineRulePublishSchema = identityFieldsSchema.extend({
  operation: z.literal('PUBLISH'),
  previewFingerprint: z.string().regex(HASH_PATTERN),
}).strict();
export const deadlineRuleArchiveSchema = identityFieldsSchema.extend({
  operation: z.literal('ARCHIVE'),
  previewFingerprint: z.string().regex(HASH_PATTERN),
  reason: z.string().trim().min(1).max(1000),
}).strict();

export type DeadlineRuleImpactInput = z.input<typeof deadlineRuleImpactPreviewSchema>;
export type DeadlineRulePublishInput = z.input<typeof deadlineRulePublishSchema>;
export type DeadlineRuleArchiveInput = z.input<typeof deadlineRuleArchiveSchema>;

export type DeadlineRuleImpactAction = 'CREATE' | 'RECALCULATE' | 'CANCEL' | 'PRESERVE' | 'WARN';
export type DeadlineRuleImpactOperation = 'PUBLISH' | 'ARCHIVE';

export type DeadlineRuleImpactSample = {
  clientServiceId: string;
  deadlineOccurrenceId: string | null;
  action: DeadlineRuleImpactAction;
  oldDate: DateOnly | null;
  newDate: DateOnly | null;
  reason: string;
};

export type DeadlineRuleImpactCounts = {
  created: number;
  recalculated: number;
  cancelled: number;
  preserved: number;
  inapplicable: number;
  missingInput: number;
  conflicts: number;
  warnings: number;
};

export type DeadlineRuleImpact = {
  ruleId: string;
  operation: DeadlineRuleImpactOperation;
  currentPublishedVersion: number | null;
  draftRevision: number;
  draftConfigHash: string;
  previewFingerprint: string;
  counts: DeadlineRuleImpactCounts;
  samples: DeadlineRuleImpactSample[];
  sourceState: {
    currentVersionId: string | null;
    draftId: string;
    draftState: string;
    isActive: boolean;
    archivedAt: string | null;
  };
};

export type DeadlineRuleImpactOptions = {
  /** Injectable Singapore civil date for deterministic tests and callers. */
  now?: () => DateOnly;
  /** Internal apply-only fallback for a concurrently consumed draft. */
  allowMissingDraft?: boolean;
  /** Injectable horizon end for deterministic planner tests. */
  horizonEnd?: DateOnly;
};

type QueryDelegate = {
  findFirst?: (args: unknown) => Promise<unknown>;
  findMany?: (args: unknown) => Promise<unknown>;
  update?: (args: unknown) => Promise<unknown>;
  updateMany?: (args: unknown) => Promise<unknown>;
};

type RawVersion = {
  id: string;
  ruleId?: string;
  version: number;
  state: string;
  schemaVersion?: number;
  recurrence?: unknown;
  applicability?: unknown;
  configHash: string;
  draftRevision: number;
  parameterDefinitions?: Array<Record<string, unknown>>;
  milestoneTemplates?: Array<Record<string, unknown>>;
};

type RawRule = {
  id: string;
  tenantId: string;
  code?: string;
  name?: string;
  description?: string | null;
  isActive?: boolean;
  archivedAt?: Date | null;
  archivedById?: string | null;
  archiveReason?: string | null;
  currentVersionId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  currentVersion?: RawVersion | null;
  draft?: RawVersion | null;
  versions?: RawVersion[];
  variantAssociations?: Array<Record<string, unknown>>;
};

type RawCycle = {
  id: string;
  tenantId: string;
  clientServiceId: string;
  ruleId: string;
  ruleVersionId?: string;
  companyId?: string;
  periodKey: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  origin?: string;
  businessCalendarId?: string | null;
  businessCalendarRevision?: number | null;
  planned?: boolean;
  generationKey?: string;
};

type RawOccurrence = {
  id: string;
  tenantId: string;
  companyId?: string;
  clientServiceId?: string;
  cycleId: string;
  ruleVersionId?: string;
  milestoneKey: string;
  scheduleEntryKey?: string;
  calculatedDueDate: Date | string;
  operativeDueDate: Date | string;
  dateOverridden?: boolean;
  status?: string;
  origin?: string;
  cycle?: RawCycle | null;
};

type RawContext = {
  tenantId: string;
  clientServiceId: string;
  ruleId: string;
  enabled?: boolean;
  parameterValues?: unknown;
  scheduleEntries?: unknown;
  clientService?: {
    tenantId: string;
    companyId: string;
    deletedAt?: Date | null;
    company?: Record<string, unknown> | null;
  } | null;
};

type ImpactDecision = DeadlineRuleImpactSample & {
  identity: string;
};

type DeadlineRuleApplyIdentity = DeadlineRuleImpactInput & {
  previewFingerprint: string;
};

type ImpactDb = unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delegate(db: ImpactDb, name: string): QueryDelegate | null {
  if (!isRecord(db)) return null;
  const value = db[name];
  if (!isRecord(value)) return null;
  const result: QueryDelegate = {};
  if (typeof value.findFirst === 'function') result.findFirst = value.findFirst.bind(value) as QueryDelegate['findFirst'];
  if (typeof value.findMany === 'function') result.findMany = value.findMany.bind(value) as QueryDelegate['findMany'];
  if (typeof value.update === 'function') result.update = value.update.bind(value) as QueryDelegate['update'];
  if (typeof value.updateMany === 'function') result.updateMany = value.updateMany.bind(value) as QueryDelegate['updateMany'];
  return result;
}

async function findFirst(db: ImpactDb, name: string, args: unknown): Promise<unknown> {
  const operation = delegate(db, name)?.findFirst;
  return operation ? operation(args) : null;
}

async function findMany(db: ImpactDb, name: string, args: unknown): Promise<unknown[]> {
  const operation = delegate(db, name)?.findMany;
  const result = operation ? await operation(args) : [];
  return Array.isArray(result) ? result : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asDateOnly(value: Date | string): DateOnly {
  if (typeof value === 'string') {
    parseDateOnly(value as DateOnly);
    return value as DateOnly;
  }
  return formatDateOnly(value);
}

function safeDateOnly(value: unknown): DateOnly | null {
  try {
    if (typeof value === 'string') return asDateOnly(value);
    if (value instanceof Date) return asDateOnly(value);
  } catch {
    return null;
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

async function loadCalendar(
  db: ImpactDb,
  tenantId: string,
  calendarId: string | null | undefined,
  cache: Map<string, BusinessCalendarSnapshot>,
): Promise<BusinessCalendarSnapshot> {
  const key = calendarId ?? 'active';
  const cached = cache.get(key);
  if (cached) return cached;
  const record = await findFirst(db, 'businessCalendar', {
    where: calendarId
      ? { id: calendarId, tenantId }
      : { tenantId, isActive: true, archivedAt: null },
    include: {
      holidays: {
        where: { tenantId, ...(calendarId ? { calendarId } : {}), isActive: true },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      },
    },
  });
  if (!isRecord(record)) {
    const fallback = defaultCalendar(calendarId ?? undefined);
    cache.set(key, fallback);
    return fallback;
  }
  const holidays = Array.isArray(record.holidays)
    ? record.holidays.map((holiday) => safeDateOnly(isRecord(holiday) ? holiday.date : undefined)).filter((value): value is DateOnly => value !== null)
    : [];
  const snapshot: BusinessCalendarSnapshot = {
    id: asString(record.id, calendarId ?? 'default'),
    timeZone: asString(record.timeZone, 'Asia/Singapore'),
    revision: typeof record.revision === 'number' ? record.revision : 1,
    weekendDays: new Set(Array.isArray(record.weekendDays) ? record.weekendDays.filter((day): day is number => typeof day === 'number') : [0, 6]),
    holidays: new Set(holidays),
  };
  cache.set(key, snapshot);
  return snapshot;
}

function versionFromRule(rule: RawRule, allowMissingDraft = false): { current: RawVersion | null; draft: RawVersion } {
  const versions = Array.isArray(rule.versions) ? rule.versions : [];
  const current = rule.currentVersion
    ?? versions.filter((version) => version.state === 'PUBLISHED').sort((left, right) => right.version - left.version)[0]
    ?? null;
  const draft = rule.draft
    ?? versions.find((version) => version.state === 'DRAFT');
  if (!draft && allowMissingDraft && current) return { current, draft: current };
  if (!draft) throw new ValidationError('Deadline rule has no mutable draft');
  return { current, draft };
}

function milestoneInput(version: RawVersion): DeadlineRuleEvaluationInput['milestones'] {
  return (version.milestoneTemplates ?? []).map((milestone, index) => ({
    key: asString(milestone.milestoneKey),
    name: asString(milestone.name),
    description: typeof milestone.description === 'string' ? milestone.description : null,
    type: asString(milestone.type, 'CLIENT') as 'STATUTORY' | 'CLIENT' | 'INTERNAL',
    generationMode: asString(milestone.generationMode, 'ONCE_PER_CYCLE') as 'ONCE_PER_CYCLE' | 'ONCE_PER_SCHEDULE_ENTRY',
    expression: milestone.dateExpression as never,
    businessDayAdjustment: asString(milestone.businessDayAdjustment, 'NONE') as 'NONE' | 'PREVIOUS' | 'NEXT',
    displayOrder: typeof milestone.displayOrder === 'number' ? milestone.displayOrder : index,
    isActive: milestone.isActive !== false,
  }));
}

async function evaluatorInputFor(
  rule: RawRule,
  version: RawVersion,
  cycle: RawCycle,
  context: RawContext,
  calendar: BusinessCalendarSnapshot,
  today: DateOnly,
): Promise<DeadlineRuleEvaluationInput | null> {
  if (!context.clientService || context.clientService.tenantId !== rule.tenantId) return null;
  const periodStart = safeDateOnly(cycle.periodStart);
  const periodEnd = safeDateOnly(cycle.periodEnd);
  if (!periodStart || !periodEnd) return null;
  return {
    ruleId: rule.id,
    ruleVersionId: version.id,
    recurrence: version.recurrence as DeadlineRuleEvaluationInput['recurrence'],
    applicability: version.applicability as DeadlineRuleEvaluationInput['applicability'],
    parameters: asRecord(context.parameterValues),
    scheduleEntries: Array.isArray(context.scheduleEntries) ? context.scheduleEntries as DeadlineRuleEvaluationInput['scheduleEntries'] : [],
    milestones: milestoneInput(version),
    company: normalizeCompanyRuleSource(context.clientService.company, today),
    period: { key: cycle.periodKey, start: periodStart, end: periodEnd },
    ...obligationPeriodInputFor(cycle.periodKey, periodStart, periodEnd),
    calendar,
  };
}

function obligationPeriodInputFor(
  periodKey: string,
  start: DateOnly,
  end: DateOnly,
): Pick<DeadlineRuleEvaluationInput, 'obligationPeriod'> {
  const obligationPeriod = obligationPeriodFromCycle(periodKey, start, end);
  return obligationPeriod ? { obligationPeriod } : {};
}

async function loadRuleScope(db: ImpactDb, ruleId: string, tenantId: string, allowMissingDraft = false): Promise<{
  rule: RawRule;
  current: RawVersion | null;
  draft: RawVersion;
  contexts: RawContext[];
  cycles: RawCycle[];
  occurrences: RawOccurrence[];
}> {
  const rawRule = await findFirst(db, 'deadlineRule', {
    where: { id: ruleId, tenantId },
    include: {
      currentVersion: { include: { parameterDefinitions: true, milestoneTemplates: true } },
      versions: { include: { parameterDefinitions: true, milestoneTemplates: true }, orderBy: { version: 'desc' } },
    },
  });
  if (!isRecord(rawRule) || asString(rawRule.id) !== ruleId || asString(rawRule.tenantId) !== tenantId) {
    throw new NotFoundError('Deadline rule not found');
  }
  const rule = rawRule as unknown as RawRule;
  const { current, draft } = versionFromRule(rule, allowMissingDraft);
  const [contexts, cycles, occurrences] = await Promise.all([
    findMany(db, 'clientServiceDeadlineRule', {
      where: {
        tenantId,
        ruleId,
        enabled: true,
        clientService: { tenantId, deletedAt: null },
      },
      include: {
        clientService: {
          include: {
            company: true,
          },
        },
      },
      orderBy: [{ clientServiceId: 'asc' }, { id: 'asc' }],
    }),
    findMany(db, 'serviceCycle', {
      where: { tenantId, ruleId },
      orderBy: [{ clientServiceId: 'asc' }, { periodStart: 'asc' }, { id: 'asc' }],
    }),
    findMany(db, 'deadlineOccurrence', {
      where: { tenantId, cycle: { tenantId, ruleId } },
      orderBy: [{ cycleId: 'asc' }, { milestoneKey: 'asc' }, { scheduleEntryKey: 'asc' }, { id: 'asc' }],
    }),
  ]);
  return {
    rule,
    current,
    draft,
    contexts: contexts as RawContext[],
    cycles: cycles as RawCycle[],
    occurrences: occurrences as RawOccurrence[],
  };
}

function occurrenceKey(clientServiceId: string, cycleId: string, milestoneKey: string, scheduleEntryKey: string): string {
  return `${clientServiceId}|${cycleId}|${milestoneKey}|${scheduleEntryKey}`;
}

function decisionIdentity(
  clientServiceId: string,
  cycleId: string,
  milestoneKey: string,
  scheduleEntryKey: string,
  deadlineOccurrenceId: string | null,
): string {
  return `${clientServiceId}|${cycleId}|${milestoneKey}|${scheduleEntryKey}|${deadlineOccurrenceId ?? ''}`;
}

function cycleIdentity(cycle: RawCycle): string {
  return cycle.planned
    ? `${cycle.clientServiceId}|${cycle.ruleId}|${cycle.periodKey}|${cycle.generationKey ?? ROLLING_PLAN_VERSION}`
    : cycle.id;
}

function evaluatorMap(result: unknown): Map<string, EvaluatedDeadline> {
  if (!isRecord(result)) return new Map();
  const byKey = result.byKey;
  const values: EvaluatedDeadline[] = [];
  if (isRecord(byKey)) {
    for (const value of Object.values(byKey)) {
      if (isRecord(value) && typeof value.milestoneKey === 'string' && typeof value.calculatedDueDate === 'string') {
        values.push(value as unknown as EvaluatedDeadline);
      }
    }
  }
  if (values.length === 0 && Array.isArray(result.occurrences)) {
    for (const value of result.occurrences) {
      if (isRecord(value) && typeof value.milestoneKey === 'string' && typeof value.calculatedDueDate === 'string') {
        values.push(value as unknown as EvaluatedDeadline);
      }
    }
  }
  return new Map(values.map((value) => [`${value.milestoneKey}:${value.scheduleEntryKey ?? ''}`, value]));
}

function evaluatorApplicability(result: unknown): { state: string; reason: string | null } {
  if (!isRecord(result) || !isRecord(result.applicability)) return { state: 'APPLICABLE', reason: null };
  return {
    state: asString(result.applicability.state, 'APPLICABLE'),
    reason: typeof result.applicability.reason === 'string' ? result.applicability.reason : null,
  };
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === 'string' ? error.code : null;
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to evaluate deadline rule';
}

function validateDateClock(options?: DeadlineRuleImpactOptions): DateOnly {
  const date = options?.now ? options.now() : currentDateInSingapore();
  parseDateOnly(date);
  return date;
}

function currentVersionNumber(version: RawVersion | null): number | null {
  return version && Number.isSafeInteger(version.version) && version.version > 0 ? version.version : null;
}

function counts(): DeadlineRuleImpactCounts {
  return {
    created: 0,
    recalculated: 0,
    cancelled: 0,
    preserved: 0,
    inapplicable: 0,
    missingInput: 0,
    conflicts: 0,
    warnings: 0,
  };
}

async function computeImpact(
  db: ImpactDb,
  ruleId: string,
  tenantId: string,
  operation: DeadlineRuleImpactOperation,
  options?: DeadlineRuleImpactOptions,
): Promise<{ impact: DeadlineRuleImpact; scope: Awaited<ReturnType<typeof loadRuleScope>> }> {
  const scope = await loadRuleScope(db, ruleId, tenantId, options?.allowMissingDraft === true);
  const today = validateDateClock(options);
  const horizonEnd = options?.horizonEnd ?? addMonthsClamped(today, ROLLING_HORIZON_MONTHS);
  const calendarCache = new Map<string, BusinessCalendarSnapshot>();
  const contextByClientService = new Map<string, RawContext>();
  for (const context of scope.contexts) {
    if (context.tenantId === tenantId && context.ruleId === ruleId) contextByClientService.set(context.clientServiceId, context);
  }

  const cyclesById = new Map<string, RawCycle>();
  for (const cycle of scope.cycles) {
    if (cycle.tenantId === tenantId && cycle.ruleId === ruleId) cyclesById.set(cycle.id, cycle);
  }
  for (const occurrence of scope.occurrences) {
    if (occurrence.tenantId !== tenantId) continue;
    const cycle = occurrence.cycle;
    if (cycle && !cyclesById.has(occurrence.cycleId)) cyclesById.set(occurrence.cycleId, cycle);
  }

  // Every enabled client-service/rule association participates in the
  // rolling scope, including first publication where no ServiceCycle exists.
  // Synthetic cycle IDs are deterministic and never written by preview; Task
  // 7 uses the same planner and generation identity when materializing them.
  const activeCalendar = await loadCalendar(db, tenantId, null, calendarCache);
  const existingCycleKeys = new Set(
    [...cyclesById.values()]
      .filter((cycle) => cycle.origin === undefined || cycle.origin === 'RULE')
      .map((cycle) => `${cycle.clientServiceId}|${cycle.periodKey}`),
  );
  const draftMilestones = milestoneInput(scope.draft);
  const draftPeriodBasis = obligationPeriodBasisForExpressions(draftMilestones.map((milestone) => milestone.expression));
  for (const context of [...contextByClientService.values()].sort((left, right) => left.clientServiceId.localeCompare(right.clientServiceId))) {
    // Period-based drafts plan the same financial periods / YAs as the
    // reconciler's OBLIGATION_PERIOD projection, so preview and apply agree.
    const periods = draftPeriodBasis
      ? planObligationPeriods(
          draftPeriodBasis,
          planFinancialPeriods(
            companyPeriodFacts(context.clientService?.company),
            addMonthsClamped(today, -OBLIGATION_PERIOD_LOOKBACK_MONTHS),
            horizonEnd,
          ).periods,
        )
      : planRollingPeriods(
          scope.draft.recurrence as DeadlineRuleEvaluationInput['recurrence'],
          today,
          horizonEnd,
        );
    for (const period of periods) {
      const key = `${context.clientServiceId}|${period.periodKey}`;
      if (existingCycleKeys.has(key)) continue;
      const plannedId = `planned-cycle:${hashConfiguration({ tenantId, ruleId, clientServiceId: context.clientServiceId, periodKey: period.periodKey, generation: ROLLING_PLAN_VERSION })}`;
      const companyId = context.clientService?.companyId ?? '';
      cyclesById.set(plannedId, {
        id: plannedId,
        tenantId,
        clientServiceId: context.clientServiceId,
        ruleId,
        ruleVersionId: scope.draft.id,
        companyId,
        periodKey: period.periodKey,
        periodStart: period.start,
        periodEnd: period.end,
        origin: 'RULE',
        businessCalendarId: activeCalendar.id,
        businessCalendarRevision: activeCalendar.revision,
        planned: true,
        generationKey: ROLLING_PLAN_VERSION,
      });
      existingCycleKeys.add(key);
    }
  }

  const decisions: ImpactDecision[] = [];
  const fullIdentityStates: Array<Record<string, unknown>> = [];
  const impactCounts = counts();
  const evaluatedByCycle = new Map<string, Map<string, EvaluatedDeadline>>();
  const evaluationStateByCycle = new Map<string, { status: 'OK' | 'INAPPLICABLE' | 'MISSING_INPUT' | 'WARNING'; reason: string | null; hash: string | null; snapshot: unknown }>();

  const ruleCycles = [...cyclesById.values()]
    .filter((cycle) => cycle.origin === undefined || cycle.origin === 'RULE')
    .sort((left, right) => cycleIdentity(left).localeCompare(cycleIdentity(right)));
  for (const cycle of ruleCycles) {
    const context = contextByClientService.get(cycle.clientServiceId);
    const calendar = await loadCalendar(db, tenantId, cycle.businessCalendarId, calendarCache);
    if (!context) {
      const reason = 'Rule evaluator context is missing';
      impactCounts.warnings += 1;
      evaluationStateByCycle.set(cycle.id, { status: 'WARNING', reason, hash: null, snapshot: null });
      const identity = `cycle|${cycle.clientServiceId}|${cycleIdentity(cycle)}|warning`;
      decisions.push({ identity, clientServiceId: cycle.clientServiceId, deadlineOccurrenceId: null, action: 'WARN', oldDate: null, newDate: null, reason });
      fullIdentityStates.push({ identity, action: 'WARN', oldDate: null, newDate: null, reason });
      continue;
    }
    if (draftPeriodBasis && !obligationPeriodFromCycle(cycle.periodKey, safeDateOnly(cycle.periodStart) ?? today, safeDateOnly(cycle.periodEnd) ?? today)) {
      // A legacy rolling cycle has no financial period. The period-based
      // reconciler no longer produces it, so its open future rows cancel.
      evaluationStateByCycle.set(cycle.id, { status: 'OK', reason: null, hash: null, snapshot: null });
      evaluatedByCycle.set(cycle.id, new Map());
      continue;
    }
    const input = await evaluatorInputFor(scope.rule, scope.draft, cycle, context, calendar, today);
    if (!input) {
      const reason = 'Rule evaluator input cannot be built';
      impactCounts.warnings += 1;
      evaluationStateByCycle.set(cycle.id, { status: 'WARNING', reason, hash: null, snapshot: null });
      const identity = `cycle|${cycle.clientServiceId}|${cycleIdentity(cycle)}|warning`;
      decisions.push({ identity, clientServiceId: cycle.clientServiceId, deadlineOccurrenceId: null, action: 'WARN', oldDate: null, newDate: null, reason });
      fullIdentityStates.push({ identity, action: 'WARN', oldDate: null, newDate: null, reason });
      continue;
    }
    try {
      const evaluated = evaluateDeadlineRule(input);
      const applicability = evaluatorApplicability(evaluated);
      const state = applicability.state === 'NOT_APPLICABLE'
        ? 'INAPPLICABLE'
        : applicability.state === 'MISSING_INPUT' ? 'MISSING_INPUT' : 'OK';
      if (state === 'INAPPLICABLE') impactCounts.inapplicable += 1;
      if (state === 'MISSING_INPUT') impactCounts.missingInput += 1;
      const reason = applicability.reason;
      evaluationStateByCycle.set(cycle.id, {
        status: state,
        reason,
        hash: isRecord(evaluated) && typeof evaluated.evaluationHash === 'string' ? evaluated.evaluationHash : null,
        snapshot: isRecord(evaluated) ? evaluated.sourceSnapshot ?? null : null,
      });
      evaluatedByCycle.set(cycle.id, evaluatorMap(evaluated));
      if (state !== 'OK') {
        const identity = `cycle|${cycle.clientServiceId}|${cycleIdentity(cycle)}|${state.toLowerCase()}`;
        decisions.push({ identity, clientServiceId: cycle.clientServiceId, deadlineOccurrenceId: null, action: 'WARN', oldDate: null, newDate: null, reason: reason ?? state });
        fullIdentityStates.push({ identity, action: 'WARN', oldDate: null, newDate: null, reason: reason ?? state });
      }
    } catch (error) {
      const code = errorCode(error);
      const reason = errorReason(error);
      const status = code === ErrorCodes.MISSING_RULE_INPUT ? 'MISSING_INPUT' : 'WARNING';
      if (status === 'MISSING_INPUT') impactCounts.missingInput += 1;
      else impactCounts.warnings += 1;
      evaluationStateByCycle.set(cycle.id, { status, reason, hash: null, snapshot: null });
      const identity = `cycle|${cycle.clientServiceId}|${cycleIdentity(cycle)}|${status.toLowerCase()}`;
      decisions.push({ identity, clientServiceId: cycle.clientServiceId, deadlineOccurrenceId: null, action: 'WARN', oldDate: null, newDate: null, reason });
      fullIdentityStates.push({ identity, action: 'WARN', oldDate: null, newDate: null, reason });
    }
  }

  const existingByKey = new Map<string, RawOccurrence[]>();
  for (const occurrence of scope.occurrences) {
    if (occurrence.tenantId !== tenantId) continue;
    const cycle = cyclesById.get(occurrence.cycleId);
    if (!cycle || cycle.tenantId !== tenantId || cycle.ruleId !== ruleId) continue;
    const key = occurrenceKey(occurrence.clientServiceId ?? cycle.clientServiceId, occurrence.cycleId, occurrence.milestoneKey, occurrence.scheduleEntryKey ?? '');
    const rows = existingByKey.get(key) ?? [];
    rows.push(occurrence);
    existingByKey.set(key, rows);
  }

  for (const [key, rows] of existingByKey.entries()) {
    if (rows.length > 1) impactCounts.conflicts += rows.length - 1;
    const occurrence = rows[0]!;
    const cycle = cyclesById.get(occurrence.cycleId)!;
    const clientServiceId = occurrence.clientServiceId ?? cycle.clientServiceId;
    const oldDate = safeDateOnly(occurrence.operativeDueDate) ?? safeDateOnly(occurrence.calculatedDueDate);
    const oldCalculatedDate = safeDateOnly(occurrence.calculatedDueDate);
    if (!oldDate) continue;
    const identity = decisionIdentity(clientServiceId, occurrence.cycleId, occurrence.milestoneKey, occurrence.scheduleEntryKey ?? '', occurrence.id);
    const state = evaluationStateByCycle.get(cycle.id);
    const next = evaluatedByCycle.get(cycle.id)?.get(`${occurrence.milestoneKey}:${occurrence.scheduleEntryKey ?? ''}`);
    const proposedCalculatedDate = safeDateOnly(next?.calculatedDueDate);
    let action: DeadlineRuleImpactAction = 'PRESERVE';
    let newDate: DateOnly | null = oldDate;
    // Keep calculated-date drift visible in the full fingerprint even when
    // the operative date is protected by lifecycle, history, or override
    // semantics. Task 7 can then refresh the hidden calculated date without
    // changing the user's operative date.
    let newCalculatedDate: DateOnly | null = proposedCalculatedDate ?? oldCalculatedDate;
    let reason = 'Evaluated date is unchanged';
    if (occurrence.status !== undefined && occurrence.status !== 'OPEN') {
      reason = 'Stored lifecycle state is immutable';
    } else if ((occurrence.origin !== undefined && occurrence.origin !== 'RULE') || (cycle.origin !== undefined && cycle.origin !== 'RULE')) {
      reason = 'Manual occurrence is immutable';
    } else if (occurrence.dateOverridden) {
      reason = 'Occurrence has a manual date override';
    } else if (oldDate < today) {
      reason = 'Occurrence date is historical';
    } else if (operation === 'ARCHIVE') {
      action = 'CANCEL';
      newDate = null;
      newCalculatedDate = null;
      reason = 'Rule archive cancels eligible future occurrences';
    } else if (state?.status === 'WARNING' || state?.status === 'MISSING_INPUT' || state?.status === 'INAPPLICABLE') {
      action = 'WARN';
      newDate = oldDate;
      reason = state.reason ?? 'Rule evaluation requires attention';
    } else if (!next) {
      action = 'CANCEL';
      newDate = null;
      newCalculatedDate = null;
      reason = 'Occurrence is no longer produced by the proposed rule';
    } else if (next.calculatedDueDate !== oldDate) {
      action = 'RECALCULATE';
      newDate = next.calculatedDueDate;
      newCalculatedDate = next.calculatedDueDate;
      reason = 'Evaluated due date changed';
    } else {
      newCalculatedDate = next.calculatedDueDate;
    }
    if (action === 'PRESERVE') impactCounts.preserved += 1;
    if (action === 'RECALCULATE') impactCounts.recalculated += 1;
    if (action === 'CANCEL') impactCounts.cancelled += 1;
    const decision = { identity, clientServiceId, deadlineOccurrenceId: occurrence.id, action, oldDate, newDate, reason };
    decisions.push(decision);
    fullIdentityStates.push({
      identity,
      clientServiceId,
      cycleId: occurrence.cycleId,
      milestoneKey: occurrence.milestoneKey,
      scheduleEntryKey: occurrence.scheduleEntryKey ?? '',
      deadlineOccurrenceId: occurrence.id,
      action,
      oldDate,
      newDate,
      oldCalculatedDate,
      newCalculatedDate,
      reason,
    });
    // A duplicate identity is independently represented in the fingerprint,
    // even though its first row determines the decision count.
    for (const duplicate of rows.slice(1)) {
      const duplicateIdentity = decisionIdentity(clientServiceId, duplicate.cycleId, duplicate.milestoneKey, duplicate.scheduleEntryKey ?? '', duplicate.id);
      fullIdentityStates.push({ identity: duplicateIdentity, action: 'WARN', oldDate: safeDateOnly(duplicate.operativeDueDate), newDate: null, reason: 'Duplicate occurrence identity' });
    }
    existingByKey.delete(key);
  }

  for (const cycle of ruleCycles) {
    if (operation === 'ARCHIVE') continue;
    const evaluated = evaluatedByCycle.get(cycle.id);
    if (!evaluated) continue;
    const context = contextByClientService.get(cycle.clientServiceId);
    if (!context) continue;
    for (const [key, next] of evaluated.entries()) {
      const [milestoneKey, scheduleEntryKey = ''] = key.split(':');
      if (scope.occurrences.some((occurrence) => {
        const occurrenceCycle = cyclesById.get(occurrence.cycleId);
        return occurrenceCycle?.id === cycle.id
          && (occurrence.clientServiceId ?? occurrenceCycle.clientServiceId) === cycle.clientServiceId
          && occurrence.milestoneKey === milestoneKey
          && (occurrence.scheduleEntryKey ?? '') === scheduleEntryKey;
      })) continue;
      const newDate = safeDateOnly(next.calculatedDueDate);
      if (!newDate || newDate < today || newDate > horizonEnd) continue;
      const stableIdentity = decisionIdentity(cycle.clientServiceId, cycleIdentity(cycle), milestoneKey ?? '', scheduleEntryKey, null);
      impactCounts.created += 1;
      const decision = {
        identity: stableIdentity,
        clientServiceId: cycle.clientServiceId,
        deadlineOccurrenceId: null,
        action: 'CREATE' as const,
        oldDate: null,
        newDate,
        reason: 'Occurrence is newly produced by the proposed rule',
      };
      decisions.push(decision);
      fullIdentityStates.push({
        identity: stableIdentity,
        clientServiceId: cycle.clientServiceId,
        cycleId: cycle.id,
        milestoneKey,
        scheduleEntryKey,
        deadlineOccurrenceId: null,
        action: 'CREATE',
        oldDate: null,
        newDate,
        reason: decision.reason,
      });
    }
  }

  const sortedStates = fullIdentityStates.sort((left, right) => String(left.identity).localeCompare(String(right.identity)));
  const sortedEvaluations = [...evaluationStateByCycle.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([cycleId, value]) => ({ cycleId, ...value }));
  const previewFingerprint = hashConfiguration({
    ruleId,
    tenantId,
    operation,
    rollingPlan: { version: ROLLING_PLAN_VERSION, today, horizonEnd },
    currentPublishedVersion: currentVersionNumber(scope.current),
    currentVersionId: scope.rule.currentVersionId ?? scope.current?.id ?? null,
    draftId: scope.draft.id,
    draftState: scope.draft.state,
    sourceState: {
      isActive: scope.rule.isActive !== false,
      archivedAt: scope.rule.archivedAt?.toISOString() ?? null,
      archivedById: scope.rule.archivedById ?? null,
      archiveReason: scope.rule.archiveReason ?? null,
    },
    draftRevision: scope.draft.draftRevision,
    draftConfigHash: scope.draft.configHash,
    today,
    counts: impactCounts,
    states: sortedStates,
    evaluations: sortedEvaluations,
  });
  const samples = decisions
    .sort((left, right) => left.identity.localeCompare(right.identity))
    .slice(0, MAX_IMPACT_SAMPLES)
    .map(({ clientServiceId, deadlineOccurrenceId, action, oldDate, newDate, reason }) => ({
      clientServiceId,
      deadlineOccurrenceId,
      action,
      oldDate,
      newDate,
      reason,
    }));
  return {
    impact: {
      ruleId,
      operation,
      currentPublishedVersion: currentVersionNumber(scope.current),
      draftRevision: scope.draft.draftRevision,
      draftConfigHash: scope.draft.configHash,
      previewFingerprint,
      counts: impactCounts,
      samples,
      sourceState: {
        currentVersionId: scope.rule.currentVersionId ?? scope.current?.id ?? null,
        draftId: scope.draft.id,
        draftState: scope.draft.state,
        isActive: scope.rule.isActive !== false,
        archivedAt: scope.rule.archivedAt?.toISOString() ?? null,
      },
    },
    scope,
  };
}

function identityMatches(
  impact: DeadlineRuleImpact,
  input: Pick<DeadlineRuleImpactInput, 'operation' | 'expectedCurrentVersion' | 'expectedDraftRevision' | 'draftConfigHash'>,
): boolean {
  return impact.operation === input.operation
    && impact.currentPublishedVersion === input.expectedCurrentVersion
    && impact.draftRevision === input.expectedDraftRevision
    && impact.draftConfigHash === input.draftConfigHash;
}

function staleImpact(impact: DeadlineRuleImpact | null): DeadlineApiError {
  return new DeadlineApiError(
    ErrorCodes.IMPACT_CHANGED,
    'Deadline rule impact preview is stale',
    409,
    impact ? { impact } : undefined,
  );
}

async function bestFreshImpact(
  db: ImpactDb,
  ruleId: string,
  tenantId: string,
  operation: DeadlineRuleImpactOperation,
  options: DeadlineRuleImpactOptions | undefined,
  fallback: DeadlineRuleImpact,
): Promise<DeadlineRuleImpact> {
  try {
    return (await computeImpact(db, ruleId, tenantId, operation, {
      ...options,
      allowMissingDraft: true,
    })).impact;
  } catch {
    return fallback;
  }
}

function parseImpactInput(rawInput: DeadlineRuleImpactInput): DeadlineRuleImpactInput {
  return deadlineRuleImpactPreviewSchema.parse(rawInput);
}

function parseApplyIdentity(rawInput: DeadlineRulePublishInput): DeadlineRuleApplyIdentity {
  return servicePublishIdentitySchema.parse(rawInput);
}

function parseArchiveInput(rawInput: DeadlineRuleArchiveInput): DeadlineRuleArchiveInput {
  return serviceArchiveInputSchema.parse(rawInput);
}

export async function previewDeadlineRuleImpact(
  ruleId: string,
  rawInput: DeadlineRuleImpactInput,
  actor: TenantAwareParams,
  options?: DeadlineRuleImpactOptions,
): Promise<DeadlineRuleImpact> {
  if (typeof ruleId !== 'string' || ruleId.trim().length === 0) throw new ValidationError('ruleId must be a non-empty string');
  const input = parseImpactInput(rawInput);
  const { impact } = await computeImpact(prisma, ruleId, actor.tenantId, input.operation, options);
  if (!identityMatches(impact, input)) throw staleImpact(impact);
  return impact;
}

export async function publishDeadlineRule(
  ruleId: string,
  rawInput: DeadlineRulePublishInput,
  actor: TenantAwareParams,
  options?: DeadlineRuleImpactOptions,
): Promise<DeadlineRuleDto> {
  const input = parseApplyIdentity(rawInput);
  await runSerializableTransaction(prisma, async (tx) => {
    const { impact, scope } = await computeImpact(tx, ruleId, actor.tenantId, input.operation, {
      ...options,
      allowMissingDraft: true,
    });
    if (!identityMatches(impact, input) || input.previewFingerprint !== impact.previewFingerprint) {
      throw staleImpact(impact);
    }
    const version = Math.max(0, ...(scope.rule.versions ?? []).map((row) => row.version)) + 1;
    const versionDelegate = delegate(tx, 'deadlineRuleVersion');
    const ruleDelegate = delegate(tx, 'deadlineRule');
    if (!versionDelegate?.updateMany || !ruleDelegate?.updateMany) throw new ValidationError('Deadline rule CAS persistence is unavailable');
    const versionChanged = await versionDelegate.updateMany({
      where: {
        id: scope.draft.id,
        tenantId: actor.tenantId,
        ruleId,
        state: 'DRAFT',
        version: 0,
        draftRevision: input.expectedDraftRevision,
        configHash: input.draftConfigHash,
      },
      data: {
        version,
        state: 'PUBLISHED',
        publishedAt: new Date(),
        publishedById: actor.userId,
      },
    });
    if (!isRecord(versionChanged) || versionChanged.count !== 1) {
      throw staleImpact(await bestFreshImpact(tx, ruleId, actor.tenantId, input.operation, options, impact));
    }
    const ruleChanged = await ruleDelegate.updateMany({
      where: {
        id: ruleId,
        tenantId: actor.tenantId,
        currentVersionId: scope.current?.id ?? null,
        isActive: true,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      },
      data: { currentVersionId: scope.draft.id, updatedById: actor.userId },
    });
    if (!isRecord(ruleChanged) || ruleChanged.count !== 1) {
      throw staleImpact(await bestFreshImpact(tx, ruleId, actor.tenantId, input.operation, options, impact));
    }
    await createAuditLog({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'UPDATE',
      changeSource: 'API',
      entityType: 'DeadlineRule',
      entityId: ruleId,
      entityName: scope.rule.name,
      summary: `Published deadline rule "${scope.rule.name ?? ruleId}" version ${version}`,
      changes: {
        currentVersion: { old: scope.current?.version ?? null, new: version },
        draftRevision: { old: scope.draft.draftRevision, new: scope.draft.draftRevision },
        configHash: { old: scope.draft.configHash, new: scope.draft.configHash },
      },
      metadata: {
        ruleId,
        version,
        previewFingerprint: impact.previewFingerprint,
        counts: impact.counts,
      },
    }, tx);
    await enqueueScheduleReconciliation(tx, {
      tenantId: actor.tenantId,
      scopeType: 'RULE',
      scopeId: ruleId,
      triggerType: 'RULE_PUBLISHED',
      correlationId: `rule:${ruleId}:published:${version}`,
      requestedById: actor.userId,
    });
  });
  return getPublishedRule(ruleId, actor);
}

export async function archiveDeadlineRule(
  ruleId: string,
  rawInput: DeadlineRuleArchiveInput,
  actor: TenantAwareParams,
  options?: DeadlineRuleImpactOptions,
): Promise<DeadlineRuleDto> {
  const input = parseArchiveInput(rawInput);
  await runSerializableTransaction(prisma, async (tx) => {
    const { impact, scope } = await computeImpact(tx, ruleId, actor.tenantId, input.operation, {
      ...options,
      allowMissingDraft: true,
    });
    if (!identityMatches(impact, input) || input.previewFingerprint !== impact.previewFingerprint) {
      throw staleImpact(impact);
    }
    const versionDelegate = delegate(tx, 'deadlineRuleVersion');
    const ruleDelegate = delegate(tx, 'deadlineRule');
    if (!versionDelegate?.updateMany || !ruleDelegate?.updateMany) throw new ValidationError('Deadline rule CAS persistence is unavailable');
    const draftChanged = await versionDelegate.updateMany({
      where: {
        id: scope.draft.id,
        tenantId: actor.tenantId,
        ruleId,
        state: 'DRAFT',
        version: 0,
        draftRevision: input.expectedDraftRevision,
        configHash: input.draftConfigHash,
      },
      // This no-op identity write locks the exact draft row and makes a
      // concurrent edit/archive race a typed stale-impact failure.
      data: { configHash: scope.draft.configHash },
    });
    if (!isRecord(draftChanged) || draftChanged.count !== 1) {
      throw staleImpact(await bestFreshImpact(tx, ruleId, actor.tenantId, input.operation, options, impact));
    }
    const archivedAt = new Date();
    const ruleChanged = await ruleDelegate.updateMany({
      where: {
        id: ruleId,
        tenantId: actor.tenantId,
        currentVersionId: scope.current?.id ?? null,
        isActive: true,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      },
      data: {
        isActive: false,
        archivedAt,
        archivedById: actor.userId,
        archiveReason: input.reason,
        updatedById: actor.userId,
      },
    });
    if (!isRecord(ruleChanged) || ruleChanged.count !== 1) {
      throw staleImpact(await bestFreshImpact(tx, ruleId, actor.tenantId, input.operation, options, impact));
    }
    await createAuditLog({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'UPDATE',
      changeSource: 'API',
      entityType: 'DeadlineRule',
      entityId: ruleId,
      entityName: scope.rule.name,
      summary: `Archived deadline rule "${scope.rule.name ?? ruleId}"`,
      reason: input.reason,
      changes: {
        isActive: { old: scope.rule.isActive ?? true, new: false },
        archivedAt: { old: scope.rule.archivedAt ?? null, new: archivedAt.toISOString() },
        archiveReason: { old: scope.rule.archiveReason ?? null, new: input.reason },
      },
      metadata: { ruleId, previewFingerprint: impact.previewFingerprint, counts: impact.counts },
    }, tx);
    await enqueueScheduleReconciliation(tx, {
      tenantId: actor.tenantId,
      scopeType: 'RULE',
      scopeId: ruleId,
      triggerType: 'RULE_ARCHIVED',
      correlationId: `rule:${ruleId}:archived:${scope.draft.draftRevision}`,
      requestedById: actor.userId,
    });
  });
  return getPublishedRule(ruleId, actor);
}

async function getPublishedRule(ruleId: string, actor: TenantAwareParams): Promise<DeadlineRuleDto> {
  const rule = await findFirst(prisma, 'deadlineRule', {
    where: { id: ruleId, tenantId: actor.tenantId },
    include: {
      versions: { include: { parameterDefinitions: true, milestoneTemplates: true }, orderBy: { version: 'desc' } },
      currentVersion: { include: { parameterDefinitions: true, milestoneTemplates: true } },
      variantAssociations: { where: { archivedAt: null }, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!isRecord(rule)) throw new NotFoundError('Deadline rule not found');
  // Keep the DTO shape aligned with the existing rule service without making
  // publication depend on a second write or a mutable version update.
  const versions = Array.isArray(rule.versions) ? rule.versions : [];
  const toVersion = (version: unknown): Record<string, unknown> | null => {
    if (!isRecord(version)) return null;
    return {
      id: version.id,
      ruleId: version.ruleId ?? ruleId,
      version: version.version,
      state: version.state,
      schemaVersion: version.schemaVersion,
      recurrence: version.recurrence,
      applicability: version.applicability,
      configHash: version.configHash,
      draftRevision: version.draftRevision,
      publishedAt: version.publishedAt ?? null,
      publishedById: version.publishedById ?? null,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      parameters: Array.isArray(version.parameterDefinitions) ? version.parameterDefinitions.map((parameter) => ({
        id: parameter.id,
        key: parameter.key,
        label: parameter.label,
        description: parameter.helpText ?? null,
        type: parameter.type,
        required: parameter.isRequired,
        defaultValue: parameter.defaultValue ?? null,
        validation: parameter.validation ?? null,
        helpText: parameter.helpText ?? null,
        displayOrder: parameter.displayOrder ?? 0,
      })) : [],
      milestones: Array.isArray(version.milestoneTemplates) ? version.milestoneTemplates.map((milestone) => ({
        id: milestone.id,
        key: milestone.milestoneKey,
        name: milestone.name,
        description: milestone.description ?? null,
        type: milestone.type,
        generationMode: milestone.generationMode,
        expression: milestone.dateExpression,
        businessDayAdjustment: milestone.businessDayAdjustment,
        displayOrder: milestone.displayOrder ?? 0,
        isActive: milestone.isActive !== false,
      })) : [],
    };
  };
  const dto = {
    id: rule.id,
    tenantId: rule.tenantId,
    code: rule.code,
    name: rule.name,
    description: rule.description ?? null,
    isActive: rule.isActive !== false,
    archivedAt: rule.archivedAt ?? null,
    archivedById: rule.archivedById ?? null,
    archiveReason: rule.archiveReason ?? null,
    currentVersionId: rule.currentVersionId ?? null,
    currentVersion: toVersion(rule.currentVersion),
    draft: versions.map(toVersion).find((version) => version?.state === 'DRAFT') ?? null,
    versions: versions.map(toVersion).filter((version): version is Record<string, unknown> => version !== null),
    variantAssociations: Array.isArray(rule.variantAssociations) ? rule.variantAssociations : [],
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
  return dto as unknown as DeadlineRuleDto;
}
