/**
 * File Validation Utility
 *
 * Provides server-side file content validation to prevent MIME type spoofing.
 * Uses magic bytes (file signatures) to detect actual file types.
 */

import { createLogger } from './logger';

const log = createLogger('file-validation');

// ============================================================================
// Types
// ============================================================================

export interface FileValidationResult {
  /** Whether the file is valid */
  valid: boolean;
  /** Detected file extension (without dot) */
  ext?: string;
  /** Detected MIME type */
  mime?: string;
  /** Error message if invalid */
  error?: string;
}

export interface AllowedFileType {
  ext: string;
  mimes: string[];
}

// ============================================================================
// Magic Bytes Detection
// ============================================================================

// Common file signatures (magic bytes) for validation
// Reference: https://en.wikipedia.org/wiki/List_of_file_signatures
const FILE_SIGNATURES = {
  // PDF
  pdf: {
    signature: [0x25, 0x50, 0x44, 0x46], // %PDF
    mime: 'application/pdf',
  },
  // PNG
  png: {
    signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    mime: 'image/png',
  },
  // JPEG (FFD8FF)
  jpg: {
    signature: [0xFF, 0xD8, 0xFF],
    mime: 'image/jpeg',
  },
  // WebP (RIFF....WEBP)
  webp: {
    signature: [0x52, 0x49, 0x46, 0x46], // RIFF (need additional check for WEBP)
    mime: 'image/webp',
  },
  // GIF87a or GIF89a
  gif: {
    signature: [0x47, 0x49, 0x46, 0x38], // GIF8
    mime: 'image/gif',
  },
} as const;

/**
 * Check if buffer starts with given signature
 */
function bufferStartsWith(buffer: Buffer, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) return false;

  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Detect file type from buffer content using magic bytes
 * This is more reliable than trusting the MIME type from the client
 */
export function detectFileType(buffer: Buffer): { ext: string; mime: string } | null {
  // Check PDF
  if (bufferStartsWith(buffer, FILE_SIGNATURES.pdf.signature)) {
    return { ext: 'pdf', mime: FILE_SIGNATURES.pdf.mime };
  }

  // Check PNG
  if (bufferStartsWith(buffer, FILE_SIGNATURES.png.signature)) {
    return { ext: 'png', mime: FILE_SIGNATURES.png.mime };
  }

  // Check JPEG
  if (bufferStartsWith(buffer, FILE_SIGNATURES.jpg.signature)) {
    return { ext: 'jpg', mime: FILE_SIGNATURES.jpg.mime };
  }

  // Check WebP (RIFF + WEBP at offset 8)
  if (bufferStartsWith(buffer, FILE_SIGNATURES.webp.signature)) {
    // Additional check for WEBP marker at offset 8
    if (buffer.length >= 12) {
      const webpMarker = buffer.slice(8, 12).toString('ascii');
      if (webpMarker === 'WEBP') {
        return { ext: 'webp', mime: FILE_SIGNATURES.webp.mime };
      }
    }
  }

  // Check GIF
  if (bufferStartsWith(buffer, FILE_SIGNATURES.gif.signature)) {
    return { ext: 'gif', mime: FILE_SIGNATURES.gif.mime };
  }

  return null;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Predefined allowed file types for different upload contexts
 */
export const ALLOWED_FILE_TYPES = {
  /** BizFile extraction: PDF and images */
  BIZFILE: [
    { ext: 'pdf', mimes: ['application/pdf'] },
    { ext: 'png', mimes: ['image/png'] },
    { ext: 'jpg', mimes: ['image/jpeg', 'image/jpg'] },
    { ext: 'webp', mimes: ['image/webp'] },
  ] as AllowedFileType[],

  /** Document templates: PDF only */
  DOCUMENT: [
    { ext: 'pdf', mimes: ['application/pdf'] },
  ] as AllowedFileType[],

  /** Images only */
  IMAGE: [
    { ext: 'png', mimes: ['image/png'] },
    { ext: 'jpg', mimes: ['image/jpeg', 'image/jpg'] },
    { ext: 'webp', mimes: ['image/webp'] },
    { ext: 'gif', mimes: ['image/gif'] },
  ] as AllowedFileType[],
} as const;

/**
 * Validate file content against allowed types
 *
 * @param buffer - File content buffer
 * @param allowedTypes - Array of allowed file types
 * @param clientMimeType - Optional MIME type from client for logging
 * @returns Validation result with detected type or error
 */
export function validateFileContent(
  buffer: Buffer,
  allowedTypes: AllowedFileType[],
  clientMimeType?: string
): FileValidationResult {
  // Detect actual file type from content
  const detected = detectFileType(buffer);

  if (!detected) {
    log.warn('Unable to detect file type from content', { clientMimeType });
    return {
      valid: false,
      error: 'Unable to determine file type. Please upload a valid file.',
    };
  }

  // Check if detected type is in allowed list
  const isAllowed = allowedTypes.some(
    (type) => type.ext === detected.ext || type.mimes.includes(detected.mime)
  );

  if (!isAllowed) {
    const allowedExts = allowedTypes.map((t) => t.ext.toUpperCase()).join(', ');
    log.warn('File type not allowed', {
      detected: detected.ext,
      clientMimeType,
      allowedExts,
    });
    return {
      valid: false,
      ext: detected.ext,
      mime: detected.mime,
      error: `File type "${detected.ext.toUpperCase()}" is not allowed. Allowed types: ${allowedExts}`,
    };
  }

  // Check for MIME type mismatch (potential spoofing attempt)
  if (clientMimeType && !allowedTypes.some((type) => type.mimes.includes(clientMimeType))) {
    log.warn('MIME type mismatch detected (potential spoofing)', {
      detected: detected.mime,
      clientMimeType,
    });
    // We still allow if content is valid, but log the discrepancy
  }

  return {
    valid: true,
    ext: detected.ext,
    mime: detected.mime,
  };
}

/**
 * Quick check if buffer looks like a valid file of any known type
 */
export function isValidFileContent(buffer: Buffer): boolean {
  return detectFileType(buffer) !== null;
}

/**
 * Get file extension from detected content
 */
export function getFileExtensionFromContent(buffer: Buffer): string | null {
  const detected = detectFileType(buffer);
  return detected?.ext || null;
}
