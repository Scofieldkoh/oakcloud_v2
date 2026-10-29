import { z } from 'zod';
import { createAuditLog } from '@/lib/audit';
import {
  DeadlineApiError,
  ConflictError,
  ErrorCodes,
  NotFoundError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import type { TenantAwareParams } from '@/lib/types';
import type { Prisma } from '@/generated/prisma';
import {
  currentDateInSingapore,
  compareDateOnly,
  formatDateOnly,
  parseDateOnly,
} from '@/services/service-schedule/date-only';
import {
  evaluateDeadlineRule,
  type DeadlineRuleEvaluationInput,
  type DeadlineRuleEvaluationResult,
} from '@/services/service-schedule/evaluator';
import {
  normalizeCompanyRuleSource,
  type BusinessCalendarSnapshot,
  type DateOnly,
  type EvaluatedDeadline,
} from '@/services/service-schedule';
import { hashConfiguration } from '@/services/service-schedule/hash';
import { scheduleEntriesSchema } from '@/lib/validations/service-schedule';
import { dateOnlySchema } from '@/lib/validations/date-only';
import { requireDeadlineWritesEnabled } from '@/services/schedule-reconciliation';

const UUID = z.string().uuid();
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const PERIOD_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

const periodFieldsBaseSchema = z.object({
  ruleVersionId: UUID,
  periodKey: z.string().trim().regex(PERIOD_KEY_PATTERN, 'Period key must be a stable, non-empty identifier'),
  periodStart: dateOnlySchema,
  periodEnd: dateOnlySchema,
  parameterOverrides: jsonObjectSchema.default({}),
  scheduleEntries: scheduleEntriesSchema,
  sourceValues: jsonObjectSchema.default({}),
}).strict();

function validateHistoricalPeriod(value: z.infer<typeof periodFieldsBaseSchema>, ctx: z.RefinementCtx): void {
  const start = value.periodStart as DateOnly;
  const end = value.periodEnd as DateOnly;
  if (compareDateOnly(end, start) < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periodEnd'], message: 'Period end must be on or after period start' });
    return;
  }

  // Historical cycles are deliberately bounded to one civil year. This is
  // enough for annual/leap-year work while preventing an accidental bulk
  // backfill from a single trigger request.
  const elapsedDays = (parseDateOnly(end).getTime() - parseDateOnly(start).getTime()) / 86_400_000;
  if (elapsedDays > 366) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periodEnd'], message: 'Historical periods cannot exceed 366 days' });
  }
  if (compareDateOnly(end, currentDateInSingapore()) >= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periodEnd'], message: 'Historical period must end before today' });
  }
}

const periodFieldsSchema = periodFieldsBaseSchema.superRefine(validateHistoricalPeriod);

const selectionSchema = z.object({
  milestoneKey: z.string().trim().min(1).max(100),
  scheduleEntryKey: z.string().trim().max(64).default(''),
  include: z.boolean(),
  operativeDueDate: dateOnlySchema.optional(),
  status: z.enum(['OPEN', 'COMPLETED']).optional(),
  completionDate: dateOnlySchema.nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.include) {
    if (!value.operativeDueDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operativeDueDate'], message: 'An operative due date is required for an included milestone' });
    }
    if (!value.status) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'A lifecycle status is required for an included milestone' });
    }
    if (value.status !== 'COMPLETED' && value.completionDate !== undefined && value.completionDate !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['completionDate'], message: 'Completion date requires COMPLETED status' });
    }
  } else if (
    value.operativeDueDate !== undefined
    || value.status !== undefined
    || value.completionDate !== undefined
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['include'], message: 'Excluded milestones cannot include date or completion values' });
  }
});

export const manualDeadlineCyclePreviewSchema = periodFieldsSchema;
export const manualDeadlineCycleApplySchema = periodFieldsBaseSchema.extend({
  previewFingerprint: z.string().regex(HASH_PATTERN, 'Preview fingerprint must be a SHA-256 hash'),
  notes: z.string().trim().max(5000).nullable().default(null),
  selections: z.array(selectionSchema).min(1).max(1000),
}).strict().superRefine(validateHistoricalPeriod);

export type ManualDeadlineCycleInput = z.output<typeof manualDeadlineCyclePreviewSchema> & { clientServiceId?: string };
export type ManualDeadlineCycleApplyInput = z.output<typeof manualDeadlineCycleApplySchema> & { clientServiceId?: string };
export type ManualCycleActor = TenantAwareParams & {
  accessibleCompanyIds?: string[];
  allCompaniesAccess?: boolean;
};

export interface ManualDeadlineMilestone {
  milestoneKey: string;
  scheduleEntryKey: string;
  name: string;
  description: string | null;
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  calculatedDueDate: DateOnly;
  operativeDueDate: DateOnly;
  explanation: string[];
}

