import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma';

import {
  LEGACY_FORM_C_STARTER_HASH,
  PREVIOUS_STARTER_DEFINITIONS,
  STARTER_DEFINITIONS,
  createServiceScheduleStarterData,
  upgradeLegacyFormCStarterDraft,
  upgradeUntouchedStarterDraftToPreset,
} from '@/services/deadline-rule/starter-drafts';
import { hashDeadlineRuleDefinition } from '@/services/deadline-rule/canonical';
import { SG_ECI_PRESET, SG_FORM_C_PRESET } from '@/services/deadline-rule/presets';

const tenantId = '11111111-1111-4111-8111-111111111111';

const databaseNull = { storage: 'DATABASE_NULL' } as const;

function normalizeNullableJson(value: unknown): unknown {
  if (value === Prisma.DbNull) return databaseNull;
  if (value === Prisma.JsonNull) return { storage: 'JSON_NULL' };
  return value;
}

const tx = {
  businessCalendar: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  deadlineRule: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  deadlineRuleVersion: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  deadlineRuleParameterDefinition: {
    deleteMany: vi.fn(),
  },
  deadlineMilestoneTemplate: {
    update: vi.fn(),
  },
  serviceVariantDeadlineRule: {
    update: vi.fn(),
  },
  clientServiceDeadlineRule: {
    update: vi.fn(),
  },
};

