import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { createLogger } from '@/lib/logger';
import { ApiError, ErrorCodes, NotFoundError, ValidationError } from '@/lib/errors';
import { readGeneratedDocumentRevision } from '@/lib/document-editor/generated-document-revision';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';
import { generatedDocumentPdfFileName } from '@/lib/generated-document-filename';
import { OAKDOC_ERROR_REASONS } from '@/types/oakdoc';
import { downloadGeneratedOakDoc } from '@/services/oakdoc-generation.service';
import { convertOfficeDocumentToPdfWithMicrosoftGraphDetailed } from '@/services/microsoft-graph-document-conversion.service';

const log = createLogger('oakdoc-output');

/**
 * Bump when the conversion policy changes (provider options, validation), so
 * cached renditions produced under the old policy are not reused.
 */
export const OAKDOC_PDF_OUTPUT_POLICY_VERSION = 1;

/** Provenance of one PDF rendition, pinned to the exact DOCX revision/hash. */
export interface OakDocPdfRendition {
  schemaVersion: 1;
  documentId: string;
  documentRevision: number;
  docxSha256: string;
  provider: string;
  connectorId: string;
  outputPolicyVersion: number;
  storageKey: string;
  pdfSha256: string;
  pageCount: number;
  createdAt: string;
}

export interface OakDocPdfResult {
  buffer: Buffer;
  filename: string;
  pageCount: number;
  mimeType: 'application/pdf';
  rendition: OakDocPdfRendition;
  cached: boolean;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readOakDocPdfRendition(metadata: unknown): OakDocPdfRendition | null {
  if (!isRecord(metadata) || !isRecord(metadata.oakDocPdfRendition)) return null;
  const raw = metadata.oakDocPdfRendition;
  if (
    raw.schemaVersion !== 1
    || typeof raw.documentId !== 'string'
    || typeof raw.documentRevision !== 'number'
    || typeof raw.docxSha256 !== 'string'
    || typeof raw.provider !== 'string'
    || typeof raw.connectorId !== 'string'
    || typeof raw.outputPolicyVersion !== 'number'
    || typeof raw.storageKey !== 'string'
    || typeof raw.pdfSha256 !== 'string'
    || typeof raw.pageCount !== 'number'
    || typeof raw.createdAt !== 'string'
  ) {
    return null;
  }
  return raw as unknown as OakDocPdfRendition;
}

export function oakDocPdfRenditionKey(tenantId: string, documentId: string): string {
  return `${tenantId}/generated-documents/${documentId}/oakdoc/renditions/${randomUUID()}.pdf`;
}

/** Parse the PDF (not just its `%PDF` prefix) and return its page count. */
export async function countValidatedPdfPages(buffer: Buffer): Promise<number> {
  try {
    const pdf = await PDFDocument.load(buffer, { updateMetadata: false });
    const pages = pdf.getPageCount();
    if (pages < 1) throw new Error('no pages');
    return pages;
  } catch {
    throw new ApiError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      'Microsoft 365 returned a PDF that could not be read. Please retry the export.',
      503,
      { reason: OAKDOC_ERROR_REASONS.CONVERTER_UNAVAILABLE },
    );
  }
}

async function readCachedRendition(
  rendition: OakDocPdfRendition,
  tenantId: string,
  documentId: string,
): Promise<Buffer | null> {
  if (!rendition.storageKey.startsWith(`${tenantId}/generated-documents/${documentId}/oakdoc/renditions/`)) {
    return null;
  }
  try {
    const buffer = await storage.download(rendition.storageKey);
    return sha256(buffer) === rendition.pdfSha256 ? buffer : null;
  } catch {
    return null;
  }
}

/**
 * Record a rendition only while the document still carries the DOCX hash it
 * was converted from. `jsonb_set` changes only this key, so it never
 * overwrites a concurrent save's metadata.
 */
