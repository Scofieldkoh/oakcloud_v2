import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  company: { findFirst: vi.fn() },
  serviceVariant: { findFirst: vi.fn() },
  clientService: { create: vi.fn(), findFirst: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  clientServiceFeeLine: { createMany: vi.fn() },
  serviceVariantDeadlineRule: { findMany: vi.fn() },
  clientServiceDeadlineRule: { deleteMany: vi.fn(), createMany: vi.fn() },
  serviceScheduleReconciliationRequest: { findUnique: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}));
const auditMock = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => auditMock);

import {
  ClientServiceWriteConflictError,
  createManualClientService,
  DuplicateClientServiceError,
} from '@/services/client-service';

const params = { tenantId: 'tenant-1', userId: 'user-1' };
const input = {
  serviceVariantId: 'variant-1',
  status: 'ACTIVE' as const,
  serviceCadence: 'ANNUALLY' as const,
  customCadenceLabel: null,
  startDate: '2026-08-01',
  endDate: null,
  fieldValues: { filingMonth: 'July' },
  feeLines: [{
    description: 'Annual service fee',
    amount: '1200.00',
    currency: 'SGD',
    billingFrequency: 'ANNUALLY' as const,
    customFrequencyLabel: null,
    billingStartDate: '2026-08-01',
  }],
  confirmDuplicate: false,
};
const billingSchedule = {
  schemaVersion: 1 as const,
  cadence: 'ANNUALLY' as const,
  startDate: '2026-08-01',
  customInterval: { unit: 'MONTH' as const, count: 12 },
  scheduleEntries: [{
    key: 'deposit',
    label: 'Deposit',
    expression: { kind: 'DAY_OF_MONTH' as const, day: 1 },
    businessDayAdjustment: 'NEXT' as const,
  }],
};
const variant = { id: 'variant-1', name: 'Corporate Secretarial (Latest)', family: { name: 'Corporate Services' } };
const createdRecord = {
  id: 'service-1',
  tenantId: params.tenantId,
  companyId: 'company-1',
  source: 'MANUAL',
  agreementId: null,
  agreementItemId: null,
  serviceVariantId: 'variant-1',
  familyName: 'Corporate Services',
  serviceName: 'Corporate Secretarial (Latest)',
  status: 'ACTIVE',
  serviceCadence: 'ANNUALLY',
  customCadenceLabel: null,
  startDate: new Date('2026-08-01T00:00:00.000Z'),
  endDate: null,
  fieldValues: { filingMonth: 'July' },
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  deletedAt: null,
  deletedReason: null,
  feeLines: [{
    id: 'fee-1',
    sourceAgreementFeeLineId: null,
    description: 'Annual service fee',
    amount: { toFixed: () => '1200.00' },
    currency: 'SGD',
    billingFrequency: 'ANNUALLY',
    customFrequencyLabel: null,
    billingStartDate: new Date('2026-08-01T00:00:00.000Z'),
    displayOrder: 0,
  }],
  agreement: null,
};

