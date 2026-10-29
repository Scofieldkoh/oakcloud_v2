import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocxFixture } from '../helpers/docx-fixture';

const prismaMock = vi.hoisted(() => ({
  generatedDocument: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  documentGenerationBatch: {
    updateMany: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findFirst: vi.fn(),
  },
  documentGenerationBatchItem: {
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));

const storageMock = vi.hoisted(() => ({
  upload: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  storage: storageMock,
}));

const revisionMock = vi.hoisted(() => ({
  claimGeneratedDocumentRevision: vi.fn(),
}));
vi.mock('@/lib/document-editor/generated-document-revision', () => revisionMock);

vi.mock('@/services/document-generation-batch/lifecycle.service', () => ({
  loadMasterCatalogueForTemplateIds: vi.fn().mockResolvedValue({
    fields: [],
    conflicts: [],
  }),
  revisionConflict: vi.fn().mockResolvedValue(new Error('revision conflict')),
}));

vi.mock('@/services/document-generation-batch/mapper', () => ({
  mapBatchToDto: vi.fn((batch) => batch),
}));

import { saveOakDocBatchDraft } from '@/services/document-generation-batch/oakdoc-draft.service';

const tenantId = 'tenant-1';
const userId = 'user-1';
const documentId = 'document-1';
const itemId = 'item-1';
const batchId = 'batch-1';
const previewFingerprint = 'c'.repeat(64);

function validDocx(): Uint8Array {
  return createDocxFixture({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml':
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Edited</w:t></w:r></w:p></w:body></w:document>',
  });
}

const existingMetadata = {
  documentEngine: 'OAKDOC',
  selectedParties: {},
  oakDocGenerated: {
    schemaVersion: 1,
    storageKey: `${tenantId}/generated-documents/${documentId}/oakdoc/old.docx`,
    fileName: 'Resolution.docx',
    fileSize: 10,
    sha256: 'a'.repeat(64),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    templateId: 'template-1',
    templateVersion: 2,
    templateSha256: 'b'.repeat(64),
    generatedAt: '2026-09-26T01:00:00.000Z',
    fieldsUpdated: 2,
    unresolvedTags: [],
    conditionsResolved: 0,
    conditionsKept: 0,
    conditionsRemoved: 0,
    repeatersResolved: 0,
    repeaterItemsCreated: 0,
  },
  oakDocReviewDraft: {
    schemaVersion: 1,
    previewFingerprint,
    savedAt: '2026-09-26T01:00:00.000Z',
    edited: false,
  },
};

describe('OakDoc batch draft service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((fn) => fn(prismaMock));
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: documentId,
      tenantId,
      revision: 4,
      status: 'DRAFT',
      metadata: existingMetadata,
      batchItem: {
        id: itemId,
        batchId,
        previewFingerprint,
      },
    });
    prismaMock.documentGenerationBatch.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.generatedDocument.update.mockResolvedValue({ id: documentId });
    prismaMock.documentGenerationBatchItem.update.mockResolvedValue({ id: itemId });
    prismaMock.documentGenerationBatch.findFirstOrThrow.mockResolvedValue({
      id: batchId,
      revision: 8,
      items: [{ templateId: 'template-1' }],
    });
    revisionMock.claimGeneratedDocumentRevision.mockResolvedValue({ revision: 5 });
    storageMock.upload.mockResolvedValue({ key: 'saved' });
    storageMock.delete.mockResolvedValue(undefined);
  });

  it('stores edited DOCX bytes separately, invalidates approval, and updates the draft SHA', async () => {
    const bytes = validDocx();

    await saveOakDocBatchDraft({
      generatedDocumentId: documentId,
      expectedBatchRevision: 7,
      previewFingerprint,
      bytes,
    }, { tenantId, userId });

    expect(storageMock.upload).toHaveBeenCalledOnce();
    const [newKey, uploaded] = storageMock.upload.mock.calls[0];
    expect(newKey).toMatch(
      new RegExp(`^${tenantId}/generated-documents/${documentId}/oakdoc/.+\\.docx$`),
    );
    expect(newKey).not.toContain('/templates/oakdoc/');
    expect(Buffer.from(uploaded).equals(Buffer.from(bytes))).toBe(true);

    expect(prismaMock.documentGenerationBatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: batchId,
        tenantId,
        deletedAt: null,
        revision: 7,
      },
      data: { revision: { increment: 1 } },
    });

    const documentUpdate = prismaMock.generatedDocument.update.mock.calls[0][0];
    expect(documentUpdate.data.metadata).toMatchObject({
      documentEngine: 'OAKDOC',
      oakDocGenerated: {
        storageKey: newKey,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      oakDocReviewDraft: {
        previewFingerprint,
        edited: true,
      },
    });

    const itemUpdate = prismaMock.documentGenerationBatchItem.update.mock.calls[0][0];
    expect(itemUpdate.data).toMatchObject({
      reviewedFingerprint: null,
      status: 'PREVIEWED',
      editedContentJson: {
        documentEngine: 'OAKDOC',
        schemaVersion: 1,
        oakDocDraftSha256: documentUpdate.data.metadata.oakDocGenerated.sha256,
        previewFingerprint,
      },
    });

    expect(storageMock.delete).toHaveBeenCalledWith(
      existingMetadata.oakDocGenerated.storageKey,
    );
  });

  it('rejects an edit if the browser is saving against a stale preview fingerprint', async () => {
    await expect(
      saveOakDocBatchDraft({
        generatedDocumentId: documentId,
        expectedBatchRevision: 7,
        previewFingerprint: 'd'.repeat(64),
        bytes: validDocx(),
      }, { tenantId, userId }),
    ).rejects.toMatchObject({ message: 'The OakDoc preview changed before this edit was saved' });

    expect(storageMock.upload).not.toHaveBeenCalled();
  });
});
