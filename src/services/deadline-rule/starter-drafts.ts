import { Prisma } from '@/generated/prisma';
import type { CanonicalDeadlineRuleDefinition } from './canonical';
import { hashDeadlineRuleDefinition } from './canonical';
import { SG_ECI_PRESET, SG_FORM_C_PRESET } from './presets';

export const STARTER_CALENDAR_NAME = 'Singapore Business Calendar';

const annualRecurrence = {
  schemaVersion: 1,
  kind: 'ANNUALLY',
} as const;

const applicability = {
  schemaVersion: 1 as const,
  kind: 'ALL' as const,
  conditions: [],
};

/**
 * The single source of truth for the four statutory starter drafts. Rule
 * rows, version rows, relational children, and hashes are all derived from
 * these complete canonical objects. ECI and the annual tax return use the
 * reviewed period-based presets.
 */
export const STARTER_DEFINITIONS: CanonicalDeadlineRuleDefinition[] = [
  {
    schemaVersion: 1,
    code: 'SG_AGM_DUE',
    name: 'Singapore AGM Due Date',
    description: 'Starter statutory AGM rule due one month before Company.accountsDueDate',
    recurrence: annualRecurrence,
    applicability,
    parameters: [],
    milestones: [{
      key: 'agm-due',
      name: 'AGM due date',
      description: null,
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_CYCLE',
      expression: {
        kind: 'ADD_MONTHS',
        source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' },
        amount: -1,
      },
      businessDayAdjustment: 'NONE',
      displayOrder: 0,
      isActive: true,
    }],
  },
  {
    schemaVersion: 1,
    code: 'SG_ANNUAL_RETURN',
    name: 'Singapore Annual Return',
    description: 'Starter statutory Annual Return rule sourced from Company.accountsDueDate',
    recurrence: annualRecurrence,
    applicability,
    parameters: [],
    milestones: [{
      key: 'annual-return-due',
      name: 'Annual Return due date',
      description: null,
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_CYCLE',
      expression: {
        kind: 'SOURCE',
        source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' },
      },
      businessDayAdjustment: 'NONE',
      displayOrder: 0,
      isActive: true,
    }],
  },
  SG_ECI_PRESET.definition,
  SG_FORM_C_PRESET.definition,
];

/**
 * Starter drafts shipped before the period-based presets. Untouched copies of
 * these exact drafts are upgraded in place; anything edited or published is
 * left for an impact-reviewed preset upgrade instead.
 */
export const PREVIOUS_STARTER_DEFINITIONS: CanonicalDeadlineRuleDefinition[] = [
  {
    schemaVersion: 1,
    code: 'SG_ECI',
    name: 'Singapore ECI',
    description: 'Starter statutory ECI rule requiring monthsAfterFye',
    recurrence: annualRecurrence,
    applicability,
    parameters: [{
      key: 'monthsAfterFye',
      label: 'Months after FYE',
      description: null,
      type: 'INTEGER',
      required: true,
    }],
    milestones: [{
      key: 'eci-due',
      name: 'ECI due date',
      description: null,
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_CYCLE',
      expression: {
        kind: 'ADD_MONTHS',
        source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
        amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
      },
      businessDayAdjustment: 'NONE',
      displayOrder: 0,
      isActive: true,
    }],
  },
  {
    schemaVersion: 1,
    code: 'SG_FORM_C',
    name: 'Singapore Form C',
    description: 'Starter statutory Form C rule due 30 November in the year following FYE',
    recurrence: annualRecurrence,
    applicability,
    parameters: [],
    milestones: [{
      key: 'form-c-due',
      name: 'Form C due date',
      description: null,
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_CYCLE',
      expression: {
        kind: 'FIXED_DATE_FROM_SOURCE_YEAR',
        source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
        yearOffset: 1,
        month: 11,
        day: 30,
      },
      businessDayAdjustment: 'NONE',
      displayOrder: 0,
      isActive: true,
    }],
  },
];

const LEGACY_FORM_C_STARTER_DESCRIPTION = 'Starter statutory Form C rule requiring monthsAfterFye';
export const LEGACY_FORM_C_STARTER_HASH = '5f7f8c126d394bcf24e1cb3303e78f9e0508bf39a431b9e049a3ac884fcbe23c';

