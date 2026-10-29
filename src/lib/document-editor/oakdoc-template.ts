import type { JsonValue } from '@/lib/validations/document-template';

export const OAKDOC_TEMPLATE_SCHEMA_VERSION = 1;
export const OAKDOC_TEMPLATE_CONTENT =
  '<p data-oakdoc-template="true">DOCX-native template. Open this template in OakDoc.</p>';
export const OAKDOC_SERVICE_AGREEMENT_CONTENT = [
  OAKDOC_TEMPLATE_CONTENT,
  '{{@agreement.serviceSections}}',
  '{{@agreement.feeTable}}',
  '{{@agreement.entityAppendix}}',
].join('\n');
export const OAKDOC_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface OakDocTemplateMetadata {
  schemaVersion: 1;
  storageKey: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  mimeType: typeof OAKDOC_MIME_TYPE;
  fieldTags: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeFieldTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )).sort();
}

export function readOakDocTemplateMetadata(
  contentJson: unknown,
): OakDocTemplateMetadata | null {
  if (!isRecord(contentJson) || !isRecord(contentJson.oakDoc)) return null;
  const raw = contentJson.oakDoc;

  if (
    raw.schemaVersion !== OAKDOC_TEMPLATE_SCHEMA_VERSION
    || typeof raw.storageKey !== 'string'
    || !raw.storageKey
    || typeof raw.fileName !== 'string'
    || !raw.fileName
    || typeof raw.fileSize !== 'number'
    || !Number.isInteger(raw.fileSize)
    || raw.fileSize < 0
    || typeof raw.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(raw.sha256)
    || raw.mimeType !== OAKDOC_MIME_TYPE
  ) {
    return null;
  }

  return {
    schemaVersion: OAKDOC_TEMPLATE_SCHEMA_VERSION,
    storageKey: raw.storageKey,
    fileName: raw.fileName,
    fileSize: raw.fileSize,
    sha256: raw.sha256.toLowerCase(),
    mimeType: OAKDOC_MIME_TYPE,
    fieldTags: sanitizeFieldTags(raw.fieldTags),
  };
}

/** Database filter matching `contentJson` that carries OakDoc (Word) metadata. */
export function oakDocContentJsonFilter() {
  return { path: ['oakDoc', 'schemaVersion'], equals: 1 };
}

export function isOakDocTemplate(contentJson: unknown): boolean {
  return readOakDocTemplateMetadata(contentJson) !== null;
}

export function mergeOakDocTemplateMetadata(
  contentJson: unknown,
  metadata: OakDocTemplateMetadata,
): Record<string, JsonValue> {
  const base = isRecord(contentJson)
    ? { ...contentJson }
    : {};

  return {
    ...(base as Record<string, JsonValue>),
    oakDoc: {
      schemaVersion: metadata.schemaVersion,
      storageKey: metadata.storageKey,
      fileName: metadata.fileName,
      fileSize: metadata.fileSize,
      sha256: metadata.sha256,
      mimeType: metadata.mimeType,
      fieldTags: metadata.fieldTags,
    },
  };
}
