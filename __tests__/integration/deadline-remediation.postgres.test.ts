// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

describePostgres('deadline occurrence remediation PostgreSQL integration', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import('@/lib/prisma')).getPrisma();
    tenantId = randomUUID();
    userId = randomUUID();
    await prisma.workspace.create({
      data: {
        id: tenantId,
        name: `Remediation ${tenantId}`,
        slug: `remediation-${tenantId}`,
        settings: { servicesWorkspace: { enabled: true, deadlineWritesEnabled: true } },
      },
    });
    await prisma.user.create({
      data: { id: userId, tenantId, email: `${userId}@example.test`, passwordHash: 'integration-only', firstName: 'Repair', lastName: 'Operator' },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.deadlineOccurrenceCoverageLink.deleteMany({ where: { tenantId } });
    await prisma.deadlineResponsibilityChange.deleteMany({ where: { tenantId } });
    await prisma.companyComplianceIssue.deleteMany({ where: { tenantId } });
    await prisma.clientServiceObligationScope.deleteMany({ where: { tenantId } });
    await prisma.companyMonitoringCoverage.deleteMany({ where: { tenantId } });
    await prisma.companyFinancialPeriod.deleteMany({ where: { tenantId } });
    await prisma.billingCoverageIssue.deleteMany({ where: { tenantId } });
    await prisma.billingOccurrence.deleteMany({ where: { tenantId } });
    await prisma.deadlineOccurrence.deleteMany({ where: { tenantId } });
    await prisma.serviceCycle.deleteMany({ where: { tenantId } });
    await prisma.clientServiceDeadlineRule.deleteMany({ where: { tenantId } });
    await prisma.clientService.deleteMany({ where: { tenantId } });
    await prisma.deadlineMilestoneTemplate.deleteMany({ where: { ruleVersion: { rule: { tenantId } } } });
    await prisma.deadlineRule.updateMany({ where: { tenantId }, data: { currentVersionId: null } });
    await prisma.deadlineRuleVersion.deleteMany({ where: { rule: { tenantId } } });
    await prisma.deadlineRule.deleteMany({ where: { tenantId } });
    await prisma.serviceVariant.deleteMany({ where: { tenantId } });
    await prisma.serviceFamily.deleteMany({ where: { tenantId } });
    await prisma.templatePartial.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.workspace.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  async function seedFixture(accountsDueDate: string) {
    const companyId = randomUUID();
    const partialId = randomUUID();
    const familyId = randomUUID();
    const variantId = randomUUID();
    const clientServiceId = randomUUID();

    await prisma.templatePartial.create({
      data: { id: partialId, tenantId, name: `remediation-partial-${partialId.slice(0, 8)}`, content: 'repair', createdById: userId },
    });
    await prisma.company.create({
      data: {
        id: companyId,
        tenantId,
        uen: `T${randomUUID().slice(0, 8).toUpperCase()}`,
        name: `Repair Co ${companyId}`,
        entityType: 'PRIVATE_LIMITED',
        status: 'LIVE',
        financialYearEndDay: 31,
        financialYearEndMonth: 12,
        accountsDueDate: new Date(`${accountsDueDate}T00:00:00.000Z`),
        incorporationDate: new Date('2022-01-01T00:00:00.000Z'),
      },
    });
    await prisma.serviceFamily.create({
      data: { id: familyId, tenantId, code: `RFAM_${familyId.slice(0, 8)}`, name: 'Repair Family', displayColor: '#0F766E' },
    });
    await prisma.serviceVariant.create({
      data: { id: variantId, tenantId, familyId, sowPartialId: partialId, code: `RSVC_${variantId.slice(0, 8)}`, name: 'Repair Service', serviceCadence: 'ANNUALLY' },
    });

    const rules = [
      {
        code: 'SG_AGM_DUE',
        key: 'agm-due',
        name: 'AGM Due',
        expression: { kind: 'ADD_MONTHS', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' }, amount: -1 },
      },
      {
        code: 'SG_ANNUAL_RETURN',
        key: 'annual-return-due',
        name: 'Annual Return Due',
        expression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
      },
    ];
    const ruleIds: string[] = [];
    const versionIds: Record<string, string> = {};
    for (const rule of rules) {
      const ruleId = randomUUID();
      const versionId = randomUUID();
      ruleIds.push(ruleId);
      versionIds[ruleId] = versionId;
      // Rule codes are unique per workspace and this fixture is seeded twice, so retire the earlier fixture's code.
      await prisma.deadlineRule.updateMany({ where: { tenantId, code: rule.code }, data: { code: `${rule.code}_${ruleId.slice(0, 8)}` } });
      await prisma.deadlineRule.create({
        data: {
          id: ruleId,
          tenantId,
          code: rule.code,
          name: rule.code,
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
                  milestoneKey: rule.key,
                  name: rule.name,
                  type: 'STATUTORY',
                  generationMode: 'ONCE_PER_CYCLE',
                  dateExpression: rule.expression,
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
        familyName: 'Repair Family',
        serviceName: 'Repair Fixture Service',
        status: 'ACTIVE',
        serviceCadence: 'ANNUALLY',
        startDate: new Date('2026-08-27T00:00:00.000Z'),
        deadlineRules: {
          create: ruleIds.map((ruleId) => ({ tenantId, ruleId, enabled: true })),
        },
      },
    });

    return { companyId, clientServiceId, ruleIds, versionIds };
  }

  function occurrenceData(
    cycleId: string,
    milestoneKey: string,
    dueDate: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id: randomUUID(),
      tenantId,
      companyId: '',
      clientServiceId: '',
      cycleId,
      ruleVersionId: '',
      milestoneKey,
      scheduleEntryKey: '',
      deadlineType: 'STATUTORY',
      calculatedDueDate: new Date(`${dueDate}T00:00:00.000Z`),
      operativeDueDate: new Date(`${dueDate}T00:00:00.000Z`),
      dateOverridden: false,
      status: 'OPEN',
      origin: 'RULE',
      ...overrides,
    } as never;
  }

  it('repairs the future-source and authoritative-backlog shapes with idempotent apply', async () => {
    const { previewDeadlineOccurrenceRemediation, applyDeadlineOccurrenceRemediation } =
      await import('@/services/schedule-reconciliation');

    const future = await seedFixture('2027-07-31');
    const [agmRuleId, arRuleId] = future.ruleIds;
    const futureCompany = future.companyId;
    const futureService = future.clientServiceId;
    const futureCycles = [
      { id: randomUUID(), ruleId: agmRuleId, periodKey: '2026' },
      { id: randomUUID(), ruleId: agmRuleId, periodKey: '2027' },
      { id: randomUUID(), ruleId: arRuleId, periodKey: '2026' },
      { id: randomUUID(), ruleId: arRuleId, periodKey: '2027' },
    ];
    await prisma.serviceCycle.createMany({
      data: futureCycles.map((cycle) => ({
        id: cycle.id,
        tenantId,
        companyId: futureCompany,
        clientServiceId: futureService,
        ruleId: cycle.ruleId,
        ruleVersionId: future.versionIds[cycle.ruleId],
        periodKey: cycle.periodKey,
        periodStart: new Date(`${cycle.periodKey}-01-01T00:00:00.000Z`),
        periodEnd: new Date(`${cycle.periodKey}-12-31T00:00:00.000Z`),
        generationKey: 'rolling-v1',
        origin: 'RULE',
        evaluationHash: randomUUID().padEnd(64, '0'),
      })),
    });
    await prisma.deadlineOccurrence.createMany({
      data: [
        occurrenceData(futureCycles[0].id, 'agm-due', '2026-06-30', { clientServiceId: futureService, ruleVersionId: future.versionIds[agmRuleId], companyId: futureCompany }),
        occurrenceData(futureCycles[1].id, 'agm-due', '2027-06-30', { clientServiceId: futureService, ruleVersionId: future.versionIds[agmRuleId], companyId: futureCompany }),
        occurrenceData(futureCycles[2].id, 'annual-return-due', '2026-07-31', { clientServiceId: futureService, ruleVersionId: future.versionIds[arRuleId], companyId: futureCompany }),
        occurrenceData(futureCycles[3].id, 'annual-return-due', '2027-07-31', { clientServiceId: futureService, ruleVersionId: future.versionIds[arRuleId], companyId: futureCompany }),
      ],
    });

    const authoritative = await seedFixture('2024-07-31');
    const [authAgmRuleId, authArRuleId] = authoritative.ruleIds;
    const authCompany = authoritative.companyId;
    const authService = authoritative.clientServiceId;
    const authCycles: Array<{ id: string; ruleId: string; periodKey: string }> = [];
    for (const ruleId of [authAgmRuleId, authArRuleId]) {
      for (const year of ['2024', '2025', '2026', '2027']) {
        authCycles.push({ id: randomUUID(), ruleId, periodKey: year });
      }
      authCycles.push({ id: randomUUID(), ruleId, periodKey: 'BUG' });
    }
    await prisma.serviceCycle.createMany({
      data: authCycles.map((cycle) => ({
        id: cycle.id,
        tenantId,
        companyId: authCompany,
        clientServiceId: authService,
        ruleId: cycle.ruleId,
        ruleVersionId: authoritative.versionIds[cycle.ruleId],
        periodKey: cycle.periodKey,
        periodStart: new Date('2024-01-01T00:00:00.000Z'),
        periodEnd: new Date('2027-12-31T00:00:00.000Z'),
        generationKey: 'rolling-v1',
        origin: 'RULE',
        evaluationHash: randomUUID().padEnd(64, '0'),
      })),
    });
    const authOccurrenceRows: Array<Record<string, unknown>> = [];
    for (const cycle of authCycles) {
      const isAgm = cycle.ruleId === authAgmRuleId;
      // The stray 'BUG' cycles duplicate the 2027 deadlines, so they are future rows the repair must cancel.
      const year = cycle.periodKey === 'BUG' ? '2027' : cycle.periodKey;
      const dueDate = isAgm ? `${year}-06-30` : `${year}-07-31`;
      authOccurrenceRows.push(occurrenceData(
        cycle.id,
        isAgm ? 'agm-due' : 'annual-return-due',
        cycle.periodKey === '2026' && !isAgm ? '2026-06-30' : dueDate,
        {
          clientServiceId: authService,
          ruleVersionId: authoritative.versionIds[cycle.ruleId],
          companyId: authCompany,
        },
      ));
    }
    const protectedRowId = randomUUID();
    const protectedRow = occurrenceData(authCycles[0].id, 'agm-due', '2024-06-30', {
      id: protectedRowId,
      milestoneKey: 'completed-milestone',
      status: 'COMPLETED',
      completedAt: new Date('2024-06-15T00:00:00.000Z'),
      completedById: userId,
      clientServiceId: authService,
      ruleVersionId: authoritative.versionIds[authAgmRuleId],
      companyId: authCompany,
    });
    authOccurrenceRows.push(protectedRow);
    await prisma.deadlineOccurrence.createMany({ data: authOccurrenceRows as never });

    const input = {
      tenantId,
      clientServiceIds: [futureService, authService],
      today: '2026-08-27' as const,
      horizonEnd: '2027-08-27' as const,
      reason: 'Correct 2026 annual source alignment',
    };

    const dryRun = await previewDeadlineOccurrenceRemediation(input, prisma);
    // Every canonical cycle already has a row, so the repair moves and cancels rows rather than creating any.
    expect(dryRun.counts.CREATE).toBe(0);
    expect(dryRun.counts.RECALCULATE).toBeGreaterThan(0);
    expect(dryRun.counts.CANCEL).toBeGreaterThan(0);
    expect(dryRun.counts.PRESERVE).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { tenantId, entityType: 'ClientService' } })).toBe(0);

    await applyDeadlineOccurrenceRemediation({
      ...input,
      expectedFingerprint: dryRun.fingerprint,
      actorId: userId,
    }, prisma);

    const futureOccurrences = await prisma.deadlineOccurrence.findMany({
      where: { tenantId, clientServiceId: futureService, status: 'OPEN', origin: 'RULE' },
    });
    expect(futureOccurrences.map((occ) => [occ.milestoneKey, occ.operativeDueDate.toISOString().slice(0, 10)]).sort())
      .toEqual([
        ['agm-due', '2027-06-30'],
        ['annual-return-due', '2027-07-31'],
      ]);

    const authOccurrences = await prisma.deadlineOccurrence.findMany({
      where: { tenantId, clientServiceId: authService, status: 'OPEN', origin: 'RULE' },
    });
    expect(authOccurrences.map((occ) => [occ.milestoneKey, occ.operativeDueDate.toISOString().slice(0, 10)]).sort())
      .toEqual([
        ['agm-due', '2024-06-30'],
        ['agm-due', '2025-06-30'],
        ['agm-due', '2026-06-30'],
        ['agm-due', '2027-06-30'],
        ['annual-return-due', '2024-07-31'],
        ['annual-return-due', '2025-07-31'],
        ['annual-return-due', '2026-07-31'],
        ['annual-return-due', '2027-07-31'],
      ]);

    const extraCancelled = await prisma.deadlineOccurrence.findMany({
      where: { tenantId, clientServiceId: authService, status: 'CANCELLED', origin: 'RULE' },
    });
    expect(extraCancelled.length).toBeGreaterThanOrEqual(2);
    expect(extraCancelled.every((occ) => String(occ.cancellationReason).startsWith('Deadline projection repair:'))).toBe(true);

    const unchangedProtected = await prisma.deadlineOccurrence.findUniqueOrThrow({ where: { id: protectedRowId } });
    expect(unchangedProtected).toMatchObject({ status: 'COMPLETED', milestoneKey: 'completed-milestone' });

    expect(await prisma.auditLog.count({ where: { tenantId, entityType: 'ClientService', action: 'UPDATE' } })).toBe(2);

    const secondDryRun = await previewDeadlineOccurrenceRemediation(input, prisma);
    expect(secondDryRun.counts.CREATE).toBe(0);
    expect(secondDryRun.counts.RECALCULATE).toBe(0);
    expect(secondDryRun.counts.CANCEL).toBe(0);

    await expect(
      applyDeadlineOccurrenceRemediation({
        ...input,
        expectedFingerprint: dryRun.fingerprint,
        actorId: userId,
      }, prisma),
    ).rejects.toMatchObject({ code: 'IMPACT_CHANGED', statusCode: 409 });
  });
});