describe('deadline rule starter definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.businessCalendar.findFirst.mockResolvedValue(null);
    tx.businessCalendar.create.mockResolvedValue({ id: 'calendar-1' });
    tx.deadlineRule.findFirst.mockResolvedValue(null);
    tx.deadlineRule.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `${String(data.code).toLowerCase()}-rule`,
      ...data,
    }));
    tx.deadlineRuleVersion.findFirst.mockResolvedValue(null);
    tx.deadlineRuleVersion.create.mockResolvedValue({ id: 'draft-1' });
  });

  it('contains the exact four canonical unpublished starter contents and stable hashes', () => {
    expect(STARTER_DEFINITIONS.map((definition) => definition.code)).toEqual([
      'SG_AGM_DUE',
      'SG_ANNUAL_RETURN',
      'SG_ECI',
      'SG_FORM_C',
    ]);
    expect(STARTER_DEFINITIONS.map((definition) => hashDeadlineRuleDefinition(definition))).toEqual([
      '5064178cfb8a0675bd7a4520c5e91e5e64c0b5f0097b97794d63ebbd52e5380d',
      'babbb099210ec2afbfaf460482b2200f609ea894dd4fda1b08bc5b6e6116797f',
      hashDeadlineRuleDefinition(SG_ECI_PRESET.definition),
      hashDeadlineRuleDefinition(SG_FORM_C_PRESET.definition),
    ]);
    // The drafts shipped before the presets keep their exact fingerprints so
    // untouched copies can still be recognised and upgraded.
    expect(PREVIOUS_STARTER_DEFINITIONS.map((definition) => hashDeadlineRuleDefinition(definition))).toEqual([
      '4124dcf4fcc2a1894d4517bc099d5d1c146587b3ad573eae1474cfb8ea134f2b',
      '75075fada015d102dadd965553bc82b67ba5362359c9994a0ac5e8217a7b06f4',
    ]);

    const [agm, annualReturn, eci, formC] = STARTER_DEFINITIONS;
    expect(agm).toMatchObject({
      name: 'Singapore AGM Due Date',
      description: 'Starter statutory AGM rule due one month before Company.accountsDueDate',
      parameters: [],
      milestones: [{
        key: 'agm-due',
        expression: {
          kind: 'ADD_MONTHS',
          source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' },
          amount: -1,
        },
      }],
    });
    expect(annualReturn.milestones[0]?.expression).toEqual({
      kind: 'SOURCE',
      source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' },
    });
    expect(eci.parameters).toEqual([]);
    expect(eci.milestones[0]?.expression).toEqual({
      kind: 'ADD_MONTHS_MONTH_END',
      source: { kind: 'OBLIGATION_PERIOD_END' },
      amount: 3,
    });
    expect(formC.parameters).toEqual([]);
    expect(formC.milestones[0]?.expression).toEqual({
      kind: 'FIXED_DATE_IN_ASSESSMENT_YEAR',
      month: 11,
      day: 30,
    });
  });

  it('derives all four relational drafts from the canonical objects and leaves them unattached', async () => {
    await createServiceScheduleStarterData(tx as never, tenantId);

    expect(tx.businessCalendar.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        name: 'Singapore Business Calendar',
        jurisdictionCode: 'SG',
        timeZone: 'Asia/Singapore',
        weekendDays: [0, 6],
      }),
    });
    expect(tx.deadlineRule.create).toHaveBeenCalledTimes(4);
    expect(tx.deadlineRuleVersion.create).toHaveBeenCalledTimes(4);
    expect(tx.deadlineRuleVersion.create.mock.calls.map(([arg]) => arg.data.configHash)).toEqual(
      STARTER_DEFINITIONS.map((definition) => hashDeadlineRuleDefinition(definition)),
    );
    for (const [arg] of tx.deadlineRuleVersion.create.mock.calls) {
      expect(arg.data).not.toHaveProperty('serviceVariantDeadlineRule');
      expect(arg.data).toMatchObject({ state: 'DRAFT', version: 0, draftRevision: 1 });
    }
  });

  it('keeps runtime starter rows canonical while retaining the legacy Form C seed fingerprint', async () => {
    await createServiceScheduleStarterData(tx as never, tenantId);

    const expectedParameter = {
      tenantId,
      key: 'monthsAfterFye',
      label: 'Months after FYE',
      type: 'INTEGER',
      isRequired: true,
      defaultValue: databaseNull,
      validation: databaseNull,
      helpText: null,
      displayOrder: 0,
    };
    const expectedMilestones = [
      {
        tenantId,
        milestoneKey: 'agm-due',
        name: 'AGM due date',
        description: null,
        type: 'STATUTORY',
        generationMode: 'ONCE_PER_CYCLE',
        dateExpression: {
          kind: 'ADD_MONTHS',
          source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' },
          amount: -1,
        },
        businessDayAdjustment: 'NONE',
        displayOrder: 0,
        isActive: true,
      },
      {
        tenantId,
        milestoneKey: 'annual-return-due',
        name: 'Annual Return due date',
        description: null,
        type: 'STATUTORY',
        generationMode: 'ONCE_PER_CYCLE',
        dateExpression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
        businessDayAdjustment: 'NONE',
        displayOrder: 0,
        isActive: true,
      },
      {
        tenantId,
        milestoneKey: 'eci-due',
        name: 'ECI due date',
        description: 'Within three months after the financial year ends',
        type: 'STATUTORY',
        generationMode: 'ONCE_PER_CYCLE',
        dateExpression: {
          kind: 'ADD_MONTHS_MONTH_END',
          source: { kind: 'OBLIGATION_PERIOD_END' },
          amount: 3,
        },
        businessDayAdjustment: 'NONE',
        displayOrder: 0,
        isActive: true,
      },
      {
        tenantId,
        milestoneKey: 'form-c-due',
        name: 'Corporate income tax return due date',
        description: '30 November of the Year of Assessment',
        type: 'STATUTORY',
        generationMode: 'ONCE_PER_CYCLE',
        dateExpression: {
          kind: 'FIXED_DATE_IN_ASSESSMENT_YEAR',
          month: 11,
          day: 30,
        },
        businessDayAdjustment: 'NONE',
        displayOrder: 0,
        isActive: true,
      },
    ];
    const migration = [
      'prisma/migrations/20260817101000_deadline_rule_starter_drafts/migration.sql',
      'prisma/migrations/20260826171000_remove_duplicate_company_deadline_dates/migration.sql',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(migration).toContain(
      '"is_required", "default_value", "validation", "display_order",',
    );
    expect(migration).toContain(
      "'INTEGER', TRUE, NULL, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP",
    );
    expect(migration).toContain('WHERE r."code" IN (\'SG_ECI\', \'SG_FORM_C\')');
    expect(migration).toContain(LEGACY_FORM_C_STARTER_HASH);
    expect(migration).toContain(JSON.stringify({
      kind: 'ADD_MONTHS',
      source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
      amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
    }));
    expect(migration).toContain(
      '"type", "generation_mode", "date_expression", "business_day_adjustment",',
    );
    expect(migration).toContain(
      "'STATUTORY', 'ONCE_PER_CYCLE', starter.\"date_expression\"::jsonb, 'NONE',",
    );

    for (const [index, definition] of STARTER_DEFINITIONS.entries()) {
      const versionData = tx.deadlineRuleVersion.create.mock.calls[index]?.[0]?.data;
      expect(versionData).toBeDefined();
      const actualParameters = versionData.parameterDefinitions.create.map((row: Record<string, unknown>) => ({
        tenantId: (row.tenant as { connect: { id: string } }).connect.id,
        key: row.key,
        label: row.label,
        type: row.type,
        isRequired: row.isRequired,
        defaultValue: normalizeNullableJson(row.defaultValue),
        validation: normalizeNullableJson(row.validation),
        helpText: row.helpText,
        displayOrder: row.displayOrder,
      }));
      const actualMilestones = versionData.milestoneTemplates.create.map((row: Record<string, unknown>) => ({
        tenantId: (row.tenant as { connect: { id: string } }).connect.id,
        milestoneKey: row.milestoneKey,
        name: row.name,
        description: row.description,
        type: row.type,
        generationMode: row.generationMode,
        dateExpression: row.dateExpression,
        businessDayAdjustment: row.businessDayAdjustment,
        displayOrder: row.displayOrder,
        isActive: row.isActive,
      }));

      expect(actualParameters).toEqual(definition.parameters.length === 0 ? [] : [expectedParameter]);
      expect(actualMilestones).toEqual([expectedMilestones[index]]);
      const expectedMilestone = expectedMilestones[index];
      if (definition.code !== 'SG_FORM_C' && definition.code !== 'SG_ECI') {
        expect(migration).toContain(hashDeadlineRuleDefinition(definition));
        expect(migration).toContain(JSON.stringify(expectedMilestone.dateExpression));
      }
      for (const row of versionData.parameterDefinitions.create) {
        expect(row.defaultValue).toBe(Prisma.DbNull);
        expect(row.validation).toBe(Prisma.DbNull);
      }
    }
  });

  it('upgrades only the exact untouched legacy Form C starter draft', async () => {
    tx.deadlineRule.findFirst.mockResolvedValue({
      id: 'legacy-form-c-rule',
      versions: [{
        id: 'legacy-form-c-draft',
        schemaVersion: 1,
        recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
        applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
        configHash: LEGACY_FORM_C_STARTER_HASH,
        draftRevision: 1,
        parameterDefinitions: [{
          id: 'legacy-param',
          key: 'monthsAfterFye',
          label: 'Months after FYE',
          type: 'INTEGER',
          isRequired: true,
          defaultValue: null,
          validation: null,
          helpText: null,
          displayOrder: 0,
        }],
        milestoneTemplates: [{
          id: 'legacy-milestone',
          milestoneKey: 'form-c-due',
          name: 'Form C due date',
          description: null,
          type: 'STATUTORY',
          generationMode: 'ONCE_PER_CYCLE',
          dateExpression: {
            kind: 'ADD_MONTHS',
            source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
            amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
          },
          businessDayAdjustment: 'NONE',
          displayOrder: 0,
          isActive: true,
        }],
      }],
      variantAssociations: [{
        id: 'association-1',
        parameterDefaults: { monthsAfterFye: 10, keepMe: 'yes' },
      }],
      clientAssociations: [{
        id: 'client-association-1',
        parameterValues: { monthsAfterFye: 10, keepMe: 'yes' },
        parameterProvenance: { monthsAfterFye: 'DEFAULT', keepMe: 'MANUAL' },
      }],
    });
    tx.deadlineRuleParameterDefinition.deleteMany.mockResolvedValue({ count: 1 });
    tx.deadlineMilestoneTemplate.update.mockResolvedValue({ id: 'legacy-milestone' });
    tx.serviceVariantDeadlineRule.update.mockResolvedValue({ id: 'association-1' });
    tx.clientServiceDeadlineRule.update.mockResolvedValue({ id: 'client-association-1' });
    tx.deadlineRule.update.mockResolvedValue({ id: 'legacy-form-c-rule' });
    tx.deadlineRuleVersion.update.mockResolvedValue({ id: 'legacy-form-c-draft' });

    await expect(upgradeLegacyFormCStarterDraft(tx as never, tenantId)).resolves.toBe(true);

    expect(tx.deadlineRuleParameterDefinition.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, ruleVersionId: 'legacy-form-c-draft', key: 'monthsAfterFye' },
    });
    expect(tx.deadlineMilestoneTemplate.update).toHaveBeenCalledWith({
      where: { id: 'legacy-milestone' },
      data: {
        dateExpression: {
          kind: 'FIXED_DATE_FROM_SOURCE_YEAR',
          source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
          yearOffset: 1,
          month: 11,
          day: 30,
        },
      },
    });
    expect(tx.serviceVariantDeadlineRule.update).toHaveBeenCalledWith({
      where: { id: 'association-1' },
      data: { parameterDefaults: { keepMe: 'yes' } },
    });
    expect(tx.clientServiceDeadlineRule.update).toHaveBeenCalledWith({
      where: { id: 'client-association-1' },
      data: {
        parameterValues: { keepMe: 'yes' },
        parameterProvenance: { keepMe: 'MANUAL' },
      },
    });
    expect(tx.deadlineRuleVersion.update).toHaveBeenCalledWith({
      where: { id: 'legacy-form-c-draft' },
      data: {
        configHash: '75075fada015d102dadd965553bc82b67ba5362359c9994a0ac5e8217a7b06f4',
        draftRevision: { increment: 1 },
      },
    });
  });

  it('leaves customized Form C drafts untouched', async () => {
    tx.deadlineRule.findFirst.mockResolvedValue({
      id: 'custom-form-c-rule',
      versions: [{
        id: 'custom-form-c-draft',
        configHash: 'a'.repeat(64),
        draftRevision: 2,
        parameterDefinitions: [],
        milestoneTemplates: [],
      }],
      variantAssociations: [],
      clientAssociations: [],
    });

    await expect(upgradeLegacyFormCStarterDraft(tx as never, tenantId)).resolves.toBe(false);
    expect(tx.deadlineRuleParameterDefinition.deleteMany).not.toHaveBeenCalled();
    expect(tx.deadlineMilestoneTemplate.update).not.toHaveBeenCalled();
    expect(tx.deadlineRuleVersion.update).not.toHaveBeenCalled();
  });

  it('is repeat-idempotent when the calendar and draft rows already exist', async () => {
    tx.businessCalendar.findFirst.mockResolvedValue({ id: 'calendar-1' });
    tx.deadlineRule.findFirst.mockResolvedValue({ id: 'existing-rule' });
    tx.deadlineRuleVersion.findFirst.mockResolvedValue({ id: 'existing-draft' });

    await createServiceScheduleStarterData(tx as never, tenantId);

    expect(tx.businessCalendar.create).not.toHaveBeenCalled();
    expect(tx.deadlineRule.create).not.toHaveBeenCalled();
    expect(tx.deadlineRuleVersion.create).not.toHaveBeenCalled();
  });

  it('does not mutate a pre-existing custom same-code rule', async () => {
    tx.businessCalendar.findFirst.mockResolvedValue({ id: 'calendar-1' });
    tx.deadlineRule.findFirst.mockResolvedValue({
      id: 'custom-rule',
      name: 'Custom AGM',
      description: 'Tenant-authored rule',
      isActive: true,
      archivedAt: null,
      currentVersionId: null,
    });

    await createServiceScheduleStarterData(tx as never, tenantId);

    expect(tx.deadlineRule.create).not.toHaveBeenCalled();
    expect(tx.deadlineRuleVersion.findFirst).not.toHaveBeenCalled();
    expect(tx.deadlineRuleVersion.create).not.toHaveBeenCalled();
  });

  it('moves an untouched previous ECI starter draft to the reviewed preset', async () => {
    const previous = PREVIOUS_STARTER_DEFINITIONS[0]!;
    tx.deadlineRule.findFirst.mockResolvedValueOnce({
      id: 'eci-rule',
      versions: [{ id: 'eci-draft', version: 0, state: 'DRAFT', configHash: hashDeadlineRuleDefinition(previous) }],
      variantAssociations: [{ id: 'variant-link', parameterDefaults: { monthsAfterFye: 3, other: 1 } }],
      clientAssociations: [{ id: 'client-link', parameterValues: { monthsAfterFye: 3 }, parameterProvenance: { monthsAfterFye: 'CATALOG_DEFAULT' } }],
    });

    await expect(upgradeUntouchedStarterDraftToPreset(tx as never, tenantId, 'SG_ECI')).resolves.toBe(true);

    expect(tx.deadlineRule.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ code: 'SG_ECI', name: previous.name, description: previous.description, currentVersionId: null }),
    }));
    expect(tx.serviceVariantDeadlineRule.update).toHaveBeenCalledWith({ where: { id: 'variant-link' }, data: { parameterDefaults: { other: 1 } } });
    expect(tx.clientServiceDeadlineRule.update).toHaveBeenCalledWith({
      where: { id: 'client-link' },
      data: { parameterValues: {}, parameterProvenance: {} },
    });
    const versionUpdate = tx.deadlineRuleVersion.update.mock.calls[0]?.[0];
    expect(versionUpdate.data.configHash).toBe(hashDeadlineRuleDefinition(SG_ECI_PRESET.definition));
    expect(versionUpdate.data.parameterDefinitions.create).toEqual([]);
    expect(versionUpdate.data.milestoneTemplates.create[0].dateExpression).toEqual(SG_ECI_PRESET.definition.milestones[0]!.expression);
    expect(tx.deadlineRule.update).toHaveBeenCalledWith({
      where: { id: 'eci-rule' },
      data: { name: SG_ECI_PRESET.definition.name, description: SG_ECI_PRESET.definition.description },
    });
  });

  it('leaves an edited or published ECI draft for the reviewed upgrade flow', async () => {
    tx.deadlineRule.findFirst.mockResolvedValueOnce({
      id: 'eci-rule',
      versions: [{ id: 'eci-draft', version: 0, state: 'DRAFT', configHash: 'edited' }],
      variantAssociations: [],
      clientAssociations: [],
    });
    await expect(upgradeUntouchedStarterDraftToPreset(tx as never, tenantId, 'SG_ECI')).resolves.toBe(false);
    tx.deadlineRule.findFirst.mockResolvedValueOnce(null);
    await expect(upgradeUntouchedStarterDraftToPreset(tx as never, tenantId, 'SG_ECI')).resolves.toBe(false);
    expect(tx.deadlineRuleVersion.update).not.toHaveBeenCalled();
  });
});

