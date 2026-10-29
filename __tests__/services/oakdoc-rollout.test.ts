// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  generatedDocument: { findMany: vi.fn() },
  documentGenerationBatchItem: { findMany: vi.fn() },
  user: { findFirst: vi.fn() },
  documentTemplate: { findMany: vi.fn() },
  templatePartial: { findMany: vi.fn() },
  serviceVariant: { findMany: vi.fn() },
}));
const libraryDeletes = vi.hoisted(() => ({
  deleteDocumentTemplate: vi.fn(async () => undefined),
  deleteTemplatePartial: vi.fn(async () => undefined),
}));
vi.mock('@/services/document-template.service', () => ({ deleteDocumentTemplate: libraryDeletes.deleteDocumentTemplate }));
vi.mock('@/services/template-partial.service', () => ({ deleteTemplatePartial: libraryDeletes.deleteTemplatePartial }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/document-editor/generated-document-revision', () => ({
  readGeneratedDocumentRevisions: vi.fn(async (_client: unknown, ids: string[]) => new Map(ids.map((id) => [id, 3]))),
}));
const migration = vi.hoisted(() => ({
  getOakDocMigrationInventory: vi.fn(),
  setOakDocMigrationPreference: vi.fn(),
}));
vi.mock('@/services/oakdoc-migration.service', () => migration);
const auditMock = vi.hoisted(() => ({ createAuditLog: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => auditMock);

const templateInventory = [
  { status: 'A4_ONLY', readiness: 'NOT_MIGRATED', legacyTemplate: { id: 'a4-template', version: 1 }, oakDocTemplate: null, warnings: [] },
  {
    status: 'MIGRATED_PAIR',
    readiness: 'READY_FOR_SWITCHOVER',
    legacyTemplate: { id: 'a4-letter', version: 2 },
    oakDocTemplate: { id: 'word-letter', version: 5 },
    warnings: [],
  },
  {
    status: 'MIGRATED_PAIR',
    readiness: 'OAKDOC_PRIMARY',
    legacyTemplate: { id: 'a4-resolution', version: 1 },
    oakDocTemplate: { id: 'word-resolution', version: 3 },
    warnings: [],
  },
];
import {
  applyA4LibraryRemoval,
  applyTemplateCutover,
  buildA4LibraryRemovalPlan,
  buildOakDocRolloutInventory,
  buildTemplateCutoverPlan,
} from '@/services/oakdoc-rollout.service';

const tenantId = 'tenant-1';
beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.documentGenerationBatchItem.findMany.mockResolvedValue([
    { template: { contentJson: null } },
    { template: { contentJson: { oakDoc: { schemaVersion: 1 } } } },
  ]);
  prismaMock.user.findFirst.mockResolvedValue({ id: 'user-1' });
  migration.getOakDocMigrationInventory.mockResolvedValue(templateInventory);
  migration.setOakDocMigrationPreference.mockImplementation(async (input: { oakDocTemplateId: string; expectedRevision: number }) => ({
    id: input.oakDocTemplateId,
    version: input.expectedRevision + 1,
  }));
});

describe('OakDoc rollout inventory', () => {
  it('reports template status and unfinished batch items on A4 templates without contents', async () => {
    const inventory = await buildOakDocRolloutInventory(tenantId);

    expect(inventory.templates.byStatus).toEqual({ A4_ONLY: 1, MIGRATED_PAIR: 2 });
    expect(inventory.unfinishedBatchItemsOnA4Templates).toBe(1);
    expect(inventory).not.toHaveProperty('documents');
    expect(prismaMock.generatedDocument.findMany).not.toHaveBeenCalled();
  });
});

describe('OakDoc template cutover', () => {
  it('plans a cutover of validated pairs and a rollback of pairs already on Word', async () => {
    const cutover = await buildTemplateCutoverPlan(tenantId, 'OAKDOC');
    const rollback = await buildTemplateCutoverPlan(tenantId, 'LEGACY');
    expect(cutover.items).toEqual([{ oakDocTemplateId: 'word-letter', legacyTemplateId: 'a4-letter', expectedRevision: 5 }]);
    expect(rollback.items).toEqual([{ oakDocTemplateId: 'word-resolution', legacyTemplateId: 'a4-resolution', expectedRevision: 3 }]);
    expect(cutover.hash).not.toBe(rollback.hash);
  });

  it('switches the approved plan through the audited preference change and journals the run', async () => {
    const plan = await buildTemplateCutoverPlan(tenantId, 'OAKDOC');
    const run = await applyTemplateCutover({
      tenantId, userId: 'user-1', direction: 'OAKDOC', manifestHash: plan.hash, reason: 'Pilot cutover',
    });

    expect(migration.setOakDocMigrationPreference).toHaveBeenCalledWith(
      { oakDocTemplateId: 'word-letter', expectedRevision: 5, preference: 'OAKDOC', reason: 'Pilot cutover' },
      { tenantId, userId: 'user-1' },
    );
    expect(run.results).toEqual([{ oakDocTemplateId: 'word-letter', outcome: 'switched', revision: 6 }]);
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'OakDocRolloutRun',
      entityId: plan.hash,
      reason: 'Pilot cutover',
      metadata: expect.objectContaining({ operation: 'TEMPLATE_CUTOVER', outcomes: { switched: 1 } }),
    }));
  });

  it('refuses a changed plan, a missing reason and an unknown operator without switching anything', async () => {
    const plan = await buildTemplateCutoverPlan(tenantId, 'OAKDOC');
    await expect(applyTemplateCutover({
      tenantId, userId: 'user-1', direction: 'OAKDOC', manifestHash: plan.hash, reason: '  ',
    })).rejects.toThrow('reason');

    migration.getOakDocMigrationInventory.mockResolvedValue([
      { ...templateInventory[1], oakDocTemplate: { id: 'word-letter', version: 6 } },
    ]);
    await expect(applyTemplateCutover({
      tenantId, userId: 'user-1', direction: 'OAKDOC', manifestHash: plan.hash, reason: 'go',
    })).rejects.toMatchObject({ details: { reason: 'OAKDOC_MANIFEST_CHANGED' } });

    prismaMock.user.findFirst.mockResolvedValue(null);
    await expect(applyTemplateCutover({
      tenantId, userId: 'user-x', direction: 'OAKDOC', manifestHash: plan.hash, reason: 'go',
    })).rejects.toThrow('operator');
    expect(migration.setOakDocMigrationPreference).not.toHaveBeenCalled();
  });

  it('rolls back pair by pair and reports failures without stopping', async () => {
    migration.getOakDocMigrationInventory.mockResolvedValue([
      templateInventory[2],
      { ...templateInventory[2], legacyTemplate: { id: 'a4-other', version: 1 }, oakDocTemplate: { id: 'word-other', version: 2 } },
    ]);
    migration.setOakDocMigrationPreference.mockRejectedValueOnce(
      Object.assign(new Error('stale'), { details: { reason: 'REVISION_CONFLICT' } }),
    );
    const plan = await buildTemplateCutoverPlan(tenantId, 'LEGACY');
    const run = await applyTemplateCutover({
      tenantId, userId: 'user-1', direction: 'LEGACY', manifestHash: plan.hash, reason: 'Rollback',
    });
    expect(run.results.map((item) => item.outcome)).toEqual(['failed', 'switched']);
    expect(run.results[0].reason).toBe('REVISION_CONFLICT');
  });
});

