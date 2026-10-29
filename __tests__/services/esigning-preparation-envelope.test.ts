import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  envelopeFindFirst: vi.fn(),
  envelopeCreate: vi.fn(),
  envelopeUpdateMany: vi.fn(),
  documentFindFirst: vi.fn(),
  envelopeDocumentCreate: vi.fn(),
  envelopeDocumentDelete: vi.fn(),
  envelopeDocumentUpdate: vi.fn(),
  storageUpload: vi.fn(),
  storageDelete: vi.fn(),
  exportPdf: vi.fn(),
  audit: vi.fn(),
  envelopeEvent: vi.fn(),
  lockDocument: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    esigningEnvelope: {
      findFirst: mocks.envelopeFindFirst,
      create: mocks.envelopeCreate,
      updateMany: mocks.envelopeUpdateMany,
    },
    generatedDocument: { findFirst: mocks.documentFindFirst },
    esigningEnvelopeDocument: {
      create: mocks.envelopeDocumentCreate,
      delete: mocks.envelopeDocumentDelete,
      update: mocks.envelopeDocumentUpdate,
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.lockDocument,
      esigningEnvelopeDocument: {
        create: mocks.envelopeDocumentCreate,
        delete: mocks.envelopeDocumentDelete,
        update: mocks.envelopeDocumentUpdate,
      },
      esigningEnvelope: {
        updateMany: mocks.envelopeUpdateMany,
      },
    })),
  },
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    upload: mocks.storageUpload,
    delete: mocks.storageDelete,
  },
  StorageKeys: {
    esigningOriginalDocument: (
      tenantId: string,
      envelopeId: string,
      documentId: string,
    ) => `esigning/${tenantId}/${envelopeId}/${documentId}.pdf`,
    esigningEnvelopePrefix: vi.fn(),
    getExtension: vi.fn(),
  },
}));

vi.mock('@/services/document-export.service', () => ({
  exportToPDF: mocks.exportPdf,
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: mocks.audit,
}));

vi.mock('@/lib/encryption', () => ({
  hashBlake3: vi.fn(() => 'document-hash'),
  hashPassword: vi.fn(),
}));

vi.mock('@/services/esigning-certificate.service', () => ({
  generateUniqueEsigningCertificateId: vi.fn(async () => 'certificate-1'),
}));

vi.mock('@/services/esigning-envelope.lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/esigning-envelope.lib')>();
  return {
    ...actual,
    createEnvelopeEvent: mocks.envelopeEvent,
  };
});

import {
  attachGeneratedDocumentToDraftEnvelope,
  createTaskPreparedEsigningEnvelope,
  detachGeneratedDocumentFromDraftEnvelope,
} from '@/services/esigning-envelope.service';

