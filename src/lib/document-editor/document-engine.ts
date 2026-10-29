import {
  OAKDOC_MIME_TYPE,
  readOakDocTemplateMetadata,
} from '@/lib/document-editor/oakdoc-template';
import { ValidationError } from '@/lib/errors';
import { OAKDOC_ERROR_REASONS } from '@/types/oakdoc';

export type DocumentEngine = 'A4' | 'OAKDOC';

/**
 * C01 engine discrimination. `INVALID` means native markers are present but
 * the metadata cannot be trusted; it must never fall back to A4 handling.
 */
export type DocumentEngineState = DocumentEngine | 'INVALID';

export type DocumentEngineCapability =
  | 'inline-edit'
  | 'html-export'
  | 'pdf-export'
  | 'docx-download';

export interface DocumentEngineCapabilities {
  inlineEdit: boolean;
  htmlExport: boolean;
  pdfExport: boolean;
  docxDownload: boolean;
}

export interface GeneratedOakDocAssetMetadata {
  schemaVersion: 1;
  storageKey: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  mimeType: typeof OAKDOC_MIME_TYPE;
  templateId: string;
  templateVersion: number;
  templateSha256: string;
  generatedAt: string;
  fieldsUpdated: number;
  unresolvedTags: string[];
  conditionsResolved: number;
  conditionsKept: number;
  conditionsRemoved: number;
  repeatersResolved: number;
  repeaterItemsCreated: number;
  /** Operation identity of the last native save, for idempotent retries. */
  lastOperationId?: string;
}

export interface OakDocReviewDraftMetadata {
  schemaVersion: 1;
  previewFingerprint: string;
  savedAt: string;
  edited: boolean;
}

export interface OakDocEditedContentMetadata {
  documentEngine: 'OAKDOC';
  schemaVersion: 1;
  oakDocDraftSha256: string;
  previewFingerprint: string;
  savedAt: string;
}

export const OAKDOC_GENERATED_CONTENT =
  '<p data-oakdoc-generated="true">DOCX-native generated document. Open the Word document to review its content.</p>';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return null;
  }
  return value as string[];
}

export class InvalidDocumentEngineError extends ValidationError {
  constructor(entity: 'template' | 'generated-document') {
    super(
      entity === 'template'
        ? 'This template has damaged OakDoc metadata and cannot be opened or generated'
        : 'This document has damaged OakDoc metadata and cannot be opened or exported',
      { reason: OAKDOC_ERROR_REASONS.INVALID_ENGINE_METADATA },
    );
    this.name = 'InvalidDocumentEngineError';
  }
}

export function getDocumentTemplateEngineState(contentJson: unknown): DocumentEngineState {
  if (readOakDocTemplateMetadata(contentJson)) return 'OAKDOC';
  if (isRecord(contentJson) && (contentJson.oakDoc !== undefined || contentJson.documentEngine === 'OAKDOC')) {
    return 'INVALID';
  }
  return 'A4';
}

/** Throws for damaged native metadata instead of treating it as A4. */
export function getDocumentTemplateEngine(contentJson: unknown): DocumentEngine {
  const state = getDocumentTemplateEngineState(contentJson);
  if (state === 'INVALID') throw new InvalidDocumentEngineError('template');
  return state;
}

/**
 * Engine to present in lists and pickers. Damaged native metadata is shown as
 * OakDoc so no A4 surface is offered; server operations then fail closed.
 */
export function getDocumentTemplateDisplayEngine(contentJson: unknown): DocumentEngine {
  return getDocumentTemplateEngineState(contentJson) === 'A4' ? 'A4' : 'OAKDOC';
}

export type DocumentLifecycleStatus = 'DRAFT' | 'FINALIZED' | 'ARCHIVED';

export interface DocumentCapabilityContext {
  engine: DocumentEngineState;
  status?: DocumentLifecycleStatus;
  /** Caller holds the document update permission. Defaults to true. */
  canUpdate?: boolean;
  /** A usable Microsoft 365 converter is configured for the workspace. */
  pdfConverterReady?: boolean;
}

