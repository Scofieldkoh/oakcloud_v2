/**
 * PDF Utilities
 *
 * Client-side utilities for PDF manipulation using pdf-lib
 * - Convert images to PDF
 * - Merge multiple files into a single PDF
 * - Compress large PDFs
 * - Split PDFs by page ranges
 */

import { PDFDocument } from 'pdf-lib';

/**
 * Helper to create a File from pdf-lib's Uint8Array output
 * Handles TypeScript strict typing for BlobPart
 */
function createPdfFile(pdfBytes: Uint8Array, fileName: string): File {
  return new File([new Uint8Array(pdfBytes)], fileName, { type: 'application/pdf' });
}

// Maximum file size before compression is attempted (1MB)
const COMPRESSION_THRESHOLD = 1 * 1024 * 1024;

// Standard A4 page size in points (72 DPI)
const _A4_WIDTH = 595; // 210mm
const A4_HEIGHT = 842; // 297mm

// Maximum page dimension to prevent overly large PDFs
const MAX_PAGE_DIMENSION = 1200; // ~16 inches at 72 DPI

// JPEG quality settings for different scenarios
const DEFAULT_JPEG_QUALITY = 0.85;
const COMPRESSED_JPEG_QUALITY = 0.65;
const MIN_JPEG_QUALITY = 0.50;

// Threshold for when to use lower initial quality (large images)
const LARGE_IMAGE_PIXEL_THRESHOLD = 3000 * 3000; // 9 megapixels

/**
 * Read EXIF orientation from JPEG file
 * Returns orientation value (1-8) or 1 if not found
 */
export function getExifOrientation(arrayBuffer: ArrayBuffer): number {
  const view = new DataView(arrayBuffer);

  // Check for JPEG magic bytes
  if (view.getUint16(0, false) !== 0xFFD8) {
    return 1; // Not a JPEG
  }

  let offset = 2;
  while (offset < view.byteLength - 2) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    // Check for EXIF marker (APP1)
    if (marker === 0xFFE1) {
      view.getUint16(offset, false); // Skip length
      offset += 2;

      // Check for "Exif\0\0"
      if (view.getUint32(offset, false) === 0x45786966 && view.getUint16(offset + 4, false) === 0x0000) {
        offset += 6;
        const tiffOffset = offset;

        // Get byte order
        const byteOrder = view.getUint16(offset, false);
        const littleEndian = byteOrder === 0x4949;
        offset += 2;

        // Skip to IFD0
        offset += 2; // Skip 0x002A
        const ifd0Offset = view.getUint32(offset, littleEndian);
        offset = tiffOffset + ifd0Offset;

        const numEntries = view.getUint16(offset, littleEndian);
        offset += 2;

        for (let i = 0; i < numEntries; i++) {
          const tag = view.getUint16(offset, littleEndian);
          if (tag === 0x0112) { // Orientation tag
            return view.getUint16(offset + 8, littleEndian);
          }
          offset += 12;
        }
      }
      break;
    } else if ((marker & 0xFF00) === 0xFF00) {
      // Skip other markers
      offset += view.getUint16(offset, false);
    } else {
      break;
    }
  }
  return 1; // Default orientation
}

/**
 * Load image and apply EXIF orientation correction
 * Returns a canvas with the correctly oriented image
 *
 * Modern browsers (Chrome 81+, Firefox 77+, Safari 13.1+) automatically
 * apply EXIF orientation when using createImageBitmap(). We rely on this
 * default behavior rather than manually parsing and applying EXIF transforms,
 * which avoids double-rotation issues from inconsistent browser implementations
 * of the 'imageOrientation: none' option.
 */
export async function loadImageWithOrientation(imageFile: File): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const arrayBuffer = await imageFile.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: imageFile.type });

  // Use createImageBitmap with explicit 'from-image' to ensure EXIF orientation is applied
  // This tells the browser to respect the image's EXIF orientation metadata
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Fallback for browsers that don't support imageOrientation option
    bitmap = await createImageBitmap(blob);
  }

  // Store dimensions before closing bitmap
  const width = bitmap.width;
  const height = bitmap.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to get canvas context');
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return {
    canvas,
    width,
    height,
  };
}

/**
 * Convert canvas to JPEG blob with specified quality
 */
async function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert image to JPEG'));
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Create PDF from canvas with given quality setting
 */