export interface ManualDeadlineCyclePreview {
  clientServiceId: string;
  companyId: string;
  ruleId: string;
  ruleVersionId: string;
  ruleName: string;
  ruleVersion: number;
  periodKey: string;
  periodStart: DateOnly;
  periodEnd: DateOnly;
  applicability: { state: 'APPLICABLE' | 'NOT_APPLICABLE' | 'MISSING_INPUT'; reason: string | null };
  milestones: ManualDeadlineMilestone[];
  sourceSnapshot: Record<string, unknown>;
  evaluationHash: string;
  previewFingerprint: string;
}

export interface ManualDeadlineCycleResult {
  clientServiceId: string;
  cycleId: string;
  generationKey: string;
  occurrenceIds: string[];
  previewFingerprint: string;
  includedCount: number;
  excludedCount: number;
  completedCount: number;
  notes: string | null;
}

type Database = Prisma.TransactionClient | typeof prisma;

type VersionRecord = {
  id: string;
  tenantId: string;
  ruleId: string;
  version: number;
  state: string;
  configHash?: string;
  recurrence: unknown;
  applicability: unknown;
  parameterDefinitions?: Array<Record<string, unknown>>;
  milestoneTemplates?: Array<Record<string, unknown>>;
};

type ClientRuleRecord = {
  id: string;
  tenantId?: string;
  clientServiceId?: string;
  ruleId: string;
  enabled?: boolean;
  parameterValues?: unknown;
  scheduleEntries?: unknown;
  rule?: {
    id: string;
    tenantId?: string;
    name?: string;
    isActive?: boolean;
    archivedAt?: Date | string | null;
    currentVersionId?: string | null;
    currentVersion?: VersionRecord | null;
    versions?: VersionRecord[];
  } | null;
};

type ClientServiceRecord = {
  id: string;
  tenantId: string;
  companyId: string;
  deletedAt?: Date | string | null;
  company?: Record<string, unknown> | null;
  serviceVariant?: { id?: string; tenantId?: string } | null;
  deadlineRules?: ClientRuleRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function dateToOnly(value: unknown, name: string): DateOnly {
  if (typeof value === 'string') {
    parseDateOnly(value as DateOnly);
    return value as DateOnly;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDateOnly(value);
  throw new ValidationError(`${name} must be a date-only value`);
}

function defaultCalendar(): BusinessCalendarSnapshot {
  return { id: 'default', timeZone: 'Asia/Singapore', revision: 1, weekendDays: new Set([0, 6]), holidays: new Set() };
}

function asVersion(value: unknown): VersionRecord | null {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.tenantId === 'string'
    && typeof value.ruleId === 'string'
    && typeof value.version === 'number'
    && typeof value.state === 'string'
    ? value as unknown as VersionRecord
    : null;
}

function asClientService(value: unknown): ClientServiceRecord | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.tenantId !== 'string' || typeof value.companyId !== 'string') return null;
  return value as unknown as ClientServiceRecord;
}

function versionMilestones(version: VersionRecord): DeadlineRuleEvaluationInput['milestones'] {
  const milestones = Array.isArray(version.milestoneTemplates) ? version.milestoneTemplates : [];
  return milestones.map((value, index) => ({
    key: typeof value.milestoneKey === 'string' ? value.milestoneKey : `milestone-${index + 1}`,
    name: typeof value.name === 'string' ? value.name : `Milestone ${index + 1}`,
    description: typeof value.description === 'string' ? value.description : null,
    type: (typeof value.type === 'string' ? value.type : 'CLIENT') as 'STATUTORY' | 'CLIENT' | 'INTERNAL',
    generationMode: (typeof value.generationMode === 'string' ? value.generationMode : 'ONCE_PER_CYCLE') as 'ONCE_PER_CYCLE' | 'ONCE_PER_SCHEDULE_ENTRY',
    expression: value.dateExpression as never,
    businessDayAdjustment: (typeof value.businessDayAdjustment === 'string' ? value.businessDayAdjustment : 'NONE') as 'NONE' | 'PREVIOUS' | 'NEXT',
    displayOrder: typeof value.displayOrder === 'number' ? value.displayOrder : index,
    isActive: value.isActive !== false,
  }));
}

function validateVersionMilestones(version: VersionRecord, actor: ManualCycleActor): void {
  const milestones = version.milestoneTemplates;
  if (!Array.isArray(milestones)) {
    throw new NotFoundError('Published deadline rule version is not available for this client service');
  }
  for (const milestone of milestones) {
    if (!isRecord(milestone) || milestone.tenantId !== actor.tenantId || milestone.ruleVersionId !== version.id) {
      throw new NotFoundError('Published deadline rule version is not available for this client service');
    }
  }
}