/**
 * Operation capabilities. UI uses these to describe availability; services
 * still enforce the same rules independently.
 */
export function getDocumentCapabilities(
  context: DocumentCapabilityContext,
): DocumentEngineCapabilities {
  const editable = (context.status ?? 'DRAFT') === 'DRAFT' && context.canUpdate !== false;
  if (context.engine === 'OAKDOC') {
    return {
      inlineEdit: editable,
      htmlExport: false,
      pdfExport: context.pdfConverterReady === true,
      docxDownload: true,
    };
  }
  // Damaged metadata fails closed; A4 records can no longer be opened.
  return { inlineEdit: false, htmlExport: false, pdfExport: false, docxDownload: false };
}

export function getDocumentEngineCapabilities(
  engine: DocumentEngineState,
): DocumentEngineCapabilities {
  return getDocumentCapabilities({ engine, status: 'DRAFT', pdfConverterReady: true });
}

export function documentEngineSupports(
  engine: DocumentEngineState,
  capability: DocumentEngineCapability,
): boolean {
  const capabilities = getDocumentEngineCapabilities(engine);
  switch (capability) {
    case 'inline-edit':
      return capabilities.inlineEdit;
    case 'html-export':
      return capabilities.htmlExport;
    case 'pdf-export':
      return capabilities.pdfExport;
    case 'docx-download':
      return capabilities.docxDownload;
    default:
      return false;
  }
}

export function readGeneratedOakDocAssetMetadata(
  metadata: unknown,
): GeneratedOakDocAssetMetadata | null {
  if (!isRecord(metadata) || metadata.documentEngine !== 'OAKDOC') return null;
  if (!isRecord(metadata.oakDocGenerated)) return null;
  const raw = metadata.oakDocGenerated;
  const unresolvedTags = stringArray(raw.unresolvedTags);
  if (
    raw.schemaVersion !== 1
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
    || typeof raw.templateId !== 'string'
    || !raw.templateId
    || typeof raw.templateVersion !== 'number'
    || !Number.isInteger(raw.templateVersion)
    || raw.templateVersion < 1
    || typeof raw.templateSha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(raw.templateSha256)
    || typeof raw.generatedAt !== 'string'
    || !raw.generatedAt
    || typeof raw.fieldsUpdated !== 'number'
    || !Number.isInteger(raw.fieldsUpdated)
    || raw.fieldsUpdated < 0
    || !unresolvedTags
    || typeof raw.conditionsResolved !== 'number'
    || !Number.isInteger(raw.conditionsResolved)
    || raw.conditionsResolved < 0
    || typeof raw.conditionsKept !== 'number'
    || !Number.isInteger(raw.conditionsKept)
    || raw.conditionsKept < 0
    || typeof raw.conditionsRemoved !== 'number'
    || !Number.isInteger(raw.conditionsRemoved)
    || raw.conditionsRemoved < 0
    || typeof raw.repeatersResolved !== 'number'
    || !Number.isInteger(raw.repeatersResolved)
    || raw.repeatersResolved < 0
    || typeof raw.repeaterItemsCreated !== 'number'
    || !Number.isInteger(raw.repeaterItemsCreated)
    || raw.repeaterItemsCreated < 0
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    storageKey: raw.storageKey,
    fileName: raw.fileName,
    fileSize: raw.fileSize,
    sha256: raw.sha256.toLowerCase(),
    mimeType: OAKDOC_MIME_TYPE,
    templateId: raw.templateId,
    templateVersion: raw.templateVersion,
    templateSha256: raw.templateSha256.toLowerCase(),
    generatedAt: raw.generatedAt,
    fieldsUpdated: raw.fieldsUpdated,
    unresolvedTags,
    conditionsResolved: raw.conditionsResolved,
    conditionsKept: raw.conditionsKept,
    conditionsRemoved: raw.conditionsRemoved,
    repeatersResolved: raw.repeatersResolved,
    repeaterItemsCreated: raw.repeaterItemsCreated,
    ...(typeof raw.lastOperationId === 'string' && raw.lastOperationId
      ? { lastOperationId: raw.lastOperationId }
      : {}),
  };
}


