import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('billing tenant-isolation PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

type PrismaClient = Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
type TenantFixture = {
  tenantId: string;
  userId: string;
  companyId: string;
  restrictedCompanyId: string;
  configuredServiceId: string;
  restrictedConfiguredServiceId: string;
  unreviewedServiceId: string;
  restrictedUnreviewedServiceId: string;
  feeLineId: string;
};

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

describePostgres('billing tenant isolation and company scope PostgreSQL integration', () => {
  let prisma: PrismaClient;
  const fixtures: TenantFixture[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import('@/lib/prisma')).getPrisma();
    const { reconcileClientServiceBilling, reconcileBillingCoverage } = await import('@/services/billing');
    fixtures.push(await seedTenant('Billing isolation one', prisma));
    fixtures.push(await seedTenant('Billing isolation two', prisma));

    for (const fixture of fixtures) {
      await reconcileClientServiceBilling({
        tenantId: fixture.tenantId,
        clientServiceId: fixture.configuredServiceId,
        today: '2026-08-18',
        horizonEnd: '2027-08-18',
        writeMode: 'APPLY',
        reconciliationRequestId: randomUUID(),
      }, prisma);
      await reconcileClientServiceBilling({
        tenantId: fixture.tenantId,
        clientServiceId: fixture.restrictedConfiguredServiceId,
        today: '2026-08-18',
        horizonEnd: '2027-08-18',
        writeMode: 'APPLY',
        reconciliationRequestId: randomUUID(),
      }, prisma);
      await reconcileBillingCoverage({
        tenantId: fixture.tenantId,
        clientServiceId: fixture.unreviewedServiceId,
        today: '2026-08-18',
        horizonEnd: '2027-08-18',
        writeMode: 'APPLY',
      }, prisma);
      await reconcileBillingCoverage({
        tenantId: fixture.tenantId,
        clientServiceId: fixture.restrictedUnreviewedServiceId,
        today: '2026-08-18',
        horizonEnd: '2027-08-18',
        writeMode: 'APPLY',
      }, prisma);
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const fixture of fixtures) {
      await prisma.auditLog.deleteMany({ where: { tenantId: fixture.tenantId } });
      await prisma.billingCoverageIssue.deleteMany({ where: { tenantId: fixture.tenantId } });
      await prisma.billingOccurrence.deleteMany({ where: { tenantId: fixture.tenantId } });
      await prisma.clientServiceFeeLine.deleteMany({ where: { tenantId: fixture.tenantId } });
      await prisma.clientService.deleteMany({ where: { tenantId: fixture.tenantId } });
      await prisma.serviceVariant.deleteMany({ where: { tenantId: fixture.tenantId } });
      await prisma.serviceFamily.deleteMany({ where: { tenantId: fixture.tenantId } });
      await prisma.templatePartial.deleteMany({ where: { tenantId: fixture.tenantId } });
      await prisma.user.deleteMany({ where: { tenantId: fixture.tenantId } });
      await prisma.company.deleteMany({ where: { tenantId: fixture.tenantId } });
      await prisma.workspace.deleteMany({ where: { id: fixture.tenantId } });
    }
    await prisma.$disconnect();
  });

  it('keeps occurrence list/detail and lifecycle mutations tenant- and company-scoped in SQL', async () => {
    const tenantOne = fixtures[0]!;
    const tenantTwo = fixtures[1]!;
    const { listBillingOccurrences, getBillingOccurrence, updateBillingOccurrence } = await import('@/services/billing');
    const ownOccurrence = await prisma.billingOccurrence.findFirstOrThrow({
      where: { tenantId: tenantOne.tenantId, clientServiceId: tenantOne.configuredServiceId },
      orderBy: { operativeExpectedDate: 'asc' },
    });
    const otherOccurrence = await prisma.billingOccurrence.findFirstOrThrow({
      where: { tenantId: tenantTwo.tenantId, clientServiceId: tenantTwo.configuredServiceId },
    });
    const sameTenantRestrictedOccurrence = await prisma.billingOccurrence.findFirstOrThrow({
      where: { tenantId: tenantOne.tenantId, clientServiceId: tenantOne.restrictedConfiguredServiceId },
    });

    const search = {
      from: '2026-08-01' as const,
      to: '2027-08-18' as const,
      statuses: ['OPEN'] as const,
      companyIds: [],
      page: 1,
      limit: 50,
    };
    const ownList = await listBillingOccurrences(search, {
      tenantId: tenantOne.tenantId,
      companyIds: [tenantOne.companyId],
    }, prisma, { today: '2026-08-18' });
    expect(ownList.items.length).toBeGreaterThan(0);
    expect(ownList.items.every((item) => item.tenantId === tenantOne.tenantId && item.companyId === tenantOne.companyId)).toBe(true);
    expect(ownList.items).not.toContainEqual(expect.objectContaining({ id: otherOccurrence.id, tenantId: tenantTwo.tenantId }));
    expect(ownList.items).not.toContainEqual(expect.objectContaining({
      id: sameTenantRestrictedOccurrence.id,
      companyId: tenantOne.restrictedCompanyId,
    }));

    const crossCompanyList = await listBillingOccurrences({ ...search, companyIds: [tenantTwo.companyId] }, {
      tenantId: tenantOne.tenantId,
      companyIds: [tenantOne.companyId],
    }, prisma, { today: '2026-08-18' });
    expect(crossCompanyList.items).toEqual([]);
    expect(crossCompanyList.total).toBe(0);

    const ownDetail = await getBillingOccurrence(ownOccurrence.id, {
      tenantId: tenantOne.tenantId,
      userId: tenantOne.userId,
      companyIds: [tenantOne.companyId],
    }, prisma);
    expect(ownDetail.id).toBe(ownOccurrence.id);
    await expect(getBillingOccurrence(otherOccurrence.id, {
      tenantId: tenantOne.tenantId,
      userId: tenantOne.userId,
      companyIds: [tenantOne.companyId],
    }, prisma)).rejects.toMatchObject({ statusCode: 404 });
    await expect(getBillingOccurrence(sameTenantRestrictedOccurrence.id, {
      tenantId: tenantOne.tenantId,
      userId: tenantOne.userId,
      companyIds: [tenantOne.companyId],
    }, prisma)).rejects.toMatchObject({ statusCode: 404 });

    await expect(updateBillingOccurrence(otherOccurrence.id, {
      expectedUpdatedAt: otherOccurrence.updatedAt.toISOString(),
      status: 'BILLED',
      billedDate: null,
      updateScope: 'THIS_OCCURRENCE',
      reason: null,
    }, {
      tenantId: tenantOne.tenantId,
      userId: tenantOne.userId,
      companyIds: [tenantOne.companyId],
    }, prisma)).rejects.toMatchObject({ statusCode: 404 });
    await expect(updateBillingOccurrence(sameTenantRestrictedOccurrence.id, {
      expectedUpdatedAt: sameTenantRestrictedOccurrence.updatedAt.toISOString(),
      status: 'BILLED',
      billedDate: null,
      updateScope: 'THIS_OCCURRENCE',
      reason: null,
    }, {
      tenantId: tenantOne.tenantId,
      userId: tenantOne.userId,
      companyIds: [tenantOne.companyId],
    }, prisma)).rejects.toMatchObject({ statusCode: 404 });

    const updatedOwn = await updateBillingOccurrence(ownOccurrence.id, {
      expectedUpdatedAt: ownOccurrence.updatedAt.toISOString(),
      status: 'BILLED',
      billedDate: null,
      updateScope: 'THIS_OCCURRENCE',
      reason: null,
    }, {
      tenantId: tenantOne.tenantId,
      userId: tenantOne.userId,
      companyIds: [tenantOne.companyId],
    }, prisma);
    expect(updatedOwn.status).toBe('BILLED');
    expect(await prisma.billingOccurrence.findUniqueOrThrow({ where: { id: otherOccurrence.id }, select: { status: true } })).toEqual({ status: 'OPEN' });
  });

  it('keeps coverage issues and healthy counts inside tenant and accessible-company SQL predicates', async () => {
    const tenantOne = fixtures[0]!;
    const tenantTwo = fixtures[1]!;
    const { listBillingCoverage } = await import('@/services/billing');

    const ownCoverage = await listBillingCoverage({
      tenantId: tenantOne.tenantId,
      companyIds: [tenantOne.companyId],
    }, prisma);
    expect(ownCoverage.openIssueCount).toBe(1);
    expect(ownCoverage.issues).toHaveLength(1);
    expect(ownCoverage.issues[0]).toMatchObject({
      type: 'MISSING_DISPOSITION',
      company: { id: tenantOne.companyId },
      service: { id: tenantOne.unreviewedServiceId },
    });
    expect(ownCoverage.issues).not.toContainEqual(expect.objectContaining({
      company: { id: tenantOne.restrictedCompanyId },
      service: { id: tenantOne.restrictedUnreviewedServiceId },
    }));

    const crossCompanyCoverage = await listBillingCoverage({
      tenantId: tenantOne.tenantId,
      companyIds: [tenantTwo.companyId],
    }, prisma);
    expect(crossCompanyCoverage.openIssueCount).toBe(0);
    expect(crossCompanyCoverage.issues).toEqual([]);
    expect(crossCompanyCoverage.healthyActiveServiceCount).toBe(0);
  });
});

