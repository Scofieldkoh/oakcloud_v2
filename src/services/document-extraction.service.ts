/**
 * Public entry point for document extraction. The implementation is split by
 * responsibility under ./document-extraction/.
 */

export type {
  ExtractionConfig,
  EvidenceBbox,
  FieldEvidence,
  ExtractedField,
  SplitDetectionResult,
  HomeCurrencyEquivalent,
  FieldExtractionResult,
  ExtractionJobResult,
} from './document-extraction/types';
export {
  mapCounterpartyIdentityDraft,
  mapAIResponseToResult,
} from './document-extraction/mapping';
export {
  reconcilePendingMistralBatchExtraction,
  reconcilePendingOpenAIBatchExtraction,
  reconcilePendingBatchExtraction,
} from './document-extraction/batch';
export {
  detectSplitBoundaries,
  extractFields,
  reextractFields,
  getExtraction,
  getExtractionsByDocument,
  createDocumentPages,
  getDocumentPages,
} from './document-extraction/extraction';
