import { describe, expect, it, vi } from 'vitest';
import {
  classifyDeadlineChange,
  getServiceWorkspaceFlags,
  projectDeadlineRule,
  reconcileClientServiceDeadlines,
} from '@/services/schedule-reconciliation';
import type {
  StoredDeadline,
  EvaluatedDeadlineForDiff,
  DeadlineRuleProjectionInput,
} from '@/services/schedule-reconciliation';
import type { DateOnly } from '@/services/service-schedule';

describe('schedule reconciliation workspace settings', () => {
  it('returns default enabled workspace flags when settings are empty', () => {
    const flags = getServiceWorkspaceFlags({});
    expect(flags.workspaceEnabled).toBe(true);
    expect(flags.deadlineWritesEnabled).toBe(false);
  });

  it('reads explicit workspace settings correctly', () => {
    const flags = getServiceWorkspaceFlags({
      servicesWorkspace: {
        enabled: false,
        deadlineWritesEnabled: true,
      },
    });
    expect(flags.workspaceEnabled).toBe(false);
    expect(flags.deadlineWritesEnabled).toBe(true);
  });

  it('respects DEADLINE_OCCURRENCE_WRITES_ENABLED env variable when setting is omitted', () => {
    const originalEnv = process.env.DEADLINE_OCCURRENCE_WRITES_ENABLED;
    try {
      process.env.DEADLINE_OCCURRENCE_WRITES_ENABLED = 'true';
      const flags = getServiceWorkspaceFlags({});
      expect(flags.deadlineWritesEnabled).toBe(true);
    } finally {
      process.env.DEADLINE_OCCURRENCE_WRITES_ENABLED = originalEnv;
    }
  });

  it('enables writes when the environment flag is true even if the tenant setting is explicitly false', () => {
    const originalEnv = process.env.DEADLINE_OCCURRENCE_WRITES_ENABLED;
    try {
      process.env.DEADLINE_OCCURRENCE_WRITES_ENABLED = 'true';
      const flags = getServiceWorkspaceFlags({
        servicesWorkspace: { deadlineWritesEnabled: false },
      });
      expect(flags.deadlineWritesEnabled).toBe(true);
    } finally {
      process.env.DEADLINE_OCCURRENCE_WRITES_ENABLED = originalEnv;
    }
  });
});

describe('classifyDeadlineChange', () => {
  const today: DateOnly = '2026-08-18';
  const proposed: EvaluatedDeadlineForDiff = {
    milestoneKey: 'agm_due',
    scheduleEntryKey: 'entry_1',
    deadlineType: 'STATUTORY',
    dueDate: '2026-09-30',
    ruleVersionId: 'version-1',
    explanation: '6 months after FYE',
  };

  it('returns CREATE when no existing deadline exists', () => {
    const result = classifyDeadlineChange(null, proposed, today);
    expect(result).toEqual({ action: 'CREATE' });
  });

  it('returns PRESERVE with MANUAL_TRIGGER when origin is not RULE', () => {
    const existing: StoredDeadline = {
      id: 'occ-1',
      cycleId: 'cycle-1',
      milestoneKey: 'agm_due',
      scheduleEntryKey: 'entry_1',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2026-09-30',
      operativeDueDate: '2026-09-30',
      dateOverridden: false,
      status: 'OPEN',
      origin: 'MANUAL_TRIGGER',
      ruleVersionId: 'version-1',
    };
    const result = classifyDeadlineChange(existing, proposed, today);
    expect(result).toEqual({ action: 'PRESERVE', reason: 'MANUAL_TRIGGER' });
  });

  it('returns PRESERVE with HISTORICAL when operativeDueDate is before today', () => {
    const existing: StoredDeadline = {
      id: 'occ-1',
      cycleId: 'cycle-1',
      milestoneKey: 'agm_due',
      scheduleEntryKey: 'entry_1',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2026-08-01',
      operativeDueDate: '2026-08-01',
      dateOverridden: false,
      status: 'OPEN',
      origin: 'RULE',
      ruleVersionId: 'version-1',
    };
    const result = classifyDeadlineChange(existing, proposed, today);
    expect(result).toEqual({ action: 'PRESERVE', reason: 'HISTORICAL' });
  });

  it('returns PRESERVE with COMPLETED when status is COMPLETED', () => {
    const existing: StoredDeadline = {
      id: 'occ-1',
      cycleId: 'cycle-1',
      milestoneKey: 'agm_due',
      scheduleEntryKey: 'entry_1',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2026-09-30',
      operativeDueDate: '2026-09-30',
      dateOverridden: false,
      status: 'COMPLETED',
      origin: 'RULE',
      ruleVersionId: 'version-1',
    };
    const result = classifyDeadlineChange(existing, proposed, today);
    expect(result).toEqual({ action: 'PRESERVE', reason: 'COMPLETED' });
  });

  it('returns PRESERVE with WAIVED when status is WAIVED', () => {
    const existing: StoredDeadline = {
      id: 'occ-1',
      cycleId: 'cycle-1',
      milestoneKey: 'agm_due',
      scheduleEntryKey: 'entry_1',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2026-09-30',
      operativeDueDate: '2026-09-30',
      dateOverridden: false,
      status: 'WAIVED',
      origin: 'RULE',
      ruleVersionId: 'version-1',
    };
    const result = classifyDeadlineChange(existing, proposed, today);
    expect(result).toEqual({ action: 'PRESERVE', reason: 'WAIVED' });
  });

  it('returns PRESERVE with CANCELLED when status is CANCELLED', () => {
    const existing: StoredDeadline = {
      id: 'occ-1',
      cycleId: 'cycle-1',
      milestoneKey: 'agm_due',
      scheduleEntryKey: 'entry_1',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2026-09-30',
      operativeDueDate: '2026-09-30',
      dateOverridden: false,
      status: 'CANCELLED',
      origin: 'RULE',
      ruleVersionId: 'version-1',
    };
    const result = classifyDeadlineChange(existing, proposed, today);
    expect(result).toEqual({ action: 'PRESERVE', reason: 'CANCELLED' });
  });

  it('returns PRESERVE with OVERRIDDEN when dateOverridden is true', () => {
    const existing: StoredDeadline = {
      id: 'occ-1',
      cycleId: 'cycle-1',
      milestoneKey: 'agm_due',
      scheduleEntryKey: 'entry_1',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2026-09-30',
      operativeDueDate: '2026-10-15',
      dateOverridden: true,
      status: 'OPEN',
      origin: 'RULE',
      ruleVersionId: 'version-1',
    };
    const result = classifyDeadlineChange(existing, proposed, today);
    expect(result).toEqual({ action: 'PRESERVE', reason: 'OVERRIDDEN' });
  });

  it('returns RECALCULATE when calculatedDueDate or ruleVersionId changes for open future rule deadline', () => {
    const existing: StoredDeadline = {
      id: 'occ-1',
      cycleId: 'cycle-1',
      milestoneKey: 'agm_due',
      scheduleEntryKey: 'entry_1',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2026-09-15',
      operativeDueDate: '2026-09-15',
      dateOverridden: false,
      status: 'OPEN',
      origin: 'RULE',
      ruleVersionId: 'version-1',
    };
    const result = classifyDeadlineChange(existing, proposed, today);
    expect(result).toEqual({ action: 'RECALCULATE' });
  });

  it('returns NO_CHANGE when calculatedDueDate, operativeDueDate, and ruleVersion match', () => {
    const existing: StoredDeadline = {
      id: 'occ-1',
      cycleId: 'cycle-1',
      milestoneKey: 'agm_due',
      scheduleEntryKey: 'entry_1',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2026-09-30',
      operativeDueDate: '2026-09-30',
      dateOverridden: false,
      status: 'OPEN',
      origin: 'RULE',
      ruleVersionId: 'version-1',
    };
    const result = classifyDeadlineChange(existing, proposed, today);
    expect(result).toEqual({ action: 'NO_CHANGE' });
  });
});