describe('deadline rule starter migration', () => {
  it('uses the runtime canonical hashes and gates child inserts to exact seeded identities', () => {
    const migration = [
      'prisma/migrations/20260817101000_deadline_rule_starter_drafts/migration.sql',
      'prisma/migrations/20260826171000_remove_duplicate_company_deadline_dates/migration.sql',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');
    for (const definition of STARTER_DEFINITIONS.filter((candidate) => !['SG_FORM_C', 'SG_ECI'].includes(candidate.code))) {
      expect(migration).toContain(hashDeadlineRuleDefinition(definition));
    }
    // The seeded ECI draft is the pre-preset definition; runtime upgrades it.
    expect(migration).toContain(hashDeadlineRuleDefinition(PREVIOUS_STARTER_DEFINITIONS[0]!));
    expect(migration).toContain(LEGACY_FORM_C_STARTER_HASH);
    expect(migration).not.toContain(hashDeadlineRuleDefinition(
      STARTER_DEFINITIONS.find((candidate) => candidate.code === 'SG_FORM_C')!,
    ));
    expect(migration).not.toContain('repeat(md5(');
    expect(migration).toMatch(/NOT EXISTS[\s\S]*SELECT 1\s+FROM\s+"deadline_rule_versions"/);
    expect(migration).toMatch(/r\."archived_at" IS NULL/);
    expect(migration).toContain('v."config_hash" = starter."config_hash"');
    expect(migration).toContain("'ACCOUNTS_DUE_SOURCE_MIGRATION'");
    expect(migration).toContain("'TENANT'::\"ScheduleReconciliationScopeType\"");
  });
});
