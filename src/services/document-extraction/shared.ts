/** Constants, JSON schemas and small helpers shared by the document extraction modules. */

import { createLogger } from '@/lib/logger';
import { Prisma } from '@/generated/prisma';
import { hashBlake3 } from '@/lib/encryption';
import { type ExtractionConfig, type FieldEvidence, type FieldExtractionResult } from './types';

export type _Decimal = Prisma.Decimal;

export const log = createLogger('document-extraction');

// ============================================================================
// Types
// ============================================================================

// Default extraction configuration
export const DEFAULT_CONFIG: ExtractionConfig = {
  provider: 'openai',
  model: '',
  promptVersion: '1.0.0',
  schemaVersion: '1.0.0',
};

export const OCR_CONFIDENCE_FIELD_JSON_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    value: {
      type: ['string', 'number', 'null'],
    },
    confidence: {
      type: 'number',
    },
  },
};

export const OCR_HOME_CURRENCY_JSON_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    currency: { type: 'string' },
    exchangeRate: { type: ['string', 'number'] },
    subtotal: { type: ['string', 'number', 'null'] },
    taxAmount: { type: ['string', 'number', 'null'] },
    totalAmount: { type: ['string', 'number'] },
    confidence: { type: 'number' },
  },
};

export const OCR_LINE_ITEM_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lineNo: { type: 'number' },
    description: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    quantity: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    unitPrice: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    amount: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    gstAmount: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    taxCode: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    accountCode: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
  },
  required: ['lineNo', 'description', 'amount'],
};

export const MISTRAL_DOCUMENT_EXTRACTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentCategory: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    documentSubCategory: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    vendorName: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    customerName: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    counterpartyIdentificationType: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    counterpartyIdentificationNumber: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    counterpartyAddress: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    counterpartyEmail: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    counterpartyPhone: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    documentNumber: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    documentDate: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    dueDate: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    currency: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    subtotal: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    taxAmount: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    totalAmount: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    supplierGstNo: OCR_CONFIDENCE_FIELD_JSON_SCHEMA,
    homeCurrencyEquivalent: OCR_HOME_CURRENCY_JSON_SCHEMA,
    lineItems: {
      type: 'array',
      items: OCR_LINE_ITEM_JSON_SCHEMA,
    },
    overallConfidence: {
      type: 'number',
    },
  },
  required: ['documentCategory', 'currency', 'totalAmount', 'lineItems', 'overallConfidence'],
};

export const MISTRAL_LINE_ITEM_ONLY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lineItems: {
      type: 'array',
      items: OCR_LINE_ITEM_JSON_SCHEMA,
    },
  },
  required: ['lineItems'],
};

export const LIGHTWEIGHT_COUNTERPARTY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    vendorName: { type: ['string', 'null'] },
    customerName: { type: ['string', 'null'] },
  },
  required: ['vendorName', 'customerName'],
};

export const LIGHTWEIGHT_COUNTERPARTY_MAX_OUTPUT_TOKENS = 80;
export const COUNTERPARTY_IDENTITY_PROMPT = `

## Counterparty Identity
Extract the external vendor/customer's identification data when visible. Prioritize UEN or registration identifiers, then preserve every available address, email, and phone value. Return confidence-bearing fields named counterpartyIdentificationType, counterpartyIdentificationNumber, counterpartyAddress, counterpartyEmail, and counterpartyPhone. Use UEN for Singapore entity registration numbers and OTHER for other organization registration identifiers. Do not return the uploading company's own identity.`;

export function withCounterpartyIdentityPrompt(prompt: string): string {
  return `${prompt.trim()}${COUNTERPARTY_IDENTITY_PROMPT}`;
}
export const LEARNING_CONTEXT_MAX_RECORDS = 3;
export const LEARNING_CONTEXT_FALLBACK_SCAN_LIMIT = 30;
export const LEARNING_CONTEXT_MAX_LINE_ITEMS_PER_RECORD = 8;
export const LEARNING_CONTEXT_DESCRIPTION_MAX_CHARS = 120;
export const LEARNING_CONTEXT_MAX_CHARS = 6000;

