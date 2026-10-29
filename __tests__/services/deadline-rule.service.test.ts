import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  deadlineRule: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  deadlineRuleVersion: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  serviceVariant: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  serviceVariantDeadlineRule: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
}));

const auditMock = vi.hoisted(() => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  computeChanges: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => auditMock);

import {
  createDeadlineRule,
  replaceVariantRuleAssociations,
  updateDeadlineRuleDraft,
} from '@/services/deadline-rule';
import { Prisma } from '@/generated/prisma';

const actor = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
};
const ruleInput = {
  code: 'SG_ECI',
  name: 'Estimated Chargeable Income',
  description: 'A starter rule',
  recurrence: { schemaVersion: 1 as const, kind: 'ANNUALLY' as const },
  applicability: { schemaVersion: 1 as const, kind: 'ALL' as const, conditions: [] },
  parameters: [{
    key: 'monthsAfterFye',
    label: 'Months after FYE',
    description: null,
    type: 'INTEGER' as const,
    required: true,
  }],
  milestones: [{
    key: 'eci-due',
    name: 'ECI due',
    description: null,
    type: 'STATUTORY' as const,
    generationMode: 'ONCE_PER_CYCLE' as const,
    expression: {
      kind: 'ADD_MONTHS' as const,
      source: { kind: 'COMPANY_FIELD' as const, field: 'financialYearEnd' as const },
      amount: { kind: 'INTEGER_PARAMETER' as const, key: 'monthsAfterFye' },
    },
    businessDayAdjustment: 'NONE' as const,
    displayOrder: 0,
    isActive: true,
  }],
};