export function readOakDocReviewDraftMetadata(
  metadata: unknown,
): OakDocReviewDraftMetadata | null {
  if (!isRecord(metadata) || !isRecord(metadata.oakDocReviewDraft)) return null;
  const raw = metadata.oakDocReviewDraft;
  if (
    raw.schemaVersion !== 1
    || typeof raw.previewFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/i.test(raw.previewFingerprint)
    || typeof raw.savedAt !== 'string'
    || !raw.savedAt
    || typeof raw.edited !== 'boolean'
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    previewFingerprint: raw.previewFingerprint.toLowerCase(),
    savedAt: raw.savedAt,
    edited: raw.edited,
  };
}

export function mergeOakDocReviewDraftMetadata(
  currentMetadata: unknown,
  reviewDraft: OakDocReviewDraftMetadata,
): Record<string, unknown> {
  const current = isRecord(currentMetadata) ? { ...currentMetadata } : {};
  return {
    ...current,
    oakDocReviewDraft: reviewDraft,
  };
}

export function readOakDocEditedContentMetadata(
  contentJson: unknown,
): OakDocEditedContentMetadata | null {
  if (!isRecord(contentJson) || contentJson.documentEngine !== 'OAKDOC') return null;
  if (
    contentJson.schemaVersion !== 1
    || typeof contentJson.oakDocDraftSha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(contentJson.oakDocDraftSha256)
    || typeof contentJson.previewFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/i.test(contentJson.previewFingerprint)
    || typeof contentJson.savedAt !== 'string'
    || !contentJson.savedAt
  ) {
    return null;
  }
  return {
    documentEngine: 'OAKDOC',
    schemaVersion: 1,
    oakDocDraftSha256: contentJson.oakDocDraftSha256.toLowerCase(),
    previewFingerprint: contentJson.previewFingerprint.toLowerCase(),
    savedAt: contentJson.savedAt,
  };
}

export function readGeneratedDocumentEngineState(metadata: unknown): DocumentEngineState {
  if (readGeneratedOakDocAssetMetadata(metadata)) return 'OAKDOC';
  if (isRecord(metadata) && (metadata.documentEngine === 'OAKDOC' || metadata.oakDocGenerated !== undefined)) {
    return 'INVALID';
  }
  return 'A4';
}

/**
 * A non-OakDoc draft that exists before generation: a batch placeholder or a
 * saved generation session. Anything else that is not OakDoc is an old A4
 * record.
 */
export function isUngeneratedDocumentDraft(metadata: unknown): boolean {
  return isRecord(metadata)
    && (metadata.batchItem === true || isRecord(metadata.generationSession));
}

/** Throws for damaged native metadata instead of treating it as A4. */
export function readGeneratedDocumentEngine(metadata: unknown): DocumentEngine {
  const state = readGeneratedDocumentEngineState(metadata);
  if (state === 'INVALID') throw new InvalidDocumentEngineError('generated-document');
  return state;
}

export function mergeGeneratedOakDocMetadata(
  currentMetadata: unknown,
  generated: GeneratedOakDocAssetMetadata,
  selectedParties: Record<string, unknown>,
  taskIntegrationContext?: Record<string, unknown>,
): Record<string, unknown> {
  const current = isRecord(currentMetadata) ? { ...currentMetadata } : {};
  return {
    ...current,
    documentEngine: 'OAKDOC',
    oakDocGenerated: generated,
    selectedParties,
    ...(taskIntegrationContext ? { taskIntegrationContext } : {}),
  };
}