describe('OakDoc A4 library', () => {
  describe('A4 library removal', () => {
    const wordAsset = {
      oakDoc: {
        schemaVersion: 1,
        storageKey: 'tenant-1/partials/p/oakdoc/a.docx',
        fileName: 'a.docx',
        fileSize: 10,
        sha256: 'a'.repeat(64),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fieldTags: [],
      },
    };

    beforeEach(() => {
      prismaMock.documentTemplate.findMany.mockResolvedValue([
        { id: 'a4-template', name: 'Old letter', version: 3, contentJson: null, _count: { generatedDocuments: 2 } },
        { id: 'word-template', name: 'Letter', version: 1, contentJson: wordAsset, _count: { generatedDocuments: 0 } },
      ]);
      prismaMock.templatePartial.findMany.mockResolvedValue([
        { id: 'a4-partial', name: 'old-scope', version: 2, contentJson: null },
        { id: 'word-partial', name: 'scope', version: 1, contentJson: wordAsset },
      ]);
      prismaMock.serviceVariant.findMany.mockResolvedValue([]);
    });

    it('plans only the A4 templates and HTML partials', async () => {
      const plan = await buildA4LibraryRemovalPlan(tenantId);

      expect(plan.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(plan.items).toEqual([
        { kind: 'partial', id: 'a4-partial', name: 'old-scope', expectedRevision: 2, serviceVariants: 0 },
        { kind: 'template', id: 'a4-template', name: 'Old letter', expectedRevision: 3, generatedDocuments: 2 },
      ]);
    });

    it('soft-deletes templates before partials through the audited services and journals the run', async () => {
      const plan = await buildA4LibraryRemovalPlan(tenantId);
      libraryDeletes.deleteTemplatePartial.mockRejectedValueOnce(new Error('Cannot delete partial: relink 1 service variant(s)'));

      const run = await applyA4LibraryRemoval({ tenantId, userId: 'user-1', manifestHash: plan.hash, reason: 'A4 retired' });

      const params = { tenantId, userId: 'user-1' };
      expect(libraryDeletes.deleteDocumentTemplate).toHaveBeenCalledWith('a4-template', params, 'A4 retired', 3);
      expect(libraryDeletes.deleteTemplatePartial).toHaveBeenCalledWith('a4-partial', params, 'A4 retired', 2);
      expect(libraryDeletes.deleteDocumentTemplate.mock.invocationCallOrder[0])
        .toBeLessThan(libraryDeletes.deleteTemplatePartial.mock.invocationCallOrder[0]);
      expect(run.results).toEqual([
        { kind: 'template', id: 'a4-template', outcome: 'removed' },
        { kind: 'partial', id: 'a4-partial', outcome: 'failed', reason: 'Cannot delete partial: relink 1 service variant(s)' },
      ]);
      expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        entityType: 'OakDocRolloutRun',
        entityId: plan.hash,
        reason: 'A4 retired',
        metadata: expect.objectContaining({ operation: 'A4_LIBRARY_REMOVAL' }),
      }));
    });

    it('refuses a changed plan or a missing reason without deleting anything', async () => {
      await expect(applyA4LibraryRemoval({ tenantId, userId: 'user-1', manifestHash: 'f'.repeat(64), reason: 'A4 retired' }))
        .rejects.toMatchObject({ details: { reason: 'OAKDOC_MANIFEST_CHANGED' } });
      const plan = await buildA4LibraryRemovalPlan(tenantId);
      await expect(applyA4LibraryRemoval({ tenantId, userId: 'user-1', manifestHash: plan.hash, reason: ' ' }))
        .rejects.toThrow('A reason is required');
      expect(libraryDeletes.deleteDocumentTemplate).not.toHaveBeenCalled();
      expect(libraryDeletes.deleteTemplatePartial).not.toHaveBeenCalled();
    });
  });
});