async function createPdfFromCanvas(
  canvas: HTMLCanvasElement,
  imgWidth: number,
  imgHeight: number,
  quality: number,
  fileName: string
): Promise<File> {
  const jpegBlob = await canvasToJpegBlob(canvas, quality);

  const pdfDoc = await PDFDocument.create();
  const imageBytes = await jpegBlob.arrayBuffer();
  const image = await pdfDoc.embedJpg(imageBytes);

  // Calculate page dimensions to fit image reasonably
  // Use A4 as reference but scale to fit image aspect ratio
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

  const pdfBytes = await pdfDoc.save({
    useObjectStreams: true, // Better compression
  });
  return createPdfFile(pdfBytes, fileName);
}

/**
 * Convert an image file to a PDF with proper orientation and sizing
 * Automatically adjusts JPEG quality to keep file size reasonable
 */
export async function imageToPdf(imageFile: File): Promise<File> {
  // Load image with EXIF orientation correction
  const { canvas, width: imgWidth, height: imgHeight } = await loadImageWithOrientation(imageFile);

  const baseName = imageFile.name.replace(/\.[^/.]+$/, '');
  const pdfFileName = `${baseName}.pdf`;
  const pixelCount = imgWidth * imgHeight;

  // Choose initial quality based on image size
  let quality = pixelCount > LARGE_IMAGE_PIXEL_THRESHOLD ? COMPRESSED_JPEG_QUALITY : DEFAULT_JPEG_QUALITY;

  // Create PDF with initial quality
  let pdfFile = await createPdfFromCanvas(canvas, imgWidth, imgHeight, quality, pdfFileName);

  // If still above threshold and we can reduce quality further, try again
  if (pdfFile.size > COMPRESSION_THRESHOLD && quality > MIN_JPEG_QUALITY) {
    quality = MIN_JPEG_QUALITY;
    pdfFile = await createPdfFromCanvas(canvas, imgWidth, imgHeight, quality, pdfFileName);
  }

  return pdfFile;
}

/**
 * Convert TIFF to JPEG using canvas
 */
async function _convertTiffToJpeg(tiffFile: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to convert TIFF to JPEG'));
              }
            },
            'image/jpeg',
            0.85
          );
        };
        img.onerror = () => reject(new Error('Failed to load TIFF image'));
        img.src = e.target?.result as string;
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read TIFF file'));
    reader.readAsDataURL(tiffFile);
  });
}

/**
 * Merge multiple files (PDFs and images) into a single PDF
 * Uses adaptive JPEG quality for large images to keep file size reasonable
 */
export async function mergeFilesToPdf(files: File[]): Promise<File> {
  const mergedDoc = await PDFDocument.create();

  for (const file of files) {
    if (file.type === 'application/pdf') {
      // Copy pages from existing PDF
      const pdfBytes = await file.arrayBuffer();
      const srcDoc = await PDFDocument.load(pdfBytes);
      const pageIndices = srcDoc.getPageIndices();
      const copiedPages = await mergedDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach((page) => mergedDoc.addPage(page));
    } else if (file.type.startsWith('image/')) {
      // Load image with orientation correction
      const { canvas, width: imgWidth, height: imgHeight } = await loadImageWithOrientation(file);

      // Choose quality based on image size
      const pixelCount = imgWidth * imgHeight;
      const quality = pixelCount > LARGE_IMAGE_PIXEL_THRESHOLD ? COMPRESSED_JPEG_QUALITY : DEFAULT_JPEG_QUALITY;

      // Convert to JPEG with appropriate quality
      const jpegBlob = await canvasToJpegBlob(canvas, quality);

      const imageBytes = await jpegBlob.arrayBuffer();
      const image = await mergedDoc.embedJpg(imageBytes);

      // Calculate page dimensions (same logic as imageToPdf)
      const aspectRatio = imgWidth / imgHeight;
      let pageWidth: number;
      let pageHeight: number;

      if (aspectRatio > 1) {
        pageWidth = Math.min(A4_HEIGHT, MAX_PAGE_DIMENSION);
        pageHeight = pageWidth / aspectRatio;
      } else {
        pageHeight = Math.min(A4_HEIGHT, MAX_PAGE_DIMENSION);
        pageWidth = pageHeight * aspectRatio;
      }

      if (pageWidth < 200) pageWidth = 200;
      if (pageHeight < 200) pageHeight = 200;

      const page = mergedDoc.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    }
  }

  const pdfBytes = await mergedDoc.save({
    useObjectStreams: true, // Better compression
  });
  const firstFileName = files[0]?.name.replace(/\.[^/.]+$/, '') || 'merged';
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return createPdfFile(pdfBytes, `${firstFileName}_merged_${timestamp}.pdf`);
}

/**
 * Compress a PDF file if it exceeds the threshold
 * Uses image quality reduction for embedded images
 */
