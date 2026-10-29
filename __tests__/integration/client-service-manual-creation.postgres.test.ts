import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('manual client service PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const describePostgres = testDatabaseUrl ? describe : describe.skip;

describePostgres('manual client service creation PostgreSQL concurrency', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let createManualClientService: typeof import('@/services/client-service')['createManualClientService'];
  let DuplicateClientServiceError: typeof import('@/services/client-service')['DuplicateClientServiceError'];
  let processServiceAgreementActivation: typeof import('@/services/service-agreement')['processServiceAgreementActivation'];
  const tenantIds: string[] = [];
  const previousLogLevel = process.env.LOG_LEVEL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.LOG_LEVEL = 'silent';
    const prismaModule = await import('@/lib/prisma');
    prisma = prismaModule.getPrisma();
    ({ createManualClientService, DuplicateClientServiceError } = await import('@/services/client-service'));
    ({ processServiceAgreementActivation } = await import('@/services/service-agreement'));
  });

  afterEach(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.clientServiceFeeLine.deleteMany({ where: { tenantId } });
      await prisma.clientService.deleteMany({ where: { tenantId } });
      await prisma.serviceAgreementFeeLine.deleteMany({ where: { tenantId } });
      await prisma.serviceAgreementItemEntity.deleteMany({ where: { tenantId } });
      await prisma.serviceAgreementItem.deleteMany({ where: { tenantId } });
      await prisma.serviceAgreementEntity.deleteMany({ where: { tenantId } });
      await prisma.serviceAgreement.deleteMany({ where: { tenantId } });
      await prisma.generatedDocument.deleteMany({ where: { tenantId } });
      await prisma.serviceVariant.deleteMany({ where: { tenantId } });
      await prisma.serviceFamily.deleteMany({ where: { tenantId } });
      await prisma.templatePartial.deleteMany({ where: { tenantId } });
      await prisma.company.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.delete({ where: { id: tenantId } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
  });

  async function seedCatalog() {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({ data: { name: `Manual create ${suffix}`, slug: `manual-create-${suffix}` } });
    tenantIds.push(workspace.id);
    const user = await prisma.user.create({ data: { tenantId: workspace.id, email: `manual-create-${suffix}@example.test`, passwordHash: 'not-used', firstName: 'Manual', lastName: 'Creator' } });
    const company = await prisma.company.create({ data: { tenantId: workspace.id, uen: suffix.slice(0, 9).toUpperCase(), name: `Company ${suffix}` } });
    const partial = await prisma.templatePartial.create({ data: { tenantId: workspace.id, createdById: user.id, name: `manual-create-${suffix}`, content: '<p>Service</p>', placeholders: [] } });
    const family = await prisma.serviceFamily.create({ data: { tenantId: workspace.id, code: `MANUAL_${suffix}`, name: 'Manual family' } });
    const variant = await prisma.serviceVariant.create({ data: { tenantId: workspace.id, familyId: family.id, sowPartialId: partial.id, code: `MANUAL_${suffix}`, name: 'Manual advisory', serviceCadence: 'ANNUALLY' } });
    return { workspace, user, company, variant };
  }

  const input = (variantId: string, confirmDuplicate = false) => ({
    serviceVariantId: variantId,
    status: 'ACTIVE' as const,
    serviceCadence: 'ANNUALLY' as const,
    customCadenceLabel: null,
    startDate: '2026-08-01',
    endDate: null,
    fieldValues: { software: 'Xero' },
    feeLines: [{ description: 'Annual service fee', amount: '1200.00', currency: 'SGD', billingFrequency: 'ANNUALLY' as const, customFrequencyLabel: null, billingStartDate: null }],
    confirmDuplicate,
  });

  it('allows exactly one simultaneous unconfirmed create and returns a duplicate for the serialization loser', async () => {
    const seeded = await seedCatalog();
    const actor = { tenantId: seeded.workspace.id, userId: seeded.user.id };

    const results = await Promise.allSettled([
      createManualClientService(seeded.company.id, input(seeded.variant.id), actor),
      createManualClientService(seeded.company.id, input(seeded.variant.id), actor),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(DuplicateClientServiceError);
    expect(await prisma.clientService.count({ where: { tenantId: seeded.workspace.id } })).toBe(1);
    expect(await prisma.clientServiceFeeLine.count({ where: { tenantId: seeded.workspace.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId: seeded.workspace.id, entityType: 'ClientService', action: 'CREATE' } })).toBe(1);
  });

  it('persists confirmed duplicates and records the override in the audit', async () => {
    const seeded = await seedCatalog();
    const actor = { tenantId: seeded.workspace.id, userId: seeded.user.id };

    await createManualClientService(seeded.company.id, input(seeded.variant.id), actor);
    await createManualClientService(seeded.company.id, input(seeded.variant.id, true), actor);

    expect(await prisma.clientService.count({ where: { tenantId: seeded.workspace.id } })).toBe(2);
    const overrideAudit = await prisma.auditLog.findMany({
      where: { tenantId: seeded.workspace.id, entityType: 'ClientService', action: 'CREATE' },
      orderBy: { createdAt: 'asc' },
    });
    expect(overrideAudit).toHaveLength(2);
    expect(overrideAudit[1]?.changes).toMatchObject({ duplicateConfirmed: { old: false, new: true } });
  });

  it('does not warn about archived rows with the same key', async () => {
    const seeded = await seedCatalog();
    const actor = { tenantId: seeded.workspace.id, userId: seeded.user.id };
    const first = await createManualClientService(seeded.company.id, input(seeded.variant.id), actor);
    await prisma.clientService.update({ where: { id: first.id }, data: { deletedAt: new Date() } });

    await expect(createManualClientService(seeded.company.id, input(seeded.variant.id), actor)).resolves.toMatchObject({ source: 'MANUAL' });
    expect(await prisma.clientService.count({ where: { tenantId: seeded.workspace.id } })).toBe(2);
  });

  it('creates an independent agreement-backed service when a later agreement matches a manual service', async () => {
    const seeded = await seedCatalog();
    const actor = { tenantId: seeded.workspace.id, userId: seeded.user.id };
    await createManualClientService(seeded.company.id, input(seeded.variant.id), actor);

    const document = await prisma.generatedDocument.create({ data: { tenantId: seeded.workspace.id, companyId: seeded.company.id, title: 'Manual match agreement', content: '<p>Agreement</p>', createdById: seeded.user.id, metadata: {} } });
    const agreement = await prisma.serviceAgreement.create({ data: { tenantId: seeded.workspace.id, generatedDocumentId: document.id, primaryCompanyId: seeded.company.id, authorizedRepresentativeSnapshots: [], signerContactIds: [], agreementDate: new Date('2026-08-01T00:00:00Z'), effectiveDate: new Date('2026-08-01T00:00:00Z'), status: 'DRAFT', activationStatus: 'PENDING', activationSource: 'MANUAL', activationAvailableAt: new Date('2026-08-01T00:00:00Z'), activationRequestedById: seeded.user.id } });
    const entity = await prisma.serviceAgreementEntity.create({ data: { tenantId: seeded.workspace.id, agreementId: agreement.id, companyId: seeded.company.id, nameSnapshot: seeded.company.name, uenSnapshot: seeded.company.uen } });
    const item = await prisma.serviceAgreementItem.create({ data: { tenantId: seeded.workspace.id, agreementId: agreement.id, serviceVariantId: seeded.variant.id, variantVersion: 1, familyNameSnapshot: 'Manual family', variantNameSnapshot: 'Manual advisory', serviceCadence: 'ANNUALLY', sowPartialId: (await prisma.serviceVariant.findUniqueOrThrow({ where: { id: seeded.variant.id } })).sowPartialId, partialVersion: 1, partialContentSnapshot: '<p>Service</p>', partialPlaceholdersSnapshot: [], partialDependencySnapshot: [], startDate: new Date('2026-08-01T00:00:00Z'), fieldValues: {} } });
    await prisma.serviceAgreementItemEntity.create({ data: { tenantId: seeded.workspace.id, itemId: item.id, agreementEntityId: entity.id } });
    const claimToken = randomUUID();
    await prisma.serviceAgreement.update({ where: { id: agreement.id }, data: { activationStatus: 'PROCESSING', activationClaimToken: claimToken, activationClaimedAt: new Date(), activationLeaseExpiresAt: new Date(Date.now() + 60_000) } });

    await expect(processServiceAgreementActivation({ agreementId: agreement.id, tenantId: seeded.workspace.id, claimToken }))
      .resolves.toMatchObject({ status: 'completed' });

    const services = await prisma.clientService.findMany({ where: { tenantId: seeded.workspace.id }, orderBy: { createdAt: 'asc' } });
    expect(services).toHaveLength(2);
    expect(services[0]).toMatchObject({ source: 'MANUAL', agreementId: null, agreementItemId: null });
    expect(services[1]).toMatchObject({ source: 'AGREEMENT', agreementItemId: item.id });
    expect(await prisma.auditLog.count({ where: { tenantId: seeded.workspace.id, entityType: 'ClientService', action: 'CREATE' } })).toBe(2);
  });
});
