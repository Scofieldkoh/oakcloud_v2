import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scheduleReconciliationDedupeKey } from '@/services/schedule-reconciliation';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

describePostgres('schedule reconciliation PostgreSQL concurrency', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let tenantId: string;
  let enqueueScheduleReconciliation: typeof import('@/services/schedule-reconciliation')['enqueueScheduleReconciliation'];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import('@/lib/prisma')).getPrisma();
    ({ enqueueScheduleReconciliation } = await import('@/services/schedule-reconciliation'));
    tenantId = randomUUID();
    await prisma.workspace.create({ data: { id: tenantId, name: `Queue concurrency ${tenantId}`, slug: `queue-${tenantId}` } });
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
    await prisma.templatePartial.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.serviceScheduleReconciliationRequest.deleteMany({ where: { tenantId } });
    await prisma.workspace.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it('preserves the true earliest timestamp under concurrent source transactions', async () => {
    const scopeId = randomUUID();
    const inputs = [
      new Date('2026-08-18T01:02:59.000Z'),
      new Date('2026-08-18T01:02:03.000Z'),
    ];
    await Promise.all(inputs.map((notBefore, index) => prisma.$transaction((tx) => enqueueScheduleReconciliation(tx, {
      tenantId,
      scopeType: 'RULE',
      scopeId,
      triggerType: 'RULE_PUBLISHED',
      correlationId: `concurrent-${index}`,
      requestedById: null,
      notBefore,
    }))));
    const row = await prisma.serviceScheduleReconciliationRequest.findFirst({ where: { tenantId, scopeId } });
    expect(row?.nextAttemptAt.toISOString()).toBe(inputs[1]!.toISOString());
  });

  it('does not revoke a processing lease and leaves durable follow-up work', async () => {
    const scopeId = randomUUID();
    const notBefore = new Date('2026-08-18T01:02:59.000Z');
    const dedupeInput = {
      tenantId,
      scopeType: 'RULE' as const,
      scopeId,
      triggerType: 'RULE_PUBLISHED',
    };
    const canonical = await prisma.serviceScheduleReconciliationRequest.create({
      data: {
        tenantId,
        scopeType: 'RULE',
        scopeId,
        triggerType: 'RULE_PUBLISHED',
        correlationId: 'processing-source',
        dedupeKey: scheduleReconciliationDedupeKey(dedupeInput, notBefore),
        status: 'PROCESSING',
        leaseOwner: 'worker-1',
        leaseExpiresAt: new Date('2026-08-18T02:00:00.000Z'),
        nextAttemptAt: new Date('2026-08-18T01:02:03.000Z'),
        requestedById: null,
      },
    });
    await enqueueScheduleReconciliation(prisma, {
      tenantId,
      scopeType: 'RULE',
      scopeId,
      triggerType: 'RULE_PUBLISHED',
      correlationId: 'processing-follow-up',
      requestedById: null,
      notBefore,
    });
    const rows = await prisma.serviceScheduleReconciliationRequest.findMany({ where: { tenantId, scopeId } });
    expect(rows.find((row) => row.id === canonical.id)).toMatchObject({ status: 'PROCESSING', leaseOwner: 'worker-1' });
    expect(rows.filter((row) => row.status === 'PENDING')).toHaveLength(1);
  });

  it('keeps repeat and concurrent execution to one open occurrence per canonical identity', async () => {
    const { reconcileClientServiceDeadlines } = await import('@/services/schedule-reconciliation');
    const userId = randomUUID();
    const companyId = randomUUID();
    const partialId = randomUUID();
    const familyId = randomUUID();
    const variantId = randomUUID();
    const clientServiceId = randomUUID();

    await prisma.user.create({
      data: { id: userId, tenantId, email: `${userId}@example.test`, passwordHash: 'integration-only', firstName: 'Queue', lastName: 'Fixture' },
    });
    await prisma.company.create({
      data: {
        id: companyId,
        tenantId,
        uen: `T${randomUUID().slice(0, 8).toUpperCase()}`,
        name: 'Queue Fixture Co',
        entityType: 'PRIVATE_LIMITED',
        status: 'LIVE',
        financialYearEndDay: 31,
        financialYearEndMonth: 12,
        accountsDueDate: new Date('2024-07-31T00:00:00.000Z'),
        incorporationDate: new Date('2022-01-01T00:00:00.000Z'),
      },
    });
    await prisma.templatePartial.create({
      data: { id: partialId, tenantId, name: 'queue-partial', content: 'queue', createdById: userId },
    });
    await prisma.serviceFamily.create({
      data: { id: familyId, tenantId, code: `QFAM_${tenantId.slice(0, 6)}`, name: 'Queue Family', displayColor: '#0F766E' },
    });
    await prisma.serviceVariant.create({
      data: { id: variantId, tenantId, familyId, sowPartialId: partialId, code: `QSVC_${tenantId.slice(0, 6)}`, name: 'Queue Service', serviceCadence: 'ANNUALLY' },
    });

    const ruleIds: string[] = [];
    const milestones = [
      { code: 'SG_AGM_DUE', key: 'agm-due', name: 'AGM Due', expression: { kind: 'ADD_MONTHS', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' }, amount: -1 } },
      { code: 'SG_ANNUAL_RETURN', key: 'annual-return-due', name: 'Annual Return Due', expression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } } },
    ];
    for (const milestone of milestones) {
      const ruleId = randomUUID();
      const versionId = randomUUID();
      ruleIds.push(ruleId);
      await prisma.deadlineRule.create({
        data: {
          id: ruleId,
          tenantId,
          code: milestone.code,
          name: milestone.code,
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
                create: {
                  tenantId,
                  milestoneKey: milestone.key,
                  name: milestone.name,
                  type: 'STATUTORY',
                  generationMode: 'ONCE_PER_CYCLE',
                  dateExpression: milestone.expression,
                  businessDayAdjustment: 'NONE',
                  displayOrder: 0,
                },
              },
            },
          },
        },
      });
      await prisma.deadlineRule.update({ where: { id: ruleId }, data: { currentVersionId: versionId } });
    }
    await prisma.clientService.create({
      data: {
        id: clientServiceId,
        tenantId,
        companyId,
        source: 'MANUAL',
        serviceVariantId: variantId,
        familyName: 'Queue Family',
        serviceName: 'Queue Fixture Service',
        status: 'ACTIVE',
        serviceCadence: 'ANNUALLY',
        startDate: new Date('2026-08-27T00:00:00.000Z'),
        deadlineRules: {
          create: ruleIds.map((ruleId) => ({ tenantId, ruleId, enabled: true })),
        },
      },
    });

    const input = {
      tenantId,
      clientServiceId,
      today: '2026-08-27' as const,
      horizonEnd: '2027-08-27' as const,
      writeMode: 'APPLY' as const,
    };
    const first = await prisma.$transaction((tx) => reconcileClientServiceDeadlines({ ...input, reconciliationRequestId: randomUUID() }, tx));
    const second = await prisma.$transaction((tx) => reconcileClientServiceDeadlines({ ...input, reconciliationRequestId: randomUUID() }, tx));

    expect(first.counts.created).toBe(8);
    // The company's accounts are due 2024-07-31, so six of the eight cycles are already past due.
    // A repeat run leaves past-due occurrences as history and changes nothing else.
    expect(second.counts).toEqual({ created: 0, recalculated: 0, cancelled: 0, preserved: 6, noChange: 2 });
    expect(second.preservedByReason.HISTORICAL).toBe(6);

    const cycles = await prisma.serviceCycle.findMany({ where: { tenantId, clientServiceId } });
    expect(cycles).toHaveLength(8);
    expect(new Set(cycles.map((cycle) => `${cycle.ruleId}|${cycle.periodKey}`)).size).toBe(8);

    const concurrent = await Promise.all([
      prisma.$transaction((tx) => reconcileClientServiceDeadlines({ ...input, reconciliationRequestId: randomUUID() }, tx)),
      prisma.$transaction((tx) => reconcileClientServiceDeadlines({ ...input, reconciliationRequestId: randomUUID() }, tx)),
    ]);
    expect(concurrent.reduce((created, result) => created + result.counts.created, 0)).toBe(0);

    const occurrences = await prisma.deadlineOccurrence.findMany({
      where: { tenantId, clientServiceId, status: 'OPEN', origin: 'RULE' },
    });
    expect(occurrences).toHaveLength(8);
    expect(new Set(occurrences.map((occurrence) => `${occurrence.cycleId}|${occurrence.milestoneKey}|${occurrence.scheduleEntryKey}`)).size).toBe(8);
  });
});
