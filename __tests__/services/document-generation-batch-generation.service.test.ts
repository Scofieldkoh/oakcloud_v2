import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    documentGenerationBatch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    documentGenerationBatchItem: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    documentTemplate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    templatePartial: {
      findMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
}));

const previewMock = vi.hoisted(() => ({
  buildBatchItemRenderInput: vi.fn(),
}));

vi.mock('@/services/document-generation-batch/preview.service', () => previewMock);

const generatorMock = vi.hoisted(() => ({
  materializeDocumentFromTemplate: vi.fn(),
  finalizeDocument: vi.fn(),
}));

vi.mock('@/services/document-generator.service', () => generatorMock);

vi.mock('@/services/tasks/integration.service', () => ({
  linkFirstGeneratedDocumentTaskOutcomeForBatch: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import {
  generateDocumentGenerationBatch,
  preflightDocumentGenerationBatch,
  retryDocumentGenerationBatchItem,
} from '@/services/document-generation-batch';
import {
  finalizeDocument,
  materializeDocumentFromTemplate,
} from '@/services/document-generator.service';
import { createReviewedFingerprint } from '@/lib/document-generation-fingerprint';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const actor = { tenantId, userId };
const batchId = 'batch-1';

const templateA = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Engagement Letter',
  compositionType: 'STANDARD',
  version: 1,
  category: 'LETTER',
  content: '<p>x</p>',
  placeholders: [],
};
const templateB = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Service Agreement',
  compositionType: 'SERVICE_AGREEMENT',
  version: 1,
  category: 'CONTRACT',
  content: '<p>x</p>',
  placeholders: [],
};
const templateC = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'KYC Checklist',
  compositionType: 'STANDARD',
  version: 1,
  category: 'OTHER',
  content: '<p>x</p>',
  placeholders: [],
};

function item(
  id: string,
  template: typeof templateA,
  status: string,
  overrides: Record<string, unknown> = {},
): any {
  const previewFingerprint: string = typeof overrides.previewFingerprint === 'string'
    ? overrides.previewFingerprint
    : 'fingerprint-ok';
  const reviewedFingerprint: string | null = overrides.reviewedFingerprint !== undefined
    ? String(overrides.reviewedFingerprint)
    : createReviewedFingerprint({
        previewFingerprint,
        editedContent: '<p>preview</p>',
        editedContentJson: null,
      });
  return {
    id,
    tenantId,
    batchId,
    templateId: template.id,
    generatedDocumentId: `child-${id}`,
    templateVersion: 1,
    displayOrder: Number(id.slice(-1)) || 0,
    status,
    configuration: {
      version: 1 as const,
      title: `Untitled - ${template.name}`,
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {},
      masterOverrides: {},
      useLetterhead: true,
      serviceAgreement: null,
    },
    previewContent: '<p>preview</p>',
    editedContent: null,
    editedContentJson: null,
    previewFingerprint,
    reviewedFingerprint,
    validationDiagnostics: null,
    lastError: null,
    generationAttemptId: null,
    generationClaimedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    template,
    generatedDocument: {
      id: `child-${id}`,
      tenantId,
      title: `Untitled - ${template.name}`,
      content: '',
      status: 'DRAFT',
      serviceAgreement: null,
    },
    ...overrides,
  };
}

type TestItem = ReturnType<typeof item>;

function batchWith(items: any[]) {
  return {
    id: batchId,
    tenantId,
    primaryCompanyId: 'company-1',
    createdById: userId,
    activeItemId: items[0]?.id ?? null,
    currentStage: 3,
    revision: 5,
    status: 'DRAFT',
    masterFieldValues: {},
    taskContext: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    primaryCompany: { id: 'company-1', name: 'Acme', uen: '123' },
    createdBy: { id: userId, firstName: 'Ava', lastName: 'Tan' },
    items,
    activeItem: items[0] ?? null,
  };
}

