import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('manual deadline billing PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

type PrismaClient = Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;

const scheduleConfig = {
  schemaVersion: 1,
  cadence: 'MONTHLY',
  startDate: '2026-08-01',
  customInterval: { unit: 'MONTH', count: 1 },
  scheduleEntries: [{
    key: 'default',
    label: 'Billing date',
    expression: { kind: 'DAY_OF_MONTH', day: 1 },
    businessDayAdjustment: 'NONE',
  }],
};

describePostgres('manual historical deadline never creates billing work', () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let userId: string;
  let companyId: string;
  let serviceId: string;
  let versionId: string;
  let requestId: string | undefined;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import('@/lib/prisma')).getPrisma();
    const fixture = await seedFixture(prisma);
    tenantId = fixture.tenantId;
    userId = fixture.userId;
    companyId = fixture.companyId;
    serviceId = fixture.serviceId;
    versionId = fixture.versionId;
  });

  afterAll(async () => {
    if (!prisma || !tenantId) return;
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.deadlineOccurrence.deleteMany({ where: { tenantId } });
    await prisma.serviceCycle.deleteMany({ where: { tenantId } });
    await prisma.billingCoverageIssue.deleteMany({ where: { tenantId } });
    await prisma.billingOccurrence.deleteMany({ where: { tenantId } });
    await prisma.serviceScheduleReconciliationRequest.deleteMany({ where: { tenantId } });
    await prisma.clientServiceDeadlineRule.deleteMany({ where: { tenantId } });
    await prisma.clientServiceFeeLine.deleteMany({ where: { tenantId } });
    await prisma.clientService.deleteMany({ where: { tenantId } });
    await prisma.deadlineMilestoneTemplate.deleteMany({ where: { tenantId } });
    await prisma.deadlineRule.updateMany({ where: { tenantId }, data: { currentVersionId: null } });
    await prisma.deadlineRuleVersion.deleteMany({ where: { tenantId } });
    await prisma.deadlineRule.deleteMany({ where: { tenantId } });
    await prisma.serviceVariant.deleteMany({ where: { tenantId } });
    await prisma.serviceFamily.deleteMany({ where: { tenantId } });
    await prisma.templatePartial.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.workspace.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it('does not enqueue or materialize billing when applying a historical manual deadline cycle', async () => {
    const {
      previewManualDeadlineCycle,
      createManualDeadlineCycle,
    } = await import('@/services/deadline/manual-cycle');
    const { enqueueScheduleReconciliation } = await import('@/services/schedule-reconciliation/queue');
    const { processScheduleReconciliationBatch } = await import('@/services/schedule-reconciliation/worker');

    const actor = {
      tenantId,
      userId,
      accessibleCompanyIds: [companyId],
      allCompaniesAccess: false,
    };
    const period = {
      ruleVersionId: versionId,
      periodKey: 'historical-2025',
      periodStart: '2025-01-01' as const,
      periodEnd: '2025-12-31' as const,
      parameterOverrides: {},
      scheduleEntries: [],
      sourceValues: {},
    };

    await prisma.$transaction(async (tx) => {
      const queued = await enqueueScheduleReconciliation(tx, {
        tenantId,
        scopeType: 'CLIENT_SERVICE',
        scopeId: serviceId,
        triggerType: 'TEST_BASELINE',
        correlationId: 'manual-deadline-baseline',
        requestedById: userId,
        notBefore: new Date('2026-08-18T00:00:00.000Z'),
      });
      requestId = queued.id;
    });

    const baseline = await processScheduleReconciliationBatch({
      limit: 20,
      concurrency: 1,
      now: new Date('2026-08-18T00:00:00.000Z'),
    });
    expect(baseline).toMatchObject({ claimed: 1, completed: 1, failed: 0, leaseLost: 0 });

    const beforeBillingCount = await prisma.billingOccurrence.count({ where: { tenantId, clientServiceId: serviceId } });
    expect(beforeBillingCount).toBeGreaterThan(0);
    const beforeRequestCount = await prisma.serviceScheduleReconciliationRequest.count({ where: { tenantId } });

    const preview = await previewManualDeadlineCycle(serviceId, period, actor);
    expect(preview.milestones.length).toBeGreaterThan(0);
    const result = await createManualDeadlineCycle(serviceId, {
      ...period,
      previewFingerprint: preview.previewFingerprint,
      notes: 'Historical deadline context',
      selections: preview.milestones.map((milestone) => ({
        milestoneKey: milestone.milestoneKey,
        scheduleEntryKey: milestone.scheduleEntryKey,
        include: true,
        operativeDueDate: milestone.calculatedDueDate,
        status: 'COMPLETED' as const,
        completionDate: milestone.calculatedDueDate,
      })),
    }, actor);
    expect(result.includedCount).toBeGreaterThan(0);
    expect(await prisma.deadlineOccurrence.count({ where: { tenantId, origin: 'MANUAL_TRIGGER' } })).toBe(result.includedCount);

    expect(await prisma.serviceScheduleReconciliationRequest.count({ where: { tenantId } })).toBe(beforeRequestCount);
    expect(await prisma.serviceScheduleReconciliationRequest.count({ where: { tenantId, triggerType: 'MANUAL_DEADLINE_CYCLE' } })).toBe(0);

    const afterManualWorker = await processScheduleReconciliationBatch({
      limit: 20,
      concurrency: 1,
      now: new Date('2026-08-18T00:00:00.000Z'),
    });
    expect(afterManualWorker.claimed).toBe(0);
    expect(await prisma.billingOccurrence.count({ where: { tenantId, clientServiceId: serviceId } })).toBe(beforeBillingCount);
    expect(await prisma.serviceScheduleReconciliationRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: 'COMPLETED' });
  });
});

