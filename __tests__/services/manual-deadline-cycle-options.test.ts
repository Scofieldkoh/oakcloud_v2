import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  clientService: { findFirst: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  getManualDeadlineCycleOptions,
  type ManualDeadlineCycleOptions,
} from '@/services/deadline/manual-cycle-options';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const serviceId = '33333333-3333-4333-8333-333333333333';
const ruleRowId = '44444444-4444-4444-8444-444444444444';
const ruleId = '55555555-5555-4555-8555-555555555555';
const versionId = '66666666-6666-4666-8666-666666666666';
const actor = { tenantId, userId: '77777777-7777-4777-8777-777777777777', accessibleCompanyIds: [companyId] };

const scheduleEntries = [
  { key: 'first-entry', label: 'First entry', expression: { kind: 'DAY_OF_MONTH' as const, day: 1 }, businessDayAdjustment: 'NONE' as const },
];

function validRelation(overrides: Record<string, unknown> = {}) {
  return {
    id: ruleRowId,
    tenantId,
    clientServiceId: serviceId,
    ruleId,
    enabled: true,
    parameterValues: { monthsAfterFye: 2 },
    scheduleEntries,
    rule: {
      id: ruleId,
      tenantId,
      code: 'ANNUAL_RETURN',
      name: 'Annual return',
      isActive: true,
      archivedAt: null,
      currentVersionId: versionId,
      currentVersion: {
        id: versionId,
        tenantId,
        ruleId,
        version: 3,
        state: 'PUBLISHED',
        configHash: 'a'.repeat(64),
        recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
        applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
        parameterDefinitions: [{
          tenantId,
          ruleVersionId: versionId,
          key: 'monthsAfterFye',
          label: 'Months after FYE',
          type: 'INTEGER',
          isRequired: true,
          defaultValue: 2,
          validation: null,
          helpText: null,
          displayOrder: 1,
        }],
        milestoneTemplates: [{ tenantId, ruleVersionId: versionId }],
      },
    },
    ...overrides,
  };
}

function validService(relations = [validRelation()]) {
  return { id: serviceId, tenantId, companyId, deletedAt: null, deadlineRules: relations };
}

describe('manual deadline cycle options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.clientService.findFirst.mockResolvedValue(validService());
  });

  it('returns only a validated published associated rule and safe configured inputs', async () => {
    const result = await getManualDeadlineCycleOptions(serviceId, actor);

    expect(result).toEqual<ManualDeadlineCycleOptions>({
      clientServiceId: serviceId,
      companyId,
      rules: [{
        id: ruleRowId,
        ruleId,
        enabled: true,
        parameterValues: { monthsAfterFye: 2 },
        scheduleEntries,
        rule: {
          id: ruleId,
          code: 'ANNUAL_RETURN',
          name: 'Annual return',
          isActive: true,
          archivedAt: null,
          currentVersionId: versionId,
          currentVersion: {
            id: versionId,
            version: 3,
            state: 'PUBLISHED',
            configHash: 'a'.repeat(64),
            recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
            applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
            parameters: [{
              key: 'monthsAfterFye',
              label: 'Months after FYE',
              type: 'INTEGER',
              required: true,
              defaultValue: 2,
              validation: null,
              helpText: null,
              displayOrder: 1,
            }],
          },
        },
      }],
    });
    expect(prismaMock.clientService.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: serviceId,
        tenantId,
        company: expect.objectContaining({ id: { in: [companyId] } }),
      }),
    }));
  });

  it('uses the same safe not-found result for missing and inaccessible services', async () => {
    prismaMock.clientService.findFirst.mockResolvedValue(null);

    const missing = getManualDeadlineCycleOptions(serviceId, actor);
    const inaccessible = getManualDeadlineCycleOptions(serviceId, { ...actor, accessibleCompanyIds: ['88888888-8888-4888-8888-888888888888'] });
    const [missingResult, inaccessibleResult] = await Promise.allSettled([missing, inaccessible]);

    expect(missingResult.status).toBe('rejected');
    expect(inaccessibleResult.status).toBe('rejected');
    if (missingResult.status === 'rejected' && inaccessibleResult.status === 'rejected') {
      expect(missingResult.reason).toMatchObject({ code: 'NOT_FOUND', statusCode: 404, message: 'Client service not found' });
      expect(inaccessibleResult.reason).toMatchObject({ code: 'NOT_FOUND', statusCode: 404, message: 'Client service not found' });
    }
  });

  it('omits cross-tenant, mismatched-version, and draft relations without disclosing them', async () => {
    const wrongTenant = validRelation({
      id: '99999999-9999-4999-8999-999999999999',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const wrongVersion = validRelation({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      rule: {
        ...validRelation().rule,
        currentVersion: { ...validRelation().rule!.currentVersion, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      },
    });
    const draft = validRelation({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      rule: { ...validRelation().rule, currentVersion: { ...validRelation().rule!.currentVersion, state: 'DRAFT' } },
    });
    prismaMock.clientService.findFirst.mockResolvedValue(validService([validRelation(), wrongTenant, wrongVersion, draft]));

    const result = await getManualDeadlineCycleOptions(serviceId, actor);

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.id).toBe(ruleRowId);
  });
});
