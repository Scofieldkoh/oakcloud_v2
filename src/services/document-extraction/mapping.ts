/** Mapping AI extraction responses to field results, line items and evidence. */

import type { DocumentCategory, DocumentSubCategory } from '@/generated/prisma';
import {
  normalizeCounterpartyIdentityDraft,
  type CounterpartyIdentityDraft,
} from '@/services/document-revision.service';
import { getCatchAllSubCategory, isValidSubCategoryForCategory } from '@/lib/document-categories';
import { log } from './shared';
import {
  type FieldEvidence,
  type ExtractedField,
  type HomeCurrencyEquivalent,
  type FieldExtractionResult,
} from './types';

// Type for AI field response
interface AIFieldValue {
  value: string | number;
  confidence?: number;
}

/**
 * Create field evidence from extraction data
 * Note: Bounding box highlighting is now done via PDF text layer search,
 * so we no longer store bbox data in evidence
 */
function createFieldEvidence(
  text: string,
  confidence: number,
  pageNum: number,
  fingerprint: string
): FieldEvidence {
  return {
    containerPageNumber: pageNum,
    childPageNumber: 1,
    text,
    confidence,
    coordSpace: 'RENDERED_IMAGE',
    renderFingerprint: fingerprint,
    // bbox is no longer used - highlighting uses PDF text layer
  };
}

/**
 * Extract value from AI field response
 */
function extractFieldValue(field: unknown): { value: string; confidence: number } | null {
  if (!field) return null;

  // Object format: { value, confidence }
  if (typeof field === 'object' && 'value' in (field as object)) {
    const f = field as AIFieldValue;
    // Handle null/undefined values - return null if value is actually null
    if (f.value === null || f.value === undefined || f.value === 'null') {
      return null;
    }
    return {
      value: String(f.value),
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.8,
    };
  }

  // Plain value format
  return { value: String(field), confidence: 0.8 };
}