function evaluatedFor(entry: TestItem) {
  return {
    content: '<p>preview</p>',
    fingerprint: entry.previewFingerprint,
    blockingErrors: [],
    effectiveCustomData: {},
    resolvedTitle: `${entry.template.name}_Acme_31 Aug 2026`,
    rendered: {},
  };
}

describe('document generation batch execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      (callback) => callback(prisma as never) as never,
    );
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      firstName: 'Ava',
      lastName: 'Tan',
    } as never);
    vi.mocked(prisma.documentTemplate.findMany).mockResolvedValue([templateA, templateB, templateC] as never);
    vi.mocked(prisma.templatePartial.findMany).mockResolvedValue([]);
    vi.mocked(prisma.documentGenerationBatch.update).mockResolvedValue({
      id: batchId,
      revision: 6,
      status: 'PARTIAL',
    } as never);
    vi.mocked(prisma.documentGenerationBatch.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.documentGenerationBatchItem.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(previewMock.buildBatchItemRenderInput).mockImplementation(
      ((batch: { items: TestItem[] }, entry: TestItem) =>
        Promise.resolve(evaluatedFor(entry))) as never,
    );
  });

  it('creates no output when any item fails preflight', async () => {
    const ready = item('item-0', templateA, 'READY');
    const needsInput = item('item-1', templateB, 'NEEDS_INPUT', {
      reviewedFingerprint: null,
    });
    const batch = batchWith([ready, needsInput]);
    vi.mocked(prisma.documentGenerationBatch.findFirst).mockResolvedValue(batch as never);

    await expect(
      preflightDocumentGenerationBatch(batchId, { expectedRevision: 5 }, actor),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.documentGenerationBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: batchId, revision: 5 }),
      }),
    );
    expect(materializeDocumentFromTemplate).not.toHaveBeenCalled();
    expect(prisma.documentGenerationBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          validationDiagnostics: expect.objectContaining({
            itemId: 'item-1',
            status: 'NEEDS_INPUT',
          }),
        }),
      }),
    );
  });

  it('preserves successes and records one execution-time failure', async () => {
    const itemA = item('item-0', templateA, 'READY');
    const itemB = item('item-1', templateB, 'READY');
    const itemC = item('item-2', templateC, 'READY');
    const batch = batchWith([itemA, itemB, itemC]);
    vi.mocked(prisma.documentGenerationBatch.findFirst).mockResolvedValue(batch as never);
    vi.mocked(prisma.documentGenerationBatchItem.updateMany)
      .mockResolvedValueOnce({ count: 3 });
    vi.mocked(prisma.documentGenerationBatchItem.findMany)
      .mockResolvedValueOnce([itemA, itemB, itemC] as never)
      .mockResolvedValueOnce([
        { id: 'item-0', status: 'GENERATED', displayOrder: 0 },
        { id: 'item-1', status: 'FAILED', displayOrder: 1 },
        { id: 'item-2', status: 'GENERATED', displayOrder: 2 },
      ] as never);
    vi.mocked(materializeDocumentFromTemplate)
      .mockResolvedValueOnce({ id: 'doc-a', title: 'Engagement Letter' } as never)
      .mockRejectedValueOnce(new Error('conversion failed'))
      .mockResolvedValueOnce({ id: 'doc-c', title: 'KYC Checklist' } as never);
    vi.mocked(prisma.documentGenerationBatchItem.update).mockResolvedValue({ id: 'x' } as never);

    const result = await generateDocumentGenerationBatch(
      batchId,
      { expectedRevision: 5 },
      actor,
    );

    expect(result.successes.map((entry) => entry.documentId)).toEqual(['doc-a', 'doc-c']);
    expect(result.failures).toEqual([
      expect.objectContaining({ itemId: 'item-1', code: 'GENERATION_FAILED' }),
    ]);
    expect(result.batchStatus).toBe('PARTIAL');
    expect(materializeDocumentFromTemplate).toHaveBeenCalledTimes(3);
    expect(finalizeDocument).toHaveBeenCalledWith('doc-a', actor, undefined);
    expect(finalizeDocument).toHaveBeenCalledWith('doc-c', actor, undefined);
    expect(finalizeDocument).toHaveBeenCalledTimes(2);
  });

  it('refuses to regenerate an already generated item', async () => {
    const generated = item('item-0', templateA, 'GENERATED');
    const batch = batchWith([generated]);
    vi.mocked(prisma.documentGenerationBatch.findFirst).mockResolvedValue(batch as never);
    vi.mocked(prisma.documentGenerationBatchItem.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.documentGenerationBatchItem.findMany)
      .mockResolvedValue([{ id: 'item-0', status: 'GENERATED', displayOrder: 0 }] as never);

    const result = await generateDocumentGenerationBatch(
      batchId,
      { expectedRevision: 5 },
      actor,
    );

    expect(materializeDocumentFromTemplate).not.toHaveBeenCalled();
    expect(result.successes).toEqual([]);
    expect(result.batchStatus).toBe('COMPLETED');
  });

  it('retries one failed item and skips generated siblings', async () => {
    const failed = item('item-1', templateB, 'FAILED', {
      previewFingerprint: 'fingerprint-ok',
    });
    const generated = item('item-0', templateA, 'GENERATED');
    const batch = batchWith([generated, failed]);
    vi.mocked(prisma.documentGenerationBatch.findFirst)
      .mockResolvedValueOnce(batch as never)
      .mockResolvedValueOnce(batchWith([generated, {
        ...failed,
        status: 'GENERATED',
      }]) as never);
    vi.mocked(prisma.documentGenerationBatchItem.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(materializeDocumentFromTemplate).mockResolvedValue({
      id: 'child-item-1',
      title: 'Untitled - Service Agreement',
    } as never);
    vi.mocked(prisma.documentGenerationBatchItem.update).mockResolvedValue({ id: 'item-1' } as never);
    vi.mocked(prisma.documentGenerationBatchItem.findMany).mockResolvedValue([
      { id: 'item-0', status: 'GENERATED' },
      { id: 'item-1', status: 'GENERATED' },
    ] as never);

    const result = await retryDocumentGenerationBatchItem(
      batchId,
      'item-1',
      { expectedRevision: 5 },
      actor,
    );

    expect(materializeDocumentFromTemplate).toHaveBeenCalledTimes(1);
    expect(materializeDocumentFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: templateB.id,
        title: 'Service Agreement_Acme_31 Aug 2026',
      }),
      actor,
      expect.objectContaining({
        generatedDocumentId: 'child-item-1',
        expectedBatchItemId: 'item-1',
      }),
      undefined,
    );
    expect(finalizeDocument).toHaveBeenCalledWith('child-item-1', actor, undefined);
    expect(result.items.find((entry) => entry.id === 'item-1')?.status).toBe('GENERATED');
  });

  it('surfaces stale claims as retryable during preflight', async () => {
    const stale = item('item-1', templateB, 'GENERATING', {
      generationClaimedAt: new Date(Date.now() - 16 * 60 * 1000),
    });
    const ready = item('item-0', templateA, 'READY');
    const batch = batchWith([ready, stale]);
    vi.mocked(prisma.documentGenerationBatch.findFirst)
      .mockResolvedValueOnce(batch as never)
      .mockResolvedValueOnce(batchWith([ready, {
        ...stale,
        status: 'FAILED' as const,
        lastError: { code: 'ABANDONED_CLAIM', message: 'abandoned', occurredAt: new Date().toISOString() },
      } as never]) as never);
    vi.mocked(prisma.documentGenerationBatchItem.updateMany).mockResolvedValue({ count: 1 });

    await preflightDocumentGenerationBatch(batchId, { expectedRevision: 5 }, actor);
    expect(prisma.documentGenerationBatchItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'GENERATING' }),
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
});
