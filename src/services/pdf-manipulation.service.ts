/**
 * PDF Manipulation Service
 *
 * Server-side utilities for modifying existing PDFs:
 * - Append pages from uploaded files (PDF/images)
 * - Reorder pages within a PDF
 * - Delete pages from a PDF
 */

import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { createLogger } from '@/lib/logger';

const log = createLogger('pdf-manipulation');

// Standard A4 page size in points (72 DPI)
const A4_HEIGHT = 842; // 297mm
const MAX_PAGE_DIMENSION = 1200; // ~16 inches at 72 DPI
const DEFAULT_JPEG_QUALITY = 85;

interface AppendFile {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
}

interface AppendResult {
  pdfBytes: Uint8Array;
  pagesAdded: number;
  newTotalPages: number;
}

interface ReorderResult {
  pdfBytes: Uint8Array;
  pageMapping: Array<{ oldPageNumber: number; newPageNumber: number }>;
}

interface DeleteResult {
  pdfBytes: Uint8Array;
  pagesDeleted: number;
  newTotalPages: number;
}

/**
 * Convert an image buffer to a PDF page
 * Uses sharp for image processing (handles EXIF orientation automatically)
 */
async function imageBufferToPdfPage(
  pdfDoc: PDFDocument,
  imageBuffer: Buffer,
  mimeType: string
): Promise<void> {
  // Use sharp to normalize image (auto-rotate based on EXIF, convert to JPEG)
  const sharpInstance = sharp(imageBuffer).rotate(); // auto-rotate based on EXIF

  // Get image metadata for dimensions
  const metadata = await sharpInstance.metadata();
  const imgWidth = metadata.width || 800;
  const imgHeight = metadata.height || 600;

  // Convert to JPEG for embedding
  const jpegBuffer = await sharpInstance
    .jpeg({ quality: DEFAULT_JPEG_QUALITY })
    .toBuffer();

  // Embed JPEG in PDF
  const image = await pdfDoc.embedJpg(jpegBuffer);

  // Calculate page dimensions to fit image
  const aspectRatio = imgWidth / imgHeight;
  let pageWidth: number;
  let pageHeight: number;

  if (aspectRatio > 1) {
    // Landscape image
    pageWidth = Math.min(A4_HEIGHT, MAX_PAGE_DIMENSION);
    pageHeight = pageWidth / aspectRatio;
  } else {
    // Portrait image
    pageHeight = Math.min(A4_HEIGHT, MAX_PAGE_DIMENSION);
    pageWidth = pageHeight * aspectRatio;
  }

  // Ensure minimum dimensions
  if (pageWidth < 200) pageWidth = 200;
  if (pageHeight < 200) pageHeight = 200;

  // Create page and draw image
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });

  log.debug(`Added image page: ${Math.round(pageWidth)}x${Math.round(pageHeight)} from ${mimeType}`);
}

/**
 * Append pages from uploaded files to an existing PDF
 *
 * @param existingPdfBytes - The current PDF file as a Buffer
 * @param newFiles - Array of files to append (PDFs or images)
 * @returns The modified PDF bytes and metadata
 */
export async function appendPagesToPdf(
  existingPdfBytes: Buffer,
  newFiles: AppendFile[]
): Promise<AppendResult> {
  if (newFiles.length === 0) {
    throw new Error('At least one file is required to append');
  }

  // Load existing PDF
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const originalPageCount = pdfDoc.getPageCount();
  let pagesAdded = 0;

  for (const file of newFiles) {
    if (file.mimeType === 'application/pdf') {
      // Append pages from another PDF
      const srcDoc = await PDFDocument.load(file.buffer);
      const pageIndices = srcDoc.getPageIndices();
      const copiedPages = await pdfDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach((page) => pdfDoc.addPage(page));
      pagesAdded += pageIndices.length;
      log.debug(`Appended ${pageIndices.length} pages from PDF: ${file.fileName || 'unknown'}`);
    } else if (file.mimeType.startsWith('image/')) {
      // Convert image to PDF page and append
      await imageBufferToPdfPage(pdfDoc, file.buffer, file.mimeType);
      pagesAdded += 1;
    } else {
      log.warn(`Skipping unsupported file type: ${file.mimeType}`);
    }
  }

  // Save modified PDF
  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });

  log.info(`Appended ${pagesAdded} pages to PDF (${originalPageCount} -> ${originalPageCount + pagesAdded})`);

  return {
    pdfBytes,
    pagesAdded,
    newTotalPages: originalPageCount + pagesAdded,
  };
}

/**
 * Reorder pages in a PDF
 *
 * @param pdfBytes - The current PDF file as a Buffer
 * @param newOrder - Array of current page numbers (1-indexed) in the desired new order
 *                   e.g., [3, 1, 2] means: page 3 becomes page 1, page 1 becomes page 2, page 2 becomes page 3
 * @returns The reordered PDF bytes and page mapping
 */
