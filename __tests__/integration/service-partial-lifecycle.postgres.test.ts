import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const describePostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('service partial lifecycle serializable concurrency', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let createServiceVariant: typeof import('@/services/service-catalog')['createServiceVariant'];
  let updateServiceVariant: typeof import('@/services/service-catalog')['updateServiceVariant'];
  let deleteTemplatePartial: typeof import('@/services/template-partial.service')['deleteTemplatePartial'];
  const tenantIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const prismaModule = await import('@/lib/prisma');
    prisma = prismaModule.getPrisma();
    ({ createServiceVariant, updateServiceVariant } = await import(
      '@/services/service-catalog'
    ));
    ({ deleteTemplatePartial } = await import(
      '@/services/template-partial.service'
    ));

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION stage1_delay_variant_write()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.code LIKE 'RACE_%' THEN
          PERFORM pg_sleep(0.5);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS stage1_delay_variant_write_trigger
      ON service_variants
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER stage1_delay_variant_write_trigger
      BEFORE INSERT OR UPDATE OF sow_partial_id ON service_variants
      FOR EACH ROW EXECUTE FUNCTION stage1_delay_variant_write()
    `);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION stage1_reject_partial_delete_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."entityType" = 'TemplatePartial'
          AND NEW.action = 'DELETE'
          AND NEW."entityName" LIKE 'audit-fail-%'
        THEN
          RAISE EXCEPTION 'forced audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS stage1_reject_partial_delete_audit_trigger
      ON audit_logs
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER stage1_reject_partial_delete_audit_trigger
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION stage1_reject_partial_delete_audit()
    `);
  });

  afterEach(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.serviceVariantFeeTemplate.deleteMany({ where: { tenantId } });
      await prisma.serviceVariant.deleteMany({ where: { tenantId } });
      await prisma.serviceFamily.deleteMany({ where: { tenantId } });
      await prisma.templatePartial.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.delete({ where: { id: tenantId } });
    }
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS stage1_reject_partial_delete_audit_trigger
      ON audit_logs
    `);
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS stage1_reject_partial_delete_audit()',
    );
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS stage1_delay_variant_write_trigger
      ON service_variants
    `);
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS stage1_delay_variant_write()');
    await prisma.$disconnect();
  });

  async function seedLifecycleRows() {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({
      data: {
        name: `Stage 1 concurrency ${suffix}`,
        slug: `stage-1-concurrency-${suffix}`,
      },
    });
    tenantIds.push(workspace.id);
    const user = await prisma.user.create({
      data: {
        tenantId: workspace.id,
        email: `stage-1-${suffix}@example.test`,
        passwordHash: 'not-used',
        firstName: 'Stage',
        lastName: 'One',
      },
    });
    const family = await prisma.serviceFamily.create({
      data: {
        tenantId: workspace.id,
        code: `FAMILY_${suffix}`,
        name: 'Concurrency family',
      },
    });
    const sourcePartial = await prisma.templatePartial.create({
      data: {
        tenantId: workspace.id,
        createdById: user.id,
        name: `source-${suffix}`,
        displayName: 'Source partial',
        content: '<p>Source</p>',
        placeholders: [],
      },
    });
    const targetPartial = await prisma.templatePartial.create({
      data: {
        tenantId: workspace.id,
        createdById: user.id,
        name: `target-${suffix}`,
        displayName: 'Target partial',
        content: '<p>Target</p>',
        placeholders: [],
      },
    });
    return {
      actor: { tenantId: workspace.id, userId: user.id },
      family,
      sourcePartial,
      targetPartial,
      suffix,
    };
  }

  it('never commits a new variant linked to a concurrently deleted partial', async () => {
    const { actor, family, targetPartial, suffix } = await seedLifecycleRows();

    const createPromise = createServiceVariant(
      {
        familyId: family.id,
        sowPartialId: targetPartial.id,
        code: `RACE_CREATE_${suffix}`,
        name: 'Concurrent create',
        description: null,
        serviceCadence: 'MONTHLY',
        customCadenceLabel: null,
        displayOrder: 0,
        isActive: true,
        feeTemplates: [],
      },
      actor,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const deletePromise = deleteTemplatePartial(
      targetPartial.id,
      actor,
      'Concurrent lifecycle test',
    );

    const results = await Promise.allSettled([createPromise, deletePromise]);
    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);

    const invalidRows = await prisma.serviceVariant.count({
      where: {
        tenantId: actor.tenantId,
        deletedAt: null,
        sowPartial: { deletedAt: { not: null } },
      },
    });
    expect(invalidRows).toBe(0);
  });

  it('never commits a relink to a concurrently deleted partial', async () => {
    const {
      actor,
      family,
      sourcePartial,
      targetPartial,
      suffix,
    } = await seedLifecycleRows();
    const variant = await createServiceVariant(
      {
        familyId: family.id,
        sowPartialId: sourcePartial.id,
        code: `BASE_${suffix}`,
        name: 'Concurrent relink',
        description: null,
        serviceCadence: 'MONTHLY',
        customCadenceLabel: null,
        displayOrder: 0,
        isActive: true,
        feeTemplates: [],
      },
      actor,
    );
    await prisma.serviceVariant.update({
      where: { id: variant.id },
      data: { code: `RACE_RELINK_${suffix}` },
    });

    const relinkPromise = updateServiceVariant(
      variant.id,
      { sowPartialId: targetPartial.id, customCadenceLabel: null },
      actor,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const deletePromise = deleteTemplatePartial(
      targetPartial.id,
      actor,
      'Concurrent lifecycle test',
    );

    const results = await Promise.allSettled([relinkPromise, deletePromise]);
    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);

    const invalidRows = await prisma.serviceVariant.count({
      where: {
        id: variant.id,
        deletedAt: null,
        sowPartial: { deletedAt: { not: null } },
      },
    });
    expect(invalidRows).toBe(0);
  });

  it('rolls back the partial soft delete when its audit insert fails', async () => {
    const { actor, targetPartial } = await seedLifecycleRows();
    await prisma.templatePartial.update({
      where: { id: targetPartial.id },
      data: { name: `audit-fail-${randomUUID()}` },
    });

    await expect(
      deleteTemplatePartial(targetPartial.id, actor, 'Force audit rollback'),
    ).rejects.toThrow();

    const persisted = await prisma.templatePartial.findUniqueOrThrow({
      where: { id: targetPartial.id },
      select: { deletedAt: true },
    });
    expect(persisted.deletedAt).toBeNull();
  });
});
