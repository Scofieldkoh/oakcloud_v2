const INVALID_SHAREPOINT_SEGMENT_CHARACTERS = /["*:<>?|\\\u0000-\u001f\u007f]/;
const DRIVE_PATH = /^[a-zA-Z]:([/\\]|$)/;
const MAX_SEGMENT_LENGTH = 255;
const MAX_PATH_LENGTH = 400;

export interface ParsedSharePointRelativeFolderPath {
  normalized: string;
  segments: string[];
}

export type SharePointRelativeFolderPathErrorCode =
  | 'EMPTY'
  | 'ABSOLUTE_PATH'
  | 'EMPTY_SEGMENT'
  | 'DOT_SEGMENT'
  | 'INVALID_CHARACTER'
  | 'TRAILING_PERIOD'
  | 'SEGMENT_TOO_LONG'
  | 'PATH_TOO_LONG';

export class SharePointRelativeFolderPathError extends Error {
  readonly code: SharePointRelativeFolderPathErrorCode;
  readonly pathValue: string;

  constructor(code: SharePointRelativeFolderPathErrorCode, message: string, pathValue: string) {
    super(message);
    this.name = 'SharePointRelativeFolderPathError';
    this.code = code;
    this.pathValue = pathValue;
  }
}

/**
 * Validate and normalize a route beneath a mapped company SharePoint folder.
 * A blank value is represented by null at persistence boundaries; the parser
 * deliberately rejects it so callers cannot accidentally route to the root.
 */
export function parseSharePointRelativeFolderPath(value: unknown): ParsedSharePointRelativeFolderPath {
  if (typeof value !== 'string') {
    throw new SharePointRelativeFolderPathError('EMPTY', 'SharePoint subfolder must be text', String(value));
  }

  const original = value;
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SharePointRelativeFolderPathError('EMPTY', 'SharePoint subfolder cannot be empty', original);
  }

  const normalizedSeparators = trimmed.replace(/\\/g, '/');
  if (
    /^\//.test(normalizedSeparators)
    || /\/$/.test(normalizedSeparators)
    || /^~\//.test(normalizedSeparators)
    || DRIVE_PATH.test(normalizedSeparators)
    || normalizedSeparators.startsWith('//')
    || /^https?:\/\//i.test(normalizedSeparators)
    || /^\\\\/.test(trimmed)
  ) {
    throw new SharePointRelativeFolderPathError(
      'ABSOLUTE_PATH',
      'SharePoint subfolder must be a relative path',
      original,
    );
  }

  const rawSegments = normalizedSeparators.split('/');
  if (rawSegments.some((segment) => !segment.trim())) {
    throw new SharePointRelativeFolderPathError(
      'EMPTY_SEGMENT',
      'SharePoint subfolder cannot contain empty path segments',
      original,
    );
  }

  const segments = rawSegments.map((segment) => segment.trim());
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new SharePointRelativeFolderPathError(
        'DOT_SEGMENT',
        'SharePoint subfolder cannot contain . or .. segments',
        original,
      );
    }
    if (INVALID_SHAREPOINT_SEGMENT_CHARACTERS.test(segment)) {
      throw new SharePointRelativeFolderPathError(
        'INVALID_CHARACTER',
        'SharePoint subfolder contains an invalid character',
        original,
      );
    }
    if (/\.$/.test(segment)) {
      throw new SharePointRelativeFolderPathError(
        'TRAILING_PERIOD',
        'SharePoint subfolder segments cannot end with a period',
        original,
      );
    }
    if (segment.length > MAX_SEGMENT_LENGTH) {
      throw new SharePointRelativeFolderPathError(
        'SEGMENT_TOO_LONG',
        `SharePoint subfolder segments must be ${MAX_SEGMENT_LENGTH} characters or fewer`,
        original,
      );
    }
  }

  const normalized = segments.join('/');
  if (normalized.length > MAX_PATH_LENGTH) {
    throw new SharePointRelativeFolderPathError(
      'PATH_TOO_LONG',
      `SharePoint subfolder paths must be ${MAX_PATH_LENGTH} characters or fewer`,
      original,
    );
  }

  return { normalized, segments };
}

export function tryParseSharePointRelativeFolderPath(value: unknown): ParsedSharePointRelativeFolderPath | null {
  try {
    return parseSharePointRelativeFolderPath(value);
  } catch {
    return null;
  }
}