function normalizeExtractedLineNo(field: unknown, fallback: number): number {
  const extracted = extractFieldValue(field);
  const parsed = extracted ? Number(extracted.value) : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function mapCounterpartyIdentityDraft(
  data: Record<string, unknown>,
  _pages: { pageNumber: number; storageKey: string | null; imageFingerprint: string | null }[] = [],
): CounterpartyIdentityDraft {
  const identificationType = extractFieldValue(data.counterpartyIdentificationType);
  const identificationNumber = extractFieldValue(data.counterpartyIdentificationNumber);
  const fullAddress = extractFieldValue(data.counterpartyAddress);
  const email = extractFieldValue(data.counterpartyEmail);
  const phone = extractFieldValue(data.counterpartyPhone);
  return normalizeCounterpartyIdentityDraft({
    identificationType: identificationType?.value,
    identificationNumber: identificationNumber?.value,
    fullAddress: fullAddress?.value,
    email: email?.value,
    phone: phone?.value,
    confidence: {
      identificationNumber: identificationNumber?.confidence,
      fullAddress: fullAddress?.confidence,
      email: email?.confidence,
      phone: phone?.confidence,
    },
  });
}

export function mapLineItemsFromAIData(
  rawLineItems: Array<Record<string, unknown>>,
  pageNum: number,
  fingerprint: string,
  hasGstRegistration: boolean
): NonNullable<FieldExtractionResult['lineItems']> {
  return rawLineItems.map((item, idx) => {
    const descField = extractFieldValue(item.description);
    const qtyField = extractFieldValue(item.quantity);
    const unitPriceField = extractFieldValue(item.unitPrice);
    const amountField = extractFieldValue(item.amount);
    const gstAmountField = extractFieldValue(item.gstAmount);
    const taxCodeField = extractFieldValue(item.taxCode);
    const accountCodeField = extractFieldValue(item.accountCode);

    let taxCode = taxCodeField?.value;
    let taxCodeConfidence = taxCodeField?.confidence || 0.7;

    if (!taxCode) {
      const gstAmountNum = gstAmountField?.value ? parseFloat(gstAmountField.value) : 0;
      const amountNum = amountField?.value ? parseFloat(amountField.value) : 0;

      if (gstAmountNum > 0 && amountNum > 0) {
        const actualRate = gstAmountNum / amountNum;

        if (actualRate >= 0.085 && actualRate <= 0.095) {
          taxCode = 'SR';
          taxCodeConfidence = 0.9;
        } else if (actualRate >= 0.075 && actualRate < 0.085) {
          taxCode = 'SR8';
          taxCodeConfidence = 0.9;
        } else if (actualRate >= 0.065 && actualRate < 0.075) {
          taxCode = 'SR7';
          taxCodeConfidence = 0.9;
        } else if (actualRate < 0.005) {
          taxCode = hasGstRegistration ? 'ZR' : 'NA';
          taxCodeConfidence = 0.75;
        } else {
          taxCode = 'SR';
          taxCodeConfidence = 0.6;
          log.debug(`Line item has unusual GST rate: ${(actualRate * 100).toFixed(2)}%`);
        }
      } else if (gstAmountNum > 0) {
        taxCode = 'SR';
        taxCodeConfidence = 0.8;
      } else if (hasGstRegistration) {
        taxCode = 'SR';
        taxCodeConfidence = 0.75;
      } else {
        taxCode = 'NA';
        taxCodeConfidence = 0.6;
      }
    }

    let gstAmount = gstAmountField?.value;
    let gstAmountConfidence = gstAmountField?.confidence || 0.8;

    if (!gstAmount && amountField?.value) {
      const amount = parseFloat(amountField.value);
      if (!isNaN(amount) && amount > 0) {
        let gstRate = 0;
        if (taxCode === 'SR') gstRate = 0.09;
        else if (taxCode === 'SR8') gstRate = 0.08;
        else if (taxCode === 'SR7') gstRate = 0.07;

        if (gstRate > 0) {
          gstAmount = (amount * gstRate).toFixed(2);
          gstAmountConfidence = 0.7;
        }
      }
    }

    let quantity = qtyField?.value;
    let quantityConfidence = qtyField?.confidence || 0.8;
    let unitPrice = unitPriceField?.value;
    let unitPriceConfidence = unitPriceField?.confidence || 0.8;

    if (!quantity && !unitPrice && amountField?.value) {
      quantity = '1';
      quantityConfidence = 0.6;
      unitPrice = amountField.value;
      unitPriceConfidence = 0.6;
    }

    let accountCode = accountCodeField?.value;
    let accountCodeConfidence = accountCodeField?.confidence || 0.8;

    if (!accountCode && descField?.value) {
      const desc = descField.value.toLowerCase();
      const expenseKeywords = [
        'subscription', 'software', 'saas', 'cloud', 'hosting', 'domain',
        'service', 'consulting', 'professional', 'legal', 'accounting',
        'office', 'supplies', 'utilities', 'rent', 'maintenance',
        'marketing', 'advertising', 'promotion', 'travel', 'transport',
        'insurance', 'license', 'fee', 'training', 'education'
      ];
      const cogsKeywords = [
        'purchase', 'inventory', 'goods', 'materials', 'raw material',
        'stock', 'manufacturing', 'production'
      ];

      if (cogsKeywords.some((kw) => desc.includes(kw))) {
        accountCode = '5000';
        accountCodeConfidence = 0.5;
      } else if (expenseKeywords.some((kw) => desc.includes(kw))) {
        accountCode = '6000';
        accountCodeConfidence = 0.5;
      }
    }

    return {
      lineNo: normalizeExtractedLineNo(item.lineNo, idx + 1),
      description: {
        value: descField?.value || 'Unknown',
        confidence: descField?.confidence || 0.9,
        evidence: descField
          ? createFieldEvidence(descField.value, descField.confidence || 0.9, pageNum, fingerprint)
          : undefined,
      },
      quantity: quantity ? { value: quantity, confidence: quantityConfidence } : undefined,
      unitPrice: unitPrice ? { value: unitPrice, confidence: unitPriceConfidence } : undefined,
      amount: {
        value: amountField?.value || '0',
        confidence: amountField?.confidence || 0.9,
        evidence: amountField
          ? createFieldEvidence(amountField.value, amountField.confidence || 0.9, pageNum, fingerprint)
          : undefined,
      },
      gstAmount: gstAmount ? { value: gstAmount, confidence: gstAmountConfidence } : undefined,
      taxCode: { value: taxCode, confidence: taxCodeConfidence },
      accountCode: accountCode ? { value: accountCode, confidence: accountCodeConfidence } : undefined,
    };
  });
}

function normalizeDocumentSubCategory(
  rawValue: string | undefined,
  category: DocumentCategory
): DocumentSubCategory | undefined {
  if (!rawValue) return undefined;

  const normalized = rawValue.trim().toUpperCase().replace(/[\s-]+/g, '_');

  if (isValidSubCategoryForCategory(category, normalized as DocumentSubCategory)) {
    return normalized as DocumentSubCategory;
  }

  switch (normalized) {
    case 'INVOICE':
      if (category === 'ACCOUNTS_RECEIVABLE') return 'SALES_INVOICE';
      if (category === 'TAX_COMPLIANCE') return 'OTHERS_TAX_COMPLIANCE';
      return 'VENDOR_INVOICE';
    case 'CREDIT_NOTE':
      return category === 'ACCOUNTS_RECEIVABLE' ? 'SALES_CREDIT_NOTE' : 'VENDOR_CREDIT_NOTE';
    case 'DEBIT_NOTE':
      return category === 'ACCOUNTS_RECEIVABLE' ? 'SALES_INVOICE' : 'VENDOR_INVOICE';
    case 'STATEMENT':
      if (category === 'ACCOUNTS_RECEIVABLE') return 'CUSTOMER_STATEMENT';
      if (category === 'TREASURY') return 'BANK_STATEMENT';
      return 'VENDOR_STATEMENT';
    case 'RECEIPT':
      return category === 'TAX_COMPLIANCE' ? 'OTHERS_TAX_COMPLIANCE' : 'RECEIPT_VOUCHER';
    case 'PAYMENT':
    case 'PAYMENT_VOUCHER':
      return category === 'TREASURY' ? 'PAYMENT_VOUCHER' : getCatchAllSubCategory(category) ?? undefined;
    case 'ORDER':
    case 'PURCHASE_ORDER':
      return category === 'ACCOUNTS_RECEIVABLE' ? 'SALES_ORDER' : 'PURCHASE_ORDER';
    case 'DELIVERY':
    case 'DELIVERY_NOTE':
      return category === 'ACCOUNTS_RECEIVABLE' ? 'DELIVERY_ORDER' : 'DELIVERY_NOTE';
    case 'QUOTATION':
    case 'QUOTE':
      return category === 'ACCOUNTS_RECEIVABLE'
        ? 'SALES_ORDER'
        : 'VENDOR_QUOTATION';
    default:
      return getCatchAllSubCategory(category) ?? undefined;
  }
}

function parseAmountString(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function amountsDiffer(a: string | undefined, b: string | undefined, tolerance = 0.005): boolean {
  const parsedA = parseAmountString(a);
  const parsedB = parseAmountString(b);

  if (parsedA === null || parsedB === null) {
    return a !== b;
  }

  return Math.abs(parsedA - parsedB) > tolerance;
}

export function normalizeHeaderAmountsFromLineItems(result: FieldExtractionResult): FieldExtractionResult {
  if (!result.lineItems || result.lineItems.length === 0) {
    return result;
  }

  const subtotalFromLines = result.lineItems.reduce(
    (sum, item) => sum + (parseAmountString(item.amount.value) ?? 0),
    0
  );
  const taxFromLines = result.lineItems.reduce(
    (sum, item) => sum + (parseAmountString(item.gstAmount?.value) ?? 0),
    0
  );
  const totalFromLines = subtotalFromLines + taxFromLines;

  const computedSubtotal = subtotalFromLines.toFixed(2);
  const computedTax = taxFromLines.toFixed(2);
  const computedTotal = totalFromLines.toFixed(2);

  const shouldNormalizeSubtotal =
    !result.subtotal?.value || amountsDiffer(result.subtotal.value, computedSubtotal);
  const shouldNormalizeTax =
    result.taxAmount?.value === undefined || amountsDiffer(result.taxAmount.value, computedTax);
  const shouldNormalizeTotal = amountsDiffer(result.totalAmount.value, computedTotal);

  if (!shouldNormalizeSubtotal && !shouldNormalizeTax && !shouldNormalizeTotal) {
    return result;
  }

  return {
    ...result,
    subtotal: shouldNormalizeSubtotal
      ? {
          value: computedSubtotal,
          confidence: result.subtotal?.confidence ?? 0.75,
        }
      : result.subtotal,
    taxAmount: shouldNormalizeTax
      ? {
          value: computedTax,
          confidence: result.taxAmount?.confidence ?? 0.75,
        }
      : result.taxAmount,
    totalAmount: shouldNormalizeTotal
      ? {
          ...result.totalAmount,
          value: computedTotal,
        }
      : result.totalAmount,
  };
}

/**
 * Map AI response to FieldExtractionResult format
 */
export function mapAIResponseToResult(
  data: Record<string, unknown>,
  pages: { pageNumber: number; storageKey: string | null; imageFingerprint: string | null }[]
): FieldExtractionResult {
  const pageNum = pages[0]?.pageNumber ?? 1;
  const fingerprint = pages[0]?.imageFingerprint ?? '';

  // Handle documentCategory (required field)
  const docCategory = extractFieldValue(data.documentCategory);
  const documentCategory: ExtractedField<DocumentCategory> = {
    value: (docCategory?.value as DocumentCategory) || 'OTHER',
    confidence: docCategory?.confidence || 0.8,
  };

  // Handle documentSubCategory (optional field)
  const docSubCategory = extractFieldValue(data.documentSubCategory);
  const normalizedSubCategory = normalizeDocumentSubCategory(
    docSubCategory?.value,
    documentCategory.value
  );
  const documentSubCategory: ExtractedField<DocumentSubCategory> | undefined = docSubCategory
    && normalizedSubCategory
    ? {
        value: normalizedSubCategory,
        confidence: docSubCategory.confidence || 0.8,
      }
    : undefined;

  // Handle optional header fields with bbox
  const vendorNameField = extractFieldValue(data.vendorName);
  const customerNameField = extractFieldValue(data.customerName);
  const counterpartyIdentificationTypeField = extractFieldValue(data.counterpartyIdentificationType);
  const counterpartyIdentificationNumberField = extractFieldValue(data.counterpartyIdentificationNumber);
  const counterpartyAddressField = extractFieldValue(data.counterpartyAddress);
  const counterpartyEmailField = extractFieldValue(data.counterpartyEmail);
  const counterpartyPhoneField = extractFieldValue(data.counterpartyPhone);
  const documentNumberField = extractFieldValue(data.documentNumber);
  const documentDateField = extractFieldValue(data.documentDate);
  const dueDateField = extractFieldValue(data.dueDate);
  const currencyField = extractFieldValue(data.currency);
  const subtotalField = extractFieldValue(data.subtotal);
  const taxAmountField = extractFieldValue(data.taxAmount);
  const totalAmountField = extractFieldValue(data.totalAmount);
  const supplierGstNoField = extractFieldValue(data.supplierGstNo);

  // Determine if document has GST registration (to infer default tax code)
  const hasGstRegistration = !!supplierGstNoField?.value;

  // Map line items with bbox support and GST code assignment
  const rawLineItems = data.lineItems as Array<Record<string, unknown>> || [];
  const lineItems = rawLineItems.map((item, idx) => {
    const descField = extractFieldValue(item.description);
    const qtyField = extractFieldValue(item.quantity);
    const unitPriceField = extractFieldValue(item.unitPrice);
    const amountField = extractFieldValue(item.amount);
    const gstAmountField = extractFieldValue(item.gstAmount);
    const taxCodeField = extractFieldValue(item.taxCode);
    const accountCodeField = extractFieldValue(item.accountCode);

    // Determine tax code with intelligent fallback based on actual GST percentage
    let taxCode = taxCodeField?.value;
    let taxCodeConfidence = taxCodeField?.confidence || 0.7;

    if (!taxCode) {
      // Apply fallback logic based on actual GST percentage calculation
      const gstAmountNum = gstAmountField?.value ? parseFloat(gstAmountField.value) : 0;
      const amountNum = amountField?.value ? parseFloat(amountField.value) : 0;

      if (gstAmountNum > 0 && amountNum > 0) {
        // Calculate actual GST rate from amounts
        const actualRate = gstAmountNum / amountNum;

        // Determine GST code based on actual rate with tolerance bands
        if (actualRate >= 0.085 && actualRate <= 0.095) {
          // 8.5% to 9.5% â†’ SR (9%)
          taxCode = 'SR';
          taxCodeConfidence = 0.9; // High confidence when calculated from actual amounts
        } else if (actualRate >= 0.075 && actualRate < 0.085) {
          // 7.5% to 8.5% â†’ SR8 (8%)
          taxCode = 'SR8';
          taxCodeConfidence = 0.9;
        } else if (actualRate >= 0.065 && actualRate < 0.075) {
          // 6.5% to 7.5% â†’ SR7 (7%)
          taxCode = 'SR7';
          taxCodeConfidence = 0.9;
        } else if (actualRate < 0.005) {
          // Less than 0.5% â†’ Zero-rated or NA
          taxCode = hasGstRegistration ? 'ZR' : 'NA';
          taxCodeConfidence = 0.75;
        } else {
          // Other rates - default to SR but lower confidence
          taxCode = 'SR';
          taxCodeConfidence = 0.6;
          log.debug(`Line item has unusual GST rate: ${(actualRate * 100).toFixed(2)}%`);
        }
      } else if (gstAmountNum > 0) {
        // Has GST amount but no base amount to calculate rate â†’ Standard-Rated
        taxCode = 'SR';
        taxCodeConfidence = 0.8;
      } else if (hasGstRegistration) {
        // Supplier is GST registered â†’ default to Standard-Rated
        taxCode = 'SR';
        taxCodeConfidence = 0.75;
      } else {
        // No GST registration â†’ Not Applicable
        taxCode = 'NA';
        taxCodeConfidence = 0.6;
      }
    }

    // Calculate GST amount if not provided but tax code indicates GST applies
    let gstAmount = gstAmountField?.value;
    let gstAmountConfidence = gstAmountField?.confidence || 0.8;

    if (!gstAmount && amountField?.value) {
      const amount = parseFloat(amountField.value);
      if (!isNaN(amount) && amount > 0) {
        // Determine rate based on tax code
        let gstRate = 0;
        if (taxCode === 'SR') gstRate = 0.09;
        else if (taxCode === 'SR8') gstRate = 0.08;
        else if (taxCode === 'SR7') gstRate = 0.07;

        if (gstRate > 0) {
          gstAmount = (amount * gstRate).toFixed(2);
          gstAmountConfidence = 0.7; // Lower confidence for calculated values
        }
      }
    }

    // Default qty=1 and unitPrice=amount when both are not provided
    let quantity = qtyField?.value;
    let quantityConfidence = qtyField?.confidence || 0.8;
    let unitPrice = unitPriceField?.value;
    let unitPriceConfidence = unitPriceField?.confidence || 0.8;

    if (!quantity && !unitPrice && amountField?.value) {
      // When qty and unitPrice are not extracted, default qty=1 and unitPrice=amount
      quantity = '1';
      quantityConfidence = 0.6; // Lower confidence for defaulted values
      unitPrice = amountField.value;
      unitPriceConfidence = 0.6;
    }

    // Fallback account code suggestion based on description keywords
    let accountCode = accountCodeField?.value;
    let accountCodeConfidence = accountCodeField?.confidence || 0.8;

    if (!accountCode && descField?.value) {
      const desc = descField.value.toLowerCase();
      // Common keyword mappings for expenses (6xxx range)
      const expenseKeywords = [
        'subscription', 'software', 'saas', 'cloud', 'hosting', 'domain',
        'service', 'consulting', 'professional', 'legal', 'accounting',
        'office', 'supplies', 'utilities', 'rent', 'maintenance',
        'marketing', 'advertising', 'promotion', 'travel', 'transport',
        'insurance', 'license', 'fee', 'training', 'education'
      ];
      // Common keywords for COGS (5xxx range)
      const cogsKeywords = [
        'purchase', 'inventory', 'goods', 'materials', 'raw material',
        'stock', 'manufacturing', 'production'
      ];

      if (cogsKeywords.some(kw => desc.includes(kw))) {
        // Suggest a COGS account - user should have one in 5xxx range
        accountCode = '5000'; // Generic COGS
        accountCodeConfidence = 0.5;
      } else if (expenseKeywords.some(kw => desc.includes(kw))) {
        // Suggest a general expense account - user should have one in 6xxx range
        accountCode = '6000'; // Generic expense
        accountCodeConfidence = 0.5;
      }
    }

    return {
      lineNo: normalizeExtractedLineNo(item.lineNo, idx + 1),
      description: {
        value: descField?.value || 'Unknown',
        confidence: descField?.confidence || 0.9,
        evidence: descField ? createFieldEvidence(descField.value, descField.confidence || 0.9, pageNum, fingerprint) : undefined,
      },
      quantity: quantity ? { value: quantity, confidence: quantityConfidence } : undefined,
      unitPrice: unitPrice ? { value: unitPrice, confidence: unitPriceConfidence } : undefined,
      amount: {
        value: amountField?.value || '0',
        confidence: amountField?.confidence || 0.9,
        evidence: amountField ? createFieldEvidence(amountField.value, amountField.confidence || 0.9, pageNum, fingerprint) : undefined,
      },
      gstAmount: gstAmount ? { value: gstAmount, confidence: gstAmountConfidence } : undefined,
      taxCode: { value: taxCode, confidence: taxCodeConfidence },
      accountCode: accountCode ? { value: accountCode, confidence: accountCodeConfidence } : undefined,
    };
  });

  // Get overall confidence from data or calculate default
  const overallConfidence = typeof data.overallConfidence === 'number' ? data.overallConfidence : 0.8;

  return {
    documentCategory,
    documentSubCategory,
    vendorName: vendorNameField ? {
      value: vendorNameField.value,
      confidence: vendorNameField.confidence,
      evidence: createFieldEvidence(vendorNameField.value, vendorNameField.confidence, pageNum, fingerprint),
    } : undefined,
    customerName: customerNameField ? {
      value: customerNameField.value,
      confidence: customerNameField.confidence,
      evidence: createFieldEvidence(customerNameField.value, customerNameField.confidence, pageNum, fingerprint),
    } : undefined,
    counterpartyIdentificationType: counterpartyIdentificationTypeField ? {
      value: counterpartyIdentificationTypeField.value,
      confidence: counterpartyIdentificationTypeField.confidence,
      evidence: createFieldEvidence(counterpartyIdentificationTypeField.value, counterpartyIdentificationTypeField.confidence, pageNum, fingerprint),
    } : undefined,
    counterpartyIdentificationNumber: counterpartyIdentificationNumberField ? {
      value: counterpartyIdentificationNumberField.value,
      confidence: counterpartyIdentificationNumberField.confidence,
      evidence: createFieldEvidence(counterpartyIdentificationNumberField.value, counterpartyIdentificationNumberField.confidence, pageNum, fingerprint),
    } : undefined,
    counterpartyAddress: counterpartyAddressField ? {
      value: counterpartyAddressField.value,
      confidence: counterpartyAddressField.confidence,
      evidence: createFieldEvidence(counterpartyAddressField.value, counterpartyAddressField.confidence, pageNum, fingerprint),
    } : undefined,
    counterpartyEmail: counterpartyEmailField ? {
      value: counterpartyEmailField.value,
      confidence: counterpartyEmailField.confidence,
      evidence: createFieldEvidence(counterpartyEmailField.value, counterpartyEmailField.confidence, pageNum, fingerprint),
    } : undefined,
    counterpartyPhone: counterpartyPhoneField ? {
      value: counterpartyPhoneField.value,
      confidence: counterpartyPhoneField.confidence,
      evidence: createFieldEvidence(counterpartyPhoneField.value, counterpartyPhoneField.confidence, pageNum, fingerprint),
    } : undefined,
    counterpartyIdentity: mapCounterpartyIdentityDraft(data, pages),
    documentNumber: documentNumberField ? {
      value: documentNumberField.value,
      confidence: documentNumberField.confidence,
      evidence: createFieldEvidence(documentNumberField.value, documentNumberField.confidence, pageNum, fingerprint),
    } : undefined,
    documentDate: documentDateField ? {
      value: documentDateField.value,
      confidence: documentDateField.confidence,
      evidence: createFieldEvidence(documentDateField.value, documentDateField.confidence, pageNum, fingerprint),
    } : undefined,
    dueDate: dueDateField ? {
      value: dueDateField.value,
      confidence: dueDateField.confidence,
      evidence: createFieldEvidence(dueDateField.value, dueDateField.confidence, pageNum, fingerprint),
    } : undefined,
    currency: {
      value: currencyField?.value || 'SGD',
      confidence: currencyField?.confidence || 0.9,
    },
    subtotal: subtotalField ? {
      value: subtotalField.value,
      confidence: subtotalField.confidence,
      evidence: createFieldEvidence(subtotalField.value, subtotalField.confidence, pageNum, fingerprint),
    } : undefined,
    taxAmount: taxAmountField ? {
      value: taxAmountField.value,
      confidence: taxAmountField.confidence,
      evidence: createFieldEvidence(taxAmountField.value, taxAmountField.confidence, pageNum, fingerprint),
    } : undefined,
    totalAmount: {
      value: totalAmountField?.value || '0',
      confidence: totalAmountField?.confidence || 0.8,
      evidence: createFieldEvidence(`Total: ${totalAmountField?.value || '0'}`, totalAmountField?.confidence || 0.8, pageNum, fingerprint),
    },
    supplierGstNo: supplierGstNoField ? {
      value: supplierGstNoField.value,
      confidence: supplierGstNoField.confidence,
      evidence: createFieldEvidence(supplierGstNoField.value, supplierGstNoField.confidence, pageNum, fingerprint),
    } : undefined,
    homeCurrencyEquivalent: extractHomeCurrencyEquivalent(
      data.homeCurrencyEquivalent,
      totalAmountField?.value
    ),
    lineItems: lineItems.length > 0 ? lineItems : undefined,
    overallConfidence,
  };
}

/**
 * Extract home currency equivalent from AI response
 * If exchange rate is not provided, calculate it from document total / home total
 * @param data - The homeCurrencyEquivalent object from AI response
 * @param documentTotalAmount - The document's total amount (in document currency)
 */
function extractHomeCurrencyEquivalent(
  data: unknown,
  documentTotalAmount?: string
): HomeCurrencyEquivalent | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const hce = data as Record<string, unknown>;

  // Check if we have required fields
  if (!hce.currency || !hce.totalAmount) return undefined;

  const homeTotalStr = String(hce.totalAmount);
  let exchangeRate: string;

  if (hce.exchangeRate) {
    // Use the exchange rate from the document
    exchangeRate = String(hce.exchangeRate);
  } else if (documentTotalAmount) {
    // Calculate exchange rate: homeTotal / documentTotal (to 6 decimal places)
    const docTotal = parseFloat(documentTotalAmount);
    const homeTotal = parseFloat(homeTotalStr);
    if (docTotal > 0 && homeTotal > 0) {
      exchangeRate = (homeTotal / docTotal).toFixed(6);
    } else {
      exchangeRate = '1';
    }
  } else {
    exchangeRate = '1';
  }

  return {
    currency: String(hce.currency),
    exchangeRate,
    subtotal: hce.subtotal ? String(hce.subtotal) : undefined,
    taxAmount: hce.taxAmount ? String(hce.taxAmount) : undefined,
    totalAmount: homeTotalStr,
    confidence: typeof hce.confidence === 'number' ? hce.confidence : 0.8,
  };
}