export async function reorderPdfPages(
  pdfBytes: Buffer,
  newOrder: number[]
): Promise<ReorderResult> {
  // Load source PDF
  const srcDoc = await PDFDocument.load(pdfBytes);
  const pageCount = srcDoc.getPageCount();

  // Validate newOrder
  if (newOrder.length !== pageCount) {
    throw new Error(`newOrder length (${newOrder.length}) must match page count (${pageCount})`);
  }

  // Check all page numbers are present exactly once
  const sortedOrder = [...newOrder].sort((a, b) => a - b);
  for (let i = 0; i < pageCount; i++) {
    if (sortedOrder[i] !== i + 1) {
      throw new Error(`Invalid newOrder: must contain each page number 1-${pageCount} exactly once`);
    }
  }

  // Check if order actually changed
  const isUnchanged = newOrder.every((pageNum, index) => pageNum === index + 1);
  if (isUnchanged) {
    log.debug('Page order unchanged, returning original PDF');
    return {
      pdfBytes: await srcDoc.save({ useObjectStreams: true }),
      pageMapping: newOrder.map((oldNum, newIdx) => ({
        oldPageNumber: oldNum,
        newPageNumber: newIdx + 1,
      })),
    };
  }

  // Create new PDF with pages in new order
  const newDoc = await PDFDocument.create();

  // Convert 1-indexed page numbers to 0-indexed for pdf-lib
  const pageIndices = newOrder.map((pageNum) => pageNum - 1);

  // Copy pages in new order
  const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
  copiedPages.forEach((page) => newDoc.addPage(page));

  // Save reordered PDF
  const reorderedBytes = await newDoc.save({ useObjectStreams: true });

  // Build page mapping for database updates
  const pageMapping = newOrder.map((oldPageNum, newIdx) => ({
    oldPageNumber: oldPageNum,
    newPageNumber: newIdx + 1,
  }));

  log.info(`Reordered ${pageCount} pages: [${newOrder.join(', ')}]`);

  return {
    pdfBytes: reorderedBytes,
    pageMapping,
  };
}

/**
 * Extract page dimensions from a PDF
 * Used when creating DocumentPage records
 */
export async function extractPdfPageDimensions(
  pdfBytes: Buffer
): Promise<Array<{ pageNumber: number; width: number; height: number }>> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();

  return pages.map((page, index) => {
    const { width, height } = page.getSize();
    return {
      pageNumber: index + 1,
      width: Math.round(width),
      height: Math.round(height),
    };
  });
}

/**
 * Delete pages from a PDF
 *
 * @param pdfBytes - The current PDF file as a Buffer
 * @param pageNumbers - Array of page numbers (1-indexed) to delete
 * @returns The modified PDF bytes and metadata
 */
export async function deletePdfPages(
  pdfBytes: Buffer,
  pageNumbers: number[]
): Promise<DeleteResult> {
  if (pageNumbers.length === 0) {
    throw new Error('At least one page number is required to delete');
  }

  // Load source PDF
  const srcDoc = await PDFDocument.load(pdfBytes);
  const pageCount = srcDoc.getPageCount();

  // Validate page numbers
  const uniquePageNumbers = [...new Set(pageNumbers)].sort((a, b) => a - b);
  for (const pageNum of uniquePageNumbers) {
    if (pageNum < 1 || pageNum > pageCount) {
      throw new Error(`Invalid page number ${pageNum}: must be between 1 and ${pageCount}`);
    }
  }

  // Cannot delete all pages
  if (uniquePageNumbers.length >= pageCount) {
    throw new Error('Cannot delete all pages from the document');
  }

  // Create set of pages to keep (all pages except those being deleted)
  const pagesToDelete = new Set(uniquePageNumbers);
  const pagesToKeep: number[] = [];
  for (let i = 1; i <= pageCount; i++) {
    if (!pagesToDelete.has(i)) {
      pagesToKeep.push(i);
    }
  }

  // Create new PDF with only the pages to keep
  const newDoc = await PDFDocument.create();

  // Convert 1-indexed page numbers to 0-indexed for pdf-lib
  const pageIndices = pagesToKeep.map((pageNum) => pageNum - 1);

  // Copy pages in order
  const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
  copiedPages.forEach((page) => newDoc.addPage(page));

  // Save modified PDF
  const modifiedBytes = await newDoc.save({ useObjectStreams: true });

  log.info(`Deleted ${uniquePageNumbers.length} pages from PDF (${pageCount} -> ${pagesToKeep.length}): [${uniquePageNumbers.join(', ')}]`);

  return {
    pdfBytes: modifiedBytes,
    pagesDeleted: uniquePageNumbers.length,
    newTotalPages: pagesToKeep.length,
  };
}