async function seedFixture(prisma: PrismaClient): Promise<{
  tenantId: string;
  userId: string;
  companyId: string;
  serviceId: string;
  versionId: string;
}> {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const companyId = randomUUID();
  const partialId = randomUUID();
  const familyId = randomUUID();
  const variantId = randomUUID();
  const serviceId = randomUUID();
  const feeLineId = randomUUID();
  const ruleId = randomUUID();
  const versionId = randomUUID();
  const suffix = tenantId.replaceAll('-', '').slice(0, 12);

  await prisma.workspace.create({
    data: {
      id: tenantId,
      name: 'Manual deadline billing workspace',
      slug: `manual-deadline-${suffix}`,
      status: 'ACTIVE',
      settings: { servicesWorkspace: { enabled: true, deadlineWritesEnabled: true } },
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      tenantId,
      email: `${suffix}@example.test`,
      passwordHash: 'integration-only',
      firstName: 'Manual',
      lastName: 'Deadline',
    },
  });
  await prisma.templatePartial.create({
    data: {
      id: partialId,
      tenantId,
      name: `Manual deadline partial ${suffix}`,
      content: '<p>Manual deadline service</p>',
      createdById: userId,
    },
  });
  await prisma.serviceFamily.create({
    data: {
      id: familyId,
      tenantId,
      code: `MANUAL_${suffix}`,
      name: 'Manual deadline family',
      displayColor: '#2F6F5E',
    },
  });
  await prisma.serviceVariant.create({
    data: {
      id: variantId,
      tenantId,
      familyId,
      sowPartialId: partialId,
      code: `MANUAL_SERVICE_${suffix}`,
      name: 'Manual deadline service',
      serviceCadence: 'MONTHLY',
    },
  });
  await prisma.company.create({
    data: {
      id: companyId,
      tenantId,
      uen: `M${suffix.toUpperCase()}`,
      name: 'Manual deadline company',
      entityType: 'PRIVATE_LIMITED',
      status: 'LIVE',
    },
  });
  await prisma.deadlineRule.create({
    data: {
      id: ruleId,
      tenantId,
      code: `MANUAL_RULE_${suffix}`,
      name: 'Manual historical rule',
    },
  });
  await prisma.deadlineRuleVersion.create({
    data: {
      id: versionId,
      tenantId,
      ruleId,
      version: 1,
      state: 'PUBLISHED',
      schemaVersion: 1,
      configHash: 'a'.repeat(64),
      recurrence: { schemaVersion: 1, kind: 'ONE_TIME' },
      applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
      milestoneTemplates: {
        create: {
          tenantId,
          milestoneKey: 'historical-review',
          name: 'Historical review',
          type: 'CLIENT',
          generationMode: 'ONCE_PER_CYCLE',
          dateExpression: { kind: 'SOURCE', source: { kind: 'CYCLE_START' } },
          businessDayAdjustment: 'NONE',
          displayOrder: 0,
        },
      },
    },
  });
  await prisma.deadlineRule.update({ where: { id: ruleId }, data: { currentVersionId: versionId } });
  await prisma.clientService.create({
    data: {
      id: serviceId,
      tenantId,
      companyId,
      source: 'MANUAL',
      serviceVariantId: variantId,
      familyName: 'Manual deadline family',
      serviceName: 'Manual deadline service',
      status: 'ACTIVE',
      serviceCadence: 'MONTHLY',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      billingDisposition: 'CONFIGURED',
      deadlineRules: {
        create: {
          tenantId,
          ruleId,
          enabled: true,
          scheduleEntries: [],
          parameterValues: {},
        },
      },
      feeLines: {
        create: {
          id: feeLineId,
          tenantId,
          description: 'Monthly tracking fee',
          amount: '125.00',
          currency: 'SGD',
          billingFrequency: 'MONTHLY',
          billingStartDate: new Date('2026-08-01T00:00:00.000Z'),
          scheduleConfig,
        },
      },
    },
  });

  return { tenantId, userId, companyId, serviceId, versionId };
}