describe('deadline rule service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (work: (tx: typeof prismaMock) => Promise<unknown>) => work(prismaMock));
  });

  it('creates one mutable draft with a canonical config hash', async () => {
    prismaMock.deadlineRule.create.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: actor.tenantId,
      code: ruleInput.code,
      name: ruleInput.name,
      description: ruleInput.description,
      isActive: true,
      archivedAt: null,
      currentVersionId: null,
      createdAt: new Date('2026-08-18T00:00:00.000Z'),
      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    });
    prismaMock.deadlineRuleVersion.create.mockResolvedValue({
      id: 'draft-1',
      tenantId: actor.tenantId,
      ruleId: '33333333-3333-4333-8333-333333333333',
      version: 0,
      state: 'DRAFT',
      schemaVersion: 1,
      recurrence: ruleInput.recurrence,
      applicability: ruleInput.applicability,
      configHash: 'a'.repeat(64),
      draftRevision: 1,
      parameterDefinitions: ruleInput.parameters,
      milestoneTemplates: ruleInput.milestones,
    });

    const result = await createDeadlineRule(ruleInput, actor);

    expect(prismaMock.deadlineRuleVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        state: 'DRAFT',
        draftRevision: 1,
        configHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
    const parameterCreate = prismaMock.deadlineRuleVersion.create.mock.calls[0]?.[0]?.data
      .parameterDefinitions.create[0];
    expect(parameterCreate.defaultValue).toBe(Prisma.DbNull);
    expect(parameterCreate.validation).toBe(Prisma.DbNull);
    expect(result.draft?.state).toBe('DRAFT');
  });

  it('rejects a stale draft revision', async () => {
    prismaMock.deadlineRule.findFirst.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: actor.tenantId,
      code: ruleInput.code,
      name: ruleInput.name,
      description: ruleInput.description,
      isActive: true,
      currentVersionId: null,
      versions: [{
        id: 'draft-1',
        tenantId: actor.tenantId,
        ruleId: '33333333-3333-4333-8333-333333333333',
        version: 0,
        state: 'DRAFT',
        draftRevision: 1,
        configHash: 'a'.repeat(64),
        parameterDefinitions: [],
        milestoneTemplates: [],
      }],
    });
    prismaMock.deadlineRuleVersion.findFirst.mockResolvedValue({
      id: 'draft-1',
      tenantId: actor.tenantId,
      ruleId: '33333333-3333-4333-8333-333333333333',
      version: 0,
      state: 'DRAFT',
      draftRevision: 1,
      configHash: 'a'.repeat(64),
      parameterDefinitions: [],
      milestoneTemplates: [],
    });
    prismaMock.deadlineRuleVersion.updateMany.mockResolvedValue({ count: 0 });

    await expect(updateDeadlineRuleDraft(
      '33333333-3333-4333-8333-333333333333',
      { ...ruleInput, expectedDraftRevision: 2 },
      actor,
    )).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('replaces only tenant-scoped variant rule associations', async () => {
    const ruleId = '11111111-1111-4111-8111-111111111111';
    prismaMock.serviceVariant.findFirst.mockResolvedValue({
      id: 'variant-1',
      tenantId: actor.tenantId,
      familyId: 'family-1',
      code: 'ACCOUNTING',
      name: 'Accounting',
      description: null,
      serviceCadence: 'MONTHLY',
      customCadenceLabel: null,
      displayOrder: 0,
      version: 1,
      isActive: true,
      sowPartial: { id: 'partial-1', name: 'SOW', displayName: null, version: 1, placeholders: {} },
      defaultFeeTemplates: [],
    });
    prismaMock.deadlineRule.findMany.mockResolvedValue([{ id: ruleId }]);
    prismaMock.serviceVariantDeadlineRule.findMany.mockResolvedValue([{
      id: 'association-1',
      serviceVariantId: 'variant-1',
      ruleId,
      enabledByDefault: true,
      parameterDefaults: {},
      scheduleDefaults: [],
      displayOrder: 0,
      archivedAt: null,
      createdAt: new Date('2026-08-18T00:00:00.000Z'),
    }]);

    const result = await replaceVariantRuleAssociations('variant-1', [{
      ruleId,
      enabledByDefault: true,
      parameterDefaults: {},
      scheduleDefaults: [],
      displayOrder: 0,
    }], actor);

    expect(prismaMock.serviceVariantDeadlineRule.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: actor.tenantId, serviceVariantId: 'variant-1' },
    });
    expect(prismaMock.serviceVariantDeadlineRule.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ tenantId: actor.tenantId, ruleId })],
    }));
    expect(result.deadlineRules?.[0]?.ruleId).toBe(ruleId);
  });

  it('rejects a draft update that attempts to change the immutable rule code', async () => {
    prismaMock.deadlineRule.findFirst.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: actor.tenantId,
      code: ruleInput.code,
      name: ruleInput.name,
      description: ruleInput.description,
      isActive: true,
      currentVersionId: null,
      versions: [{
        id: '44444444-4444-4444-8444-444444444444',
        tenantId: actor.tenantId,
        ruleId: '33333333-3333-4333-8333-333333333333',
        version: 0,
        state: 'DRAFT',
        draftRevision: 1,
        configHash: 'a'.repeat(64),
        parameterDefinitions: [],
        milestoneTemplates: [],
      }],
    });

    await expect(updateDeadlineRuleDraft(
      '33333333-3333-4333-8333-333333333333',
      { ...ruleInput, code: 'SG_FORM_C' },
      actor,
    )).rejects.toThrow(/immutable/i);
    expect(prismaMock.deadlineRuleVersion.updateMany).not.toHaveBeenCalled();
  });

  it('validates association defaults against the referenced usable rule parameters', async () => {
    const ruleId = '55555555-5555-4555-8555-555555555555';
    prismaMock.serviceVariant.findFirst.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666',
      tenantId: actor.tenantId,
      familyId: '77777777-7777-4777-8777-777777777777',
      code: 'ACCOUNTING',
      name: 'Accounting',
      description: null,
      serviceCadence: 'MONTHLY',
      customCadenceLabel: null,
      displayOrder: 0,
      version: 1,
      isActive: true,
      sowPartial: { id: '88888888-8888-4888-8888-888888888888', name: 'SOW', displayName: null, version: 1, placeholders: {} },
      defaultFeeTemplates: [],
    });
    prismaMock.deadlineRule.findMany.mockResolvedValue([{
      id: ruleId,
      currentVersion: {
        parameterDefinitions: [{ key: 'monthsAfterFye', type: 'INTEGER', validation: null }],
      },
      versions: [],
    }]);

    await expect(replaceVariantRuleAssociations(
      '66666666-6666-4666-8666-666666666666',
      [{
        ruleId,
        enabledByDefault: true,
        parameterDefaults: { monthsAfterFye: 'six' },
        scheduleDefaults: [],
        displayOrder: 0,
      }],
      actor,
    )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prismaMock.serviceVariantDeadlineRule.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects unknown defaults and enum values without a usable definition', async () => {
    const ruleId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    prismaMock.serviceVariant.findFirst.mockResolvedValue({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      tenantId: actor.tenantId,
      familyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      code: 'ACCOUNTING',
      name: 'Accounting',
      description: null,
      serviceCadence: 'MONTHLY',
      customCadenceLabel: null,
      displayOrder: 0,
      version: 1,
      isActive: true,
      sowPartial: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'SOW', displayName: null, version: 1, placeholders: {} },
      defaultFeeTemplates: [],
    });
    prismaMock.deadlineRule.findMany.mockResolvedValue([{
      id: ruleId,
      currentVersion: {
        parameterDefinitions: [{ key: 'status', type: 'ENUM', validation: null }],
      },
      versions: [],
    }]);

    await expect(replaceVariantRuleAssociations(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      [{ ruleId, enabledByDefault: true, parameterDefaults: { unknown: true }, scheduleDefaults: [], displayOrder: 0 }],
      actor,
    )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(replaceVariantRuleAssociations(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      [{ ruleId, enabledByDefault: true, parameterDefaults: { status: 'ACTIVE' }, scheduleDefaults: [], displayOrder: 0 }],
      actor,
    )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('records a bounded canonical before-and-after definition in draft update audits', async () => {
    const ruleId = '99999999-9999-4999-8999-999999999999';
    const draftId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    prismaMock.deadlineRule.findFirst.mockResolvedValue({
      id: ruleId,
      tenantId: actor.tenantId,
      code: ruleInput.code,
      name: ruleInput.name,
      description: ruleInput.description,
      isActive: true,
      currentVersionId: null,
      versions: [{
        id: draftId,
        tenantId: actor.tenantId,
        ruleId,
        version: 0,
        state: 'DRAFT',
        schemaVersion: 1,
        recurrence: ruleInput.recurrence,
        applicability: ruleInput.applicability,
        draftRevision: 1,
        configHash: 'a'.repeat(64),
        parameterDefinitions: ruleInput.parameters,
        milestoneTemplates: ruleInput.milestones,
      }],
      variantAssociations: [],
    });
    prismaMock.deadlineRuleVersion.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.deadlineRuleVersion.update.mockResolvedValue({
      id: draftId,
      tenantId: actor.tenantId,
      ruleId,
      version: 0,
      state: 'DRAFT',
      schemaVersion: 1,
      recurrence: ruleInput.recurrence,
      applicability: ruleInput.applicability,
      configHash: 'b'.repeat(64),
      draftRevision: 2,
      parameterDefinitions: ruleInput.parameters,
      milestoneTemplates: ruleInput.milestones,
    });

    await updateDeadlineRuleDraft(ruleId, {
      ...ruleInput,
      name: 'Updated ECI',
      description: 'Updated description',
      expectedDraftRevision: 1,
    }, actor);

    const updatedParameterCreate = prismaMock.deadlineRuleVersion.update.mock.calls[0]?.[0]?.data
      .parameterDefinitions.create[0];
    expect(updatedParameterCreate.defaultValue).toBe(Prisma.DbNull);
    expect(updatedParameterCreate.validation).toBe(Prisma.DbNull);

    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({
        definition: expect.objectContaining({
          old: expect.objectContaining({
            code: ruleInput.code,
            name: ruleInput.name,
            description: ruleInput.description,
            parameters: expect.any(Array),
            milestones: expect.any(Array),
            recurrence: ruleInput.recurrence,
            applicability: ruleInput.applicability,
          }),
          new: expect.objectContaining({
            code: ruleInput.code,
            name: 'Updated ECI',
            description: 'Updated description',
            parameters: expect.any(Array),
            milestones: expect.any(Array),
            recurrence: ruleInput.recurrence,
            applicability: ruleInput.applicability,
          }),
        }),
      }),
    }), prismaMock);
  });
});
