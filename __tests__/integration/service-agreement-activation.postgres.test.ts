// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('Stage 3 PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const describePostgres = testDatabaseUrl ? describe : describe.skip;

describePostgres('service agreement activation PostgreSQL concurrency', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let processQueuedServiceAgreementActivations: typeof import('@/services/service-agreement')['processQueuedServiceAgreementActivations'];
  let processServiceAgreementActivation: typeof import('@/services/service-agreement')['processServiceAgreementActivation'];
  let retryServiceAgreementActivation: typeof import('@/services/service-agreement')['retryServiceAgreementActivation'];
  const tenantIds: string[] = [];
  const previousLogLevel = process.env.LOG_LEVEL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.LOG_LEVEL = 'silent';
    const prismaModule = await import('@/lib/prisma');
    prisma = prismaModule.getPrisma();
    ({ processQueuedServiceAgreementActivations, processServiceAgreementActivation, retryServiceAgreementActivation } = await import('@/services/service-agreement'));
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION stage3_reject_activation_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."entityType" = 'ClientService' AND NEW."entityName" LIKE 'stage3-reject-%' THEN
          RAISE EXCEPTION 'forced activation audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS stage3_reject_activation_audit_trigger ON audit_logs');
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER stage3_reject_activation_audit_trigger
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION stage3_reject_activation_audit()
    `);
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
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS stage3_reject_activation_audit_trigger ON audit_logs');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS stage3_reject_activation_audit()');
    await prisma.$disconnect();
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
  });

  async function seedAgreement(input: {
    agreementStatus?: 'DRAFT' | 'CANCELLED';
    activationStatus?: 'PENDING' | 'PROCESSING' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT';
    activationAttemptCount?: number;
    claimToken?: string;
    leaseExpiresAt?: Date;
    serviceName?: string;
  } = {}) {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({ data: { name: `Stage 3 ${suffix}`, slug: `stage-3-${suffix}` } });
    tenantIds.push(workspace.id);
    const user = await prisma.user.create({ data: { tenantId: workspace.id, email: `stage-3-${suffix}@example.test`, passwordHash: 'not-used', firstName: 'Stage', lastName: 'Three' } });
    const company = await prisma.company.create({ data: { tenantId: workspace.id, uen: suffix.slice(0, 9).toUpperCase(), name: `Company ${suffix}` } });
    const partial = await prisma.templatePartial.create({ data: { tenantId: workspace.id, createdById: user.id, name: `stage-3-${suffix}`, content: '<p>Service</p>', placeholders: [] } });
    const family = await prisma.serviceFamily.create({ data: { tenantId: workspace.id, code: `STAGE3_${suffix}`, name: 'Stage 3 family' } });
    const variant = await prisma.serviceVariant.create({ data: { tenantId: workspace.id, familyId: family.id, sowPartialId: partial.id, code: `STAGE3_${suffix}`, name: input.serviceName ?? 'Operational service', serviceCadence: 'ANNUALLY' } });
    const document = await prisma.generatedDocument.create({ data: { tenantId: workspace.id, companyId: company.id, title: 'Stage 3 agreement', content: '<p>Agreement</p>', createdById: user.id, metadata: {} } });
    const activationStatus = input.activationStatus ?? 'PENDING';
    const agreement = await prisma.serviceAgreement.create({ data: { tenantId: workspace.id, generatedDocumentId: document.id, primaryCompanyId: company.id, authorizedRepresentativeSnapshots: [], signerContactIds: [], agreementDate: new Date('2026-07-30T00:00:00Z'), effectiveDate: new Date('2026-07-30T00:00:00Z'), status: input.agreementStatus ?? 'DRAFT', activationStatus, activationAttemptCount: input.activationAttemptCount ?? 0, activationSource: 'ESIGNING', activationAvailableAt: new Date('2026-07-30T00:00:00Z'), activationClaimToken: input.claimToken ?? null, activationClaimedAt: activationStatus === 'PROCESSING' ? new Date() : null, activationLeaseExpiresAt: activationStatus === 'PROCESSING' ? input.leaseExpiresAt ?? new Date(Date.now() + 60_000) : null } });
    const entity = await prisma.serviceAgreementEntity.create({ data: { tenantId: workspace.id, agreementId: agreement.id, companyId: company.id, nameSnapshot: company.name, uenSnapshot: company.uen } });
    const item = await prisma.serviceAgreementItem.create({ data: { tenantId: workspace.id, agreementId: agreement.id, serviceVariantId: variant.id, variantVersion: 1, familyNameSnapshot: family.name, variantNameSnapshot: input.serviceName ?? variant.name, serviceCadence: 'ANNUALLY', sowPartialId: partial.id, partialVersion: 1, partialContentSnapshot: '<p>Service</p>', partialPlaceholdersSnapshot: [], partialDependencySnapshot: [], startDate: new Date('2026-07-30T00:00:00Z'), fieldValues: {} } });
    await prisma.serviceAgreementItemEntity.create({ data: { tenantId: workspace.id, itemId: item.id, agreementEntityId: entity.id } });
    const fee = await prisma.serviceAgreementFeeLine.create({ data: { tenantId: workspace.id, itemId: item.id, agreementEntityId: entity.id, description: 'Annual fee', amount: '500.00', currency: 'SGD', billingFrequency: 'ANNUALLY' } });
    return { workspace, user, agreement, item, company, fee };
  }

  it('claims once under overlap and preserves unique operational rows', async () => {
    const seeded = await seedAgreement();
    const results = await Promise.all([
      processQueuedServiceAgreementActivations({ limit: 1, concurrency: 1 }),
      processQueuedServiceAgreementActivations({ limit: 1, concurrency: 1 }),
    ]);
    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(1);
    expect(await prisma.clientService.count({ where: { agreementId: seeded.agreement.id } })).toBe(1);
    expect(await prisma.clientServiceFeeLine.count({ where: { sourceAgreementFeeLineId: seeded.fee.id } })).toBe(1);
    await expect(prisma.clientService.create({ data: { tenantId: seeded.workspace.id, companyId: seeded.company.id, agreementId: seeded.agreement.id, agreementItemId: seeded.item.id, serviceVariantId: (await prisma.serviceAgreementItem.findUniqueOrThrow({ where: { id: seeded.item.id } })).serviceVariantId, familyName: 'Duplicate', serviceName: 'Duplicate', serviceCadence: 'ANNUALLY', startDate: new Date('2026-07-30T00:00:00Z'), fieldValues: {} } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rolls back operational rows and success audits when an audit insert fails', async () => {
    const claimToken = randomUUID();
    const seeded = await seedAgreement({ activationStatus: 'PROCESSING', claimToken, serviceName: `stage3-reject-${randomUUID()}` });
    await expect(processServiceAgreementActivation({ agreementId: seeded.agreement.id, tenantId: seeded.workspace.id, claimToken })).resolves.toMatchObject({ status: 'retryable-failure' });
    expect(await prisma.clientService.count({ where: { agreementId: seeded.agreement.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId: seeded.workspace.id, entityType: 'ClientService' } })).toBe(0);
    await expect(prisma.serviceAgreement.findUniqueOrThrow({ where: { id: seeded.agreement.id } })).resolves.toMatchObject({ activationStatus: 'FAILED_RETRYABLE' });
  });

  it('reclaims an expired processing lease', async () => {
    const seeded = await seedAgreement({
      activationStatus: 'PROCESSING',
      claimToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });

    await expect(processQueuedServiceAgreementActivations({ limit: 1, concurrency: 1, leaseMs: 60_000 }))
      .resolves.toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    await expect(prisma.serviceAgreement.findUniqueOrThrow({ where: { id: seeded.agreement.id } }))
      .resolves.toMatchObject({ status: 'EFFECTIVE', activationStatus: 'COMPLETED', activationClaimToken: null });
  });

  it('does not claim an activation after the agreement is cancelled', async () => {
    const seeded = await seedAgreement({ agreementStatus: 'CANCELLED' });

    await expect(processQueuedServiceAgreementActivations({ limit: 1, concurrency: 1 }))
      .resolves.toMatchObject({ claimed: 0, completed: 0, failed: 0 });
    expect(await prisma.clientService.count({ where: { agreementId: seeded.agreement.id } })).toBe(0);
  });

  it('prevents an expired worker from writing with an obsolete claim token', async () => {
    const currentClaimToken = randomUUID();
    const seeded = await seedAgreement({ activationStatus: 'PROCESSING', claimToken: currentClaimToken });

    await expect(processServiceAgreementActivation({ agreementId: seeded.agreement.id, tenantId: seeded.workspace.id, claimToken: randomUUID() }))
      .resolves.toEqual({ status: 'stale-worker' });
    expect(await prisma.clientService.count({ where: { agreementId: seeded.agreement.id } })).toBe(0);
    await expect(prisma.serviceAgreement.findUniqueOrThrow({ where: { id: seeded.agreement.id } }))
      .resolves.toMatchObject({ activationStatus: 'PROCESSING', activationClaimToken: currentClaimToken });
  });

  it('treats duplicate completion as idempotent', async () => {
    const seeded = await seedAgreement();
    await expect(processQueuedServiceAgreementActivations({ limit: 1, concurrency: 1 }))
      .resolves.toMatchObject({ claimed: 1, completed: 1, failed: 0 });

    await expect(processServiceAgreementActivation({ agreementId: seeded.agreement.id, tenantId: seeded.workspace.id, claimToken: 'obsolete-claim' }))
      .resolves.toEqual({ status: 'already-completed', clientServiceCount: 1 });
    expect(await prisma.clientService.count({ where: { agreementId: seeded.agreement.id } })).toBe(1);
    expect(await prisma.clientServiceFeeLine.count({ where: { sourceAgreementFeeLineId: seeded.fee.id } })).toBe(1);
  });

  it('allows exactly one overlapping manual retry', async () => {
    const seeded = await seedAgreement({ activationStatus: 'FAILED_PERMANENT', activationAttemptCount: 5 });
    const actor = { tenantId: seeded.workspace.id, userId: seeded.user.id };
    const results = await Promise.allSettled([
      retryServiceAgreementActivation(seeded.agreement.id, actor),
      retryServiceAgreementActivation(seeded.agreement.id, actor),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ statusCode: 409 });
    await expect(prisma.serviceAgreement.findUniqueOrThrow({ where: { id: seeded.agreement.id } }))
      .resolves.toMatchObject({ activationStatus: 'PENDING', activationAttemptCount: 0, activationLastError: null });
    expect(await prisma.auditLog.count({ where: { tenantId: seeded.workspace.id, entityType: 'ServiceAgreement', entityId: seeded.agreement.id, summary: 'Retried Service Agreement activation' } })).toBe(1);
  });

  it('creates an independent agreement service when a manual row with null lineage exists', async () => {
    const seeded = await seedAgreement();
    await prisma.clientService.create({
      data: {
        tenantId: seeded.workspace.id,
        companyId: seeded.company.id,
        source: 'MANUAL',
        agreementId: null,
        agreementItemId: null,
        serviceVariantId: seeded.item.serviceVariantId,
        familyName: 'Manual family',
        serviceName: 'Manual advisory',
        serviceCadence: 'ANNUALLY',
        startDate: new Date('2026-07-30T00:00:00Z'),
        fieldValues: {},
      },
    });

    await expect(processQueuedServiceAgreementActivations({ limit: 1, concurrency: 1 }))
      .resolves.toMatchObject({ claimed: 1, completed: 1, failed: 0 });

    const services = await prisma.clientService.findMany({ where: { tenantId: seeded.workspace.id }, orderBy: { createdAt: 'asc' } });
    expect(services).toHaveLength(2);
    expect(services[0]).toMatchObject({ source: 'MANUAL', agreementId: null, agreementItemId: null });
    expect(services[1]).toMatchObject({ source: 'AGREEMENT', agreementItemId: seeded.item.id });
    expect(await prisma.clientService.updateMany({ where: { id: services[0].id }, data: { serviceName: 'Unchanged' } })).toMatchObject({ count: 1 });
    expect((await prisma.clientService.findUniqueOrThrow({ where: { id: services[0].id } })).serviceName).toBe('Unchanged');
  });

  it('rejects every impossible client-service source/reference combination', async () => {
    const seeded = await seedAgreement();
    const base = {
      tenantId: seeded.workspace.id,
      companyId: seeded.company.id,
      serviceVariantId: seeded.item.serviceVariantId,
      familyName: 'Constraint family',
      serviceCadence: 'ANNUALLY' as const,
      startDate: new Date('2026-08-02T00:00:00Z'),
      fieldValues: {},
    };
    const invalid = [
      { source: 'AGREEMENT' as const, agreementId: null, agreementItemId: null },
      { source: 'AGREEMENT' as const, agreementId: seeded.agreement.id, agreementItemId: null },
      { source: 'AGREEMENT' as const, agreementId: null, agreementItemId: seeded.item.id },
      { source: 'MANUAL' as const, agreementId: seeded.agreement.id, agreementItemId: seeded.item.id },
      { source: 'MANUAL' as const, agreementId: seeded.agreement.id, agreementItemId: null },
      { source: 'MANUAL' as const, agreementId: null, agreementItemId: seeded.item.id },
    ];

    for (const [index, lineage] of invalid.entries()) {
      await expect(prisma.clientService.create({
        data: { ...base, ...lineage, serviceName: `Invalid lineage ${index}` },
      })).rejects.toThrow(/client_services_source_reference_consistency/);
    }

    expect(await prisma.clientService.count({ where: { tenantId: seeded.workspace.id } })).toBe(0);

    await prisma.clientService.create({
      data: {
        ...base,
        source: 'AGREEMENT',
        agreementId: seeded.agreement.id,
        agreementItemId: seeded.item.id,
        serviceName: 'Valid agreement lineage',
      },
    });
    await prisma.clientService.create({
      data: {
        ...base,
        source: 'MANUAL',
        agreementId: null,
        agreementItemId: null,
        serviceName: 'Valid manual lineage',
        startDate: new Date('2026-08-03T00:00:00Z'),
      },
    });

    expect(await prisma.clientService.count({ where: { tenantId: seeded.workspace.id } })).toBe(2);
  });

  it('uses the activation queue indexes for pending and expired-lease claims', async () => {
    await seedAgreement();
    const plans = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const pending = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`EXPLAIN SELECT id FROM service_agreements WHERE activation_status IN ('PENDING', 'FAILED_RETRYABLE') AND activation_available_at <= NOW() ORDER BY activation_available_at LIMIT 10`);
      const leases = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`EXPLAIN SELECT id FROM service_agreements WHERE activation_status = 'PROCESSING' AND activation_lease_expires_at <= NOW() ORDER BY activation_lease_expires_at LIMIT 10`);
      return [...pending, ...leases].map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plans).toMatch(/service_agreements_activation_(available_claim|expired_lease)_idx/);
  });
});
