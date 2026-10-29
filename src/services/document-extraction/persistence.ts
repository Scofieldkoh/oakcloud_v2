/** Persisting a completed extraction to the document, its extraction record and revision. */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import type { ExchangeRateSource } from '@/generated/prisma';
import { createRevision, type LineItemInput } from '@/services/document-revision.service';
import { transitionPipelineStatus, recordProcessingAttempt } from '@/services/document-processing.service';
import { checkForDuplicates, updateDuplicateStatus } from '@/services/duplicate-detection.service';
import { getRateWithPreference } from '@/services/exchange-rate.service';
import type { SupportedCurrency } from '@/lib/validations/exchange-rate';
import { resolveLookupDate } from '@/lib/date-lookup';
import { log, buildEvidenceJson, buildConfidenceJson } from './shared';
import { type FieldExtractionResult } from './types';
import { normalizeHeaderAmountsFromLineItems } from './mapping';

export async function persistCompletedExtraction(params: {
  processingDocumentId: string;
  tenantId: string;
  companyId: string;
  userId: string;
  extractionResult: FieldExtractionResult;
  modelUsed: string;
  providerUsed: string;
  promptVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  latencyMs: number;
}): Promise<{ extractionId: string; revisionId: string }> {
  const {
    processingDocumentId,
    tenantId,
    companyId,
    userId,
    extractionResult,
    modelUsed,
    providerUsed,
    promptVersion,
    schemaVersion,
    inputFingerprint,
    latencyMs,
  } = params;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { homeCurrency: true },
  });
  const companyHomeCurrency = company?.homeCurrency || 'SGD';
  const normalizedExtractionResult = normalizeHeaderAmountsFromLineItems(extractionResult);

  const evidenceJson = buildEvidenceJson(normalizedExtractionResult);

  const extraction = await prisma.documentExtraction.create({
    data: {
      processingDocumentId,
      extractionType: 'FIELDS',
      provider: providerUsed,
      model: modelUsed,
      promptVersion,
      extractionSchemaVersion: schemaVersion,
      inputFingerprint,
      rawJson: extractionResult as unknown as Prisma.InputJsonValue,
      confidenceJson: buildConfidenceJson(normalizedExtractionResult),
      evidenceJson: evidenceJson as Prisma.InputJsonValue,
      overallConfidence: normalizedExtractionResult.overallConfidence,
      latencyMs,
    },
  });

  const hce = normalizedExtractionResult.homeCurrencyEquivalent;
  const homeCurrency = companyHomeCurrency;
  const documentCurrency = normalizedExtractionResult.currency.value;
  const isSameCurrency = documentCurrency === homeCurrency;

  let exchangeRate: string;
  let exchangeRateSource: ExchangeRateSource = 'PROVIDER_DEFAULT';

  const hceExchangeRateValid = hce?.exchangeRate && hce?.currency === companyHomeCurrency;

  if (hceExchangeRateValid) {
    exchangeRate = hce.exchangeRate;
    exchangeRateSource = 'DOCUMENT';
  } else if (isSameCurrency) {
    // Legitimate rate=1 (document currency == home currency); no fallback.
    exchangeRate = '1';
    exchangeRateSource = 'PROVIDER_DEFAULT';
  } else {
    const lookupDate = resolveLookupDate(normalizedExtractionResult.documentDate?.value);
    const documentDate = lookupDate.date;
    const documentDateIso = lookupDate.isoDate;

    // Correlation context shared by every log emitted from this block so an
    // operator can alert on `event: 'fx_rate_fallback'` and immediately see
    // which tenant/document/currency was affected. Critical for detecting
    // systemic FX-sync outages — behavior still falls back to rate=1 so the
    // pipeline does not stall, but the degradation is no longer silent.
    const fxLogContext = {
      event: 'fx_rate_fallback' as const,
      tenantId,
      processingDocumentId,
      documentCurrency,
      homeCurrency: companyHomeCurrency,
      documentDate: documentDateIso,
      documentDateFallback: lookupDate.usedFallback,
    };

    if (lookupDate.usedFallback) {
      log.warn(
        `Invalid extraction document date "${lookupDate.rawValue ?? ''}" for ${processingDocumentId}; using ${documentDateIso} for FX lookup`,
        { ...fxLogContext, reason: 'invalid_document_date' }
      );
    }

    try {
      const rateResult = await getRateWithPreference(
        documentCurrency as SupportedCurrency,
        companyHomeCurrency as SupportedCurrency,
        documentDate,
        tenantId
      );

      if (rateResult) {
        exchangeRate = rateResult.rate.toString();
        if (rateResult.rateType === 'MAS_DAILY_RATE') {
          exchangeRateSource = 'MAS_DAILY';
        } else if (rateResult.rateType === 'MAS_MONTHLY_RATE') {
          exchangeRateSource = 'IRAS_MONTHLY_AVG';
        } else if (rateResult.rateType === 'MANUAL_RATE') {
          exchangeRateSource = 'MANUAL';
        } else {
          exchangeRateSource = 'PROVIDER_DEFAULT';
        }
        log.info(
          `Exchange rate resolved for ${documentCurrency} on ${documentDateIso}: ${exchangeRate} (source: ${exchangeRateSource})`
        );
      } else {
        exchangeRate = '1';
        exchangeRateSource = 'PROVIDER_DEFAULT';
        log.warn(
          `FX fallback: no rate found for ${documentCurrency} on ${documentDateIso}, coerced to 1`,
          { ...fxLogContext, reason: 'rate_not_found' }
        );
      }
    } catch (rateError) {
      exchangeRate = '1';
      exchangeRateSource = 'PROVIDER_DEFAULT';
      log.error(
        `FX fallback: lookup threw for ${documentCurrency} on ${documentDateIso}, coerced to 1`,
        {
          ...fxLogContext,
          reason: 'lookup_threw',
          errorMessage: rateError instanceof Error ? rateError.message : String(rateError),
        }
      );
    }
  }
  const exchangeRateNum = parseFloat(exchangeRate);

  const hceMatchesHomeCurrency = hce?.currency === companyHomeCurrency;
  const useExtractedHce = hceMatchesHomeCurrency && hce;

  const lineItemInputs = normalizedExtractionResult.lineItems?.map((item) => {
    const amount = parseFloat(item.amount.value) || 0;
    const gstAmount = item.gstAmount?.value ? parseFloat(item.gstAmount.value) : 0;

    return {
      lineNo: item.lineNo,
      description: item.description.value,
      quantity: item.quantity?.value,
      unitPrice: item.unitPrice?.value,
      amount: item.amount.value,
      gstAmount: item.gstAmount?.value,
      taxCode: item.taxCode?.value,
      accountCode: item.accountCode?.value,
      evidenceJson: {
        description: item.description.evidence,
        amount: item.amount.evidence,
      },
      homeAmount: (amount * exchangeRateNum).toFixed(2),
      homeGstAmount: (gstAmount * exchangeRateNum).toFixed(2),
    };
  }) as LineItemInput[] | undefined;

  const homeSubtotalFromLines = lineItemInputs?.reduce(
    (sum, item) => sum + (parseFloat(String(item.homeAmount)) || 0),
    0
  );
  const homeTaxFromLines = lineItemInputs?.reduce(
    (sum, item) => sum + (parseFloat(String(item.homeGstAmount)) || 0),
    0
  );
  const homeTotalFromLines =
    homeSubtotalFromLines !== undefined && homeTaxFromLines !== undefined
      ? homeSubtotalFromLines + homeTaxFromLines
      : undefined;

  const homeSubtotal = homeSubtotalFromLines !== undefined
    ? homeSubtotalFromLines.toFixed(2)
    : (useExtractedHce && hce?.subtotal) ||
      (normalizedExtractionResult.subtotal?.value
        ? (parseFloat(normalizedExtractionResult.subtotal.value) * exchangeRateNum).toFixed(2)
        : undefined);
  const homeTaxAmount = homeTaxFromLines !== undefined
    ? homeTaxFromLines.toFixed(2)
    : (useExtractedHce && hce?.taxAmount) ||
      (normalizedExtractionResult.taxAmount?.value
        ? (parseFloat(normalizedExtractionResult.taxAmount.value) * exchangeRateNum).toFixed(2)
        : undefined);
  const homeEquivalent = homeTotalFromLines !== undefined
    ? homeTotalFromLines.toFixed(2)
    : (useExtractedHce && hce?.totalAmount) ||
      (parseFloat(normalizedExtractionResult.totalAmount.value) * exchangeRateNum).toFixed(2);

  const isReceivable = normalizedExtractionResult.documentCategory.value === 'ACCOUNTS_RECEIVABLE';
  const rawCounterpartyName = isReceivable
    ? normalizedExtractionResult.customerName?.value ?? normalizedExtractionResult.vendorName?.value
    : normalizedExtractionResult.vendorName?.value;

  const revision = await createRevision({
    processingDocumentId,
    revisionType: 'EXTRACTION',
    extractionId: extraction.id,
    createdById: userId,
    documentCategory: normalizedExtractionResult.documentCategory.value,
    documentSubCategory: normalizedExtractionResult.documentSubCategory?.value,
    vendorName: rawCounterpartyName,
    customerName: isReceivable ? rawCounterpartyName : undefined,
    counterpartyIdentity: normalizedExtractionResult.counterpartyIdentity,
    documentNumber: normalizedExtractionResult.documentNumber?.value,
    documentDate: normalizedExtractionResult.documentDate?.value
      ? new Date(normalizedExtractionResult.documentDate.value)
      : undefined,
    dueDate: normalizedExtractionResult.dueDate?.value
      ? new Date(normalizedExtractionResult.dueDate.value)
      : normalizedExtractionResult.documentDate?.value
        ? new Date(normalizedExtractionResult.documentDate.value)
        : undefined,
    currency: normalizedExtractionResult.currency.value,
    subtotal: normalizedExtractionResult.subtotal?.value,
    taxAmount: normalizedExtractionResult.taxAmount?.value,
    totalAmount: normalizedExtractionResult.totalAmount.value,
    supplierGstNo: normalizedExtractionResult.supplierGstNo?.value,
    homeCurrency,
    homeExchangeRate: exchangeRate,
    homeExchangeRateSource: exchangeRateSource,
    homeSubtotal,
    homeTaxAmount,
    homeEquivalent,
    headerEvidenceJson: evidenceJson,
    items: lineItemInputs,
    reason: 'initial_extraction',
  });

  await prisma.processingDocument.update({
    where: { id: processingDocumentId },
    data: {
      currentRevisionId: revision.id,
      lockVersion: { increment: 1 },
    },
  });

  await transitionPipelineStatus(processingDocumentId, 'EXTRACTION_DONE', tenantId, companyId);

  await recordProcessingAttempt(processingDocumentId, 'FIELD_EXTRACTION', 'SUCCEEDED', {
    providerLatencyMs: latencyMs,
  });

  try {
    const duplicateResult = await checkForDuplicates(processingDocumentId, tenantId, companyId);
    if (duplicateResult.hasPotentialDuplicate) {
      await updateDuplicateStatus(processingDocumentId, duplicateResult);
      log.info(
        `Post-extraction duplicate check found ${duplicateResult.candidates.length} candidates ` +
          `for ${processingDocumentId}`
      );
    }
  } catch (dupError) {
    log.warn(`Post-extraction duplicate check failed for ${processingDocumentId}:`, dupError);
  }

  log.info(`Field extraction completed for ${processingDocumentId}, revision ${revision.id} created`);

  return {
    extractionId: extraction.id,
    revisionId: revision.id,
  };
}
