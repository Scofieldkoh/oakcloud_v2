import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

describePostgres('deadline reconciliation PostgreSQL integration', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let tenantId: string;
  let companyId: string;
  let variantId: string;
  let ruleId: string;
  let versionId: string;
  let draftVersionId: string;
  let clientServiceId: string;
  let userId: string;
  let sowPartialId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import('@/lib/prisma')).getPrisma();
    tenantId = randomUUID();
    companyId = randomUUID();
    variantId = randomUUID();
    ruleId = randomUUID();
    versionId = randomUUID();
    draftVersionId = randomUUID();
    clientServiceId = randomUUID();
    userId = randomUUID();
    sowPartialId = randomUUID();

    // Create workspace
    await prisma.workspace.create({
      data: {
        id: tenantId,
        name: `Reconciliation Tenant ${tenantId}`,
        slug: `recon-${tenantId}`,
        settings: {
          servicesWorkspace: {
            enabled: true,
            deadlineWritesEnabled: true,
          },
        },
      },
    });

    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: `${userId}@example.test`,
        passwordHash: 'integration-only',
        firstName: 'Integration',
        lastName: 'Worker',
      },
    });

    await prisma.templatePartial.create({
      data: {
        id: sowPartialId,
        tenantId,
        name: `reconcile-sow-${tenantId}`,
        content: 'Integration SOW',
        createdById: userId,
      },
    });

    // Create company
    await prisma.company.create({
      data: {
        id: companyId,
        tenantId,
        uen: `T${randomUUID().slice(0, 8).toUpperCase()}`,
        name: `Integration Reconcile Co ${tenantId}`,
        entityType: 'PRIVATE_LIMITED',
        status: 'LIVE',
        financialYearEndDay: 31,
        financialYearEndMonth: 12,
        incorporationDate: new Date('2022-01-01T00:00:00.000Z'),
      },
    });

    // Create family and variant
    const family = await prisma.serviceFamily.create({
      data: {
        tenantId,
        code: `FAM_${tenantId.slice(0, 6)}`,
        name: 'Corporate Secretarial',
        displayColor: '#0F766E',
        displayOrder: 1,
      },
    });

    await prisma.serviceVariant.create({
      data: {
        id: variantId,
        tenantId,
        familyId: family.id,
        sowPartialId,
        code: `ANNUAL_${tenantId.slice(0, 6)}`,
        name: 'Annual Compliance',
        serviceCadence: 'ANNUALLY',
      },
    });

    // Create published rule
    await prisma.deadlineRule.create({
      data: {
        id: ruleId,
        tenantId,
        code: `RULE_${tenantId.slice(0, 6)}`,
        name: 'AGM and Annual Return',
        versions: {
          create: {
            id: versionId,
            tenantId,
            version: 1,
            state: 'PUBLISHED',
            schemaVersion: 1,
            configHash: 'a'.repeat(64),
            draftRevision: 1,
            recurrence: { schemaVersion: 1, kind: 'ANNUALLY', interval: 1 },
            applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
            milestoneTemplates: {
              create: [
                {
                  tenantId,
                  milestoneKey: 'agm-due',
                  name: 'AGM Due',
                  type: 'STATUTORY',
                  generationMode: 'ONCE_PER_CYCLE',
                  dateExpression: {
                    kind: 'RELATIVE_TO_SOURCE',
                    source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
                    offset: 6,
                    unit: 'CALENDAR_DAY',
                  },
                  businessDayAdjustment: 'NONE',
                  displayOrder: 1,
                },
              ],
            },
          },
        },
      },
    });
    await prisma.deadlineRule.update({ where: { id: ruleId }, data: { currentVersionId: versionId } });

    await prisma.deadlineRuleVersion.create({
      data: {
        id: draftVersionId,
        tenantId,
        ruleId,
        version: 0,
        state: 'DRAFT',
        schemaVersion: 1,
        configHash: 'b'.repeat(64),
        draftRevision: 2,
        recurrence: { schemaVersion: 1, kind: 'ANNUALLY', interval: 1 },
        applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
        milestoneTemplates: {
          create: {
            tenantId,
            milestoneKey: 'agm-due',
            name: 'AGM Due',
            type: 'STATUTORY',
            generationMode: 'ONCE_PER_CYCLE',
            dateExpression: {
              kind: 'RELATIVE_TO_SOURCE',
              source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
              offset: 6,
              unit: 'CALENDAR_DAY',
            },
            businessDayAdjustment: 'NONE',
            displayOrder: 1,
          },
        },
      },
    });

    // Create client service with attached rule
    await prisma.clientService.create({
      data: {
        id: clientServiceId,
        tenantId,
        companyId,
        source: 'MANUAL',
        serviceVariantId: variantId,
        familyName: 'Corporate Secretarial',
        serviceName: 'Annual Compliance',
        status: 'ACTIVE',
        serviceCadence: 'ANNUALLY',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        deadlineRules: {
          create: {
            tenantId,
            ruleId,
            enabled: true,
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.deadlineOccurrenceCoverageLink.deleteMany({ where: { tenantId } });
    await prisma.deadlineResponsibilityChange.deleteMany({ where: { tenantId } });
    await prisma.companyComplianceIssue.deleteMany({ where: { tenantId } });
    await prisma.clientServiceObligationScope.deleteMany({ where: { tenantId } });
    await prisma.companyMonitoringCoverage.deleteMany({ where: { tenantId } });
    await prisma.companyFinancialPeriod.deleteMany({ where: { tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.billingCoverageIssue.deleteMany({ where: { tenantId } });
    await prisma.billingOccurrence.deleteMany({ where: { tenantId } });
    await prisma.deadlineOccurrence.deleteMany({ where: { tenantId } });
    await prisma.serviceCycle.deleteMany({ where: { tenantId } });
    await prisma.clientServiceDeadlineRule.deleteMany({ where: { tenantId } });
    await prisma.clientService.deleteMany({ where: { tenantId } });
    await prisma.serviceVariantDeadlineRule.deleteMany({ where: { tenantId } });
    await prisma.deadlineMilestoneTemplate.deleteMany({ where: { ruleVersion: { rule: { tenantId } } } });
    await prisma.deadlineRule.updateMany({ where: { tenantId }, data: { currentVersionId: null } });
    await prisma.deadlineRuleVersion.deleteMany({ where: { rule: { tenantId } } });
    await prisma.deadlineRule.deleteMany({ where: { tenantId } });
    await prisma.serviceVariant.deleteMany({ where: { tenantId } });
    await prisma.serviceFamily.deleteMany({ where: { tenantId } });
    await prisma.serviceScheduleReconciliationRequest.deleteMany({ where: { tenantId } });
    await prisma.templatePartial.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.workspace.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it('claims, materializes occurrences, and completes reconciliation request', async () => {
    const { enqueueScheduleReconciliation, processScheduleReconciliationBatch } =
      await import('@/services/schedule-reconciliation');
    const { previewDeadlineRuleImpact } = await import('@/services/deadline-rule');

    const preview = await previewDeadlineRuleImpact(ruleId, {
      operation: 'PUBLISH',
      expectedCurrentVersion: 1,
      expectedDraftRevision: 2,
      draftConfigHash: 'b'.repeat(64),
    }, { tenantId, userId }, { now: () => '2026-08-18' });
    expect(preview.counts.created).toBeGreaterThan(0);

    await enqueueScheduleReconciliation(prisma, {
      tenantId,
      scopeType: 'CLIENT_SERVICE',
      scopeId: clientServiceId,
      triggerType: 'CLIENT_SERVICE_CREATED',
      correlationId: 'test-req-1',
      requestedById: null,
    });

    const batchResult = await processScheduleReconciliationBatch({ limit: 10, concurrency: 2 });
    expect(batchResult.claimed).toBeGreaterThanOrEqual(1);

    const occurrences = await prisma.deadlineOccurrence.findMany({
      where: { tenantId, clientServiceId },
    });
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    expect(occurrences[0]).toMatchObject({
      milestoneKey: 'agm-due',
      status: 'OPEN',
      origin: 'RULE',
    });
    const previewDates = preview.samples
      .filter((sample) => sample.action === 'CREATE')
      .map((sample) => sample.newDate)
      .filter((date) => date !== null)
      .sort();
    const reconciledDates = occurrences
      .map((occurrence) => occurrence.calculatedDueDate.toISOString().slice(0, 10))
      .sort();
    expect(reconciledDates).toEqual(previewDates);

    const requests = await prisma.serviceScheduleReconciliationRequest.findMany({
      where: { tenantId, scopeId: clientServiceId },
    });
    expect(requests.every((r) => r.status === 'COMPLETED')).toBe(true);
  });

  it('survives concurrent reconciliation and reclaimed processing with one stable occurrence', async () => {
    const { reconcileClientServiceDeadlines, enqueueScheduleReconciliation, processScheduleReconciliationBatch } =
      await import('@/services/schedule-reconciliation');

    await prisma.deadlineOccurrence.deleteMany({ where: { tenantId, clientServiceId } });
    await prisma.serviceCycle.deleteMany({ where: { tenantId, clientServiceId } });
    await prisma.serviceScheduleReconciliationRequest.deleteMany({ where: { tenantId, scopeId: clientServiceId } });

    const reconciliationInput = {
      tenantId,
      clientServiceId,
      today: '2026-08-18' as const,
      horizonEnd: '2027-08-18' as const,
      writeMode: 'APPLY' as const,
      reconciliationRequestId: randomUUID(),
    };
    const attempts = await Promise.all([
      prisma.$transaction((tx) => reconcileClientServiceDeadlines(reconciliationInput, tx)),
      prisma.$transaction((tx) => reconcileClientServiceDeadlines({
        ...reconciliationInput,
        reconciliationRequestId: randomUUID(),
      }, tx)),
    ]);
    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt) => attempt.counts.created).sort()).toEqual([0, 1]);
    expect(attempts.reduce((created, attempt) => created + attempt.counts.created, 0)).toBe(1);

    const occurrences = await prisma.deadlineOccurrence.findMany({ where: { tenantId, clientServiceId } });
    expect(occurrences).toHaveLength(1);

    await enqueueScheduleReconciliation(prisma, {
      tenantId,
      scopeType: 'CLIENT_SERVICE',
      scopeId: clientServiceId,
      triggerType: 'CLIENT_SERVICE_CONFIGURATION_CHANGED',
      correlationId: 'reclaimed-worker-request',
      requestedById: null,
      notBefore: new Date('2026-08-18T01:00:00.000Z'),
    });
    const request = await prisma.serviceScheduleReconciliationRequest.findFirst({
      where: { tenantId, scopeId: clientServiceId, triggerType: 'CLIENT_SERVICE_CONFIGURATION_CHANGED' },
    });
    expect(request).not.toBeNull();
    await prisma.serviceScheduleReconciliationRequest.update({
      where: { id: request!.id },
      data: {
        status: 'PROCESSING',
        leaseOwner: 'expired-worker',
        leaseExpiresAt: new Date('2026-08-18T00:59:00.000Z'),
      },
    });

    const reclaimed = await processScheduleReconciliationBatch({
      limit: 1,
      concurrency: 1,
      now: new Date('2026-08-18T01:00:00.000Z'),
    });
    expect(reclaimed).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(await prisma.serviceScheduleReconciliationRequest.findUnique({ where: { id: request!.id } }))
      .toMatchObject({ status: 'COMPLETED', leaseOwner: null, leaseExpiresAt: null });
    expect(await prisma.deadlineOccurrence.count({ where: { tenantId, clientServiceId } })).toBe(1);
  });

  async function seedRuleFixture(code: string, milestones: Array<{ key: string; name: string; expression: Record<string, unknown> }>) {
    const ruleId = randomUUID();
    const versionId = randomUUID();
    // Rule codes are unique per workspace and the tests below reuse real codes, so retire the earlier test's rule code.
    await prisma.deadlineRule.updateMany({ where: { tenantId, code }, data: { code: `${code}_${ruleId.slice(0, 8)}` } });
    await prisma.deadlineRule.create({
      data: {
        id: ruleId,
        tenantId,
        code,
        name: code,
        versions: {
          create: {
            id: versionId,
            tenantId,
            version: 1,
            state: 'PUBLISHED',
            schemaVersion: 1,
            configHash: randomUUID().padEnd(64, '0'),
            draftRevision: 1,
            recurrence: { schemaVersion: 1, kind: 'ANNUALLY', interval: 1 },
            applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
            milestoneTemplates: {
              create: milestones.map((milestone, index) => ({
                tenantId,
                milestoneKey: milestone.key,
                name: milestone.name,
                type: 'STATUTORY',
                generationMode: 'ONCE_PER_CYCLE',
                dateExpression: milestone.expression as never,
                businessDayAdjustment: 'NONE',
                displayOrder: index,
              })),
            },
          },
        },
      } as never,
    });
    await prisma.deadlineRule.update({ where: { id: ruleId }, data: { currentVersionId: versionId } });
    await prisma.serviceVariantDeadlineRule.create({
      data: { tenantId, serviceVariantId: variantId, ruleId },
    });
    return ruleId;
  }

  async function seedFixtureService(accountsDueDate: string, rules: string[]) {
    const fixtureCompanyId = randomUUID();
    const fixtureServiceId = randomUUID();
    await prisma.company.create({
      data: {
        id: fixtureCompanyId,
        tenantId,
        uen: `T${randomUUID().slice(0, 8).toUpperCase()}`,
        name: `Fixture Co ${fixtureCompanyId}`,
        entityType: 'PRIVATE_LIMITED',
        status: 'LIVE',
        financialYearEndDay: 31,
        financialYearEndMonth: 12,
        accountsDueDate: new Date(`${accountsDueDate}T00:00:00.000Z`),
        incorporationDate: new Date('2022-01-01T00:00:00.000Z'),
      },
    });
    await prisma.clientService.create({
      data: {
        id: fixtureServiceId,
        tenantId,
        companyId: fixtureCompanyId,
        source: 'MANUAL',
        serviceVariantId: variantId,
        familyName: 'Corporate Secretarial',
        serviceName: `Fixture Service ${fixtureServiceId}`,
        status: 'ACTIVE',
        serviceCadence: 'ANNUALLY',
        startDate: new Date('2026-08-27T00:00:00.000Z'),
        deadlineRules: {
          create: rules.map((ruleId) => ({ tenantId, ruleId, enabled: true })),
        },
      },
    });
    return { fixtureCompanyId, fixtureServiceId };
  }

  it('reconciles the future-source fixture with exact preview/apply parity', async () => {
    const { previewClientServiceDeadlineConfiguration } = await import('@/services/client-service');
    const { reconcileClientServiceDeadlines } = await import('@/services/schedule-reconciliation');

    const agmRuleId = await seedRuleFixture('SG_AGM_DUE', [{
      key: 'agm-due',
      name: 'AGM Due',
      expression: { kind: 'ADD_MONTHS', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' }, amount: -1 },
    }]);
    const arRuleId = await seedRuleFixture('SG_ANNUAL_RETURN', [{
      key: 'annual-return-due',
      name: 'Annual Return Due',
      expression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
    }]);
    const { fixtureServiceId } = await seedFixtureService('2027-07-31', [agmRuleId, arRuleId]);

    const today = '2026-08-27' as const;
    const horizonEnd = '2027-08-27' as const;
    const service = await prisma.clientService.findUniqueOrThrow({ where: { id: fixtureServiceId } });
    const impact = await previewClientServiceDeadlineConfiguration(fixtureServiceId, {
      expectedUpdatedAt: service.updatedAt.toISOString(),
      deadlineRules: [
        { ruleId: agmRuleId, enabled: true, parameterValues: {}, parameterProvenance: {}, scheduleEntries: [] },
        { ruleId: arRuleId, enabled: true, parameterValues: {}, parameterProvenance: {}, scheduleEntries: [] },
      ],
      scheduleSnapshot: {
        status: 'ACTIVE',
        serviceCadence: 'ANNUALLY',
        customCadenceLabel: null,
        startDate: '2026-08-27',
        endDate: null,
        fieldValues: {},
      },
    }, { tenantId, userId, allCompaniesAccess: true }, prisma, { today, horizonEnd });

    const result = await prisma.$transaction((tx) => reconcileClientServiceDeadlines({
      tenantId,
      clientServiceId: fixtureServiceId,
      today,
      horizonEnd,
      writeMode: 'APPLY',
      reconciliationRequestId: randomUUID(),
    }, tx));
    expect(result.counts.created).toBe(2);

    const occurrences = await prisma.deadlineOccurrence.findMany({
      where: { tenantId, clientServiceId: fixtureServiceId, status: 'OPEN', origin: 'RULE' },
    });
    const reconciledTuples = occurrences
      .map((occurrence) => [occurrence.milestoneKey, occurrence.scheduleEntryKey, occurrence.operativeDueDate.toISOString().slice(0, 10)])
      .sort((left, right) => String(left[2]).localeCompare(String(right[2])));
    const previewTuples = impact.projectedDeadlines
      .map((deadline) => [deadline.milestoneKey, deadline.scheduleEntryKey, deadline.calculatedDueDate])
      .sort((left, right) => String(left[2]).localeCompare(String(right[2])));

    expect(reconciledTuples).toEqual([
      ['agm-due', '', '2027-06-30'],
      ['annual-return-due', '', '2027-07-31'],
    ]);
    expect(previewTuples).toEqual(reconciledTuples);
  });

  it('materializes the exact authoritative backlog with a rolling-only control rule', async () => {
    const { previewClientServiceDeadlineConfiguration } = await import('@/services/client-service');
    const { reconcileClientServiceDeadlines } = await import('@/services/schedule-reconciliation');

    const agmRuleId = await seedRuleFixture('SG_AGM_DUE', [{
      key: 'agm-due',
      name: 'AGM Due',
      expression: { kind: 'ADD_MONTHS', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' }, amount: -1 },
    }]);
    const arRuleId = await seedRuleFixture('SG_ANNUAL_RETURN', [{
      key: 'annual-return-due',
      name: 'Annual Return Due',
      expression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
    }]);
    const eciRuleId = await seedRuleFixture('SG_ECI', [{
      key: 'eci-due',
      name: 'ECI Due',
      expression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
    }]);
    const { fixtureServiceId } = await seedFixtureService('2024-07-31', [agmRuleId, arRuleId, eciRuleId]);

    const today = '2026-08-27' as const;
    const horizonEnd = '2027-08-27' as const;
    const service = await prisma.clientService.findUniqueOrThrow({ where: { id: fixtureServiceId } });
    const impact = await previewClientServiceDeadlineConfiguration(fixtureServiceId, {
      expectedUpdatedAt: service.updatedAt.toISOString(),
      deadlineRules: [agmRuleId, arRuleId, eciRuleId].map((ruleId) => ({
        ruleId, enabled: true, parameterValues: {}, parameterProvenance: {}, scheduleEntries: [],
      })),
      scheduleSnapshot: {
        status: 'ACTIVE',
        serviceCadence: 'ANNUALLY',
        customCadenceLabel: null,
        startDate: '2026-08-27',
        endDate: null,
        fieldValues: {},
      },
    }, { tenantId, userId, allCompaniesAccess: true }, prisma, { today, horizonEnd });

    const result = await prisma.$transaction((tx) => reconcileClientServiceDeadlines({
      tenantId,
      clientServiceId: fixtureServiceId,
      today,
      horizonEnd,
      writeMode: 'APPLY',
      reconciliationRequestId: randomUUID(),
    }, tx));
    expect(result.counts.created).toBe(9);

    const occurrences = await prisma.deadlineOccurrence.findMany({
      where: { tenantId, clientServiceId: fixtureServiceId, status: 'OPEN', origin: 'RULE' },
    });
    const reconciledTuples = occurrences
      .map((occurrence) => [occurrence.milestoneKey, occurrence.operativeDueDate.toISOString().slice(0, 10)])
      .sort((left, right) => String(left[1]).localeCompare(String(right[1])) || String(left[0]).localeCompare(String(right[0])));
    expect(reconciledTuples).toEqual([
      ['agm-due', '2024-06-30'],
      ['annual-return-due', '2024-07-31'],
      ['agm-due', '2025-06-30'],
      ['annual-return-due', '2025-07-31'],
      ['agm-due', '2026-06-30'],
      ['annual-return-due', '2026-07-31'],
      ['agm-due', '2027-06-30'],
      ['annual-return-due', '2027-07-31'],
      ['eci-due', '2027-07-31'],
    ]);
    const previewTuples = impact.projectedDeadlines
      .map((deadline) => [deadline.milestoneKey, deadline.calculatedDueDate])
      .sort((left, right) => String(left[1]).localeCompare(String(right[1])) || String(left[0]).localeCompare(String(right[0])));
    expect(previewTuples).toEqual(reconciledTuples);
    expect(reconciledTuples.filter(([milestone]) => milestone === 'eci-due'))
      .toEqual([['eci-due', '2027-07-31']]);
  });

  it('caps a 28-cycle authoritative source at the most recent 20 cycles with one truncation warning', async () => {
    const { previewClientServiceDeadlineConfiguration } = await import('@/services/client-service');
    const { reconcileClientServiceDeadlines } = await import('@/services/schedule-reconciliation');

    const arRuleId = await seedRuleFixture('SG_ANNUAL_RETURN', [{
      key: 'annual-return-due',
      name: 'Annual Return Due',
      expression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
    }]);
    const { fixtureServiceId } = await seedFixtureService('2000-07-31', [arRuleId]);

    const today = '2026-08-27' as const;
    const horizonEnd = '2027-08-27' as const;
    const service = await prisma.clientService.findUniqueOrThrow({ where: { id: fixtureServiceId } });
    const impact = await previewClientServiceDeadlineConfiguration(fixtureServiceId, {
      expectedUpdatedAt: service.updatedAt.toISOString(),
      deadlineRules: [{ ruleId: arRuleId, enabled: true, parameterValues: {}, parameterProvenance: {}, scheduleEntries: [] }],
      scheduleSnapshot: {
        status: 'ACTIVE',
        serviceCadence: 'ANNUALLY',
        customCadenceLabel: null,
        startDate: '2026-08-27',
        endDate: null,
        fieldValues: {},
      },
    }, { tenantId, userId, allCompaniesAccess: true }, prisma, { today, horizonEnd });

    expect(impact.projectedDeadlines).toHaveLength(20);
    expect(impact.projectedDeadlines[0]?.calculatedDueDate).toBe('2008-07-31');
    expect(impact.projectedDeadlines.at(-1)?.calculatedDueDate).toBe('2027-07-31');
    expect(impact.warnings).toContainEqual(expect.objectContaining({
      code: 'AUTHORITATIVE_BACKLOG_TRUNCATED',
      excludedCycleCount: 8,
      oldestRetainedYear: 2008,
    }));

    const result = await prisma.$transaction((tx) => reconcileClientServiceDeadlines({
      tenantId,
      clientServiceId: fixtureServiceId,
      today,
      horizonEnd,
      writeMode: 'APPLY',
      reconciliationRequestId: randomUUID(),
    }, tx));
    expect(result.counts.created).toBe(20);
    const cycles = await prisma.serviceCycle.findMany({ where: { tenantId, clientServiceId: fixtureServiceId } });
    expect(cycles.map((cycle) => cycle.periodKey).sort()).toEqual(Array.from({ length: 20 }, (_, index) => String(2008 + index)));
  });
});
