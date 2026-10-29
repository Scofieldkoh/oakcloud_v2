// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

const prismaMock = vi.hoisted(() => ({
  generatedDocument: { findFirst: vi.fn() },
  $executeRaw: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const objects = vi.hoisted(() => new Map<string, Buffer>());
const storageMock = vi.hoisted(() => ({
  upload: vi.fn(async (key: string, body: Buffer) => { objects.set(key, Buffer.from(body)); }),
  download: vi.fn(async (key: string) => {
    const value = objects.get(key);
    if (!value) throw new Error('missing');
    return value;
  }),
  delete: vi.fn(async (key: string) => { objects.delete(key); }),
}));
vi.mock('@/lib/storage', () => ({ storage: storageMock }));

const generationMock = vi.hoisted(() => ({ downloadGeneratedOakDoc: vi.fn() }));
vi.mock('@/services/oakdoc-generation.service', () => generationMock);

const revisionMock = vi.hoisted(() => ({ readGeneratedDocumentRevision: vi.fn() }));
vi.mock('@/lib/document-editor/generated-document-revision', () => revisionMock);

const packageMock = vi.hoisted(() => ({ inspectOakDocPackage: vi.fn() }));
vi.mock('@/lib/document-editor/oakdoc-package-policy', () => packageMock);

const graphMock = vi.hoisted(() => ({ convertOfficeDocumentToPdfWithMicrosoftGraphDetailed: vi.fn() }));
vi.mock('@/services/microsoft-graph-document-conversion.service', () => graphMock);

import {
  OAKDOC_PDF_OUTPUT_POLICY_VERSION,
  assertNoNativeLayoutOverride,
  countValidatedPdfPages,
  renderGeneratedOakDocPdf,
} from '@/services/oakdoc-output.service';

const tenantId = 'tenant-1';
const documentId = 'document-1';
const docx = Buffer.from('docx-bytes');
const docxSha = createHash('sha256').update(docx).digest('hex');

async function pdfWithPages(count: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) pdf.addPage();
  return Buffer.from(await pdf.save());
}

function sha(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
  objects.clear();
  prismaMock.generatedDocument.findFirst.mockResolvedValue({ id: documentId, title: 'Letter', metadata: {} });
  prismaMock.$executeRaw.mockResolvedValue(1);
  generationMock.downloadGeneratedOakDoc.mockResolvedValue({
    buffer: docx,
    metadata: { sha256: docxSha, fileName: 'Letter.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  });
  revisionMock.readGeneratedDocumentRevision.mockResolvedValue(4);
});

describe('native PDF output (O1)', () => {
  it('converts verified DOCX bytes and records provenance pinned to revision and hash', async () => {
    const pdf = await pdfWithPages(3);
    graphMock.convertOfficeDocumentToPdfWithMicrosoftGraphDetailed.mockResolvedValue({
      buffer: pdf, connectorId: 'connector-1', provider: 'SHAREPOINT', cleanupFailed: false,
    });

    const result = await renderGeneratedOakDocPdf({ documentId, tenantId });

    expect(packageMock.inspectOakDocPackage).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ pageCount: 3, cached: false, filename: expect.stringMatching(/\.pdf$/) });
    expect(result.rendition).toMatchObject({
      documentId,
      documentRevision: 4,
      docxSha256: docxSha,
      pdfSha256: sha(pdf),
      provider: 'SHAREPOINT',
      connectorId: 'connector-1',
      outputPolicyVersion: OAKDOC_PDF_OUTPUT_POLICY_VERSION,
    });
    expect(result.rendition.storageKey.startsWith(`${tenantId}/generated-documents/${documentId}/oakdoc/renditions/`)).toBe(true);
    expect(objects.get(result.rendition.storageKey)).toEqual(pdf);
    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();
  });

  it('reuses a cached rendition only for the same revision, DOCX hash and policy', async () => {
    const pdf = await pdfWithPages(2);
    const key = `${tenantId}/generated-documents/${documentId}/oakdoc/renditions/cached.pdf`;
    objects.set(key, pdf);
    const rendition = {
      schemaVersion: 1, documentId, documentRevision: 4, docxSha256: docxSha, provider: 'ONEDRIVE',
      connectorId: 'c', outputPolicyVersion: OAKDOC_PDF_OUTPUT_POLICY_VERSION, storageKey: key,
      pdfSha256: sha(pdf), pageCount: 2, createdAt: '2026-09-26T00:00:00.000Z',
    };
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: documentId, title: 'Letter', metadata: { oakDocPdfRendition: rendition },
    });

    const hit = await renderGeneratedOakDocPdf({ documentId, tenantId });
    expect(hit.cached).toBe(true);
    expect(graphMock.convertOfficeDocumentToPdfWithMicrosoftGraphDetailed).not.toHaveBeenCalled();

    revisionMock.readGeneratedDocumentRevision.mockResolvedValue(5);
    graphMock.convertOfficeDocumentToPdfWithMicrosoftGraphDetailed.mockResolvedValue({
      buffer: pdf, connectorId: 'c', provider: 'ONEDRIVE', cleanupFailed: false,
    });
    const miss = await renderGeneratedOakDocPdf({ documentId, tenantId });
    expect(miss.cached).toBe(false);
    expect(graphMock.convertOfficeDocumentToPdfWithMicrosoftGraphDetailed).toHaveBeenCalledOnce();
  });

  it('returns the PDF but does not cache it when the document changed during conversion', async () => {
    const pdf = await pdfWithPages(1);
    graphMock.convertOfficeDocumentToPdfWithMicrosoftGraphDetailed.mockResolvedValue({
      buffer: pdf, connectorId: 'c', provider: 'ONEDRIVE', cleanupFailed: false,
    });
    prismaMock.$executeRaw.mockResolvedValue(0);

    const result = await renderGeneratedOakDocPdf({ documentId, tenantId });

    expect(result.buffer).toEqual(pdf);
    expect(objects.size).toBe(0);
  });

  it('rejects converter output that is not a parseable PDF', async () => {
    await expect(countValidatedPdfPages(Buffer.from('%PDF-1.7 truncated'))).rejects.toMatchObject({ statusCode: 503 });
  });

  it('refuses legacy page overrides for native layout', () => {
    expect(() => assertNoNativeLayoutOverride({ format: 'Letter' })).toThrow(/page size and orientation/);
    expect(() => assertNoNativeLayoutOverride({})).not.toThrow();
  });
});