async function persistRendition(
  tenantId: string,
  rendition: OakDocPdfRendition,
): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE generated_documents
    SET metadata = jsonb_set(metadata::jsonb, '{oakDocPdfRendition}', ${JSON.stringify(rendition)}::jsonb, true)
    WHERE id = ${rendition.documentId}
      AND tenant_id = ${tenantId}
      AND deleted_at IS NULL
      AND metadata::jsonb #>> '{oakDocGenerated,sha256}' = ${rendition.docxSha256}
  `;
  return updated === 1;
}

/**
 * The single native PDF authority for download, bulk ZIP, envelope
 * attachment and task preparation. Converts verified DOCX bytes through the
 * workspace Microsoft 365 connector; never renders the sentinel HTML.
 */
export async function renderGeneratedOakDocPdf(input: {
  documentId: string;
  tenantId: string;
  filename?: string;
  signal?: AbortSignal;
}): Promise<OakDocPdfResult> {
  const document = await prisma.generatedDocument.findFirst({
    where: { id: input.documentId, tenantId: input.tenantId, deletedAt: null },
    select: { id: true, title: true, metadata: true },
  });
  if (!document) throw new NotFoundError('Document not found');

  const { buffer: docx, metadata: asset } = await downloadGeneratedOakDoc(document.id, input.tenantId);
  const revision = await readGeneratedDocumentRevision(prisma, document.id, input.tenantId);
  const filename = input.filename || generatedDocumentPdfFileName(document.title);

  const cached = readOakDocPdfRendition(document.metadata);
  if (
    cached
    && cached.documentId === document.id
    && cached.docxSha256 === asset.sha256
    && cached.documentRevision === revision
    && cached.outputPolicyVersion === OAKDOC_PDF_OUTPUT_POLICY_VERSION
  ) {
    const buffer = await readCachedRendition(cached, input.tenantId, document.id);
    if (buffer) {
      return { buffer, filename, pageCount: cached.pageCount, mimeType: 'application/pdf', rendition: cached, cached: true };
    }
  }

  inspectOakDocPackage(new Uint8Array(docx), 'draft');
  const converted = await convertOfficeDocumentToPdfWithMicrosoftGraphDetailed({
    tenantId: input.tenantId,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    buffer: docx,
    signal: input.signal,
  });
  const pageCount = await countValidatedPdfPages(converted.buffer);
  const rendition: OakDocPdfRendition = {
    schemaVersion: 1,
    documentId: document.id,
    documentRevision: revision,
    docxSha256: asset.sha256,
    provider: converted.provider,
    connectorId: converted.connectorId,
    outputPolicyVersion: OAKDOC_PDF_OUTPUT_POLICY_VERSION,
    storageKey: oakDocPdfRenditionKey(input.tenantId, document.id),
    pdfSha256: sha256(converted.buffer),
    pageCount,
    createdAt: new Date().toISOString(),
  };

  // Caching is best-effort: the converted PDF is returned even when the
  // document changed during conversion (then it is simply not cached).
  try {
    await storage.upload(rendition.storageKey, converted.buffer, {
      contentType: 'application/pdf',
      metadata: {
        tenantId: input.tenantId,
        generatedDocumentId: document.id,
        docxSha256: asset.sha256,
        sha256: rendition.pdfSha256,
      },
    });
    const recorded = await persistRendition(input.tenantId, rendition);
    if (!recorded) {
      await storage.delete(rendition.storageKey).catch(() => undefined);
    } else if (cached && cached.storageKey !== rendition.storageKey) {
      await storage.delete(cached.storageKey).catch(() => undefined);
    }
  } catch (error) {
    log.warn('Failed to cache OakDoc PDF rendition', {
      documentId: document.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { buffer: converted.buffer, filename, pageCount, mimeType: 'application/pdf', rendition, cached: false };
}

/** OakDoc DOCX is canonical; HTML output is historical-A4 only (D06). */
export class OakDocUnsupportedOutputError extends ApiError {
  constructor(format: 'html') {
    super(
      ErrorCodes.CONFLICT,
      `${format.toUpperCase()} export is not available for OakDoc documents. Download the Word document or a PDF instead.`,
      409,
      {
        reason: OAKDOC_ERROR_REASONS.UNSUPPORTED_OUTPUT,
        capability: `${format}-export`,
        available: ['docx-download', 'pdf-export'],
      },
    );
    this.name = 'OakDocUnsupportedOutputError';
  }
}

/** Native section layout is authoritative; legacy page overrides are refused. */
export function assertNoNativeLayoutOverride(input: {
  format?: string;
  orientation?: string;
}): void {
  if (input.format !== undefined || input.orientation !== undefined) {
    throw new ValidationError(
      'OakDoc documents use the page size and orientation set in the Word document',
      { reason: OAKDOC_ERROR_REASONS.UNSUPPORTED_OUTPUT },
    );
  }
}