describe('reconcileClientServiceDeadlines', () => {
  it('preserves manual, historical, completed, waived, cancelled, and overridden deadlines', async () => {
    const today: DateOnly = '2026-08-18';
    const horizonEnd: DateOnly = '2027-08-18';

    const dbMock = {
      clientService: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cs-1',
          tenantId: 'tenant-1',
          companyId: 'company-1',
          deletedAt: null,
          status: 'ACTIVE',
          company: {
            id: 'company-1',
            tenantId: 'tenant-1',
            uen: '202400001A',
            name: 'Example Pte Ltd',
            entityType: 'PRIVATE_LIMITED',
            status: 'LIVE',
            financialYearEndDay: 31,
            financialYearEndMonth: 12,
          },
          deadlineRules: [],
        }),
      },
      serviceCycle: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cycle-1',
            tenantId: 'tenant-1',
            clientServiceId: 'cs-1',
            ruleId: 'rule-1',
            periodKey: '2026',
            generationKey: 'rolling-v1',
            origin: 'RULE',
            occurrences: [
              {
                id: 'occ-manual',
                cycleId: 'cycle-1',
                milestoneKey: 'm1',
                scheduleEntryKey: 'e1',
                deadlineType: 'STATUTORY',
                calculatedDueDate: new Date('2026-09-30T00:00:00.000Z'),
                operativeDueDate: new Date('2026-09-30T00:00:00.000Z'),
                dateOverridden: false,
                status: 'OPEN',
                origin: 'MANUAL_TRIGGER',
                ruleVersionId: 'v1',
              },
              {
                id: 'occ-hist',
                cycleId: 'cycle-1',
                milestoneKey: 'm2',
                scheduleEntryKey: 'e2',
                deadlineType: 'STATUTORY',
                calculatedDueDate: new Date('2026-07-01T00:00:00.000Z'),
                operativeDueDate: new Date('2026-07-01T00:00:00.000Z'),
                dateOverridden: false,
                status: 'OPEN',
                origin: 'RULE',
                ruleVersionId: 'v1',
              },
              {
                id: 'occ-comp',
                cycleId: 'cycle-1',
                milestoneKey: 'm3',
                scheduleEntryKey: 'e3',
                deadlineType: 'STATUTORY',
                calculatedDueDate: new Date('2026-09-30T00:00:00.000Z'),
                operativeDueDate: new Date('2026-09-30T00:00:00.000Z'),
                dateOverridden: false,
                status: 'COMPLETED',
                origin: 'RULE',
                ruleVersionId: 'v1',
              },
              {
                id: 'occ-waived',
                cycleId: 'cycle-1',
                milestoneKey: 'm4',
                scheduleEntryKey: 'e4',
                deadlineType: 'STATUTORY',
                calculatedDueDate: new Date('2026-09-30T00:00:00.000Z'),
                operativeDueDate: new Date('2026-09-30T00:00:00.000Z'),
                dateOverridden: false,
                status: 'WAIVED',
                origin: 'RULE',
                ruleVersionId: 'v1',
              },
              {
                id: 'occ-cancelled',
                cycleId: 'cycle-1',
                milestoneKey: 'm5',
                scheduleEntryKey: 'e5',
                deadlineType: 'STATUTORY',
                calculatedDueDate: new Date('2026-09-30T00:00:00.000Z'),
                operativeDueDate: new Date('2026-09-30T00:00:00.000Z'),
                dateOverridden: false,
                status: 'CANCELLED',
                origin: 'RULE',
                ruleVersionId: 'v1',
              },
              {
                id: 'occ-overridden',
                cycleId: 'cycle-1',
                milestoneKey: 'm6',
                scheduleEntryKey: 'e6',
                deadlineType: 'STATUTORY',
                calculatedDueDate: new Date('2026-09-30T00:00:00.000Z'),
                operativeDueDate: new Date('2026-10-15T00:00:00.000Z'),
                dateOverridden: true,
                status: 'OPEN',
                origin: 'RULE',
                ruleVersionId: 'v1',
              },
            ],
          },
        ]),
      },
      businessCalendar: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      deadlineOccurrence: {
        update: vi.fn(),
        create: vi.fn(),
      },
    };

    const result = await reconcileClientServiceDeadlines(
      {
        tenantId: 'tenant-1',
        clientServiceId: 'cs-1',
        today,
        horizonEnd,
        writeMode: 'OBSERVE',
        reconciliationRequestId: 'req-1',
      },
      dbMock as never,
    );

    expect(result.preservedByReason).toMatchObject({
      MANUAL_TRIGGER: 1,
      HISTORICAL: 1,
      COMPLETED: 1,
      WAIVED: 1,
      CANCELLED: 1,
      OVERRIDDEN: 1,
    });
  });

  function reconciliationRule(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rule-1',
      code: 'DEFAULT_RULE',
      name: 'AGM due date',
      isActive: true,
      currentVersion: {
        id: 'version-1',
        recurrence: { schemaVersion: 1, kind: 'ONE_TIME' },
        applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
        configHash: 'config-1',
        parameterDefinitions: [],
        milestoneTemplates: [{
          milestoneKey: 'agm-due',
          name: 'AGM due',
          description: null,
          type: 'STATUTORY',
          generationMode: 'ONCE_PER_CYCLE',
          dateExpression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
          businessDayAdjustment: 'NONE',
          displayOrder: 0,
          isActive: true,
        }],
      },
      ...overrides,
    };
  }

  function reconciliationDb(existingCycles: unknown[] = [], rule: unknown = reconciliationRule(), company: Record<string, unknown> = {}) {
    const cycle = {
      id: 'cycle-1',
      tenantId: 'tenant-1',
      clientServiceId: 'cs-1',
      ruleId: 'rule-1',
      periodKey: 'ONE_TIME',
      generationKey: 'rolling-v1',
      origin: 'RULE',
      occurrences: [],
    };
    return {
      clientService: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cs-1',
          tenantId: 'tenant-1',
          companyId: 'company-1',
          deletedAt: null,
          status: 'ACTIVE',
          company: {
            id: 'company-1',
            tenantId: 'tenant-1',
            accountsDueDate: new Date('2026-09-30T00:00:00.000Z'),
            financialYearEndDay: 31,
            financialYearEndMonth: 12,
            ...company,
          },
          deadlineRules: [{
            id: 'client-rule-1',
            enabled: true,
            parameterValues: {},
            scheduleEntries: [],
            rule,
          }],
        }),
        deadlineRules: { findMany: vi.fn() },
      },
      serviceCycle: {
        findMany: vi.fn().mockResolvedValue(existingCycles),
        upsert: vi.fn().mockResolvedValue(cycle),
        update: vi.fn().mockResolvedValue(cycle),
      },
      businessCalendar: { findFirst: vi.fn().mockResolvedValue(null) },
      clientServiceDeadlineRule: { update: vi.fn().mockResolvedValue({}) },
      deadlineOccurrence: {
        upsert: vi.fn().mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
          id: 'occ-created',
          ...create,
        })),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    };
  }

  function annualAccountsDueRule() {
    return reconciliationRule({
      currentVersion: {
        id: 'version-1',
        recurrence: { schemaVersion: 1, kind: 'ANNUALLY', interval: 1 },
        applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
        configHash: 'config-1',
        parameterDefinitions: [],
        milestoneTemplates: [{
          milestoneKey: 'annual-return-due',
          name: 'Annual Return due',
          description: null,
          type: 'STATUTORY',
          generationMode: 'ONCE_PER_CYCLE',
          dateExpression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
          businessDayAdjustment: 'NONE',
          displayOrder: 0,
          isActive: true,
        }],
      },
    });
  }

  function reconciliationDbWithRules(
    existingCycles: unknown[] = [],
    rules: Array<{ id: string; rule: unknown; enabled?: boolean }>,
    company: Record<string, unknown> = {},
  ) {
    const db = reconciliationDb(existingCycles, rules[0]?.rule, company);
    const originalFindFirst = db.clientService.findFirst;
    db.clientService.findFirst = vi.fn().mockImplementation(async () => {
      const base = await originalFindFirst();
      return {
        ...base,
        deadlineRules: rules.map(({ id, rule, enabled }) => ({
          id: `client-${id}`,
          enabled: enabled ?? true,
          parameterValues: {},
          scheduleEntries: [],
          rule,
        })),
      };
    });
    return db;
  }

  it('materializes the exact authoritative AGM and Annual Return backlog for a 2024 source', async () => {
    const dbMock = reconciliationDbWithRules([], [
      {
        id: 'rule-agm',
        rule: reconciliationRule({
          id: 'rule-agm',
          code: 'SG_AGM_DUE',
          currentVersion: {
            id: 'version-agm',
            recurrence: { schemaVersion: 1, kind: 'ANNUALLY', interval: 1 },
            applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
            configHash: 'config-agm',
            parameterDefinitions: [],
            milestoneTemplates: [{
              milestoneKey: 'agm-due',
              name: 'AGM due',
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
            }],
          },
        }),
      },
      {
        id: 'rule-ar',
        rule: reconciliationRule({
          id: 'rule-ar',
          code: 'SG_ANNUAL_RETURN',
          currentVersion: {
            id: 'version-ar',
            recurrence: { schemaVersion: 1, kind: 'ANNUALLY', interval: 1 },
            applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
            configHash: 'config-ar',
            parameterDefinitions: [],
            milestoneTemplates: [{
              milestoneKey: 'annual-return-due',
              name: 'Annual Return due',
              description: null,
              type: 'STATUTORY',
              generationMode: 'ONCE_PER_CYCLE',
              dateExpression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
              businessDayAdjustment: 'NONE',
              displayOrder: 0,
              isActive: true,
            }],
          },
        }),
      },
    ], { accountsDueDate: '2024-07-31' });

    const result = await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1', clientServiceId: 'cs-1',
      today: '2026-08-27', horizonEnd: '2027-08-27',
      writeMode: 'APPLY', reconciliationRequestId: 'req-authoritative-backlog',
    }, dbMock as never);

    expect(result.counts).toMatchObject({ created: 8, recalculated: 0, cancelled: 0, preserved: 0 });
    const created = dbMock.deadlineOccurrence.upsert.mock.calls
      .map((call: unknown) => {
        const payload = (call as Array<{ create: { milestoneKey: string; calculatedDueDate: Date } }>)[0];
        return {
          milestoneKey: payload.create.milestoneKey,
          dueDate: payload.create.calculatedDueDate.toISOString().slice(0, 10),
        };
      })
      .sort((left: { dueDate: string }, right: { dueDate: string }) => left.dueDate.localeCompare(right.dueDate));
    expect(created).toEqual([
      { milestoneKey: 'agm-due', dueDate: '2024-06-30' },
      { milestoneKey: 'annual-return-due', dueDate: '2024-07-31' },
      { milestoneKey: 'agm-due', dueDate: '2025-06-30' },
      { milestoneKey: 'annual-return-due', dueDate: '2025-07-31' },
      { milestoneKey: 'agm-due', dueDate: '2026-06-30' },
      { milestoneKey: 'annual-return-due', dueDate: '2026-07-31' },
      { milestoneKey: 'agm-due', dueDate: '2027-06-30' },
      { milestoneKey: 'annual-return-due', dueDate: '2027-07-31' },
    ]);
  });

  it('evaluates occurrences, creates stable cycles, and snapshots explanations in APPLY mode', async () => {
    const dbMock = reconciliationDb();
    const result = await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1',
      clientServiceId: 'cs-1',
      today: '2026-08-18',
      horizonEnd: '2027-08-18',
      writeMode: 'APPLY',
      reconciliationRequestId: 'req-1',
    }, dbMock as never);

    expect(result.counts.created).toBe(1);
    expect(dbMock.serviceCycle.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId_clientServiceId_ruleId_periodKey_generationKey_origin: expect.objectContaining({
          tenantId: 'tenant-1', clientServiceId: 'cs-1', ruleId: 'rule-1', generationKey: 'rolling-v1', origin: 'RULE',
        }),
      }),
      create: expect.objectContaining({ sourceSnapshot: expect.anything() }),
    }));
    expect(dbMock.deadlineOccurrence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId_cycleId_milestoneKey_scheduleEntryKey: expect.objectContaining({
          tenantId: 'tenant-1', cycleId: 'cycle-1', milestoneKey: 'agm-due', scheduleEntryKey: '',
        }),
      }),
      create: expect.objectContaining({
        milestoneKey: 'agm-due',
        calculatedDueDate: new Date('2026-09-30T00:00:00.000Z'),
        operativeDueDate: new Date('2026-09-30T00:00:00.000Z'),
      }),
      update: {},
    }));
  });

  it('reports no creation when stable-identity insert loses a concurrent conflict', async () => {
    const dbMock = reconciliationDb();
    const existingOccurrence = {
      id: 'occ-existing',
      tenantId: 'tenant-1',
      cycleId: 'cycle-1',
      milestoneKey: 'agm-due',
      scheduleEntryKey: '',
      deadlineType: 'STATUTORY',
      calculatedDueDate: new Date('2026-09-30T00:00:00.000Z'),
      operativeDueDate: new Date('2026-09-30T00:00:00.000Z'),
      dateOverridden: false,
      status: 'OPEN',
      origin: 'RULE',
      ruleVersionId: 'version-1',
    };
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    Object.assign(dbMock.deadlineOccurrence, {
      createMany,
      findUnique: vi.fn().mockResolvedValue(existingOccurrence),
    });
    Reflect.deleteProperty(dbMock.deadlineOccurrence, 'upsert');

    const result = await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1',
      clientServiceId: 'cs-1',
      today: '2026-08-18',
      horizonEnd: '2027-08-18',
      writeMode: 'APPLY',
      reconciliationRequestId: 'req-concurrent-loser',
    }, dbMock as never);

    expect(result.counts.created).toBe(0);
    expect(result.counts.noChange).toBe(1);
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
    }));
  });

  it('uses the stored FYE source when materializing a no-cycle annual plan', async () => {
    const dbMock = reconciliationDb([], reconciliationRule({
      currentVersion: {
        id: 'version-1',
        recurrence: { schemaVersion: 1, kind: 'ANNUALLY', interval: 1 },
        applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
        configHash: 'config-1',
        parameterDefinitions: [],
        milestoneTemplates: [{
          milestoneKey: 'fye',
          name: 'Financial year end',
          description: null,
          type: 'STATUTORY',
          generationMode: 'ONCE_PER_CYCLE',
          dateExpression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' } },
          businessDayAdjustment: 'NONE',
          displayOrder: 0,
          isActive: true,
        }],
      },
    }));

    const result = await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1', clientServiceId: 'cs-1', today: '2026-08-18', horizonEnd: '2027-08-18',
      writeMode: 'APPLY', reconciliationRequestId: 'req-fye',
    }, dbMock as never);

    expect(result.counts.created).toBeGreaterThan(0);
    expect(dbMock.deadlineOccurrence.upsert.mock.calls
      .map((call) => call[0].create.calculatedDueDate.toISOString()))
      .toContain('2026-12-31T00:00:00.000Z');
  });

  it('materializes one in-window anniversary for an annual company-date source', async () => {
    const dbMock = reconciliationDb([], annualAccountsDueRule(), { accountsDueDate: '2027-07-31' });

    const result = await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1',
      clientServiceId: 'cs-1',
      today: '2026-08-27',
      horizonEnd: '2027-08-27',
      writeMode: 'APPLY',
      reconciliationRequestId: 'req-annual-anniversary',
    }, dbMock as never);

    expect(result.counts).toMatchObject({ created: 1, recalculated: 0 });
    expect(dbMock.serviceCycle.upsert).toHaveBeenCalledTimes(1);
    expect(dbMock.serviceCycle.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ periodKey: '2026' }),
    }));
    expect(dbMock.deadlineOccurrence.upsert).toHaveBeenCalledTimes(1);
    expect(dbMock.deadlineOccurrence.upsert.mock.calls[0][0].create.calculatedDueDate)
      .toEqual(new Date('2027-07-31T00:00:00.000Z'));
  });

  it('updates only calculated date and explanation snapshot for overridden occurrences', async () => {
    const existingOccurrence = {
      id: 'occ-overridden', cycleId: 'cycle-1', milestoneKey: 'agm-due', scheduleEntryKey: '',
      deadlineType: 'STATUTORY', calculatedDueDate: new Date('2026-08-31T00:00:00.000Z'),
      operativeDueDate: new Date('2026-10-15T00:00:00.000Z'), dateOverridden: true, status: 'OPEN',
      origin: 'RULE', ruleVersionId: 'old-version',
    };
    const dbMock = reconciliationDb([{
      id: 'cycle-1', tenantId: 'tenant-1', clientServiceId: 'cs-1', ruleId: 'rule-1',
      periodKey: 'ONE_TIME:2026-08-18', generationKey: 'rolling-v1', origin: 'RULE', occurrences: [existingOccurrence],
    }]);

    const result = await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1', clientServiceId: 'cs-1', today: '2026-08-18', horizonEnd: '2027-08-18',
      writeMode: 'APPLY', reconciliationRequestId: 'req-1',
    }, dbMock as never);

    expect(result.preservedByReason.OVERRIDDEN).toBe(1);
    expect(dbMock.deadlineOccurrence.update).toHaveBeenCalledWith({
      where: { id: 'occ-overridden' },
      data: { calculatedDueDate: new Date('2026-09-30T00:00:00.000Z') },
    });
    expect(dbMock.serviceCycle.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cycle-1' },
      data: expect.objectContaining({ sourceSnapshot: expect.anything() }),
    }));
  });

  it('cancels only eligible future open rule occurrences removed from evaluation', async () => {
    const existingOccurrence = {
      id: 'occ-removed', cycleId: 'cycle-1', milestoneKey: 'old-milestone', scheduleEntryKey: '',
      deadlineType: 'STATUTORY', calculatedDueDate: new Date('2026-09-01T00:00:00.000Z'),
      operativeDueDate: new Date('2026-09-01T00:00:00.000Z'), dateOverridden: false, status: 'OPEN',
      origin: 'RULE', ruleVersionId: 'version-1',
    };
    const dbMock = reconciliationDb([{
      id: 'cycle-1', tenantId: 'tenant-1', clientServiceId: 'cs-1', ruleId: 'rule-1',
      periodKey: 'ONE_TIME:2026-08-18', generationKey: 'rolling-v1', origin: 'RULE', occurrences: [existingOccurrence],
    }], reconciliationRule({ currentVersion: {
      id: 'version-1', recurrence: { schemaVersion: 1, kind: 'ONE_TIME' },
      applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] }, configHash: 'config-1',
      parameterDefinitions: [], milestoneTemplates: [],
    } }));

    const result = await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1', clientServiceId: 'cs-1', today: '2026-08-18', horizonEnd: '2027-08-18',
      writeMode: 'APPLY', reconciliationRequestId: 'req-1',
    }, dbMock as never);

    expect(result.counts.cancelled).toBe(1);
    expect(dbMock.deadlineOccurrence.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'occ-removed' },
      data: expect.objectContaining({ status: 'CANCELLED', cancellationReason: expect.any(String) }),
    }));
  });

  it('applies archive mode by cancelling only eligible target-rule occurrences', async () => {
    const dbMock = reconciliationDb([
      {
        id: 'cycle-archive', tenantId: 'tenant-1', clientServiceId: 'cs-1', ruleId: 'rule-1',
        periodKey: '2026', generationKey: 'rolling-v1', origin: 'RULE', occurrences: [
          {
            id: 'occ-archive-open', cycleId: 'cycle-archive', milestoneKey: 'open', scheduleEntryKey: '',
            deadlineType: 'STATUTORY', calculatedDueDate: new Date('2026-09-01T00:00:00.000Z'),
            operativeDueDate: new Date('2026-09-01T00:00:00.000Z'), dateOverridden: false, status: 'OPEN', origin: 'RULE', ruleVersionId: 'version-1',
          },
          {
            id: 'occ-archive-manual', cycleId: 'cycle-archive', milestoneKey: 'manual', scheduleEntryKey: '',
            deadlineType: 'STATUTORY', calculatedDueDate: new Date('2026-09-02T00:00:00.000Z'),
            operativeDueDate: new Date('2026-09-02T00:00:00.000Z'), dateOverridden: false, status: 'OPEN', origin: 'MANUAL_TRIGGER', ruleVersionId: 'version-1',
          },
          {
            id: 'occ-archive-completed', cycleId: 'cycle-archive', milestoneKey: 'completed', scheduleEntryKey: '',
            deadlineType: 'STATUTORY', calculatedDueDate: new Date('2026-09-03T00:00:00.000Z'),
            operativeDueDate: new Date('2026-09-03T00:00:00.000Z'), dateOverridden: false, status: 'COMPLETED', origin: 'RULE', ruleVersionId: 'version-1',
          },
          {
            id: 'occ-archive-history', cycleId: 'cycle-archive', milestoneKey: 'history', scheduleEntryKey: '',
            deadlineType: 'STATUTORY', calculatedDueDate: new Date('2026-07-03T00:00:00.000Z'),
            operativeDueDate: new Date('2026-07-03T00:00:00.000Z'), dateOverridden: false, status: 'OPEN', origin: 'RULE', ruleVersionId: 'version-1',
          },
        ],
      },
    ], reconciliationRule({ isActive: false, archivedAt: new Date('2026-08-18T00:00:00.000Z') }));

    const result = await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1', clientServiceId: 'cs-1', ruleId: 'rule-1', operation: 'ARCHIVE',
      today: '2026-08-18', horizonEnd: '2027-08-18', writeMode: 'APPLY', reconciliationRequestId: 'req-archive',
    }, dbMock as never);

    expect(result.counts).toMatchObject({ cancelled: 1, preserved: 3, created: 0, recalculated: 0 });
    expect(dbMock.serviceCycle.upsert).not.toHaveBeenCalled();
    expect(dbMock.deadlineOccurrence.upsert).not.toHaveBeenCalled();
    expect(dbMock.deadlineOccurrence.update).toHaveBeenCalledTimes(1);
    expect(dbMock.deadlineOccurrence.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'occ-archive-open' },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
  });

  it('does not cancel another rule during a rule-scoped publish cleanup', async () => {
    const dbMock = reconciliationDb([{
      id: 'cycle-other', tenantId: 'tenant-1', clientServiceId: 'cs-1', ruleId: 'rule-2',
      periodKey: 'OTHER', generationKey: 'rolling-v1', origin: 'RULE', occurrences: [{
        id: 'occ-other', cycleId: 'cycle-other', milestoneKey: 'other', scheduleEntryKey: '',
        deadlineType: 'STATUTORY', calculatedDueDate: new Date('2026-09-01T00:00:00.000Z'),
        operativeDueDate: new Date('2026-09-01T00:00:00.000Z'), dateOverridden: false, status: 'OPEN',
        origin: 'RULE', ruleVersionId: 'version-2',
      }],
    }]);

    await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1', clientServiceId: 'cs-1', ruleId: 'rule-1', operation: 'PUBLISH',
      today: '2026-08-18', horizonEnd: '2027-08-18', writeMode: 'APPLY', reconciliationRequestId: 'req-publish-scope',
    }, dbMock as never);

    expect(dbMock.deadlineOccurrence.update).not.toHaveBeenCalled();
  });

  it('does not cancel another rule during a rule-scoped archive cleanup', async () => {
    const dbMock = reconciliationDb([{
      id: 'cycle-other', tenantId: 'tenant-1', clientServiceId: 'cs-1', ruleId: 'rule-2',
      periodKey: 'OTHER', generationKey: 'rolling-v1', origin: 'RULE', occurrences: [{
        id: 'occ-other', cycleId: 'cycle-other', milestoneKey: 'other', scheduleEntryKey: '',
        deadlineType: 'STATUTORY', calculatedDueDate: new Date('2026-09-01T00:00:00.000Z'),
        operativeDueDate: new Date('2026-09-01T00:00:00.000Z'), dateOverridden: false, status: 'OPEN',
        origin: 'RULE', ruleVersionId: 'version-2',
      }],
    }], reconciliationRule({ isActive: false, archivedAt: new Date('2026-08-18T00:00:00.000Z') }));

    await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1', clientServiceId: 'cs-1', ruleId: 'rule-1', operation: 'ARCHIVE',
      today: '2026-08-18', horizonEnd: '2027-08-18', writeMode: 'APPLY', reconciliationRequestId: 'req-archive-scope',
    }, dbMock as never);

    expect(dbMock.deadlineOccurrence.update).not.toHaveBeenCalled();
  });

  it('returns a structured permanent warning for production evaluator missing input', async () => {
    const dbMock = reconciliationDb([], reconciliationRule({
      currentVersion: {
        id: 'version-1', recurrence: { schemaVersion: 1, kind: 'ONE_TIME' },
        applicability: {
          schemaVersion: 1, kind: 'ALL',
          conditions: [{ kind: 'FIELD_EQUALS', field: 'entityType', value: 'PRIVATE_LIMITED' }],
        }, configHash: 'config-1', parameterDefinitions: [], milestoneTemplates: [],
      },
    }));

    const result = await reconcileClientServiceDeadlines({
      tenantId: 'tenant-1', clientServiceId: 'cs-1', today: '2026-08-18', horizonEnd: '2027-08-18',
      writeMode: 'APPLY', reconciliationRequestId: 'req-missing-input',
    }, dbMock as never);

    expect(result.warnings).toEqual([expect.objectContaining({
      code: 'MISSING_INPUT', ruleId: 'rule-1', permanent: true, missingFields: ['entityType'],
    })]);
  });
});

