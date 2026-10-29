const INVALID_FILENAME_CHARACTERS = /["*:<>?|\\/\u0000-\u001f\u007f]/g;
const MAX_FILENAME_LENGTH = 255;

export function sanitizeSharePointFilenameComponent(value: string, fallback = 'Document'): string {
  const sanitized = value
    .replace(INVALID_FILENAME_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return sanitized || fallback;
}

function extensionless(value: string): string {
  return value.toLowerCase().endsWith('.pdf') ? value.slice(0, -4) : value;
}

export interface SignedDocumentFilenameInput {
  documentTitle: string;
}

export function preferredSignedDocumentFileName(input: SignedDocumentFilenameInput): string {
  const sourceBaseName = sanitizeSharePointFilenameComponent(
    extensionless(input.documentTitle),
    'Document',
  );
  const base = /_signed$/i.test(sourceBaseName) ? sourceBaseName : `${sourceBaseName}_signed`;
  const suffix = '.pdf';
  return `${base.slice(0, Math.max(1, MAX_FILENAME_LENGTH - suffix.length))}${suffix}`;
}

export function signedDocumentFilenameCandidate(preferred: string, suffix: number): string {
  if (suffix <= 0) return preferred;
  const extension = preferred.toLowerCase().endsWith('.pdf') ? '.pdf' : '';
  const base = extension ? preferred.slice(0, -extension.length) : preferred;
  const candidate = `${base} (${suffix})${extension}`;
  return candidate.length <= MAX_FILENAME_LENGTH ? candidate : `${candidate.slice(0, MAX_FILENAME_LENGTH - extension.length)}${extension}`;
}

export const MAX_AUTOMATIC_FILENAME_CANDIDATES = 100;
