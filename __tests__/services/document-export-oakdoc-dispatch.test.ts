import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ generatedDocument: { findFirst: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn().mockResolvedValue(undefined) }));

const outputMock = vi.hoisted(() => ({ renderGeneratedOakDocPdf: vi.fn() }));
vi.mock('@/services/oakdoc-output.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/oakdoc-output.service')>()),
  renderGeneratedOakDocPdf: outputMock.renderGeneratedOakDocPdf,
}));

import { exportDocumentsToZip, exportToPDF } from '@/services/document-export.service';

const nativeMetadata = {
  documentEngine: 'OAKDOC',
  oakDocGenerated: {
    schemaVersion: 1,
    storageKey: 'tenant-1/generated-documents/document-1/oakdoc/a.docx',
    fileName: 'Letter.docx',
    fileSize: 10,
    sha256: 'a'.repeat(64),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    templateId: 'template-1',
    templateVersion: 1,
    templateSha256: 'b'.repeat(64),
    generatedAt: '2026-09-26T00:00:00.000Z',
    fieldsUpdated: 0,
    unresolvedTags: [],
    conditionsResolved: 0,
    conditionsKept: 0,
    conditionsRemoved: 0,
    repeatersResolved: 0,
    repeaterItemsCreated: 0,
  },
};

const nativeDocument = {
  id: 'document-1',
  title: 'Letter',
  companyId: null,
  content: '<p data-oakdoc-generated="true">DOCX-native generated document.</p>',
  contentJson: { documentEngine: 'OAKDOC', schemaVersion: 1 },
  metadata: nativeMetadata,
  useLetterhead: false,
};

describe('export service engine dispatch (O1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.generatedDocument.findFirst.mockResolvedValue(nativeDocument);
    outputMock.renderGeneratedOakDocPdf.mockResolvedValue({
      buffer: Buffer.from('%PDF-native'),
      filename: 'Letter.pdf',
      pageCount: 2,
      mimeType: 'application/pdf',
      cached: false,
      rendition: { docxSha256: 'a'.repeat(64), pdfSha256: 'c'.repeat(64), documentRevision: 3 },
    });
  });

  it('routes OakDoc PDF export to the native converter and never renders sentinel HTML', async () => {
    const result = await exportToPDF({ documentId: 'document-1', tenantId: 'tenant-1' });
    expect(outputMock.renderGeneratedOakDocPdf).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'document-1', tenantId: 'tenant-1' }),
    );
    expect(result.buffer.toString()).toBe('%PDF-native');
    expect(result.provenance).toMatchObject({ documentRevision: 3 });
  });

  it('uses the same native authority for bulk ZIP export', async () => {
    prismaMock.generatedDocument.findFirst.mockResolvedValue(nativeDocument);
    const findMany = vi.fn().mockResolvedValue([{ id: 'document-1' }]);
    (prismaMock.generatedDocument as Record<string, unknown>).findMany = findMany;
    const zip = await exportDocumentsToZip(['document-1'], { tenantId: 'tenant-1' });
    expect(zip.buffer.byteLength).toBeGreaterThan(0);
    expect(outputMock.renderGeneratedOakDocPdf).toHaveBeenCalledOnce();
  });

  it('refuses explicit layout overrides for OakDoc', async () => {
    await expect(exportToPDF({ documentId: 'document-1', tenantId: 'tenant-1', format: 'Letter' }))
      .rejects.toThrow(/page size and orientation/);
  });

  it('refuses to export old A4 records and ungenerated drafts', async () => {
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      ...nativeDocument,
      metadata: { batchItem: true },
    });
    await expect(exportToPDF({ documentId: 'document-1', tenantId: 'tenant-1' }))
      .rejects.toMatchObject({ details: { reason: 'A4_EDITOR_RETIRED', operation: 'document-export' } });
    expect(outputMock.renderGeneratedOakDocPdf).not.toHaveBeenCalled();
  });

  it('fails closed for damaged native metadata', async () => {
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      ...nativeDocument,
      metadata: { documentEngine: 'OAKDOC', oakDocGenerated: { schemaVersion: 1 } },
    });
    await expect(exportToPDF({ documentId: 'document-1', tenantId: 'tenant-1' }))
      .rejects.toMatchObject({ details: { reason: 'OAKDOC_INVALID_ENGINE_METADATA' } });
    expect(outputMock.renderGeneratedOakDocPdf).not.toHaveBeenCalled();
  });
});
