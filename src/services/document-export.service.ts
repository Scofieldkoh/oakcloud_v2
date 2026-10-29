/**
 * Document Export Service
 *
 * PDF export of generated documents. OakDoc documents are converted from
 * their Word file by Microsoft 365; `generatePDF` renders HTML (form
 * submissions) with Chromium.
 */

import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { findChromePath } from '@/lib/chrome-executable';
import { rejectRetiredA4Operation } from '@/lib/document-editor/a4-retirement';
import archiver from 'archiver';
import {
  InvalidDocumentEngineError,
  readGeneratedDocumentEngineState,
} from '@/lib/document-editor/document-engine';
import {
  assertNoNativeLayoutOverride,
  renderGeneratedOakDocPdf,
  type OakDocPdfRendition,
} from '@/services/oakdoc-output.service';

export { findChromePath };

export interface ExportPDFParams {
  documentId: string;
  tenantId: string;
  userId?: string;
  format?: 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  filename?: string;
  signal?: AbortSignal;
}

export interface PDFResult {
  buffer: Buffer;
  filename: string;
  pageCount: number;
  mimeType: string;
  /** The exact DOCX revision/hash converted. */
  provenance?: OakDocPdfRendition;
}

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const PDF_PAGE_TIMEOUT_MS = 30_000;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The export was cancelled', 'AbortError');
  }
}

export async function exportToPDF(params: ExportPDFParams): Promise<PDFResult> {
  const { documentId, tenantId, userId, filename, signal } = params;

  throwIfAborted(signal);
  const document = await prisma.generatedDocument.findFirst({
    where: { id: documentId, tenantId, deletedAt: null },
    select: { title: true, companyId: true, metadata: true },
  });
  if (!document) throw new Error('Document not found');

  const engine = readGeneratedDocumentEngineState(document.metadata);
  if (engine === 'INVALID') throw new InvalidDocumentEngineError('generated-document');
  if (engine === 'A4') rejectRetiredA4Operation('document-export');

  assertNoNativeLayoutOverride({ format: params.format, orientation: params.orientation });
  const native = await renderGeneratedOakDocPdf({ documentId, tenantId, filename, signal });
  await createAuditLog({
    action: 'EXPORT',
    entityType: 'GeneratedDocument',
    entityId: documentId,
    entityName: document.title,
    summary: `Exported document "${document.title}" to PDF`,
    metadata: {
      format: 'PDF',
      documentEngine: 'OAKDOC',
      docxSha256: native.rendition.docxSha256,
      pdfSha256: native.rendition.pdfSha256,
      documentRevision: native.rendition.documentRevision,
      cached: native.cached,
    },
    userId,
    tenantId,
    companyId: document.companyId || undefined,
  }).catch(() => undefined);
  return {
    buffer: native.buffer,
    filename: native.filename,
    pageCount: native.pageCount,
    mimeType: native.mimeType,
    provenance: native.rendition,
  };
}

/**
 * Renders self-contained HTML to PDF with Chromium once its fonts are ready.
 * The browser is always closed, including on errors and cancellation.
 */
export async function generatePDF(
  html: string,
  options: {
    format: 'A4' | 'Letter';
    orientation: 'portrait' | 'landscape';
    margins: PageMargins;
    headerHtml: string;
    footerHtml: string;
    signal?: AbortSignal;
  },
): Promise<Buffer> {
  throwIfAborted(options.signal);
  const puppeteer = await import('puppeteer-core');
  const executablePath = await findChromePath();
  throwIfAborted(options.signal);

  const browser = await puppeteer.default.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(PDF_PAGE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(PDF_PAGE_TIMEOUT_MS);
    throwIfAborted(options.signal);

    await page.setContent(html, {
      waitUntil: 'load',
      timeout: PDF_PAGE_TIMEOUT_MS,
    });
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    throwIfAborted(options.signal);

    const { margins } = options;
    const pdfBuffer = await page.pdf({
      format: options.format,
      landscape: options.orientation === 'landscape',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: !!(options.headerHtml || options.footerHtml),
      headerTemplate: options.headerHtml || '<div></div>',
      footerTemplate: options.footerHtml || '<div></div>',
      margin: {
        top: `${margins.top}mm`,
        right: `${margins.right}mm`,
        bottom: `${margins.bottom}mm`,
        left: `${margins.left}mm`,
      },
      timeout: PDF_PAGE_TIMEOUT_MS,
    });
    throwIfAborted(options.signal);
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

export interface ExportZipResult {
  buffer: Buffer;
  filename: string;
}

export async function exportDocumentsToZip(
  ids: string[],
  params: { tenantId: string; userId?: string },
): Promise<ExportZipResult> {
  const { tenantId, userId } = params;
  const documents = await prisma.generatedDocument.findMany({
    where: { id: { in: ids }, tenantId, deletedAt: null },
    select: { id: true },
  });
  const foundIds = new Set(documents.map((document) => document.id));
  const archive = archiver('zip', { zlib: { level: 5 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finalized = new Promise<Buffer>((resolve, reject) => {
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });
  const usedFilenames = new Map<string, number>();

  for (const id of ids) {
    if (!foundIds.has(id)) continue;
    const result = await exportToPDF({ documentId: id, tenantId, userId });
    let fileName = result.filename;
    const count = usedFilenames.get(result.filename) ?? 0;
    if (count > 0) {
      const extensionIndex = result.filename.lastIndexOf('.');
      fileName = extensionIndex > 0
        ? `${result.filename.slice(0, extensionIndex)} (${count})${result.filename.slice(extensionIndex)}`
        : `${result.filename} (${count})`;
    }
    usedFilenames.set(result.filename, count + 1);
    archive.append(result.buffer, { name: fileName });
  }

  await archive.finalize();
  const buffer = await finalized;
  const dateStr = new Date().toISOString().split('T')[0];
  return { buffer, filename: `documents-${dateStr}.zip` };
}
