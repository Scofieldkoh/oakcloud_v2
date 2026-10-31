// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCodes } from '@/lib/errors';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

describePostgres('deadline-rule archive draft concurrency PostgreSQL integration', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let tenantId: string;
  let ruleId: string;
  let publishedVersionId: string;
  let draftVersionId: string;
  let userId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import('@/lib/prisma')).getPrisma();
    tenantId = randomUUID();
    ruleId = randomUUID();
    publishedVersionId = randomUUID();
    draftVersionId = randomUUID();
    userId = randomUUID();

    await prisma.workspace.create({
      data: { id: tenantId, name: `Archive race ${tenantId}`, slug: `archive-race-${tenantId}` },
    });
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: `${userId}@example.test`,
        passwordHash: 'integration-only',
        firstName: 'Archive',
        lastName: 'Race',
      },
    });
    await prisma.deadlineRule.create({
      data: {
        id: ruleId,
        tenantId,
        code: `ARCHIVE_${tenantId.slice(0, 8)}`,
        name: 'Archive race rule',
        versions: {
          create: {
            id: publishedVersionId,
            tenantId,
            version: 1,
            state: 'PUBLISHED',
            schemaVersion: 1,
            configHash: 'a'.repeat(64),
            draftRevision: 1,
            recurrence: { schemaVersion: 1, kind: 'ANNUALLY', interval: 1 },
            applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
          },
        },
      },
    });
    await prisma.deadlineRule.update({ where: { id: ruleId }, data: { currentVersionId: publishedVersionId } });
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
      },
    });
  });

  afterAll(async () => {
    await prisma.deadlineRule.update({
      where: { id: ruleId },
      data: { currentVersionId: null },
    });
    await prisma.deadlineRuleVersion.deleteMany({ where: { tenantId } });
    await prisma.deadlineRule.deleteMany({ where: { tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.workspace.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it('returns IMPACT_CHANGED and commits no archive when a draft edit wins the row lock', async () => {
    const { archiveDeadlineRule, previewDeadlineRuleImpact } = await import('@/services/deadline-rule');
    const actor = { tenantId, userId };
    const preview = await previewDeadlineRuleImpact(ruleId, {
      operation: 'ARCHIVE',
      expectedCurrentVersion: 1,
      expectedDraftRevision: 2,
      draftConfigHash: 'b'.repeat(64),
    }, actor, { now: () => '2026-08-18' });

    let releaseEdit!: () => void;
    const editHeld = new Promise<void>((resolve) => { releaseEdit = resolve; });
    const edit = prisma.$transaction(async (tx) => {
      await tx.deadlineRuleVersion.update({
        where: { id: draftVersionId },
        data: { draftRevision: 3, configHash: 'c'.repeat(64) },
      });
      await editHeld;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    const archive = archiveDeadlineRule(ruleId, {
      operation: 'ARCHIVE',
      expectedCurrentVersion: 1,
      expectedDraftRevision: 2,
      draftConfigHash: 'b'.repeat(64),
      previewFingerprint: preview.previewFingerprint,
      reason: 'Retired',
    }, actor, { now: () => '2026-08-18' });
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseEdit();
    await edit;

    await expect(archive).rejects.toMatchObject({
      code: ErrorCodes.IMPACT_CHANGED,
      statusCode: 409,
      details: { impact: expect.any(Object) },
    });
    await expect(prisma.deadlineRule.findUnique({ where: { id: ruleId } })).resolves.toMatchObject({
      isActive: true,
      archivedAt: null,
    });
    await expect(prisma.serviceScheduleReconciliationRequest.count({ where: { tenantId, scopeId: ruleId } }))
      .resolves.toBe(0);
  });
});