function isLegacyFormCExpression(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const expression = value as Record<string, unknown>;
  if (expression.kind !== 'ADD_MONTHS') return false;
  const source = expression.source;
  const amount = expression.amount;
  return typeof source === 'object'
    && source !== null
    && !Array.isArray(source)
    && (source as Record<string, unknown>).kind === 'COMPANY_FIELD'
    && (source as Record<string, unknown>).field === 'financialYearEnd'
    && typeof amount === 'object'
    && amount !== null
    && !Array.isArray(amount)
    && (amount as Record<string, unknown>).kind === 'INTEGER_PARAMETER'
    && (amount as Record<string, unknown>).key === 'monthsAfterFye';
}

/**
 * Compatibility repair for workspaces created before Form C was modelled as
 * a fixed 30 November deadline. It only changes the exact untouched starter
 * draft; published and customized rules are intentionally left alone.
 */
export async function upgradeLegacyFormCStarterDraft(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<boolean> {
  const rule = await tx.deadlineRule.findFirst({
    where: {
      tenantId,
      code: 'SG_FORM_C',
      name: 'Singapore Form C',
      description: LEGACY_FORM_C_STARTER_DESCRIPTION,
      isActive: true,
      archivedAt: null,
      currentVersionId: null,
    },
    select: {
      id: true,
      versions: {
        where: { version: 0, state: 'DRAFT' },
        take: 1,
        select: {
          id: true,
          schemaVersion: true,
          recurrence: true,
          applicability: true,
          configHash: true,
          draftRevision: true,
          parameterDefinitions: {
            select: {
              id: true,
              key: true,
              label: true,
              type: true,
              isRequired: true,
              defaultValue: true,
              validation: true,
              helpText: true,
              displayOrder: true,
            },
          },
          milestoneTemplates: {
            select: {
              id: true,
              milestoneKey: true,
              name: true,
              description: true,
              type: true,
              generationMode: true,
              dateExpression: true,
              businessDayAdjustment: true,
              displayOrder: true,
              isActive: true,
            },
          },
        },
      },
      variantAssociations: {
        where: { archivedAt: null },
        select: { id: true, parameterDefaults: true },
      },
      clientAssociations: {
        select: { id: true, parameterValues: true, parameterProvenance: true },
      },
    },
  });

  const draft = rule?.versions?.[0];
  if (!rule || !draft || draft.configHash !== LEGACY_FORM_C_STARTER_HASH || draft.draftRevision !== 1) return false;
  const recurrence = draft.recurrence as Record<string, unknown>;
  const applicability = draft.applicability as Record<string, unknown>;
  if (
    draft.schemaVersion !== 1
    || recurrence.schemaVersion !== 1
    || recurrence.kind !== 'ANNUALLY'
    || Object.keys(recurrence).length !== 2
    || applicability.schemaVersion !== 1
    || applicability.kind !== 'ALL'
    || !Array.isArray(applicability.conditions)
    || applicability.conditions.length !== 0
  ) return false;
  if (
    draft.parameterDefinitions.length !== 1
    || draft.parameterDefinitions[0]?.key !== 'monthsAfterFye'
    || draft.parameterDefinitions[0]?.label !== 'Months after FYE'
    || draft.parameterDefinitions[0]?.type !== 'INTEGER'
    || draft.parameterDefinitions[0]?.isRequired !== true
    || draft.parameterDefinitions[0]?.defaultValue !== null
    || draft.parameterDefinitions[0]?.validation !== null
    || draft.parameterDefinitions[0]?.helpText !== null
    || draft.parameterDefinitions[0]?.displayOrder !== 0
  ) return false;
  if (
    draft.milestoneTemplates.length !== 1
    || draft.milestoneTemplates[0]?.milestoneKey !== 'form-c-due'
    || draft.milestoneTemplates[0]?.name !== 'Form C due date'
    || draft.milestoneTemplates[0]?.description !== null
    || draft.milestoneTemplates[0]?.type !== 'STATUTORY'
    || draft.milestoneTemplates[0]?.generationMode !== 'ONCE_PER_CYCLE'
    || draft.milestoneTemplates[0]?.businessDayAdjustment !== 'NONE'
    || draft.milestoneTemplates[0]?.displayOrder !== 0
    || draft.milestoneTemplates[0]?.isActive !== true
    || !isLegacyFormCExpression(draft.milestoneTemplates[0]?.dateExpression)
  ) return false;

  const definition = PREVIOUS_STARTER_DEFINITIONS.find((candidate) => candidate.code === 'SG_FORM_C');
  if (!definition) throw new Error('SG_FORM_C previous starter definition is missing');
  const milestone = definition.milestones[0];
  if (!milestone) throw new Error('SG_FORM_C starter milestone is missing');

  await tx.deadlineRuleParameterDefinition.deleteMany({
    where: { tenantId, ruleVersionId: draft.id, key: 'monthsAfterFye' },
  });
  await tx.deadlineMilestoneTemplate.update({
    where: { id: draft.milestoneTemplates[0].id },
    data: { dateExpression: milestone.expression },
  });

  await removeParameterFromAssociations(tx, rule, 'monthsAfterFye');

  await tx.deadlineRule.update({
    where: { id: rule.id },
    data: { description: definition.description },
  });
  await tx.deadlineRuleVersion.update({
    where: { id: draft.id },
    data: {
      configHash: hashDeadlineRuleDefinition(definition),
      draftRevision: { increment: 1 },
    },
  });
  return true;
}

type StarterAssociations = {
  variantAssociations: Array<{ id: string; parameterDefaults: unknown }>;
  clientAssociations: Array<{ id: string; parameterValues: unknown; parameterProvenance: unknown }>;
};

/** Drop a parameter a starter no longer defines from catalog and client values. */
async function removeParameterFromAssociations(
  tx: Prisma.TransactionClient,
  rule: StarterAssociations,
  key: string,
): Promise<void> {
  for (const association of rule.variantAssociations) {
    const defaults = typeof association.parameterDefaults === 'object'
      && association.parameterDefaults !== null
      && !Array.isArray(association.parameterDefaults)
      ? { ...(association.parameterDefaults as Record<string, unknown>) }
      : {};
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
    delete defaults[key];
    await tx.serviceVariantDeadlineRule.update({
      where: { id: association.id },
      data: { parameterDefaults: defaults as Prisma.InputJsonValue },
    });
  }

  for (const association of rule.clientAssociations) {
    const values = typeof association.parameterValues === 'object'
      && association.parameterValues !== null
      && !Array.isArray(association.parameterValues)
      ? { ...(association.parameterValues as Record<string, unknown>) }
      : {};
    const provenance = typeof association.parameterProvenance === 'object'
      && association.parameterProvenance !== null
      && !Array.isArray(association.parameterProvenance)
      ? { ...(association.parameterProvenance as Record<string, unknown>) }
      : {};
    const hadValue = Object.prototype.hasOwnProperty.call(values, key);
    const hadProvenance = Object.prototype.hasOwnProperty.call(provenance, key);
    if (!hadValue && !hadProvenance) continue;
    delete values[key];
    delete provenance[key];
    await tx.clientServiceDeadlineRule.update({
      where: { id: association.id },
      data: {
        parameterValues: values as Prisma.InputJsonValue,
        parameterProvenance: provenance as Prisma.InputJsonValue,
      },
    });
  }

}

/**
 * Move an untouched copy of a previous starter draft to its reviewed preset.
 * The draft must still hash to the exact previous starter definition and the
 * rule must never have been published; otherwise nothing changes and staff
 * upgrade through the preset draft and normal impact-reviewed publish.
 */
export async function upgradeUntouchedStarterDraftToPreset(
  tx: Prisma.TransactionClient,
  tenantId: string,
  code: 'SG_ECI' | 'SG_FORM_C',
): Promise<boolean> {
  const previous = PREVIOUS_STARTER_DEFINITIONS.find((candidate) => candidate.code === code);
  const next = STARTER_DEFINITIONS.find((candidate) => candidate.code === code);
  if (!previous || !next) throw new Error(`${code} starter definitions are missing`);

  const rule = await tx.deadlineRule.findFirst({
    where: {
      tenantId,
      code,
      name: previous.name,
      description: previous.description,
      isActive: true,
      archivedAt: null,
      currentVersionId: null,
    },
    select: {
      id: true,
      versions: {
        select: { id: true, version: true, state: true, configHash: true },
      },
      variantAssociations: {
        where: { archivedAt: null },
        select: { id: true, parameterDefaults: true },
      },
      clientAssociations: {
        select: { id: true, parameterValues: true, parameterProvenance: true },
      },
    },
  });
  const versions = rule?.versions ?? [];
  const draft = versions[0];
  if (
    !rule
    || versions.length !== 1
    || !draft
    || draft.version !== 0
    || draft.state !== 'DRAFT'
    || draft.configHash !== hashDeadlineRuleDefinition(previous)
  ) return false;

  const nextParameterKeys = new Set(next.parameters.map((parameter) => parameter.key));
  for (const parameter of previous.parameters) {
    if (!nextParameterKeys.has(parameter.key)) {
      await removeParameterFromAssociations(tx, rule, parameter.key);
    }
  }

  const versionData = createVersionData(tenantId, rule.id, next);
  await tx.deadlineRuleVersion.update({
    where: { id: draft.id },
    data: {
      configHash: hashDeadlineRuleDefinition(next),
      draftRevision: { increment: 1 },
      parameterDefinitions: {
        deleteMany: { ruleVersionId: draft.id },
        create: versionData.parameterDefinitions?.create as never,
      },
      milestoneTemplates: {
        deleteMany: { ruleVersionId: draft.id },
        create: versionData.milestoneTemplates?.create as never,
      },
    },
  });
  await tx.deadlineRule.update({
    where: { id: rule.id },
    data: { name: next.name, description: next.description },
  });
  return true;
}

function createVersionData(
  tenantId: string,
  ruleId: string,
  definition: CanonicalDeadlineRuleDefinition,
): Prisma.DeadlineRuleVersionCreateInput {
  return {
    tenant: { connect: { id: tenantId } },
    rule: { connect: { id: ruleId } },
    version: 0,
    state: 'DRAFT',
    schemaVersion: definition.schemaVersion,
    recurrence: definition.recurrence,
    applicability: definition.applicability,
    configHash: hashDeadlineRuleDefinition(definition),
    draftRevision: 1,
    parameterDefinitions: {
      create: definition.parameters.map((parameter, index) => ({
        tenant: { connect: { id: tenantId } },
        key: parameter.key,
        label: parameter.label,
        type: parameter.type,
        isRequired: parameter.required,
        defaultValue: Prisma.DbNull,
        validation: parameter.options === undefined
          ? Prisma.DbNull
          : { options: parameter.options },
        helpText: parameter.description,
        displayOrder: index,
      })),
    },
    milestoneTemplates: {
      create: definition.milestones.map((milestone) => ({
        tenant: { connect: { id: tenantId } },
        milestoneKey: milestone.key,
        name: milestone.name,
        description: milestone.description,
        type: milestone.type,
        generationMode: milestone.generationMode,
        dateExpression: milestone.expression,
        businessDayAdjustment: milestone.businessDayAdjustment,
        displayOrder: milestone.displayOrder,
        isActive: milestone.isActive,
      })),
    },
  };
}

async function ensureStarterRule(
  tx: Prisma.TransactionClient,
  tenantId: string,
  definition: CanonicalDeadlineRuleDefinition,
): Promise<void> {
  let rule = await tx.deadlineRule.findFirst({
    where: { tenantId, code: definition.code },
  });
  if (!rule) {
    rule = await tx.deadlineRule.create({
      data: {
        tenantId,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        isActive: true,
      },
    });
  } else if (
    rule.name !== definition.name
    || rule.description !== definition.description
    || rule.isActive === false
    || rule.archivedAt !== null && rule.archivedAt !== undefined
  ) {
    // A pre-existing custom same-code rule is never mutated by provisioning.
    return;
  }

  const draft = await tx.deadlineRuleVersion.findFirst({
    where: { tenantId, ruleId: rule.id, state: 'DRAFT' },
  });
  if (draft || rule.currentVersionId) return;

  await tx.deadlineRuleVersion.create({
    data: createVersionData(tenantId, rule.id, definition),
  });
}

/**
 * Provision the schedule foundation for a newly-created workspace. Every
 * operation is performed against the caller's transaction client so a tenant
 * cannot become visible without its calendar and four unpublished drafts.
 */
export async function createServiceScheduleStarterData(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  const calendar = await tx.businessCalendar.findFirst({
    where: { tenantId, name: STARTER_CALENDAR_NAME },
  });
  if (!calendar) {
    await tx.businessCalendar.create({
      data: {
        tenantId,
        name: STARTER_CALENDAR_NAME,
        jurisdictionCode: 'SG',
        timeZone: 'Asia/Singapore',
        weekendDays: [0, 6],
        revision: 1,
        isActive: true,
      },
    });
  }

  await upgradeLegacyFormCStarterDraft(tx, tenantId);
  await upgradeUntouchedStarterDraftToPreset(tx, tenantId, 'SG_ECI');
  await upgradeUntouchedStarterDraftToPreset(tx, tenantId, 'SG_FORM_C');

  for (const definition of STARTER_DEFINITIONS) {
    await ensureStarterRule(tx, tenantId, definition);
  }
}
