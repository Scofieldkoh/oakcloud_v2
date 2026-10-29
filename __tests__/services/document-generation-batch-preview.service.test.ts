import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    documentGenerationBatch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
    documentGenerationBatchItem: {
      update: vi.fn(),
    },
    generatedDocument: {
      update: vi.fn(),
    },
    documentTemplate: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    templatePartial: {
      findMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('@/services/document-generator.service', () => ({
  renderTemplateForGeneration: vi.fn(),
  materializeDocumentFromTemplate: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import {
  previewDocumentGenerationBatchItem,
  reviewDocumentGenerationBatchItem,
} from '@/services/document-generation-batch';
import { renderTemplateForGeneration } from '@/services/document-generator.service';
import {
  createPreviewFingerprint,
  createReviewedFingerprint,
} from '@/lib/document-generation-fingerprint';
import { DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN } from '@/lib/document-generation-title';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const actor = { tenantId, userId };
const batchId = 'batch-1';
const itemId = 'item-1';
const templateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const template = {
  id: templateId,
  name: 'Engagement Letter',
  category: 'LETTER',
  compositionType: 'STANDARD',
  version: 1,
  content: '<p>{{custom.engagement_date}}</p>',
  contentJson: null,
  placeholders: [
    {
      key: 'custom.engagement_date',
      label: 'Engagement date',
      type: 'date',
      source: 'custom',
      category: 'custom',
      required: true,
    },
    {
      key: 'custom.reference',
      label: 'Reference',
      type: 'text',
      source: 'custom',
      category: 'custom',
      required: false,
    },
  ],
};

function batchItem(overrides: Record<string, unknown> = {}): any {
  return {
    id: itemId,
    tenantId,
    batchId,
    templateId,
    generatedDocumentId: 'child-1',
    templateVersion: 1,
    displayOrder: 0,
    status: 'NEEDS_INPUT',
    configuration: {
      version: 1 as const,
      title: 'Engagement Letter',
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {},
      masterOverrides: { 'engagement_date::date': '2026-09-01' },
      useLetterhead: true,
      serviceAgreement: null,
    },
    previewContent: '<p>auto</p>',
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: null,
    reviewedFingerprint: null,
    validationDiagnostics: null,
    lastError: null,
    generationAttemptId: null,
    generationClaimedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    template,
    generatedDocument: {
      id: 'child-1',
      tenantId,
      title: 'Engagement Letter',
      content: '',
      status: 'DRAFT',
      serviceAgreement: null,
    },
    ...overrides,
  };
}

function batchWith(item: any = batchItem()): any {
  return {
    id: batchId,
    tenantId,
    primaryCompanyId: 'company-1',
    createdById: userId,
    activeItemId: itemId,
    currentStage: 2,
    revision: 3,
    status: 'DRAFT',
    masterFieldValues: {
      'engagement_date::date': '2026-08-12',
      'reference::text': 'MASTER-1',
    },
    taskContext: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    primaryCompany: { id: 'company-1', name: 'Acme', uen: '123' },
    createdBy: { id: userId, firstName: 'Ava', lastName: 'Tan' },
    items: [item],
    activeItem: item,
  };
}

function renderedResult(content = '<p>rendered</p>') {
  return {
    template: { id: templateId, name: 'Engagement Letter', category: 'LETTER', version: 1 },
    content,
    contentHtml: content,
    rawResolvedContent: content,
    sections: [],
    missingPlaceholders: [],
    missingPartials: [],
    contextSummary: {},
    blockingErrors: [],
    context: {},
    diagnostics: {
      syntaxErrors: [],
      partialReferences: [],
      missingPartials: [],
      circularPartials: [],
      unknownPlaceholders: [],
      duplicateCustomKeys: [],
      unusedCustomFields: [],
      dependencies: [],
    },
    dependencySnapshot: {
      templateId,
      templateName: 'Engagement Letter',
      templateVersion: 1,
      partials: [],
    },
  };
}

describe('document generation batch preview and review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      (callback) => callback(prisma as never) as never,
    );
    // Claims the generated document's revision before its title is updated.
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ revision: 2 }] as never);
    vi.mocked(prisma.documentTemplate.findMany).mockResolvedValue([template] as never);
    vi.mocked(prisma.templatePartial.findMany).mockResolvedValue([]);
    vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue(template as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      firstName: 'Ava',
      lastName: 'Tan',
    } as never);
    vi.mocked(prisma.documentGenerationBatch.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.documentGenerationBatchItem.update).mockResolvedValue({ id: itemId } as never);
    vi.mocked(renderTemplateForGeneration).mockResolvedValue(renderedResult() as never);
  });

  it('renders with effective master values and item overrides', async () => {
    const item = batchItem();
    vi.mocked(prisma.documentGenerationBatch.findFirst).mockResolvedValue(batchWith(item) as never);
    vi.mocked(prisma.documentGenerationBatch.findFirstOrThrow).mockResolvedValue(
      batchWith(item) as never,
    );

    await previewDocumentGenerationBatchItem(
      batchId,
      itemId,
      { expectedRevision: 3 },
      actor,
    );

    expect(renderTemplateForGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        customData: {
          engagement_date: '2026-09-01',
          reference: 'MASTER-1',
        },
        generatedDocumentId: 'child-1',
        companyId: 'company-1',
      }),
    );
  });

  it('requires explicit replacement before overwriting manual edits', async () => {
    const item = batchItem({
      editedContent: '<p>manual</p>',
      previewContent: '<p>auto</p>',
    });
    vi.mocked(prisma.documentGenerationBatch.findFirst).mockResolvedValue(batchWith(item) as never);

    await expect(
      previewDocumentGenerationBatchItem(
        batchId,
        itemId,
        { expectedRevision: 3, replaceEditedContent: false },
        actor,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.documentGenerationBatchItem.update).not.toHaveBeenCalled();
  });

  it('persists a fresh preview with a computed fingerprint', async () => {
    const item = batchItem();
    vi.mocked(prisma.documentGenerationBatch.findFirst).mockResolvedValue(batchWith(item) as never);
    vi.mocked(prisma.documentGenerationBatch.findFirstOrThrow).mockResolvedValue(
      batchWith({ ...item, previewFingerprint: 'a'.repeat(64) }) as never,
    );

    const result = await previewDocumentGenerationBatchItem(
      batchId,
      itemId,
      { expectedRevision: 3 },
      actor,
    );

    expect(prisma.documentGenerationBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          // The workflow renderer re-renders the stored template with the item override.
          previewContent: '<p>2026-09-01</p>',
          previewFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          reviewedFingerprint: null,
        }),
      }),
    );
    expect(typeof result.items[0].previewFingerprint).toBe('string');
  });

  it('resolves the configured template title date before review', async () => {
    const item = batchItem({
      configuration: {
        ...batchItem().configuration,
        title: DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
      },
    });
    vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
      ...template,
      contentJson: { documentTitleDateFieldKey: 'engagement_date' },
    } as never);
    vi.mocked(prisma.documentGenerationBatch.findFirst).mockResolvedValue(batchWith(item) as never);
    vi.mocked(prisma.documentGenerationBatch.findFirstOrThrow).mockResolvedValue(
      batchWith({
        ...item,
        generatedDocument: {
          ...item.generatedDocument,
          title: 'Engagement Letter_Acme_1 Sep 2026',
        },
      }) as never,
    );

    await previewDocumentGenerationBatchItem(
      batchId,
      itemId,
      { expectedRevision: 3 },
      actor,
    );

    expect(prisma.generatedDocument.update).toHaveBeenCalledWith({
      where: { id: 'child-1' },
      data: { title: 'Engagement Letter_Acme_1 Sep 2026' },
    });
    expect(prisma.documentGenerationBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          validationDiagnostics: expect.objectContaining({ errors: [] }),
        }),
      }),
    );
  });

  it('uses a populated document-specific date for the title token', async () => {
    const item = batchItem({
      configuration: {
        ...batchItem().configuration,
        title: DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
        itemValues: { engagement_date: '2026-09-01' },
        masterOverrides: {},
      },
    });
    const batch = batchWith(item);
    batch.masterFieldValues = {};
    vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
      ...template,
      contentJson: { documentTitleDateFieldKey: 'engagement_date' },
    } as never);
    vi.mocked(prisma.documentGenerationBatch.findFirst).mockResolvedValue(batch as never);
    vi.mocked(prisma.documentGenerationBatch.findFirstOrThrow).mockResolvedValue(
      batchWith({
        ...item,
        generatedDocument: {
          ...item.generatedDocument,
          title: 'Engagement Letter_Acme_1 Sep 2026',
        },
      }) as never,
    );

    await previewDocumentGenerationBatchItem(
      batchId,
      itemId,
      { expectedRevision: 3 },
      actor,
    );

    expect(prisma.generatedDocument.update).toHaveBeenCalledWith({
      where: { id: 'child-1' },
      data: { title: 'Engagement Letter_Acme_1 Sep 2026' },
    });
    expect(prisma.documentGenerationBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          validationDiagnostics: expect.objectContaining({ errors: [] }),
        }),
      }),
    );
  });

  it('binds review to preview inputs and persisted editor content', async () => {
    const fingerprint = createPreviewFingerprint({
      templateId,
      templateVersion: 1,
      partials: [],
      primaryCompanyId: 'company-1',
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      effectiveCustomData: {
        engagement_date: '2026-09-01',
        reference: 'MASTER-1',
      },
      itemValues: {},
      useLetterhead: true,
      agreementData: undefined,
    });
    const item = batchItem({
      previewFingerprint: fingerprint,
      status: 'NEEDS_INPUT',
    } as never);
    vi.mocked(prisma.documentGenerationBatch.findFirst).mockResolvedValue(batchWith(item) as never);
    vi.mocked(prisma.documentGenerationBatch.findFirstOrThrow).mockResolvedValue(
      batchWith({
        ...item,
        status: 'READY',
        reviewedFingerprint: createReviewedFingerprint({
          previewFingerprint: fingerprint,
          editedContent: '<p>auto</p>',
          editedContentJson: null,
        }),
      }) as never,
    );

    const result = await reviewDocumentGenerationBatchItem(
      batchId,
      itemId,
      { expectedRevision: 3 },
      actor,
    );

    expect(prisma.documentGenerationBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewedFingerprint: createReviewedFingerprint({
            previewFingerprint: fingerprint,
            editedContent: '<p>auto</p>',
            editedContentJson: null,
          }),
          status: 'READY',
        }),
      }),
    );
    expect(result.items[0].status).toBe('READY');
    expect(result.items[0].reviewedFingerprint).toBe(
      createReviewedFingerprint({
        previewFingerprint: fingerprint,
        editedContent: '<p>auto</p>',
        editedContentJson: null,
      }),
    );
  });

  it('rejects review when the persisted preview is stale', async () => {
    const item = batchItem({
      previewFingerprint: 'a'.repeat(64),
    });
    vi.mocked(prisma.documentGenerationBatch.findFirst).mockResolvedValue(batchWith(item) as never);

    await expect(
      reviewDocumentGenerationBatchItem(
        batchId,
        itemId,
        { expectedRevision: 3 },
        actor,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.documentGenerationBatchItem.update).not.toHaveBeenCalled();
  });
});