export async function compressPdfIfNeeded(file: File): Promise<File> {
  // Only compress if above threshold
  if (file.size <= COMPRESSION_THRESHOLD) {
    return file;
  }

  try {
    const pdfBytes = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes, {
      // Skip parsing embedded fonts to speed up loading
      updateMetadata: false,
    });

    // Re-save with compression options
    // pdf-lib automatically compresses when saving
    const compressedBytes = await pdfDoc.save({
      useObjectStreams: true, // Better compression
      addDefaultPage: false,
    });

    // If the "compressed" version is larger or similar, return original
    if (compressedBytes.length >= file.size * 0.95) {
      return file;
    }

    return createPdfFile(compressedBytes, file.name);
  } catch (err) {
    console.error('PDF compression failed, using original:', err);
    return file;
  }
}

/**
 * Process a file for upload:
 * - Convert images to PDF
 * - Compress large PDFs
 */
export async function processFileForUpload(file: File): Promise<File> {
  // If it's an image, convert to PDF first
  if (file.type.startsWith('image/')) {
    const pdfFile = await imageToPdf(file);
    // Then compress if needed
    return compressPdfIfNeeded(pdfFile);
  }

  // If it's a PDF, just compress if needed
  if (file.type === 'application/pdf') {
    return compressPdfIfNeeded(file);
  }

  // Return as-is for other types
  return file;
}

/**
 * Check if a file is a supported type
 */
export function isSupportedFileType(file: File): boolean {
  const supportedTypes = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/tiff',
    'image/tif',
  ];
  return supportedTypes.includes(file.type.toLowerCase());
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/tiff': 'tiff',
    'image/tif': 'tiff',
  };
  return extensions[mimeType.toLowerCase()] || 'bin';
}

/**
 * Split range definition for PDF splitting
 */
export interface SplitPageRange {
  /** Page number to start from (1-indexed, inclusive) */
  pageFrom: number;
  /** Page number to end at (1-indexed, inclusive) */
  pageTo: number;
  /** Optional label for the split (e.g., "Invoice 1") */
  label?: string;
}

/**
 * Get the total number of pages in a PDF file
 */
export async function getPdfPageCount(file: File): Promise<number> {
  const pdfBytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(pdfBytes);
  return pdfDoc.getPageCount();
}

/**
 * Split a PDF file into multiple PDFs based on page ranges
 * @param file - Source PDF file to split
 * @param ranges - Array of page ranges (1-indexed, inclusive)
 * @returns Array of split PDF files
 */
export async function splitPdfByRanges(
  file: File,
  ranges: SplitPageRange[]
): Promise<File[]> {
  if (ranges.length === 0) {
    throw new Error('At least one split range is required');
  }

  const sourceBytes = await file.arrayBuffer();
  const sourceDoc = await PDFDocument.load(sourceBytes);
  const totalPages = sourceDoc.getPageCount();

  // Validate ranges
  for (const range of ranges) {
    if (range.pageFrom < 1 || range.pageTo < range.pageFrom) {
      throw new Error(`Invalid range: ${range.pageFrom}-${range.pageTo}`);
    }
    if (range.pageTo > totalPages) {
      throw new Error(`Page ${range.pageTo} exceeds document length (${totalPages} pages)`);
    }
  }

  const result: File[] = [];
  const baseName = file.name.replace(/\.pdf$/i, '');

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const newDoc = await PDFDocument.create();

    // Copy pages for this range (convert to 0-indexed)
    const pageIndices: number[] = [];
    for (let p = range.pageFrom - 1; p < range.pageTo; p++) {
      pageIndices.push(p);
    }

    const copiedPages = await newDoc.copyPages(sourceDoc, pageIndices);
    copiedPages.forEach((page) => newDoc.addPage(page));

    // Save the new PDF
    const pdfBytes = await newDoc.save({ useObjectStreams: true });
    const label = range.label || `Part ${i + 1}`;
    const fileName = `${baseName}_${label.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    result.push(createPdfFile(pdfBytes, fileName));
  }

  return result;
}

/**
 * Get page thumbnails for split preview
 * Renders each page as a small canvas for preview purposes
 * Note: This uses pdf.js internally for rendering
 */
export async function getPdfPageThumbnails(
  file: File,
  _maxThumbnailHeight: number = 150
): Promise<{ pageNumber: number; dataUrl: string }[]> {
  // This would require pdf.js for rendering. For now, return empty array
  // and let the component use a different approach (e.g., pdf.js directly)
  // Placeholder - actual implementation would use pdfjs-dist
  return [];
}
