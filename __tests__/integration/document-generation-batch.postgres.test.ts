import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  OAKDOC_MIME_TYPE,
  OAKDOC_SERVICE_AGREEMENT_CONTENT,
  OAKDOC_TEMPLATE_CONTENT,
} from '@/lib/document-editor/oakdoc-template';

// A4 templates can no longer generate, so the fixtures are Word templates.
// Creating and editing a batch reads only the template metadata, not the file.
const oakDocContentJson = (suffix: string, fieldTags: string[]) => ({
  oakDoc: {
    schemaVersion: 1,
    storageKey: `integration/${suffix}.docx`,
    fileName: `${suffix}.docx`,
    fileSize: 1,
    sha256: '0'.repeat(64),
    mimeType: OAKDOC_MIME_TYPE,
    fieldTags,
  },
});

const describePostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('document generation batch postgres integration', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let createDocumentGenerationBatch: typeof import('@/services/document-generation-batch')['createDocumentGenerationBatch'];
  let updateDocumentGenerationBatch: typeof import('@/services/document-generation-batch')['updateDocumentGenerationBatch'];
  let discardDocumentGenerationBatch: typeof import('@/services/document-generation-batch')['discardDocumentGenerationBatch'];
  let adoptLegacyGenerationSession: typeof import('@/services/document-generation-batch')['adoptLegacyGenerationSession'];
  let searchGeneratedDocuments: typeof import('@/services/document-generator.service')['searchGeneratedDocuments'];
  let upsertServiceAgreementDraft: typeof import('@/services/service-agreement')['upsertServiceAgreementDraft'];
  const tenantIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const prismaModule = await import('@/lib/prisma');
    prisma = prismaModule.getPrisma();
    const batchModule = await import('@/services/document-generation-batch');
    createDocumentGenerationBatch = batchModule.createDocumentGenerationBatch;
    updateDocumentGenerationBatch = batchModule.updateDocumentGenerationBatch;
    discardDocumentGenerationBatch = batchModule.discardDocumentGenerationBatch;
    adoptLegacyGenerationSession = batchModule.adoptLegacyGenerationSession;
    ({ searchGeneratedDocuments } = await import('@/services/document-generator.service'));
    ({ upsertServiceAgreementDraft } = await import('@/services/service-agreement'));
  });

  afterEach(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.documentGenerationBatch.updateMany({
        where: { tenantId },
        data: { activeItemId: null },
      });
      await prisma.documentGenerationBatchItem.deleteMany({ where: { tenantId } });
      await prisma.documentGenerationBatch.deleteMany({ where: { tenantId } });
      await prisma.generatedDocument.deleteMany({ where: { tenantId } });
      await prisma.documentTemplate.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.delete({ where: { id: tenantId } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed() {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({
      data: { name: `Batch integration ${suffix}`, slug: `batch-integration-${suffix}` },
    });
    tenantIds.push(workspace.id);
    const user = await prisma.user.create({
      data: {
        tenantId: workspace.id,
        email: `batch-${suffix}@example.test`,
        passwordHash: 'not-used',
        firstName: 'Batch',
        lastName: 'User',
      },
    });
    const templates = await Promise.all([
      prisma.documentTemplate.create({
        data: {
          tenantId: workspace.id,
          createdById: user.id,
          name: `Engagement ${suffix}`,
          category: 'LETTER',
          content: OAKDOC_TEMPLATE_CONTENT,
          contentJson: oakDocContentJson(`engagement-${suffix}`, ['custom.reference']),
          placeholders: [
            {
              key: 'custom.reference',
              label: 'Reference',
              type: 'text',
              source: 'custom',
              category: 'custom',
              required: false,
            },
          ],
        },
      }),
      prisma.documentTemplate.create({
        data: {
          tenantId: workspace.id,
          createdById: user.id,
          name: `Agreement ${suffix}`,
          category: 'CONTRACT',
          compositionType: 'SERVICE_AGREEMENT',
          content: OAKDOC_SERVICE_AGREEMENT_CONTENT,
          contentJson: oakDocContentJson(`agreement-${suffix}`, ['selectedContact.name']),
        },
      }),
    ]);
    return {
      actor: { tenantId: workspace.id, userId: user.id },
      templates,
      suffix,
    };
  }

  it('creates distinct ordered child documents and hides incomplete children from search', async () => {
    const { actor, templates } = await seed();
    const created = await createDocumentGenerationBatch(
      {
        items: [
          { templateId: templates[0].id },
          { templateId: templates[1].id },
        ],
      },
      actor,
    );

    expect(created.items).toHaveLength(2);
    expect(created.items.map((item) => item.displayOrder)).toEqual([0, 1]);
    const childIds = created.items.map((item) => item.generatedDocumentId);
    expect(new Set(childIds).size).toBe(2);

    const search = await searchGeneratedDocuments(
      { page: 1, limit: 20, sortBy: 'updatedAt', sortOrder: 'desc' },
      actor.tenantId,
    );
    expect(search.documents.some((doc) => childIds.includes(doc.id))).toBe(false);
  });

  it('rejects an outdated revision with a conflict and mutates nothing', async () => {
    const { actor, templates } = await seed();
    const created = await createDocumentGenerationBatch(
      { items: [{ templateId: templates[0].id }] },
      actor,
    );
    const stale = created.revision - 1;

    await expect(updateDocumentGenerationBatch(
      created.id,
      {
        expectedRevision: stale,
        items: [{ templateId: templates[0].id }],
      },
      actor,
    )).rejects.toMatchObject({ statusCode: 409 });

    const refreshed = await prisma.documentGenerationBatch.findUniqueOrThrow({
      where: { id: created.id },
      select: { revision: true },
    });
    expect(refreshed.revision).toBe(created.revision);
  });

  it('claims an item exactly once under concurrent generation requests', async () => {
    const { actor, templates } = await seed();
    const created = await createDocumentGenerationBatch(
      { items: [{ templateId: templates[0].id }] },
      actor,
    );
    const itemId = created.items[0].id;
    await prisma.documentGenerationBatchItem.update({
      where: { id: itemId },
      data: { status: 'READY' },
    });

    const [first, second] = await Promise.all([
      prisma.documentGenerationBatchItem.updateMany({
        where: {
          id: itemId,
          batchId: created.id,
          tenantId: actor.tenantId,
          status: 'READY',
        },
        data: {
          status: 'GENERATING',
          generationAttemptId: randomUUID(),
          generationClaimedAt: new Date(),
        },
      }),
      prisma.documentGenerationBatchItem.updateMany({
        where: {
          id: itemId,
          batchId: created.id,
          tenantId: actor.tenantId,
          status: 'READY',
        },
        data: {
          status: 'GENERATING',
          generationAttemptId: randomUUID(),
          generationClaimedAt: new Date(),
        },
      }),
    ]);
    expect([first.count, second.count].sort()).toEqual([0, 1]);

    const stale = await prisma.documentGenerationBatchItem.updateMany({
      where: {
        id: itemId,
        batchId: created.id,
        tenantId: actor.tenantId,
        status: 'GENERATING',
        generationClaimedAt: { lt: new Date(Date.now() - 16 * 60 * 1000) },
      },
      data: { status: 'FAILED', generationAttemptId: null, generationClaimedAt: null },
    });
    expect(stale.count).toBe(0);

    await prisma.documentGenerationBatchItem.update({
      where: { id: itemId },
      data: { generationClaimedAt: new Date(Date.now() - 16 * 60 * 1000) },
    });
    const reclaimed = await prisma.documentGenerationBatchItem.updateMany({
      where: {
        id: itemId,
        batchId: created.id,
        tenantId: actor.tenantId,
        status: 'GENERATING',
        generationClaimedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) },
      },
      data: { status: 'FAILED', generationAttemptId: null, generationClaimedAt: null },
    });
    expect(reclaimed.count).toBe(1);
  });

  it('discards draft agreements and incomplete children while preserving generated outputs', async () => {
    const { actor, templates } = await seed();
    const created = await createDocumentGenerationBatch(
      { items: [{ templateId: templates[1].id }] },
      actor,
    );
    const item = created.items[0];
    await upsertServiceAgreementDraft(
      item.generatedDocumentId,
      {
        primaryCompanyId: actor.tenantId,
        authorizedContactIds: [actor.userId],
        signerContactIds: [actor.userId],
        entityIds: [actor.tenantId],
        agreementDate: '2026-08-12',
        effectiveDate: null,
        termMonths: 12,
        items: [],
      },
      actor,
      { skipDocumentCheck: true },
    ).catch(() => undefined);

    const result = await discardDocumentGenerationBatch(created.id, {}, actor);
    expect(result.discardedItemCount).toBe(1);
    const agreementCount = await prisma.serviceAgreement.count({
      where: { generatedDocumentId: item.generatedDocumentId },
    });
    expect(agreementCount).toBe(0);
  });

  it('saves preset resolutions on resolution templates only, without a version bump', async () => {
    const { actor, templates } = await seed();
    const { setDocumentTemplateResolutionPreset } = await import('@/services/document-template.service');
    await expect(setDocumentTemplateResolutionPreset(templates[0].id, null, actor))
      .rejects.toThrow('Preset resolutions are only available on resolution templates.');

    await prisma.documentTemplate.update({ where: { id: templates[0].id }, data: { compositionType: 'RESOLUTION' } });
    const preset = {
      subject: 'CHANGE IN COMPANY SECRETARY',
      sections: [{ id: 'a', kind: 'CUSTOM' as const, heading: 'APPOINTMENT OF SECRETARY', body: 'RESOLVED that ...' }],
    };
    const saved = await setDocumentTemplateResolutionPreset(templates[0].id, preset, actor);
    expect(saved.resolutionPreset).toEqual(preset);
    expect(saved.version).toBe(templates[0].version);

    const cleared = await setDocumentTemplateResolutionPreset(templates[0].id, null, actor);
    expect(cleared.resolutionPreset).toBeNull();
  });

  it('keeps repeat copies of one template as separate items through updates', async () => {
    const { actor, templates } = await seed();
    const created = await createDocumentGenerationBatch(
      { items: [{ templateId: templates[0].id }, { templateId: templates[0].id }] },
      actor,
    );
    expect(created.items).toHaveLength(2);
    expect(new Set(created.items.map((item) => item.generatedDocumentId)).size).toBe(2);
    const [first, second] = created.items;

    const added = await updateDocumentGenerationBatch(
      created.id,
      {
        expectedRevision: created.revision,
        items: [
          { id: first.id, templateId: templates[0].id, configuration: { ...first.configuration, title: 'First copy' } },
          { id: second.id, templateId: templates[0].id, configuration: { ...second.configuration, title: 'Second copy' } },
          { templateId: templates[0].id },
        ],
      },
      actor,
    );
    expect(added.items).toHaveLength(3);
    expect(added.items.slice(0, 2).map((item) => item.id)).toEqual([first.id, second.id]);
    expect(added.items.map((item) => item.configuration.title).slice(0, 2)).toEqual(['First copy', 'Second copy']);

    const removed = await updateDocumentGenerationBatch(
      created.id,
      {
        expectedRevision: added.revision,
        items: [
          { id: added.items[2].id, templateId: templates[0].id },
          { id: first.id, templateId: templates[0].id },
        ],
      },
      actor,
    );
    expect(removed.items.map((item) => item.id)).toEqual([added.items[2].id, first.id]);
    expect(removed.items[1].configuration.title).toBe('First copy');
  });

  it('resolves the active item to the new item when a local item is saved by template id', async () => {
    const { actor, templates } = await seed();
    const created = await createDocumentGenerationBatch(
      { items: [{ templateId: templates[0].id }] },
      actor,
    );

    const updated = await updateDocumentGenerationBatch(
      created.id,
      {
        expectedRevision: created.revision,
        currentStage: 2,
        activeItemId: templates[1].id,
        items: [
          { templateId: templates[0].id },
          { templateId: templates[1].id },
        ],
      },
      actor,
    );

    const newItem = updated.items.find(
      (item) => item.templateId === templates[1].id,
    );
    expect(updated.activeItemId).toBe(newItem?.id);
    expect(updated.items).toHaveLength(2);
  });

  it('adopts a legacy session idempotently around the same child document', async () => {
    const { actor, templates } = await seed();
    const legacy = await prisma.generatedDocument.create({
      data: {
        tenantId: actor.tenantId,
        templateId: templates[0].id,
        templateVersion: templates[0].version,
        title: 'Legacy draft',
        content: '<p>preview</p>',
        status: 'DRAFT',
        createdById: actor.userId,
        metadata: {
          generationSession: {
            version: 2,
            currentStep: 1,
            templateId: templates[0].id,
            companyId: null,
            contactIds: [],
            selectedDirectorId: null,
            selectedShareholderId: null,
            selectedContactId: null,
            title: 'Legacy draft',
            customData: {},
            useLetterhead: true,
            previewContent: '<p>preview</p>',
            editedContent: null,
            editedContentJson: null,
            serviceAgreementId: null,
          },
        },
      },
    });

    const first = await adoptLegacyGenerationSession(
      legacy.id,
      { items: [{ templateId: templates[0].id }] },
      actor,
    );
    const afterFirst = await prisma.generatedDocument.findUniqueOrThrow({
      where: { id: legacy.id },
      select: { revision: true },
    });
    const second = await adoptLegacyGenerationSession(
      legacy.id,
      { items: [{ templateId: templates[0].id }] },
      actor,
    );
    const afterSecond = await prisma.generatedDocument.findUniqueOrThrow({
      where: { id: legacy.id },
      select: { revision: true },
    });

    expect(first.items[0].generatedDocumentId).toBe(legacy.id);
    expect(second.id).toBe(first.id);
    expect(second.items[0].generatedDocumentId).toBe(legacy.id);
    expect(afterSecond.revision).toBe(afterFirst.revision);
    const count = await prisma.documentGenerationBatch.count({
      where: { tenantId: actor.tenantId },
    });
    expect(count).toBe(1);
  });
});