async function seedTenant(label: string, prisma: PrismaClient): Promise<TenantFixture> {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const companyId = randomUUID();
  const restrictedCompanyId = randomUUID();
  const partialId = randomUUID();
  const familyId = randomUUID();
  const variantId = randomUUID();
  const configuredServiceId = randomUUID();
  const restrictedConfiguredServiceId = randomUUID();
  const unreviewedServiceId = randomUUID();
  const restrictedUnreviewedServiceId = randomUUID();
  const feeLineId = randomUUID();
  const restrictedFeeLineId = randomUUID();
  const suffix = tenantId.replaceAll('-', '').slice(0, 12);

  await prisma.workspace.create({
    data: {
      id: tenantId,
      name: `${label} workspace`,
      slug: `${label.toLowerCase().replaceAll(' ', '-')}-${suffix}`,
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
      firstName: 'Billing',
      lastName: 'Isolation',
    },
  });
  await prisma.templatePartial.create({
    data: {
      id: partialId,
      tenantId,
      name: `${label} partial`,
      content: '<p>Billing integration service</p>',
      createdById: userId,
    },
  });
  await prisma.serviceFamily.create({
    data: {
      id: familyId,
      tenantId,
      code: `BILLING_${suffix}`,
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
      code: `BILLING_SERVICE_${suffix}`,
      name: `${label} service`,
      serviceCadence: 'MONTHLY',
    },
  });
  await prisma.company.create({
    data: {
      id: companyId,
      tenantId,
      uen: `B${suffix.toUpperCase()}`,
      name: `${label} company`,
      entityType: 'PRIVATE_LIMITED',
      status: 'LIVE',
    },
  });
  await prisma.company.create({
    data: {
      id: restrictedCompanyId,
      tenantId,
      uen: `R${suffix.toUpperCase()}`,
      name: `${label} restricted company`,
      entityType: 'PRIVATE_LIMITED',
      status: 'LIVE',
    },
  });
  await prisma.clientService.create({
    data: {
      id: configuredServiceId,
      tenantId,
      companyId,
      source: 'MANUAL',
      serviceVariantId: variantId,
      familyName: `${label} family`,
      serviceName: `${label} configured service`,
      status: 'ACTIVE',
      serviceCadence: 'MONTHLY',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      billingDisposition: 'CONFIGURED',
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
  await prisma.clientService.create({
    data: {
      id: restrictedConfiguredServiceId,
      tenantId,
      companyId: restrictedCompanyId,
      source: 'MANUAL',
      serviceVariantId: variantId,
      familyName: `${label} family`,
      serviceName: `${label} restricted configured service`,
      status: 'ACTIVE',
      serviceCadence: 'MONTHLY',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      billingDisposition: 'CONFIGURED',
      feeLines: {
        create: {
          id: restrictedFeeLineId,
          tenantId,
          description: 'Restricted monthly tracking fee',
          amount: '125.00',
          currency: 'SGD',
          billingFrequency: 'MONTHLY',
          billingStartDate: new Date('2026-08-01T00:00:00.000Z'),
          scheduleConfig,
        },
      },
    },
  });
  await prisma.clientService.create({
    data: {
      id: unreviewedServiceId,
      tenantId,
      companyId,
      source: 'MANUAL',
      serviceVariantId: variantId,
      familyName: `${label} family`,
      serviceName: `${label} unreviewed service`,
      status: 'ACTIVE',
      serviceCadence: 'MONTHLY',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      billingDisposition: 'UNREVIEWED',
    },
  });
  await prisma.clientService.create({
    data: {
      id: restrictedUnreviewedServiceId,
      tenantId,
      companyId: restrictedCompanyId,
      source: 'MANUAL',
      serviceVariantId: variantId,
      familyName: `${label} family`,
      serviceName: `${label} restricted unreviewed service`,
      status: 'ACTIVE',
      serviceCadence: 'MONTHLY',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      billingDisposition: 'UNREVIEWED',
    },
  });

  return {
    tenantId,
    userId,
    companyId,
    restrictedCompanyId,
    configuredServiceId,
    restrictedConfiguredServiceId,
    unreviewedServiceId,
    restrictedUnreviewedServiceId,
    feeLineId,
  };
}
