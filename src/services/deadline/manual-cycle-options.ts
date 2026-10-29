import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { scheduleEntriesSchema, type ScheduleEntryInput } from '@/lib/validations/service-schedule';
import type { ManualCycleActor } from './manual-cycle';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const PARAMETER_TYPES = new Set(['DATE', 'INTEGER', 'DECIMAL', 'STRING', 'BOOLEAN', 'ENUM']);

export type ManualDeadlineCycleParameterType = 'DATE' | 'INTEGER' | 'DECIMAL' | 'STRING' | 'BOOLEAN' | 'ENUM';

export interface ManualDeadlineCycleParameterDefinition {
  key: string;
  label: string;
  type: ManualDeadlineCycleParameterType;
  required: boolean;
  defaultValue: unknown;
  validation: unknown;
  helpText: string | null;
  displayOrder: number;
}

export interface ManualDeadlineCycleRuleOption {
  id: string;
  ruleId: string;
  enabled: true;
  parameterValues: Record<string, unknown>;
  scheduleEntries: ScheduleEntryInput[];
  rule: {
    id: string;
    code: string;
    name: string;
    isActive: true;
    archivedAt: null;
    currentVersionId: string;
    currentVersion: {
      id: string;
      version: number;
      state: 'PUBLISHED';
      configHash: string;
      recurrence: unknown;
      applicability: unknown;
      parameters: ManualDeadlineCycleParameterDefinition[];
    };
  };
}

export interface ManualDeadlineCycleOptions {
  clientServiceId: string;
  companyId: string;
  rules: ManualDeadlineCycleRuleOption[];
}