function sourceSnapshotWithManualInputs(
  evaluation: DeadlineRuleEvaluationResult,
  input: z.output<typeof manualDeadlineCyclePreviewSchema>,
  notes?: string | null,
): Record<string, unknown> {
  return {
    ...evaluation.sourceSnapshot,
    manualCycle: {
      periodKey: input.periodKey,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      parameterOverrides: input.parameterOverrides,
      scheduleEntries: input.scheduleEntries,
      sourceValues: input.sourceValues,
      ...(notes === undefined ? {} : { notes }),
    },
  };
}

function milestoneNameMap(version: VersionRecord): Map<string, { name: string; description: string | null }> {
  const result = new Map<string, { name: string; description: string | null }>();
  for (const [index, value] of (Array.isArray(version.milestoneTemplates) ? version.milestoneTemplates : []).entries()) {
    const key = typeof value.milestoneKey === 'string' ? value.milestoneKey : `milestone-${index + 1}`;
    result.set(key, { name: typeof value.name === 'string' ? value.name : key, description: typeof value.description === 'string' ? value.description : null });
  }
  return result;
}

function buildPreviewFingerprint(preview: Omit<ManualDeadlineCyclePreview, 'previewFingerprint'>): string {
  return hashConfiguration({
    clientServiceId: preview.clientServiceId,
    companyId: preview.companyId,
    ruleId: preview.ruleId,
    ruleVersionId: preview.ruleVersionId,
    ruleVersion: preview.ruleVersion,
    period: { key: preview.periodKey, start: preview.periodStart, end: preview.periodEnd },
    applicability: preview.applicability,
    milestones: preview.milestones,
    sourceSnapshot: preview.sourceSnapshot,
    evaluationHash: preview.evaluationHash,
  });
}

function invocation<T extends ManualDeadlineCycleInput | ManualDeadlineCycleApplyInput>(
  first: string | T,
  second: T | ManualCycleActor,
  third?: ManualCycleActor,
): { clientServiceId: string; input: T; actor: ManualCycleActor } {
  if (typeof first === 'string') {
    return { clientServiceId: first, input: second as T, actor: third! };
  }
  const actor = second as ManualCycleActor;
  const clientServiceId = first.clientServiceId;
  if (!clientServiceId) throw new ValidationError('Client service ID is required for a manual cycle');
  return { clientServiceId, input: first, actor };
}

function parsePreviewInput(raw: ManualDeadlineCycleInput): z.output<typeof manualDeadlineCyclePreviewSchema> {
  const {
    clientServiceId: _clientServiceId,
    previewFingerprint: _previewFingerprint,
    notes: _notes,
    selections: _selections,
    ...body
  } = raw as ManualDeadlineCycleInput & Record<string, unknown>;
  return manualDeadlineCyclePreviewSchema.parse(body);
}

function parseApplyInput(raw: ManualDeadlineCycleApplyInput): z.output<typeof manualDeadlineCycleApplySchema> {
  const { clientServiceId: _clientServiceId, ...body } = raw as ManualDeadlineCycleApplyInput & Record<string, unknown>;
  return manualDeadlineCycleApplySchema.parse(body);
}

