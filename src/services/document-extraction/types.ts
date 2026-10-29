/** Public types of document extraction results and configuration. */

import type { DocumentCategory, DocumentSubCategory } from '@/generated/prisma';
import { type CounterpartyIdentityDraft } from '@/services/document-revision.service';

export interface ExtractionConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'mistral';
  model: string;
  promptVersion: string;
  schemaVersion: string;
  /** Additional context to help AI extraction (e.g., "Focus on line items") */
  additionalContext?: string;
  /** Queue extraction as a provider batch job when supported */
  batchMode?: boolean;
}

export interface EvidenceBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  unit: 'normalized';
  origin: 'top-left';
}

export interface FieldEvidence {
  containerPageNumber: number;
  childPageNumber: number;
  text: string;
  confidence: number;
  coordSpace: 'RENDERED_IMAGE';
  renderFingerprint: string;
  bbox?: EvidenceBbox; // Optional - bounding box highlighting is now done via PDF text layer
}

export interface ExtractedField<T> {
  value: T;
  evidence?: FieldEvidence;
  confidence?: number;
}

export interface SplitDetectionResult {
  documentBoundaries: Array<{
    pageFrom: number;
    pageTo: number;
    confidence: number;
    predictedCategory?: DocumentCategory;
  }>;
  overallConfidence: number;
}

export interface HomeCurrencyEquivalent {
  currency: string;
  exchangeRate: string;
  subtotal?: string;
  taxAmount?: string;
  totalAmount: string;
  confidence: number;
}

export interface FieldExtractionResult {
  documentCategory: ExtractedField<DocumentCategory>;
  documentSubCategory?: ExtractedField<DocumentSubCategory>;
  vendorName?: ExtractedField<string>;
  customerName?: ExtractedField<string>;
  counterpartyIdentificationType?: ExtractedField<string>;
  counterpartyIdentificationNumber?: ExtractedField<string>;
  counterpartyAddress?: ExtractedField<string>;
  counterpartyEmail?: ExtractedField<string>;
  counterpartyPhone?: ExtractedField<string>;
  counterpartyIdentity?: CounterpartyIdentityDraft;
  documentNumber?: ExtractedField<string>;
  documentDate?: ExtractedField<string>;
  dueDate?: ExtractedField<string>;
  currency: ExtractedField<string>;
  subtotal?: ExtractedField<string>;
  taxAmount?: ExtractedField<string>;
  totalAmount: ExtractedField<string>;
  supplierGstNo?: ExtractedField<string>;
  homeCurrencyEquivalent?: HomeCurrencyEquivalent;
  lineItems?: Array<{
    lineNo: number;
    description: ExtractedField<string>;
    quantity?: ExtractedField<string>;
    unitPrice?: ExtractedField<string>;
    amount: ExtractedField<string>;
    gstAmount?: ExtractedField<string>;
    taxCode?: ExtractedField<string>;
    accountCode?: ExtractedField<string>;
  }>;
  overallConfidence: number;
}

export interface ExtractionJobResult {
  success: boolean;
  extractionId: string;
  revisionId?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
