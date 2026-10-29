import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('deadline tenant-isolation PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const describePostgres = testDatabaseUrl ? describe : describe.skip;

type PrismaClient = Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;

describePostgres('deadline tenant isolation and idempotency PostgreSQL integration', () => {
  let prisma: PrismaClient;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import('@/lib/prisma')).getPrisma();
  });

  afterAll(async () => {
    if (!prisma) return;
    const failures: unknown[] = [];
    const attempt = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };

    try {
      for (const tenantId of tenantIds.splice(0)) {
        const where = { tenantId };
        await attempt(() => prisma.auditLog.deleteMany({ where }));
        await attempt(() => prisma.deadlineOccurrence.deleteMany({ where }));
        await attempt(() => prisma.serviceCycle.deleteMany({ where }));
        await attempt(() => prisma.clientServiceDeadlineRule.deleteMany({ where }));
        await attempt(() => prisma.clientService.deleteMany({ where }));
        await attempt(() => prisma.deadlineMilestoneTemplate.deleteMany({ where }));
        await attempt(() => prisma.deadlineRule.updateMany({ where, data: { currentVersionId: null } }));
        await attempt(() => prisma.deadlineRuleVersion.deleteMany({ where }));
        await attempt(() => prisma.deadlineRule.deleteMany({ where }));
        await attempt(() => prisma.serviceVariant.deleteMany({ where }));
        await attempt(() => prisma.serviceFamily.deleteMany({ where }));
        await attempt(() => prisma.templatePartial.deleteMany({ where }));
        await attempt(() => prisma.user.deleteMany({ where }));
        await attempt(() => prisma.company.deleteMany({ where }));
        await attempt(() => prisma.workspace.deleteMany({ where: { id: tenantId } }));
      }
    } finally {
      await prisma.$disconnect();
    }
    if (failures.length > 0) {
      throw new Error(`Tenant-isolation cleanup failed in ${failures.length} step(s)`);
    }
  });

  async function seedTenant(label: string) {
    const tenantId = randomUUID();
    tenantIds.push(tenantId);
    const userId = randomUUID();
    const companyId = randomUUID();
    const partialId = randomUUID();
    const familyId = randomUUID();
    const variantId = randomUUID();
    const ruleId = randomUUID();
    const versionId = randomUUID();
    const clientServiceId = randomUUID();

    await prisma.workspace.create({
      data: {
        id: tenantId,
        name: `${label} workspace`,
        slug: `${label.toLowerCase()}-${tenantId}`,
        settings: { servicesWorkspace: { enabled: true, deadlineWritesEnabled: true } },
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: `${userId}@example.test`,
        passwordHash: 'integration-only',
        firstName: 'Isolation',
        lastName: 'Test',
      },
    });
    await prisma.company.create({
      data: {
        id: companyId,
        tenantId,
        uen: `T${tenantId.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
        name: `${label} company`,
        entityType: 'PRIVATE_LIMITED',
        status: 'LIVE',
        accountsDueDate: new Date('2026-09-30T00:00:00.000Z'),
        financialYearEndDay: 31,
        financialYearEndMonth: 12,
      },
    });
    await prisma.templatePartial.create({
      data: {
        id: partialId,
        tenantId,
        name: `${label}-partial`,
        content: '<p>Integration service</p>',
        createdById: userId,
      },
    });
    await prisma.serviceFamily.create({
      data: {
        id: familyId,
        tenantId,
        code: `${label.toUpperCase()}_FAMILY`,
        name: `${label} family`,
        displayColor: '#2F6F5E',
      },
    });
    await prisma.serviceVariant.create({
      data: {
        id: variantId,
        tenantId,
        familyId,
        sowPartialId: partialId,
        code: `${label.toUpperCase()}_SERVICE`,
        name: `${label} service`,
        serviceCadence: 'ONE_TIME',
      },
    });
    await prisma.deadlineRule.create({
      data: {
        id: ruleId,
        tenantId,
        code: `${label.toUpperCase()}_RULE`,
        name: `${label} deadline rule`,
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
            milestoneKey: 'annual-return',
            name: 'Annual return',
            type: 'STATUTORY',
            generationMode: 'ONCE_PER_CYCLE',
            dateExpression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
            businessDayAdjustment: 'NONE',
            displayOrder: 0,
          },
        },
      },
    });
    await prisma.deadlineRule.update({ where: { id: ruleId }, data: { currentVersionId: versionId } });
    await prisma.clientService.create({
      data: {
        id: clientServiceId,
        tenantId,
        companyId,
        source: 'MANUAL',
        serviceVariantId: variantId,
        familyName: `${label} family`,
        serviceName: `${label} service`,
        status: 'ACTIVE',
        serviceCadence: 'ONE_TIME',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        deadlineRules: { create: { tenantId, ruleId, enabled: true } },
      },
    });

    return { tenantId, companyId, clientServiceId, ruleId, userId };
  }

  it('cannot list or mutate another tenant deadline', async () => {
    const tenantOne = await seedTenant('TenantOne');
    const tenantTwo = await seedTenant('TenantTwo');
    const { reconcileClientServiceDeadlines } = await import('@/services/schedule-reconciliation');
    const { listDeadlines, getDeadlineOccurrence, updateDeadlineOccurrence } = await import('@/services/deadline');

    const input = {
      tenantId: tenantTwo.tenantId,
      clientServiceId: tenantTwo.clientServiceId,
      today: '2026-08-18' as const,
      horizonEnd: '2027-08-18' as const,
      writeMode: 'APPLY' as const,
      reconciliationRequestId: randomUUID(),
    };
    await prisma.$transaction((tx) => reconcileClientServiceDeadlines({
      ...input,
      tenantId: tenantOne.tenantId,
      clientServiceId: tenantOne.clientServiceId,
      reconciliationRequestId: randomUUID(),
    }, tx));
    await prisma.$transaction((tx) => reconcileClientServiceDeadlines(input, tx));
    const ownTenantOccurrence = await prisma.deadlineOccurrence.findFirstOrThrow({ where: { tenantId: tenantOne.tenantId } });
    const otherTenantOccurrence = await prisma.deadlineOccurrence.findFirstOrThrow({ where: { tenantId: tenantTwo.tenantId } });

    const search = {
      from: '2026-08-01' as const,
      to: '2026-10-31' as const,
      mode: 'TABLE' as const,
      types: ['STATUTORY', 'CLIENT', 'INTERNAL'] as const,
      familyIds: [],
      companyIds: [],
      statuses: [],
      timing: [],
      openOnly: true,
      companyQuery: '',
      serviceQuery: '',
      milestoneQuery: '',
      page: 1,
      limit: 50,
      sortBy: 'dueDate' as const,
      sortOrder: 'asc' as const,
    };
    const visibleToTenantOne = await listDeadlines(search, { tenantId: tenantOne.tenantId });
    expect(visibleToTenantOne.items).toHaveLength(1);
    expect(visibleToTenantOne.items[0]?.id).toBe(ownTenantOccurrence.id);
    expect(visibleToTenantOne.items).not.toContainEqual(expect.objectContaining({ tenantId: tenantTwo.tenantId }));

    await expect(getDeadlineOccurrence(otherTenantOccurrence.id, {
      tenantId: tenantOne.tenantId,
      userId: tenantOne.userId,
    })).rejects.toMatchObject({ statusCode: 404 });
    const inaccessibleMutation = await updateDeadlineOccurrence(otherTenantOccurrence.id, {
      expectedUpdatedAt: otherTenantOccurrence.updatedAt.toISOString(),
      notes: 'cross-tenant mutation must be rejected',
    }, {
      tenantId: tenantOne.tenantId,
      userId: tenantOne.userId,
    }).then(() => null, (error: unknown) => error);
    const missingMutation = await updateDeadlineOccurrence(randomUUID(), {
      expectedUpdatedAt: otherTenantOccurrence.updatedAt.toISOString(),
      notes: 'nonexistent mutation must be rejected',
    }, {
      tenantId: tenantOne.tenantId,
      userId: tenantOne.userId,
    }).then(() => null, (error: unknown) => error);
    expect(inaccessibleMutation).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Deadline occurrence not found' });
    expect(missingMutation).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Deadline occurrence not found' });
    const unchangedOtherTenantOccurrence = await prisma.deadlineOccurrence.findUniqueOrThrow({ where: { id: otherTenantOccurrence.id } });
    expect(unchangedOtherTenantOccurrence.status).toBe(otherTenantOccurrence.status);
    expect(unchangedOtherTenantOccurrence.updatedAt).toEqual(otherTenantOccurrence.updatedAt);
    expect(await prisma.auditLog.count({ where: { tenantId: tenantTwo.tenantId, entityType: 'DeadlineOccurrence' } })).toBe(0);
  });

  it('produces one occurrence identity after three concurrent retries', async () => {
    const tenant = await seedTenant('RetryTenant');
    const { reconcileClientServiceDeadlines } = await import('@/services/schedule-reconciliation');
    const input = {
      tenantId: tenant.tenantId,
      clientServiceId: tenant.clientServiceId,
      today: '2026-08-18' as const,
      horizonEnd: '2027-08-18' as const,
      writeMode: 'APPLY' as const,
    };

    await Promise.all([
      prisma.$transaction((tx) => reconcileClientServiceDeadlines({ ...input, reconciliationRequestId: randomUUID() }, tx)),
      prisma.$transaction((tx) => reconcileClientServiceDeadlines({ ...input, reconciliationRequestId: randomUUID() }, tx)),
      prisma.$transaction((tx) => reconcileClientServiceDeadlines({ ...input, reconciliationRequestId: randomUUID() }, tx)),
    ]);

    const occurrences = await prisma.deadlineOccurrence.findMany({ where: { tenantId: tenant.tenantId } });
    expect(occurrences).toHaveLength(1);
    expect(new Set(occurrences.map((occurrence) => `${occurrence.cycleId}|${occurrence.milestoneKey}|${occurrence.scheduleEntryKey}`)).size).toBe(1);
  });

  it('rejects impact projection for a service belonging to another tenant', async () => {
    const tenantOne = await seedTenant('PreviewTenantOne');
    const tenantTwo = await seedTenant('PreviewTenantTwo');
    const { previewClientServiceDeadlineConfiguration } = await import('@/services/client-service');

    const service = await prisma.clientService.findFirstOrThrow({ where: { id: tenantTwo.clientServiceId } });
    const error = await previewClientServiceDeadlineConfiguration(
      tenantTwo.clientServiceId,
      {
        expectedUpdatedAt: service.updatedAt.toISOString(),
        deadlineRules: [],
        scheduleSnapshot: {
          status: 'ACTIVE',
          serviceCadence: 'ONE_TIME',
          customCadenceLabel: null,
          startDate: '2026-08-01',
          endDate: null,
          fieldValues: {},
        },
      },
      { tenantId: tenantOne.tenantId, userId: tenantOne.userId, allCompaniesAccess: true },
      prisma,
      { today: '2026-08-18', horizonEnd: '2027-08-18' },
    ).then(() => null, (caught: unknown) => caught);

    expect(error).toMatchObject({ statusCode: 404 });
    expect(JSON.stringify(error)).not.toContain(tenantTwo.tenantId);
  });
});