type RawVersion = {
  id?: unknown;
  tenantId?: unknown;
  ruleId?: unknown;
  version?: unknown;
  state?: unknown;
  configHash?: unknown;
  recurrence?: unknown;
  applicability?: unknown;
  parameterDefinitions?: unknown;
  milestoneTemplates?: unknown;
};
type RawRule = {
  id?: unknown;
  tenantId?: unknown;
  code?: unknown;
  name?: unknown;
  isActive?: unknown;
  archivedAt?: unknown;
  currentVersionId?: unknown;
  currentVersion?: RawVersion | null;
};
type RawAssociation = {
  id?: unknown;
  tenantId?: unknown;
  clientServiceId?: unknown;
  ruleId?: unknown;
  enabled?: unknown;
  parameterValues?: unknown;
  scheduleEntries?: unknown;
  rule?: RawRule | null;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRawVersion(value: unknown): value is RawVersion {
  return isRecord(value);
}

function isRawRule(value: unknown): value is RawRule {
  return isRecord(value);
}

function asSafeParameterDefinition(
  value: unknown,
  tenantId: string,
  ruleVersionId: string,
  seenKeys: Set<string>,
): ManualDeadlineCycleParameterDefinition | null {
  if (!isRecord(value)) return null;
  if (value.tenantId !== tenantId || value.ruleVersionId !== ruleVersionId) return null;
  if (typeof value.key !== 'string' || !value.key.trim() || seenKeys.has(value.key)) return null;
  if (typeof value.label !== 'string' || !value.label.trim()) return null;
  if (typeof value.type !== 'string' || !PARAMETER_TYPES.has(value.type)) return null;
  if (typeof value.isRequired !== 'boolean' || typeof value.displayOrder !== 'number' || !Number.isInteger(value.displayOrder)) return null;
  if (value.helpText !== null && value.helpText !== undefined && typeof value.helpText !== 'string') return null;
  seenKeys.add(value.key);
  return {
    key: value.key,
    label: value.label,
    type: value.type as ManualDeadlineCycleParameterType,
    required: value.isRequired,
    defaultValue: value.defaultValue ?? null,
    validation: value.validation ?? null,
    helpText: value.helpText === undefined ? null : value.helpText as string | null,
    displayOrder: value.displayOrder,
  };
}

function asSafeRule(
  value: unknown,
  association: RawAssociation,
  actor: ManualCycleActor,
  clientServiceId: string,
): ManualDeadlineCycleRuleOption | null {
  if (!isRawRule(value)) return null;
  const version = value.currentVersion;
  if (!isRawVersion(version)) return null;
  if (
    association.tenantId !== actor.tenantId
    || association.clientServiceId !== clientServiceId
    || association.ruleId !== value.id
    || association.enabled !== true
    || value.tenantId !== actor.tenantId
    || typeof value.id !== 'string'
    || typeof value.code !== 'string'
    || typeof value.name !== 'string'
    || value.isActive !== true
    || value.archivedAt !== null
    || typeof value.currentVersionId !== 'string'
    || version.id !== value.currentVersionId
    || version.tenantId !== actor.tenantId
    || version.ruleId !== value.id
    || version.state !== 'PUBLISHED'
    || typeof version.id !== 'string'
    || typeof version.version !== 'number'
    || !Number.isInteger(version.version)
    || typeof version.configHash !== 'string'
    || !HASH_PATTERN.test(version.configHash)
    || !isRecord(version.recurrence)
    || !isRecord(version.applicability)
    || !isRecord(association.parameterValues)
  ) return null;

  const scheduleEntries = scheduleEntriesSchema.safeParse(association.scheduleEntries);
  if (!scheduleEntries.success || !Array.isArray(version.parameterDefinitions) || !Array.isArray(version.milestoneTemplates)) return null;
  if (version.milestoneTemplates.some((template) => !isRecord(template)
    || template.tenantId !== actor.tenantId
    || template.ruleVersionId !== version.id)) return null;

  const seenKeys = new Set<string>();
  const parameters: ManualDeadlineCycleParameterDefinition[] = [];
  for (const definition of version.parameterDefinitions) {
    const parsed = asSafeParameterDefinition(definition, actor.tenantId, version.id, seenKeys);
    if (!parsed) return null;
    parameters.push(parsed);
  }

  return {
    id: typeof association.id === 'string' ? association.id : '',
    ruleId: value.id,
    enabled: true,
    parameterValues: association.parameterValues,
    scheduleEntries: scheduleEntries.data,
    rule: {
      id: value.id,
      code: value.code,
      name: value.name,
      isActive: true,
      archivedAt: null,
      currentVersionId: value.currentVersionId,
      currentVersion: {
        id: version.id,
        version: version.version,
        state: 'PUBLISHED',
        configHash: version.configHash,
        recurrence: version.recurrence,
        applicability: version.applicability,
        parameters: parameters.sort((left, right) => left.displayOrder - right.displayOrder || left.key.localeCompare(right.key)),
      },
    },
  };
}

/**
 * Load only the rule configuration that the manual-cycle selector can safely
 * disclose. The company scope is part of the SQL predicate, so an inaccessible
 * existing service and a missing service take the same not-found path.
 */
export async function getManualDeadlineCycleOptions(
  clientServiceId: string,
  actor: ManualCycleActor,
): Promise<ManualDeadlineCycleOptions> {
  const companyIds = actor.allCompaniesAccess ? undefined : actor.accessibleCompanyIds ?? [];
  const delegate = prisma.clientService as unknown as { findFirst?: (args: unknown) => Promise<unknown> };
  if (!delegate.findFirst) throw new NotFoundError('Client service not found');

  const raw = await delegate.findFirst({
    where: {
      id: clientServiceId,
      tenantId: actor.tenantId,
      deletedAt: null,
      company: {
        tenantId: actor.tenantId,
        deletedAt: null,
        ...(companyIds ? { id: { in: companyIds } } : {}),
      },
    },
    select: {
      id: true,
      tenantId: true,
      companyId: true,
      deadlineRules: {
        where: { tenantId: actor.tenantId, clientServiceId, enabled: true },
        select: {
          id: true,
          tenantId: true,
          clientServiceId: true,
          ruleId: true,
          enabled: true,
          parameterValues: true,
          scheduleEntries: true,
          rule: {
            select: {
              id: true,
              tenantId: true,
              code: true,
              name: true,
              isActive: true,
              archivedAt: true,
              currentVersionId: true,
              currentVersion: {
                select: {
                  id: true,
                  tenantId: true,
                  ruleId: true,
                  version: true,
                  state: true,
                  configHash: true,
                  recurrence: true,
                  applicability: true,
                  parameterDefinitions: {
                    where: { tenantId: actor.tenantId },
                    select: {
                      tenantId: true,
                      ruleVersionId: true,
                      key: true,
                      label: true,
                      type: true,
                      isRequired: true,
                      defaultValue: true,
                      validation: true,
                      helpText: true,
                      displayOrder: true,
                    },
                    orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }],
                  },
                  milestoneTemplates: {
                    select: { tenantId: true, ruleVersionId: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!isRecord(raw) || raw.id !== clientServiceId || raw.tenantId !== actor.tenantId || typeof raw.companyId !== 'string') {
    throw new NotFoundError('Client service not found');
  }

  const associations = Array.isArray(raw.deadlineRules) ? raw.deadlineRules : [];
  const rules: ManualDeadlineCycleRuleOption[] = [];
  for (const candidate of associations) {
    if (!isRecord(candidate)) continue;
    const association = candidate as RawAssociation;
    const parsed = asSafeRule(association.rule, association, actor, clientServiceId);
    if (parsed && parsed.id) rules.push(parsed);
  }

  return { clientServiceId, companyId: raw.companyId, rules };
}