export function getDocumentMimeTypeFromStorageKey(storageKey: string): string {
  const normalizedStorageKey = storageKey.toLowerCase();

  if (normalizedStorageKey.endsWith('.pdf')) {
    return 'application/pdf';
  }

  if (normalizedStorageKey.endsWith('.jpg') || normalizedStorageKey.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  if (normalizedStorageKey.endsWith('.webp')) {
    return 'image/webp';
  }

  return 'image/png';
}

/**
 * Generate input fingerprint for reproducibility
 */
export function generateInputFingerprint(pageIds: string[], config: ExtractionConfig): string {
  return hashBlake3(JSON.stringify({ pageIds, config }));
}

/**
 * Build evidence JSON from extraction result
 */
export function buildEvidenceJson(result: FieldExtractionResult): Record<string, FieldEvidence | undefined> {
  const evidence: Record<string, FieldEvidence | undefined> = {};

  if (result.vendorName?.evidence) {
    evidence.vendorName = result.vendorName.evidence;
  }
  if (result.customerName?.evidence) {
    evidence.customerName = result.customerName.evidence;
  }
  if (result.counterpartyIdentificationType?.evidence) evidence.counterpartyIdentificationType = result.counterpartyIdentificationType.evidence;
  if (result.counterpartyIdentificationNumber?.evidence) evidence.counterpartyIdentificationNumber = result.counterpartyIdentificationNumber.evidence;
  if (result.counterpartyAddress?.evidence) evidence.counterpartyAddress = result.counterpartyAddress.evidence;
  if (result.counterpartyEmail?.evidence) evidence.counterpartyEmail = result.counterpartyEmail.evidence;
  if (result.counterpartyPhone?.evidence) evidence.counterpartyPhone = result.counterpartyPhone.evidence;
  if (result.documentNumber?.evidence) {
    evidence.documentNumber = result.documentNumber.evidence;
  }
  if (result.documentDate?.evidence) {
    evidence.documentDate = result.documentDate.evidence;
  }
  if (result.dueDate?.evidence) {
    evidence.dueDate = result.dueDate.evidence;
  }
  if (result.subtotal?.evidence) {
    evidence.subtotal = result.subtotal.evidence;
  }
  if (result.taxAmount?.evidence) {
    evidence.taxAmount = result.taxAmount.evidence;
  }
  if (result.totalAmount?.evidence) {
    evidence.totalAmount = result.totalAmount.evidence;
  }
  if (result.supplierGstNo?.evidence) {
    evidence.supplierGstNo = result.supplierGstNo.evidence;
  }

  // Log evidence summary for debugging
  log.debug('Built evidence JSON with fields:', Object.keys(evidence));

  return evidence;
}

/**
 * Build confidence JSON from extraction result
 */
export function buildConfidenceJson(result: FieldExtractionResult): Prisma.InputJsonValue {
  return {
    overall: result.overallConfidence,
    fields: {
      documentCategory: result.documentCategory.confidence,
      documentSubCategory: result.documentSubCategory?.confidence,
      vendorName: result.vendorName?.confidence,
      customerName: result.customerName?.confidence,
      counterpartyIdentificationNumber: result.counterpartyIdentificationNumber?.confidence,
      counterpartyAddress: result.counterpartyAddress?.confidence,
      counterpartyEmail: result.counterpartyEmail?.confidence,
      counterpartyPhone: result.counterpartyPhone?.confidence,
      documentNumber: result.documentNumber?.confidence,
      documentDate: result.documentDate?.confidence,
      currency: result.currency.confidence,
      totalAmount: result.totalAmount.confidence,
    },
  } as Prisma.InputJsonValue;
}

/**
 * Determine if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Non-retryable errors
    if (
      message.includes('pdf encrypted') ||
      message.includes('pdf corrupted') ||
      message.includes('unsupported')
    ) {
      return false;
    }
    // Retryable errors
    if (
      message.includes('timeout') ||
      message.includes('rate limit') ||
      message.includes('network') ||
      message.includes('temporary')
    ) {
      return true;
    }
  }
  // Default to retryable
  return true;
}

// Types are already exported via interface declarations