describe('task-prepared E-signing envelopes', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const buffer = Buffer.from(await pdf.save());
    mocks.exportPdf.mockResolvedValue({
      buffer,
      filename: 'Engagement letter.pdf',
    });
    mocks.storageUpload.mockResolvedValue(undefined);
    mocks.storageDelete.mockResolvedValue(undefined);
    mocks.documentFindFirst.mockResolvedValue({
      id: 'document-1',
      title: 'Engagement letter',
      revision: 4,
    });
    mocks.lockDocument.mockResolvedValue([{ status: 'FINALIZED', revision: 4, deleted_at: null }]);
  });

  it('reuses an envelope already owned by the same task stage', async () => {
    mocks.envelopeFindFirst.mockResolvedValue({ id: 'envelope-existing' });

    await expect(createTaskPreparedEsigningEnvelope({
      tenantId: 'tenant-a',
      taskContext: { taskId: 'task-1', taskStageId: 'stage-1' },
      createdById: 'user-1',
      title: 'Engagement letter',
    })).resolves.toEqual({ id: 'envelope-existing' });

    expect(mocks.envelopeCreate).not.toHaveBeenCalled();
  });

  it('creates one attributed draft with durable task context', async () => {
    mocks.envelopeFindFirst.mockResolvedValue(null);
    mocks.envelopeCreate.mockResolvedValue({ id: 'envelope-1', title: 'Engagement letter' });

    await createTaskPreparedEsigningEnvelope({
      tenantId: 'tenant-a',
      taskContext: { taskId: 'task-1', taskStageId: 'stage-1' },
      createdById: 'user-1',
      title: 'Engagement letter',
      companyId: 'company-1',
    });

    expect(mocks.envelopeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        createdById: 'user-1',
        status: 'DRAFT',
        title: 'Engagement letter',
        companyId: 'company-1',
        metadata: {
          taskIntegrationContext: {
            taskId: 'task-1',
            taskStageId: 'stage-1',
          },
        },
      }),
      select: { id: true, title: true },
    });
    expect(mocks.envelopeEvent).toHaveBeenCalledWith(expect.objectContaining({
      envelopeId: 'envelope-1',
      action: 'CREATED',
    }));
  });

  it('attaches a generated PDF and records its authoritative source', async () => {
    mocks.envelopeFindFirst.mockResolvedValue({
      id: 'envelope-1',
      title: 'Engagement letter',
      status: 'DRAFT',
      companyId: 'company-1',
      documents: [],
    });
    mocks.envelopeDocumentCreate.mockImplementation(async ({ data }) => data);

    const result = await attachGeneratedDocumentToDraftEnvelope({
      tenantId: 'tenant-a',
      envelopeId: 'envelope-1',
      generatedDocumentId: 'document-1',
      actorUserId: 'user-1',
    });

    expect(result.envelopeDocumentId).toEqual(expect.any(String));
    expect(mocks.storageUpload).toHaveBeenCalledWith(
      expect.stringContaining('esigning/tenant-a/envelope-1/'),
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
    expect(mocks.envelopeDocumentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        envelopeId: 'envelope-1',
        generatedDocumentId: 'document-1',
        fileName: 'Engagement letter.pdf',
        originalFileName: 'Engagement letter',
        pageCount: 1,
      }),
    });
  });

  it('refuses a PDF converted from a different revision than the one checked', async () => {
    mocks.envelopeFindFirst.mockResolvedValue({
      id: 'envelope-1',
      title: 'Engagement letter',
      status: 'DRAFT',
      companyId: 'company-1',
      documents: [],
    });
    const exported = await mocks.exportPdf();
    mocks.exportPdf.mockResolvedValue({
      ...exported,
      provenance: { documentRevision: 5, docxSha256: 'a'.repeat(64) },
    });

    await expect(attachGeneratedDocumentToDraftEnvelope({
      tenantId: 'tenant-a',
      envelopeId: 'envelope-1',
      generatedDocumentId: 'document-1',
      actorUserId: 'user-1',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.storageUpload).not.toHaveBeenCalled();
    expect(mocks.envelopeDocumentCreate).not.toHaveBeenCalled();
  });

  it('discards the PDF when the document was unfinalized or edited before commit', async () => {
    mocks.envelopeFindFirst.mockResolvedValue({
      id: 'envelope-1',
      title: 'Engagement letter',
      status: 'DRAFT',
      companyId: 'company-1',
      documents: [],
    });
    mocks.lockDocument.mockResolvedValue([{ status: 'DRAFT', revision: 5, deleted_at: null }]);

    await expect(attachGeneratedDocumentToDraftEnvelope({
      tenantId: 'tenant-a',
      envelopeId: 'envelope-1',
      generatedDocumentId: 'document-1',
      actorUserId: 'user-1',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.envelopeDocumentCreate).not.toHaveBeenCalled();
    expect(mocks.storageDelete).toHaveBeenCalledWith(
      expect.stringContaining('esigning/tenant-a/envelope-1/'),
    );
  });

  it('inherits the company from a generated document when the envelope has none', async () => {
    mocks.envelopeFindFirst.mockResolvedValue({
      id: 'envelope-1',
      title: 'Engagement letter',
      status: 'DRAFT',
      companyId: null,
      documents: [],
    });
    mocks.documentFindFirst.mockResolvedValue({
      id: 'document-1',
      title: 'Engagement letter',
      companyId: 'company-1',
      revision: 4,
    });
    mocks.envelopeDocumentCreate.mockImplementation(async ({ data }) => data);
    mocks.envelopeUpdateMany.mockResolvedValue({ count: 1 });

    await attachGeneratedDocumentToDraftEnvelope({
      tenantId: 'tenant-a',
      envelopeId: 'envelope-1',
      generatedDocumentId: 'document-1',
      actorUserId: 'user-1',
    });

    expect(mocks.envelopeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'envelope-1', tenantId: 'tenant-a', companyId: null },
      data: { companyId: 'company-1' },
    });
  });

  it('detaches only the managed document and preserves manual documents', async () => {
    mocks.envelopeFindFirst.mockResolvedValue({
      id: 'envelope-1',
      title: 'Engagement letter',
      status: 'DRAFT',
      companyId: null,
      documents: [
        {
          id: 'managed-document',
          generatedDocumentId: 'document-1',
          storagePath: 'managed.pdf',
          signedStoragePath: null,
          sortOrder: 0,
        },
        {
          id: 'manual-document',
          generatedDocumentId: null,
          storagePath: 'manual.pdf',
          signedStoragePath: null,
          sortOrder: 1,
        },
      ],
    });

    await detachGeneratedDocumentFromDraftEnvelope({
      tenantId: 'tenant-a',
      envelopeId: 'envelope-1',
      generatedDocumentId: 'document-1',
      actorUserId: 'user-1',
    });

    expect(mocks.envelopeDocumentDelete).toHaveBeenCalledWith({
      where: { id: 'managed-document' },
    });
    expect(mocks.envelopeDocumentUpdate).toHaveBeenCalledWith({
      where: { id: 'manual-document' },
      data: { sortOrder: 0 },
    });
    expect(mocks.storageDelete).toHaveBeenCalledWith('managed.pdf');
    expect(mocks.storageDelete).not.toHaveBeenCalledWith('manual.pdf');
  });

  it('refuses automatic document changes after the envelope leaves draft', async () => {
    mocks.envelopeFindFirst.mockResolvedValue({
      id: 'envelope-1',
      title: 'Engagement letter',
      status: 'SENT',
      companyId: null,
      documents: [],
    });

    await expect(attachGeneratedDocumentToDraftEnvelope({
      tenantId: 'tenant-a',
      envelopeId: 'envelope-1',
      generatedDocumentId: 'document-1',
      actorUserId: 'user-1',
    })).rejects.toThrow('draft');
  });
});
