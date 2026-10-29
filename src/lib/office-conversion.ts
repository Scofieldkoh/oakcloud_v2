import { extname } from 'node:path';

type OfficeDocumentType = 'pdf' | 'docx' | 'doc';

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46] as const;
const DOC_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0] as const;
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
] as const;

const WORD_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function startsWithSignature(buffer: Buffer, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) {
    return false;
  }

  return signature.every((byte, index) => buffer[index] === byte);
}

function hasDocxMarkers(buffer: Buffer): boolean {
  const content = buffer.toString('latin1');
  return content.includes('[Content_Types].xml') && content.includes('word/');
}

export function detectOfficeDocumentType(
  buffer: Buffer,
  fileName: string,
  clientMimeType?: string
): OfficeDocumentType | null {
  if (startsWithSignature(buffer, PDF_SIGNATURE)) {
    return 'pdf';
  }

  const lowerFileName = fileName.toLowerCase();
  const lowerMimeType = clientMimeType?.toLowerCase();

  if (ZIP_SIGNATURES.some((signature) => startsWithSignature(buffer, signature))) {
    if (
      hasDocxMarkers(buffer) ||
      lowerFileName.endsWith('.docx') ||
      lowerMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return 'docx';
    }
  }

  if (
    startsWithSignature(buffer, DOC_SIGNATURE) &&
    (lowerFileName.endsWith('.doc') || (lowerMimeType ? WORD_MIME_TYPES.has(lowerMimeType) : true))
  ) {
    return 'doc';
  }

  return null;
}

export function getPdfFileNameForUpload(fileName: string): string {
  const trimmedName = fileName.trim() || 'document';
  const extension = extname(trimmedName);
  const baseName = extension ? trimmedName.slice(0, -extension.length) : trimmedName;
  return `${baseName || 'document'}.pdf`;
}