describe('projectDeadlineRule', () => {
  const common = {
    today: '2026-08-27' as DateOnly,
    horizonEnd: '2027-08-27' as DateOnly,
    accountsDueDate: '2024-07-31' as DateOnly,
  };

  function projectionInput(overrides: Partial<DeadlineRuleProjectionInput> = {}): DeadlineRuleProjectionInput {
    return {
      ruleId: 'annual-return-rule',
      ruleCode: 'SG_ANNUAL_RETURN',
      ruleVersionId: 'version-1',
      recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
      applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
      parameters: {},
      scheduleEntries: [],
      milestones: [{
        key: 'annual-return-due',
        name: 'Annual Return due',
        description: null,
        type: 'STATUTORY',
        generationMode: 'ONCE_PER_CYCLE',
        expression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
        businessDayAdjustment: 'NONE',
        displayOrder: 0,
        isActive: true,
      }],
      company: { accountsDueDate: common.accountsDueDate },
      calendar: {
        id: 'sg-calendar',
        timeZone: 'Asia/Singapore',
        revision: 1,
        weekendDays: new Set([0, 6]),
        holidays: new Set<DateOnly>(),
      },
      today: common.today,
      horizonEnd: common.horizonEnd,
      ...overrides,
    };
  }

  function agmInput(ruleId: string): DeadlineRuleProjectionInput {
    return projectionInput({
      ruleId,
      ruleCode: 'SG_AGM_DUE',
      milestones: [{
        key: 'agm-due',
        name: 'AGM due',
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
    });
  }

  it('projects one in-window Annual Return for a future source date', () => {
    const projection = projectDeadlineRule(projectionInput({
      company: { accountsDueDate: '2027-07-31' },
    }));

    expect(projection.materializationPolicy).toBe('AUTHORITATIVE_ANNUAL_BACKLOG');
    expect(projection.occurrences).toEqual([
      expect.objectContaining({
        milestoneKey: 'annual-return-due',
        calculatedDueDate: '2027-07-31',
      }),
    ]);
  });

  it('projects the exact authoritative AGM and Annual Return backlog for a 2024 source', () => {
    const occurrences = [
      ...projectDeadlineRule(agmInput('agm-rule')).occurrences,
      ...projectDeadlineRule(projectionInput()).occurrences,
    ].sort((left, right) => left.calculatedDueDate.localeCompare(right.calculatedDueDate));

    expect(occurrences.map(({ milestoneKey, calculatedDueDate }) => ({
      milestoneKey,
      calculatedDueDate,
    }))).toEqual([
      { milestoneKey: 'agm-due', calculatedDueDate: '2024-06-30' },
      { milestoneKey: 'annual-return-due', calculatedDueDate: '2024-07-31' },
      { milestoneKey: 'agm-due', calculatedDueDate: '2025-06-30' },
      { milestoneKey: 'annual-return-due', calculatedDueDate: '2025-07-31' },
      { milestoneKey: 'agm-due', calculatedDueDate: '2026-06-30' },
      { milestoneKey: 'annual-return-due', calculatedDueDate: '2026-07-31' },
      { milestoneKey: 'agm-due', calculatedDueDate: '2027-06-30' },
      { milestoneKey: 'annual-return-due', calculatedDueDate: '2027-07-31' },
    ]);
    expect(occurrences.every(({ calculatedDueDate }) => calculatedDueDate <= '2027-08-27')).toBe(true);
  });

  it.each(['SG_ECI', 'SG_FORM_C', 'SG_CUSTOM_ANNUAL'])(
    'resolves %s to ROLLING_HORIZON even when its expression reads accountsDueDate',
    (ruleCode) => {
      const projection = projectDeadlineRule(projectionInput({
        ruleCode,
        company: { accountsDueDate: common.accountsDueDate },
      }));

      expect(projection.materializationPolicy).toBe('ROLLING_HORIZON');
      expect(projection.occurrences.map(({ calculatedDueDate }) => calculatedDueDate))
        .toEqual(['2027-07-31']);
    },
  );

  it('keeps non-backlog rules inside the rolling window and produces no pre-today occurrences', () => {
    const projection = projectDeadlineRule(projectionInput({
      ruleCode: 'SG_ECI',
      company: { accountsDueDate: '2024-07-31' },
    }));

    expect(projection.occurrences).toHaveLength(1);
    expect(projection.occurrences[0]?.calculatedDueDate).toBe('2027-07-31');
    expect(projection.occurrences.every(({ calculatedDueDate }) => calculatedDueDate >= common.today)).toBe(true);
  });

  it.each(['sg_agm_due', 'SG_AGM_DUE_CUSTOM', 'Annual General Meeting'])(
    'does not enable authoritative backlog for near-match code %s',
    (ruleCode) => {
      const projection = projectDeadlineRule(projectionInput({
        ruleCode,
        company: { accountsDueDate: common.accountsDueDate },
      }));
      expect(projection.materializationPolicy).toBe('ROLLING_HORIZON');
      expect(projection.warnings.every((warning) => warning.code !== 'AUTHORITATIVE_BACKLOG_TRUNCATED')).toBe(true);
      expect(projection.occurrences.every(({ calculatedDueDate }) => calculatedDueDate >= common.today && calculatedDueDate <= common.horizonEnd)).toBe(true);
    },
  );

  it('caps a 28-cycle authoritative range at the most recent 20 cycles with one truncation warning', () => {
    const projection = projectDeadlineRule(projectionInput({
      ruleId: 'annual-return-rule',
      company: { accountsDueDate: '2000-07-31' },
    }));

    expect(projection.periods).toHaveLength(20);
    expect(projection.periods[0]?.periodKey).toBe('2008');
    expect(projection.periods.at(-1)?.periodKey).toBe('2027');
    expect(projection.occurrences).toHaveLength(20);
    expect(projection.occurrences.at(-1)?.calculatedDueDate).toBe('2027-07-31');
    expect(projection.warnings).toContainEqual(expect.objectContaining({
      code: 'AUTHORITATIVE_BACKLOG_TRUNCATED',
      ruleId: 'annual-return-rule',
      excludedCycleCount: 8,
      oldestRetainedYear: 2008,
    }));
  });

  it('never projects an occurrence beyond the horizon for the truncated final period', () => {
    const projection = projectDeadlineRule(projectionInput({
      company: { accountsDueDate: '2000-07-31' },
    }));

    expect(projection.occurrences.every(({ calculatedDueDate }) => calculatedDueDate <= common.horizonEnd)).toBe(true);
  });

  it('collapses duplicate occurrence tuples from adjacent periods deterministically', () => {
    const projection = projectDeadlineRule(projectionInput({
      ruleCode: 'SG_ECI',
      company: { accountsDueDate: '2027-07-31' },
    }));

    expect(projection.occurrences.map(({ calculatedDueDate }) => calculatedDueDate)).toEqual(['2027-07-31']);
  });

  it('returns a missing-input warning and no occurrences for a non-annual authoritative rule', () => {
    const projection = projectDeadlineRule(projectionInput({
      recurrence: { schemaVersion: 1, kind: 'ONE_TIME' },
    }));

    expect(projection.occurrences).toEqual([]);
    expect(projection.applicability.state).toBe('MISSING_INPUT');
    expect(projection.warnings).toContainEqual(expect.objectContaining({
      code: 'MISSING_INPUT',
      ruleId: 'annual-return-rule',
    }));
  });

  it('returns a missing-input warning and no occurrences when accountsDueDate is absent', () => {
    const projection = projectDeadlineRule(projectionInput({
      company: {},
    }));

    expect(projection.occurrences).toEqual([]);
    expect(projection.applicability.state).toBe('MISSING_INPUT');
    expect(projection.warnings).toContainEqual(expect.objectContaining({
      code: 'MISSING_INPUT',
      missingFields: ['accountsDueDate'],
    }));
  });
});