describe('manual client service creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.company.findFirst.mockResolvedValue({ id: 'company-1' });
    prismaMock.serviceVariant.findFirst.mockResolvedValue(variant);
    prismaMock.clientService.create.mockImplementation(async ({ data }) => ({ id: 'service-1', ...data, createdAt: new Date(), updatedAt: new Date() }));
    prismaMock.clientService.findFirst.mockResolvedValue(createdRecord);
    prismaMock.clientServiceFeeLine.createMany.mockResolvedValue({ count: 1 });
    prismaMock.clientService.count.mockResolvedValue(0);
    prismaMock.clientService.findMany.mockResolvedValue([]);
    prismaMock.serviceVariantDeadlineRule.findMany.mockResolvedValue([]);
    prismaMock.clientServiceDeadlineRule.createMany.mockResolvedValue({ count: 0 });
    prismaMock.serviceScheduleReconciliationRequest.findUnique.mockResolvedValue(null);
    prismaMock.serviceScheduleReconciliationRequest.upsert.mockResolvedValue({ id: 'req-1', dedupeKey: 'k-1' });
  });

  it('creates with server-owned names, manual lineage, array-order fees, and audit without field values', async () => {
    const result = await createManualClientService('company-1', input, params);

    expect(prismaMock.clientService.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        companyId: 'company-1',
        source: 'MANUAL',
        agreementId: null,
        agreementItemId: null,
        serviceVariantId: 'variant-1',
        familyName: 'Corporate Services',
        serviceName: 'Corporate Secretarial (Latest)',
      }),
    }));
    expect(prismaMock.clientServiceFeeLine.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ sourceAgreementFeeLineId: null, displayOrder: 0 })],
    }));
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      changeSource: 'MANUAL',
      summary: 'Added manual operational service with 1 fee line(s)',
    }), prismaMock);
    expect(JSON.stringify(auditMock.createAuditLog.mock.calls[0][0].changes)).not.toContain('fieldValues');
    expect(result).toMatchObject({ id: 'service-1', source: 'MANUAL', serviceName: 'Corporate Secretarial (Latest)' });
  });

  it('persists configured billing disposition and structured fee schedules in the creation transaction', async () => {
    await createManualClientService('company-1', {
      ...input,
      billingDisposition: 'CONFIGURED',
      feeLines: [{ ...input.feeLines[0], scheduleConfig: billingSchedule }],
    }, params);

    expect(prismaMock.clientService.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        billingDisposition: 'CONFIGURED',
        billingNotRequiredReason: null,
      }),
    }));
    expect(prismaMock.clientServiceFeeLine.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ scheduleConfig: billingSchedule })],
    }));
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({
        billingDisposition: { old: null, new: 'CONFIGURED' },
        feeLines: expect.objectContaining({
          new: expect.objectContaining({
            snapshot: expect.objectContaining({
              items: expect.arrayContaining([expect.objectContaining({
                description: 'Annual service fee',
                billingFrequency: 'ANNUALLY',
                billingStartDate: '2026-08-01',
                scheduleConfigHash: expect.any(String),
                state: 'ACTIVE',
              })]),
            }),
          }),
        }),
      }),
    }), prismaMock);
  });

  it('materializes a deterministic legacy schedule when a configured fee omits structured config', async () => {
    await createManualClientService('company-1', {
      ...input,
      billingDisposition: 'CONFIGURED',
      feeLines: [{ ...input.feeLines[0], scheduleConfig: undefined }],
    }, params);

    expect(prismaMock.clientServiceFeeLine.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        billingStartDate: new Date('2026-08-01T00:00:00.000Z'),
        scheduleConfig: expect.objectContaining({
          cadence: 'ANNUALLY',
          startDate: '2026-08-01',
          scheduleEntries: [expect.objectContaining({ key: 'default' })],
        }),
      })],
    }));
  });

  it('rejects an explicitly configured fee without an effective materializable schedule', async () => {
    await expect(createManualClientService('company-1', {
      ...input,
      billingDisposition: 'CONFIGURED',
      feeLines: [{ ...input.feeLines[0], billingStartDate: null, scheduleConfig: undefined }],
    }, params)).rejects.toThrow(/configured billing requires a valid start date/i);
    expect(prismaMock.clientService.create).not.toHaveBeenCalled();
  });

  it('rejects not-required fee rows and caller-controlled inactive rows at the service boundary', async () => {
    await expect(createManualClientService('company-1', {
      ...input,
      billingDisposition: 'NOT_REQUIRED',
      billingNotRequiredReason: 'Included elsewhere',
      feeLines: [input.feeLines[0]],
    }, params)).rejects.toThrow(/fee lines must be empty/i);

    await expect(createManualClientService('company-1', {
      ...input,
      billingDisposition: 'CONFIGURED',
      feeLines: [{ ...input.feeLines[0], isActive: false }],
    } as never, params)).rejects.toThrow(/inactive|lifecycle/i);
    expect(prismaMock.clientService.create).not.toHaveBeenCalled();
  });

  it('rejects conflicting structured and legacy billing fields before writing', async () => {
    await expect(createManualClientService('company-1', {
      ...input,
      billingDisposition: 'CONFIGURED',
      feeLines: [{ ...input.feeLines[0], scheduleConfig: { ...billingSchedule, cadence: 'MONTHLY', customInterval: { unit: 'MONTH', count: 1 } } }],
    }, params)).rejects.toThrow(/frequency|cadence/i);
    expect(prismaMock.clientService.create).not.toHaveBeenCalled();
  });

  it('allows not-required billing without fee rows and preserves the user reason', async () => {
    await createManualClientService('company-1', {
      ...input,
      billingDisposition: 'NOT_REQUIRED',
      billingNotRequiredReason: 'Included in another engagement',
      feeLines: [],
    }, params);

    expect(prismaMock.clientService.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        billingDisposition: 'NOT_REQUIRED',
        billingNotRequiredReason: 'Included in another engagement',
      }),
    }));
    expect(prismaMock.clientServiceFeeLine.createMany).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({
        billingDisposition: { old: null, new: 'NOT_REQUIRED' },
        billingNotRequiredReason: { old: null, new: 'Included in another engagement' },
      }),
    }), prismaMock);
  });

  it('attaches only enabled catalog default rules with defaults and provenance', async () => {
    prismaMock.serviceVariantDeadlineRule.findMany.mockResolvedValue([
      {
        ruleId: '22222222-2222-4222-8222-222222222222',
        enabledByDefault: true,
        parameterDefaults: { filingMonth: 'June' },
        scheduleDefaults: [{ key: 'filing', label: 'Filing', expression: { kind: 'DAY_OF_MONTH', day: 15 }, businessDayAdjustment: 'NONE' }],
        rule: {
          id: '22222222-2222-4222-8222-222222222222',
          isActive: true,
          archivedAt: null,
          currentVersionId: '33333333-3333-4333-8333-333333333333',
          currentVersion: {
            id: '33333333-3333-4333-8333-333333333333',
            state: 'PUBLISHED',
            configHash: 'a'.repeat(64),
            recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
            applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
            parameterDefinitions: [{ key: 'filingMonth', type: 'STRING', isRequired: false, validation: null }],
            milestoneTemplates: [],
          },
        },
      },
      { ruleId: '33333333-3333-4333-8333-333333333333', enabledByDefault: false, parameterDefaults: { filingMonth: 'July' }, scheduleDefaults: [] },
    ]);

    await createManualClientService('company-1', input, params);

    expect(prismaMock.serviceVariantDeadlineRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ enabledByDefault: true, archivedAt: null }),
      select: expect.objectContaining({ parameterDefaults: true, scheduleDefaults: true }),
    }));
    expect(prismaMock.clientServiceDeadlineRule.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        tenantId: 'tenant-1', clientServiceId: 'service-1', ruleId: '22222222-2222-4222-8222-222222222222', enabled: true,
        parameterValues: { filingMonth: 'June' }, parameterProvenance: { filingMonth: 'CATALOG_DEFAULT' },
        scheduleEntries: [{ key: 'filing', label: 'Filing', expression: { kind: 'DAY_OF_MONTH', day: 15 }, businessDayAdjustment: 'NONE' }],
        applicabilityState: 'APPLICABLE',
      })],
    }));
  });

  it('validates and persists omitted catalog defaults through the shared state path', async () => {
    prismaMock.serviceVariantDeadlineRule.findMany.mockResolvedValue([{
      ruleId: '22222222-2222-4222-8222-222222222222',
      enabledByDefault: true,
      parameterDefaults: { filingMonth: 'June' },
      scheduleDefaults: [],
      rule: {
        id: '22222222-2222-4222-8222-222222222222',
        isActive: true,
        archivedAt: null,
        currentVersionId: '33333333-3333-4333-8333-333333333333',
        currentVersion: {
          id: '33333333-3333-4333-8333-333333333333',
          state: 'PUBLISHED',
          recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
          applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
          parameterDefinitions: [{ key: 'filingMonth', type: 'STRING', isRequired: false, validation: null }],
          milestoneTemplates: [],
        },
      },
    }]);

    await createManualClientService('company-1', input, params);

    expect(prismaMock.clientServiceDeadlineRule.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        lastEvaluatedVersionId: '33333333-3333-4333-8333-333333333333',
        applicabilityState: 'APPLICABLE',
        configHash: expect.any(String),
      })],
    }));
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({ deadlineRules: expect.objectContaining({ new: expect.objectContaining({ rules: expect.any(Array) }) }) }),
    }), prismaMock);
  });

  it('normalizes fee display order from request array position', async () => {
    const twoFees = [
      { ...input.feeLines[0], description: 'First fee' },
      { ...input.feeLines[0], description: 'Second fee' },
    ];
    await createManualClientService('company-1', { ...input, feeLines: twoFees }, params);

    expect(prismaMock.clientServiceFeeLine.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        expect.objectContaining({ description: 'First fee', displayOrder: 0 }),
        expect.objectContaining({ description: 'Second fee', displayOrder: 1 }),
      ],
    }));
  });

  it('rejects inactive or unavailable catalog variants without writing', async () => {
    prismaMock.serviceVariant.findFirst.mockResolvedValue(null);

    await expect(createManualClientService('company-1', input, params)).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.clientService.create).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('rejects unconfirmed duplicates with a capped stable summary and no writes', async () => {
    prismaMock.clientService.count.mockResolvedValue(3);
    prismaMock.clientService.findMany.mockResolvedValue([
      { id: 'service-3', serviceName: 'Third', startDate: new Date('2026-08-01T00:00:00.000Z'), status: 'ENDED', source: 'MANUAL' },
      { id: 'service-2', serviceName: 'Second', startDate: new Date('2026-08-01T00:00:00.000Z'), status: 'PAUSED', source: 'AGREEMENT' },
      { id: 'service-1', serviceName: 'First', startDate: new Date('2026-08-01T00:00:00.000Z'), status: 'ACTIVE', source: 'AGREEMENT' },
    ]);

    const failure = createManualClientService('company-1', input, params);
    await expect(failure).rejects.toBeInstanceOf(DuplicateClientServiceError);
    await expect(failure).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_CLIENT_SERVICE', duplicates: { total: 3 } });
    expect(prismaMock.clientService.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        companyId: 'company-1',
        serviceVariantId: 'variant-1',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        deletedAt: null,
      }),
    }));
    expect(prismaMock.clientService.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
    }));
    expect(prismaMock.clientService.create).not.toHaveBeenCalled();
    expect(prismaMock.clientServiceFeeLine.createMany).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('ignores archived rows in the duplicate predicate', async () => {
    prismaMock.clientService.count.mockResolvedValue(0);
    await expect(createManualClientService('company-1', input, params)).resolves.toMatchObject({ id: 'service-1' });
    expect(prismaMock.clientService.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deletedAt: null }),
    }));
  });

  it('creates after an explicit duplicate override and audits the confirmation', async () => {
    await createManualClientService('company-1', { ...input, confirmDuplicate: true }, params);

    expect(prismaMock.clientService.count).not.toHaveBeenCalled();
    expect(prismaMock.clientService.findMany).not.toHaveBeenCalled();
    expect(prismaMock.clientService.create).toHaveBeenCalled();
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({ duplicateConfirmed: { old: false, new: true } }),
    }), prismaMock);
  });

  it('rolls back when fee writes fail and writes no audit', async () => {
    prismaMock.clientServiceFeeLine.createMany.mockRejectedValueOnce(new Error('fee write failed'));

    await expect(createManualClientService('company-1', input, params)).rejects.toThrow('fee write failed');
    expect(prismaMock.clientService.create).toHaveBeenCalledTimes(1);
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('rolls back when the audit write fails', async () => {
    auditMock.createAuditLog.mockRejectedValueOnce(new Error('audit write failed'));

    await expect(createManualClientService('company-1', input, params)).rejects.toThrow('audit write failed');
  });

  it('maps exhausted serialization retries to a retriable conflict', async () => {
    prismaMock.$transaction.mockRejectedValue({ code: 'P2034' });

    await expect(createManualClientService('company-1', input, params)).rejects.toBeInstanceOf(ClientServiceWriteConflictError);
    await expect(createManualClientService('company-1', input, params)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CLIENT_SERVICE_WRITE_CONFLICT',
      details: { retriable: true },
    });
  });
});