async function loadClientService(
  db: Database,
  clientServiceId: string,
  actor: ManualCycleActor,
): Promise<ClientServiceRecord> {
  const companyScope = actor.allCompaniesAccess
    ? { tenantId: actor.tenantId, deletedAt: null }
    : actor.accessibleCompanyIds !== undefined
      ? { tenantId: actor.tenantId, deletedAt: null, id: { in: [...actor.accessibleCompanyIds] } }
      : undefined;

  const delegate = db.clientService as unknown as { findFirst?: (args: unknown) => Promise<unknown> };
  if (!delegate?.findFirst) throw new ValidationError('Client service persistence is unavailable');
  const raw = await delegate.findFirst({
    where: {
      id: clientServiceId,
      tenantId: actor.tenantId,
      deletedAt: null,
      ...(companyScope ? { company: companyScope } : {}),
    },
    include: {
      company: true,
      serviceVariant: true,
      deadlineRules: {
        where: { tenantId: actor.tenantId },
        include: {
          rule: {
            include: {
              versions: {
                where: { tenantId: actor.tenantId, state: 'PUBLISHED' },
                include: {
                  parameterDefinitions: { where: { tenantId: actor.tenantId } },
                  milestoneTemplates: true,
                },
                orderBy: { version: 'desc' },
              },
              currentVersion: {
                include: {
                  parameterDefinitions: { where: { tenantId: actor.tenantId } },
                  milestoneTemplates: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const service = asClientService(raw);
  if (!service) throw new NotFoundError('Client service not found');
  if (service.tenantId !== actor.tenantId) throw new NotFoundError('Client service not found');

  // Defensive relationship checks remain necessary for lightweight test
  // doubles and protect against malformed rows if a relation is corrupted.
  if (service.company && (service.company.tenantId !== undefined && service.company.tenantId !== actor.tenantId)) {
    throw new NotFoundError('Client service not found');
  }
  if (service.serviceVariant && (service.serviceVariant.tenantId !== undefined && service.serviceVariant.tenantId !== actor.tenantId)) {
    throw new NotFoundError('Client service not found');
  }
  return service;
}

async function loadVersion(
  db: Database,
  service: ClientServiceRecord,
  ruleVersionId: string,
  actor: ManualCycleActor,
): Promise<{ clientRule: ClientRuleRecord; version: VersionRecord; rule: NonNullable<ClientRuleRecord['rule']> }> {
  const clientRule = (service.deadlineRules ?? []).find((candidate) => candidate.rule?.versions?.some((version) => version.id === ruleVersionId)
    || candidate.rule?.currentVersion?.id === ruleVersionId);
  let matchedRule = clientRule;
  let version = clientRule?.rule?.versions?.find((candidate) => candidate.id === ruleVersionId)
    ?? (clientRule?.rule?.currentVersion?.id === ruleVersionId ? clientRule.rule.currentVersion : null);

  // A historical published version may not be included by an older Prisma
  // client/test fixture. Load it explicitly, then still require the service's
  // association to prove the rule is allowed for this variant.
  const versionDelegate = db.deadlineRuleVersion as unknown as { findFirst?: (args: unknown) => Promise<unknown> } | undefined;
  if (!version && versionDelegate?.findFirst) {
    const raw = await versionDelegate.findFirst({
      where: { id: ruleVersionId, tenantId: actor.tenantId, state: 'PUBLISHED' },
      include: {
        rule: true,
        parameterDefinitions: { where: { tenantId: actor.tenantId } },
        milestoneTemplates: true,
      },
    });
    const candidate = asVersion(raw);
    if (candidate) {
      matchedRule = (service.deadlineRules ?? []).find((row) => row.ruleId === candidate.ruleId);
      version = candidate;
    }
  }

  if (!matchedRule || !version || !matchedRule.rule) throw new NotFoundError('Published deadline rule version is not available for this client service');
  const rule = matchedRule.rule;
  if (
    matchedRule.tenantId !== undefined && matchedRule.tenantId !== actor.tenantId
    || rule.tenantId !== undefined && rule.tenantId !== actor.tenantId
    || version.tenantId !== actor.tenantId
    || version.ruleId !== rule.id
    || version.state !== 'PUBLISHED'
    || rule.isActive === false
    || rule.archivedAt !== null && rule.archivedAt !== undefined
    || matchedRule.enabled === false
  ) {
    throw new ValidationError('Manual cycles require an active, published rule version enabled for this client service');
  }
  validateVersionMilestones(version, actor);
  return { clientRule: matchedRule, version, rule };
}

async function loadCalendar(db: Database, tenantId: string): Promise<BusinessCalendarSnapshot> {
  const delegate = db.businessCalendar as unknown as { findFirst?: (args: unknown) => Promise<unknown> } | undefined;
  if (!delegate?.findFirst) return defaultCalendar();
  const raw = await delegate.findFirst({
    where: { tenantId, isActive: true, archivedAt: null },
    include: { holidays: { where: { tenantId, isActive: true }, orderBy: [{ date: 'asc' }, { id: 'asc' }] } },
  });
  if (!isRecord(raw)) return defaultCalendar();
  const holidays = Array.isArray(raw.holidays)
    ? raw.holidays.map((holiday) => dateToOnly(isRecord(holiday) ? holiday.date : holiday, 'Holiday date'))
    : [];
  const weekendDays = Array.isArray(raw.weekendDays)
    ? raw.weekendDays.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6)
    : [0, 6];
  return {
    id: typeof raw.id === 'string' ? raw.id : 'default',
    timeZone: typeof raw.timeZone === 'string' ? raw.timeZone : 'Asia/Singapore',
    revision: typeof raw.revision === 'number' ? raw.revision : 1,
    weekendDays: new Set(weekendDays),
    holidays: new Set(holidays),
  };
}

async function buildPreview(
  db: Database,
  clientServiceId: string,
  rawInput: ManualDeadlineCycleInput,
  actor: ManualCycleActor,
  notes?: string | null,
): Promise<ManualDeadlineCyclePreview> {
  const input = parsePreviewInput(rawInput);
  const service = await loadClientService(db, clientServiceId, actor);
  const { clientRule, version, rule } = await loadVersion(db, service, input.ruleVersionId, actor);
  const today = currentDateInSingapore();
  const calendar = await loadCalendar(db, actor.tenantId);
  const company = normalizeCompanyRuleSource({ ...asRecord(service.company), ...input.sourceValues }, today);
  const parameters = { ...asRecord(clientRule.parameterValues), ...input.parameterOverrides };
  const evaluationInput: DeadlineRuleEvaluationInput = {
    ruleId: rule.id,
    ruleVersionId: version.id,
    recurrence: version.recurrence as never,
    applicability: version.applicability as never,
    parameters,
    scheduleEntries: input.scheduleEntries as never,
    milestones: versionMilestones(version),
    company,
    period: { key: input.periodKey, start: input.periodStart as DateOnly, end: input.periodEnd as DateOnly },
    calendar,
  };
  const evaluation = evaluateDeadlineRule(evaluationInput);
  const names = milestoneNameMap(version);
  const milestones: ManualDeadlineMilestone[] = evaluation.occurrences.map((occurrence: EvaluatedDeadline) => ({
    milestoneKey: occurrence.milestoneKey,
    scheduleEntryKey: occurrence.scheduleEntryKey,
    name: names.get(occurrence.milestoneKey)?.name ?? occurrence.milestoneKey,
    description: names.get(occurrence.milestoneKey)?.description ?? null,
    deadlineType: occurrence.type,
    calculatedDueDate: occurrence.calculatedDueDate,
    operativeDueDate: occurrence.calculatedDueDate,
    explanation: [...occurrence.explanation],
  }));
  const sourceSnapshot = sourceSnapshotWithManualInputs(evaluation, input, notes);
  const withoutFingerprint: Omit<ManualDeadlineCyclePreview, 'previewFingerprint'> = {
    clientServiceId,
    companyId: service.companyId,
    ruleId: rule.id,
    ruleVersionId: version.id,
    ruleName: rule.name ?? rule.id,
    ruleVersion: version.version,
    periodKey: input.periodKey,
    periodStart: input.periodStart as DateOnly,
    periodEnd: input.periodEnd as DateOnly,
    applicability: { state: evaluation.applicability.state, reason: evaluation.applicability.reason },
    milestones,
    sourceSnapshot,
    evaluationHash: evaluation.evaluationHash,
  };
  return { ...withoutFingerprint, previewFingerprint: buildPreviewFingerprint(withoutFingerprint) };
}

function identityKey(milestoneKey: string, scheduleEntryKey: string): string {
  return `${milestoneKey}|${scheduleEntryKey}`;
}

function validateSelections(
  selections: z.output<typeof manualDeadlineCycleApplySchema>['selections'],
  milestones: ManualDeadlineMilestone[],
): Map<string, z.output<typeof selectionSchema>> {
  const expected = new Map(milestones.map((milestone) => [identityKey(milestone.milestoneKey, milestone.scheduleEntryKey), milestone]));
  const selected = new Map<string, z.output<typeof selectionSchema>>();
  for (const selection of selections) {
    const key = identityKey(selection.milestoneKey, selection.scheduleEntryKey);
    if (selected.has(key)) throw new ValidationError(`Duplicate manual milestone selection: ${selection.milestoneKey}/${selection.scheduleEntryKey}`);
    if (!expected.has(key)) throw new ValidationError(`Manual milestone selection does not match the evaluated cycle: ${selection.milestoneKey}/${selection.scheduleEntryKey}`);
    selected.set(key, selection);
  }
  if (selected.size !== expected.size) {
    const missing = [...expected.keys()].filter((key) => !selected.has(key));
    throw new ValidationError('Exactly one selection is required for every evaluated milestone', { missing });
  }
  return selected;
}

function ensureHistoricalDate(value: DateOnly, name: string): void {
  if (compareDateOnly(value, currentDateInSingapore()) >= 0) throw new ValidationError(`${name} must be before today for a historical cycle`);
}

function isPrismaCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

class ManualCycleUniqueRace extends Error {
  constructor() {
    super('Another request created this manual cycle concurrently');
    this.name = 'ManualCycleUniqueRace';
  }
}

type ParsedManualCycleApplyInput = z.output<typeof manualDeadlineCycleApplySchema>;

function canonicalSelectionProjection(
  selections: ParsedManualCycleApplyInput['selections'],
): Array<Record<string, unknown>> {
  return [...selections]
    .sort((left, right) => left.milestoneKey.localeCompare(right.milestoneKey) || left.scheduleEntryKey.localeCompare(right.scheduleEntryKey))
    .map((selection) => ({
      milestoneKey: selection.milestoneKey,
      scheduleEntryKey: selection.scheduleEntryKey,
      include: selection.include,
      operativeDueDate: selection.operativeDueDate ?? null,
      status: selection.status ?? null,
      completionDate: selection.completionDate ?? null,
    }));
}

function selectionSummary(selections: ParsedManualCycleApplyInput['selections']): {
  includedCount: number;
  excludedCount: number;
  completedCount: number;
} {
  return {
    includedCount: selections.filter((selection) => selection.include).length,
    excludedCount: selections.filter((selection) => !selection.include).length,
    completedCount: selections.filter((selection) => selection.include && selection.status === 'COMPLETED').length,
  };
}

async function findExistingCycle(db: Database, data: { tenantId: string; clientServiceId: string; ruleId: string; periodKey: string; generationKey: string }) {
  const delegate = db.serviceCycle as unknown as {
    findUnique?: (args: unknown) => Promise<unknown>;
    findFirst?: (args: unknown) => Promise<unknown>;
  };
  const where = {
    tenantId_clientServiceId_ruleId_periodKey_generationKey_origin: {
      tenantId: data.tenantId,
      clientServiceId: data.clientServiceId,
      ruleId: data.ruleId,
      periodKey: data.periodKey,
      generationKey: data.generationKey,
      origin: 'MANUAL_TRIGGER',
    },
  };
  if (delegate.findUnique) return delegate.findUnique({ where, include: { occurrences: true } });
  if (delegate.findFirst) return delegate.findFirst({ where: { ...where, tenantId: data.tenantId }, include: { occurrences: true } });
  return null;
}

async function createOccurrence(
  db: Database,
  data: Record<string, unknown>,
): Promise<{ id?: string }> {
  const delegate = db.deadlineOccurrence as unknown as {
    create?: (args: unknown) => Promise<unknown>;
    createMany?: (args: unknown) => Promise<{ count: number }>;
  };
  if (delegate.create) {
    const created = await delegate.create({ data });
    return isRecord(created) && typeof created.id === 'string' ? { id: created.id } : {};
  }
  if (delegate.createMany) {
    await delegate.createMany({ data, skipDuplicates: true });
    return {};
  }
  throw new ValidationError('Deadline occurrence persistence is unavailable');
}

function existingResult(
  existing: unknown,
  clientServiceId: string,
  fingerprint: string,
  notes: string | null,
  generationKey: string,
  summary: { includedCount: number; excludedCount: number; completedCount: number },
): ManualDeadlineCycleResult | null {
  if (!isRecord(existing) || typeof existing.id !== 'string') return null;
  const occurrences = Array.isArray(existing.occurrences) ? existing.occurrences : [];
  return {
    clientServiceId,
    cycleId: existing.id,
    generationKey,
    occurrenceIds: occurrences.filter(isRecord).map((occurrence) => typeof occurrence.id === 'string' ? occurrence.id : '').filter(Boolean),
    previewFingerprint: fingerprint,
    includedCount: summary.includedCount,
    excludedCount: summary.excludedCount,
    completedCount: summary.completedCount,
    notes,
  };
}

type PreparedManualCycle = {
  input: ParsedManualCycleApplyInput;
  preview: ManualDeadlineCyclePreview;
  selections: Map<string, z.output<typeof selectionSchema>>;
  generationKey: string;
  selectionSummary: ReturnType<typeof selectionSummary>;
};

async function prepareManualCycle(
  tx: Database,
  clientServiceId: string,
  rawInput: ManualDeadlineCycleApplyInput,
  actor: ManualCycleActor,
): Promise<PreparedManualCycle> {
  const input = parseApplyInput(rawInput);
  await requireDeadlineWritesEnabled(actor.tenantId, tx);
  const preview = await buildPreview(tx, clientServiceId, input, actor);
  if (preview.previewFingerprint !== input.previewFingerprint) {
    throw new DeadlineApiError(
      ErrorCodes.IMPACT_CHANGED,
      'The manual cycle preview is stale. Preview the cycle again before applying it.',
      409,
      { preview },
    );
  }
  const selections = validateSelections(input.selections, preview.milestones);
  const generationKey = `MANUAL_TRIGGER:${hashConfiguration({
    previewFingerprint: input.previewFingerprint,
    selections: canonicalSelectionProjection(input.selections),
    notes: input.notes,
  })}`;
  return {
    input,
    preview,
    selections,
    generationKey,
    selectionSummary: selectionSummary(input.selections),
  };
}

async function resolveManualCycleAfterRace(
  tx: Database,
  clientServiceId: string,
  rawInput: ManualDeadlineCycleApplyInput,
  actor: ManualCycleActor,
): Promise<ManualDeadlineCycleResult> {
  const prepared = await prepareManualCycle(tx, clientServiceId, rawInput, actor);
  const existing = await findExistingCycle(tx, {
    tenantId: actor.tenantId,
    clientServiceId,
    ruleId: prepared.preview.ruleId,
    periodKey: prepared.preview.periodKey,
    generationKey: prepared.generationKey,
  });
  const alreadyApplied = existingResult(
    existing,
    clientServiceId,
    prepared.preview.previewFingerprint,
    prepared.input.notes,
    prepared.generationKey,
    prepared.selectionSummary,
  );
  if (alreadyApplied) return alreadyApplied;
  throw new ConflictError('Manual cycle creation raced with another request; retry the apply operation.');
}

async function applyManualCycle(
  tx: Database,
  clientServiceId: string,
  rawInput: ManualDeadlineCycleApplyInput,
  actor: ManualCycleActor,
): Promise<ManualDeadlineCycleResult> {
  // Notes and selection choices are apply metadata; only the evaluator inputs
  // are represented by the preview fingerprint. A stale input is rejected
  // before any cycle, occurrence, or audit write.
  const { input, preview, selections, generationKey, selectionSummary } = await prepareManualCycle(tx, clientServiceId, rawInput, actor);
  const existing = await findExistingCycle(tx, {
    tenantId: actor.tenantId,
    clientServiceId,
    ruleId: preview.ruleId,
    periodKey: preview.periodKey,
    generationKey,
  });
  const alreadyApplied = existingResult(existing, clientServiceId, preview.previewFingerprint, input.notes, generationKey, selectionSummary);
  if (alreadyApplied) return alreadyApplied;

  const calendar = await loadCalendar(tx, actor.tenantId);
  const createdAt = new Date();
  const cycleDelegate = tx.serviceCycle as unknown as { create?: (args: unknown) => Promise<unknown> };
  if (!cycleDelegate?.create) throw new ValidationError('Service cycle persistence is unavailable');
  let cycle: unknown;
  try {
    cycle = await cycleDelegate.create({
      data: {
        tenantId: actor.tenantId,
        companyId: preview.companyId,
        clientServiceId,
        ruleId: preview.ruleId,
        ruleVersionId: preview.ruleVersionId,
        businessCalendarId: calendar.id === 'default' ? null : calendar.id,
        businessCalendarRevision: calendar.revision,
        periodKey: preview.periodKey,
        periodStart: parseDateOnly(preview.periodStart),
        periodEnd: parseDateOnly(preview.periodEnd),
        generationKey,
        origin: 'MANUAL_TRIGGER',
        recurrenceAnchor: { kind: 'MANUAL_TRIGGER', periodKey: preview.periodKey },
        sourceSnapshot: preview.sourceSnapshot,
        evaluationHash: preview.evaluationHash,
        createdById: actor.userId,
        createdAt,
      },
    });
  } catch (error) {
    // A concurrent request can pass the read-before-create check and then
    // lose the cycle's unique-key race. Treat that winner as the idempotent
    // result instead of emitting a duplicate or leaking a raw Prisma error.
    if (!isPrismaCode(error, 'P2002')) throw error;
    throw new ManualCycleUniqueRace();
  }
  if (!isRecord(cycle) || typeof cycle.id !== 'string') throw new ValidationError('Manual cycle was not created');

  const occurrenceIds: string[] = [];
  let includedCount = 0;
  let completedCount = 0;
  const completionAudit: Array<Record<string, unknown>> = [];
  for (const milestone of preview.milestones) {
    const selection = selections.get(identityKey(milestone.milestoneKey, milestone.scheduleEntryKey))!;
    if (!selection.include) continue;
    const operativeDueDate = selection.operativeDueDate! as DateOnly;
    ensureHistoricalDate(operativeDueDate, 'Operative due date');
    const dateAdjusted = operativeDueDate !== milestone.calculatedDueDate;
    const completed = selection.status === 'COMPLETED';
    const completionDate = completed
      ? (selection.completionDate as DateOnly | null | undefined ?? operativeDueDate)
      : null;
    if (completionDate) ensureHistoricalDate(completionDate, 'Completion date');
    const created = await createOccurrence(tx, {
      tenantId: actor.tenantId,
      companyId: preview.companyId,
      clientServiceId,
      cycleId: cycle.id,
      ruleVersionId: preview.ruleVersionId,
      milestoneKey: milestone.milestoneKey,
      scheduleEntryKey: milestone.scheduleEntryKey,
      deadlineType: milestone.deadlineType,
      calculatedDueDate: parseDateOnly(milestone.calculatedDueDate),
      operativeDueDate: parseDateOnly(operativeDueDate),
      dateOverridden: dateAdjusted,
      dateOverride: dateAdjusted ? parseDateOnly(operativeDueDate) : null,
      dateOverrideReason: dateAdjusted ? 'Manual historical cycle adjustment' : null,
      dateOverriddenById: dateAdjusted ? actor.userId : null,
      dateOverriddenAt: dateAdjusted ? createdAt : null,
      status: completed ? 'COMPLETED' : 'OPEN',
      completedAt: completionDate ? parseDateOnly(completionDate) : null,
      completedById: completionDate ? actor.userId : null,
      notes: input.notes,
      origin: 'MANUAL_TRIGGER',
    });
    if (created.id) occurrenceIds.push(created.id);
    includedCount += 1;
    if (completed) completedCount += 1;
    completionAudit.push({
      milestoneKey: milestone.milestoneKey,
      scheduleEntryKey: milestone.scheduleEntryKey,
      include: true,
      calculatedDueDate: milestone.calculatedDueDate,
      operativeDueDate,
      status: completed ? 'COMPLETED' : 'OPEN',
      completionDate,
    });
  }
  const excluded = preview.milestones
    .filter((milestone) => !selections.get(identityKey(milestone.milestoneKey, milestone.scheduleEntryKey))!.include)
    .map((milestone) => ({ milestoneKey: milestone.milestoneKey, scheduleEntryKey: milestone.scheduleEntryKey, include: false }));
  await createAuditLog({
    tenantId: actor.tenantId,
    userId: actor.userId,
    companyId: preview.companyId,
    action: 'CREATE',
    changeSource: 'MANUAL',
    entityType: 'ServiceCycle',
    entityId: cycle.id,
    entityName: `${preview.ruleName} ${preview.periodKey}`,
    summary: `Created manual historical deadline cycle for ${preview.ruleName} (${preview.periodKey})`,
    reason: input.notes ?? undefined,
    metadata: {
      origin: 'MANUAL_TRIGGER',
      clientServiceId,
      ruleId: preview.ruleId,
      ruleVersionId: preview.ruleVersionId,
      previewFingerprint: preview.previewFingerprint,
      evaluationHash: preview.evaluationHash,
      included: completionAudit,
      excluded,
      completed: completionAudit.filter((choice) => choice.status === 'COMPLETED'),
      notes: input.notes,
    },
  }, tx as Prisma.TransactionClient);

  return {
    clientServiceId,
    cycleId: cycle.id,
    generationKey,
    occurrenceIds,
    previewFingerprint: preview.previewFingerprint,
    includedCount,
    excludedCount: excluded.length,
    completedCount,
    notes: input.notes,
  };
}

export async function previewManualDeadlineCycle(
  clientServiceId: string,
  rawInput: ManualDeadlineCycleInput,
  actor: ManualCycleActor,
): Promise<ManualDeadlineCyclePreview>;
export async function previewManualDeadlineCycle(
  rawInput: ManualDeadlineCycleInput,
  actor: ManualCycleActor,
): Promise<ManualDeadlineCyclePreview>;
export async function previewManualDeadlineCycle(
  first: string | ManualDeadlineCycleInput,
  second: ManualDeadlineCycleInput | ManualCycleActor,
  third?: ManualCycleActor,
): Promise<ManualDeadlineCyclePreview> {
  const { clientServiceId, input, actor } = invocation(first, second, third);
  return buildPreview(prisma, clientServiceId, input, actor);
}

export async function createManualDeadlineCycle(
  clientServiceId: string,
  rawInput: ManualDeadlineCycleApplyInput,
  actor: ManualCycleActor,
): Promise<ManualDeadlineCycleResult>;
export async function createManualDeadlineCycle(
  rawInput: ManualDeadlineCycleApplyInput,
  actor: ManualCycleActor,
): Promise<ManualDeadlineCycleResult>;
export async function createManualDeadlineCycle(
  first: string | ManualDeadlineCycleApplyInput,
  second: ManualDeadlineCycleApplyInput | ManualCycleActor,
  third?: ManualCycleActor,
): Promise<ManualDeadlineCycleResult> {
  const { clientServiceId, input, actor } = invocation(first, second, third);
  try {
    return await runSerializableTransaction(prisma, (tx) => applyManualCycle(tx, clientServiceId, input, actor));
  } catch (error) {
    // A unique-key violation aborts the interactive transaction in PostgreSQL;
    // it is not legal to query that transaction afterward. Recompute in a
    // fresh serializable transaction and resolve the committed winner there.
    if (!(error instanceof ManualCycleUniqueRace)) throw error;
    return runSerializableTransaction(prisma, (tx) => resolveManualCycleAfterRace(tx, clientServiceId, input, actor));
  }
}
