/**
 * Prompt building and the AI extraction call, including the chunked Mistral
 * line-item fallback.
 */

import {
  callAIWithConnector,
  getBestAvailableModelForWorkspace,
  getDocumentInputModeForModel,
  logExtractionResults,
  isAIDebugEnabled,
  stripMarkdownCodeBlocks,
} from '@/lib/ai';
import { prepareImageUrlVisionInput } from '@/lib/ai/vision-input';
import { PDFDocument } from 'pdf-lib';
import {
  extractStructuredWithMistralOCR,
  MISTRAL_OCR_MODEL_ID,
  MistralOCRNotConfiguredError,
} from '@/lib/ocr/mistral';
import { storage } from '@/lib/storage';
import { getAccountsForSelect } from '@/services/chart-of-accounts.service';
import { resolveDocumentExtractionPrompt } from '@/services/document-extraction-prompt-settings.service';
import {
  log,
  MISTRAL_DOCUMENT_EXTRACTION_JSON_SCHEMA,
  MISTRAL_LINE_ITEM_ONLY_JSON_SCHEMA,
  withCounterpartyIdentityPrompt,
  getDocumentMimeTypeFromStorageKey,
} from './shared';
import { type ExtractionConfig, type FieldExtractionResult } from './types';
import { mapLineItemsFromAIData, mapAIResponseToResult } from './mapping';

interface AIExtractionResult {
  result: FieldExtractionResult;
  modelUsed: string;
  providerUsed: string;
}

/**
 * Get Chart of Accounts context for AI extraction.
 * Returns accounts in the 4xxx-8xxx range (Revenue, COGS, Expenses)
 * formatted as a string for the AI prompt.
 */
async function getCOAContextForExtraction(
  tenantId: string,
  companyId?: string | null
): Promise<string> {
  try {
    // Fetch accounts for the tenant (includes system accounts)
    const accounts = await getAccountsForSelect(tenantId, companyId);

    // Filter to relevant ranges: 4xxx (Revenue), 5xxx (COGS), 6xxx-8xxx (Expenses)
    const relevantAccounts = accounts.filter((acc) => {
      const code = acc.code;
      return code >= '4000' && code <= '8999';
    });

    if (relevantAccounts.length === 0) {
      return '';
    }

    // Format as structured list for AI
    const accountList = relevantAccounts
      .map((acc) => `- ${acc.code}: ${acc.name} (${acc.accountType})`)
      .join('\n');

    return `## Available Chart of Accounts (for accountCode assignment)
IMPORTANT: You SHOULD attempt to assign an accountCode to every line item based on the description.
Even if uncertain, make your best guess - the user can correct it later.

${accountList}

Guidelines for account selection:
- 4xxx: Revenue accounts (use for sales, service income, other income)
- 5xxx: Cost of goods sold (use for direct costs, purchases, manufacturing)
- 6xxx-7xxx: Operating expenses (use for admin, marketing, utilities, rent, professional fees, software, subscriptions, cloud services, etc.)
- 8xxx: Tax expenses (use for income tax, deferred tax)

Common mappings for vendor invoices (Accounts Payable):
- Software/SaaS subscriptions (e.g., Wix, Adobe, Microsoft) â†’ 6xxx (IT/Software expenses)
- Professional services (legal, accounting, consulting) â†’ 6xxx (Professional fees)
- Office supplies, utilities â†’ 6xxx (Administrative expenses)
- Inventory purchases â†’ 5xxx (Cost of goods sold)
- Advertising, marketing â†’ 6xxx (Marketing expenses)

Set lower confidence (0.5-0.7) if the account mapping is a best guess rather than obvious.`;
  } catch (error) {
    log.warn('Failed to fetch COA context for extraction:', error);
    return '';
  }
}

export async function buildBatchExtractionPrompt(
  tenantId: string,
  companyId: string | null,
  additionalContext: string | undefined,
  recentTransactions: string | undefined,
  promptTemplate: string
): Promise<string> {
  const coaContext = await getCOAContextForExtraction(tenantId, companyId);
  return withCounterpartyIdentityPrompt(resolveDocumentExtractionPrompt(promptTemplate, {
    additionalContext,
    chartOfAccounts: coaContext,
    recentTransactions,
  }));
}

async function buildMistralLineItemSupplementPrompt(
  tenantId: string,
  companyId: string | null,
  additionalContext?: string
): Promise<string> {
  const coaContext = await getCOAContextForExtraction(tenantId, companyId);

  const parts = [
    'You are extracting ONLY line items from a structured business document table.',
    'Return JSON with exactly one top-level field: lineItems.',
    'Extract EVERY visible business row from these pages.',
    'Do not stop at 20 or 30 rows.',
    'Do not aggregate, summarize, or skip repeated-looking rows.',
    'Continue through all rows visible on the provided page chunk only.',
    'Do not include subtotal, tax, total, freight summary, page totals, or grand total rows as line items.',
    'If a row wraps across multiple text lines, keep it as one line item.',
    'Preserve row order and use the visible row numbering when present.',
    'Each line item should include description, quantity, unitPrice, amount, gstAmount, taxCode, and accountCode when possible.',
  ];

  if (coaContext) {
    parts.push(coaContext);
  }

  if (additionalContext) {
    parts.push(`## Additional Context\n${additionalContext}`);
  }

  return parts.join('\n\n');
}

export function shouldUseChunkedMistralLineItemFallback(
  result: FieldExtractionResult,
  pages: { pageNumber: number; storageKey: string | null; imageFingerprint: string | null }[],
  mimeType: string
): boolean {
  return mimeType === 'application/pdf' && pages.length > 1 && (result.lineItems?.length ?? 0) === 30;
}

export async function applyChunkedMistralLineItemFallback(params: {
  result: FieldExtractionResult;
  pages: { pageNumber: number; storageKey: string | null; imageFingerprint: string | null }[];
  documentBuffer: Buffer;
  mimeType: string;
  tenantId: string;
  companyId: string | null;
  userId: string;
  additionalContext?: string;
}): Promise<FieldExtractionResult> {
  const {
    result,
    pages,
    documentBuffer,
    mimeType,
    tenantId,
    companyId,
    userId,
    additionalContext,
  } = params;

  if (!shouldUseChunkedMistralLineItemFallback(result, pages, mimeType)) {
    return result;
  }

  try {
    const fallbackLineItems = await extractMistralLineItemsByPage(
      documentBuffer,
      pages,
      tenantId,
      companyId,
      userId,
      additionalContext,
      Boolean(result.supplierGstNo?.value)
    );

    if (fallbackLineItems && fallbackLineItems.length > (result.lineItems?.length ?? 0)) {
      log.info(
        `Chunked Mistral line item fallback replaced ${result.lineItems?.length ?? 0} items with ${fallbackLineItems.length} items`
      );
      return {
        ...result,
        lineItems: fallbackLineItems,
      };
    }
  } catch (fallbackError) {
    log.warn('Chunked Mistral line item fallback failed', fallbackError);
  }

  return result;
}

async function extractMistralLineItemsByPage(
  pdfBuffer: Buffer,
  pages: { pageNumber: number; storageKey: string | null; imageFingerprint: string | null }[],
  tenantId: string,
  companyId: string | null,
  userId: string,
  additionalContext?: string,
  hasGstRegistration: boolean = false
): Promise<FieldExtractionResult['lineItems']> {
  const prompt = await buildMistralLineItemSupplementPrompt(
    tenantId,
    companyId,
    additionalContext
  );

  const sourcePdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const mergedItems: NonNullable<FieldExtractionResult['lineItems']> = [];

  for (let index = 0; index < pages.length; index += 1) {
    const pageMeta = pages[index];
    const singlePagePdf = await PDFDocument.create();
    const copiedPages = await singlePagePdf.copyPages(sourcePdf, [index]);
    singlePagePdf.addPage(copiedPages[0]);
    const singlePageBytes = await singlePagePdf.save();

    const response = await extractStructuredWithMistralOCR<Record<string, unknown>>({
      document: {
        base64: Buffer.from(singlePageBytes).toString('base64'),
        mimeType: 'application/pdf',
      },
      prompt,
      tenantId,
      userId,
      operation: 'document_extraction_line_items_fallback',
      usageMetadata: {
        companyId,
        processingDocumentPageCount: 1,
        fallbackMode: 'chunked_line_items',
        sourcePageNumber: pageMeta.pageNumber,
      },
      schemaName: 'processing_document_line_items',
      jsonSchema: MISTRAL_LINE_ITEM_ONLY_JSON_SCHEMA,
    });

    const rawLineItems = Array.isArray(response.documentAnnotation?.lineItems)
      ? (response.documentAnnotation.lineItems as Array<Record<string, unknown>>)
      : [];

    mergedItems.push(
      ...mapLineItemsFromAIData(
        rawLineItems,
        pageMeta.pageNumber,
        pageMeta.imageFingerprint ?? '',
        hasGstRegistration
      )
    );
  }

  const dedupedItems = mergedItems.filter((item, index, array) => {
    const duplicateIndex = array.findIndex((candidate) =>
      candidate.lineNo === item.lineNo &&
      candidate.description.value === item.description.value &&
      candidate.amount.value === item.amount.value
    );
    return duplicateIndex === index;
  });

  return dedupedItems
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((item, index) => ({
      ...item,
      lineNo: index + 1,
    }));
}

/**
 * Extract fields using AI vision model
 */
export async function performAIExtraction(
  pages: { pageNumber: number; storageKey: string | null; imageFingerprint: string | null }[],
  tenantId: string,
  companyId: string | null,
  userId: string,
  config: ExtractionConfig,
  recentTransactions: string | undefined,
  promptTemplate: string
): Promise<AIExtractionResult> {
  const explicitModel =
    config.model && config.model !== MISTRAL_OCR_MODEL_ID
      ? config.model
      : undefined;
  const forceMistral =
    config.provider === 'mistral' || config.model === MISTRAL_OCR_MODEL_ID;

  // Use config.model if provided and valid, otherwise get best available for tenant
  const modelId = explicitModel
    ? explicitModel
    : forceMistral
      ? null
      : await getBestAvailableModelForWorkspace(tenantId);

  // Read and encode the first page image
  const firstPage = pages[0];
  if (!firstPage || !firstPage.storageKey) {
    throw new Error('No pages to extract from or missing storage key');
  }

  let imageBase64: string;
  let documentBuffer: Buffer;
  let mimeType: string = 'image/png';

  try {
    // Download image from storage
    documentBuffer = await storage.download(firstPage.storageKey);
    imageBase64 = documentBuffer.toString('base64');

    // Detect mime type from extension
    mimeType = getDocumentMimeTypeFromStorageKey(firstPage.storageKey);
  } catch (error) {
    log.error(`Failed to read image from storage: ${firstPage.storageKey}`, error);
    throw new Error(`Failed to read document image from storage. Please ensure the document was uploaded correctly.`);
  }

  // Build extraction prompt from workspace-managed prompt template.
  const coaContext = await getCOAContextForExtraction(tenantId, companyId);
  if (coaContext) {
    if (isAIDebugEnabled()) {
      const accountCount = (coaContext.match(/^- /gm) || []).length;
      log.info(`[ai-debug] COA context added to prompt: ${accountCount} accounts`);
    }
  } else if (isAIDebugEnabled()) {
    log.info('[ai-debug] No COA context available - account codes will use fallback logic');
  }

  const extractionPrompt = withCounterpartyIdentityPrompt(resolveDocumentExtractionPrompt(promptTemplate, {
    additionalContext: config.additionalContext,
    chartOfAccounts: coaContext,
    recentTransactions,
  }));

  if (forceMistral) {
    try {
      const mistralResponse = await extractStructuredWithMistralOCR<Record<string, unknown>>({
        document: {
          base64: imageBase64,
          mimeType,
        },
        prompt: extractionPrompt,
        tenantId,
        userId,
        operation: 'document_extraction',
        usageMetadata: {
          companyId,
          processingDocumentPageCount: pages.length,
        },
        schemaName: 'processing_document_extraction',
        jsonSchema: MISTRAL_DOCUMENT_EXTRACTION_JSON_SCHEMA,
      });

      let result = mapAIResponseToResult(mistralResponse.documentAnnotation, pages);
      result = await applyChunkedMistralLineItemFallback({
        result,
        pages,
        documentBuffer,
        mimeType,
        tenantId,
        companyId,
        userId,
        additionalContext: config.additionalContext,
      });

      if (isAIDebugEnabled()) {
        logExtractionResults(null, {
          documentCategory: result.documentCategory,
          vendorName: result.vendorName,
          totalAmount: result.totalAmount,
          currency: result.currency,
          lineItems: result.lineItems?.map((item) => ({
            lineNo: item.lineNo,
            description: item.description,
            accountCode: item.accountCode,
          })),
        });
      }

      return {
        result,
        modelUsed: mistralResponse.model || MISTRAL_OCR_MODEL_ID,
        providerUsed: 'mistral',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (error instanceof MistralOCRNotConfiguredError) {
        throw new Error('Mistral OCR is not configured. Please configure a Mistral connector or choose a different extraction model.');
      }
      log.error('Mistral OCR extraction failed', error);
      throw new Error(`AI extraction failed: ${errorMessage}. Please try again or use a different AI model.`);
    }
  }

  if (!modelId) {
    log.warn('No AI model available for extraction after Mistral fallback');
    throw new Error(
      'No AI model configured. Please configure an AI provider (Mistral, OpenAI, Anthropic, Google, or OpenRouter) to enable document extraction.'
    );
  }

  try {
    const documentInputMode = await getDocumentInputModeForModel(tenantId, modelId);
    const connectorDocument =
      mimeType === 'application/pdf' && documentInputMode === 'image'
        ? await prepareImageUrlVisionInput(documentBuffer, mimeType)
        : { base64: imageBase64, mimeType };

    const response = await callAIWithConnector({
      model: modelId,
      tenantId,
      userId,
      userPrompt: extractionPrompt,
      jsonMode: true,
      images: [connectorDocument],
      operation: 'document_extraction',
      temperature: 0.1, // Low temperature for precise extraction
    });

    // Parse the AI response (strip markdown code blocks if present)
    const cleanedContent = stripMarkdownCodeBlocks(response.content);
    const extractedData = JSON.parse(cleanedContent);

    // Debug: log raw AI response to understand bbox format
    log.debug('AI extraction raw response (sample fields):', {
      vendorName: extractedData.vendorName,
      documentNumber: extractedData.documentNumber,
      totalAmount: extractedData.totalAmount,
    });

    // Map to our FieldExtractionResult format
    const result = mapAIResponseToResult(extractedData, pages);

    // Log extraction results for debugging (including account code assignments)
    if (isAIDebugEnabled()) {
      logExtractionResults(null, {
        documentCategory: result.documentCategory,
        vendorName: result.vendorName,
        totalAmount: result.totalAmount,
        currency: result.currency,
        lineItems: result.lineItems?.map((item) => ({
          lineNo: item.lineNo,
          description: item.description,
          accountCode: item.accountCode,
        })),
      });
    }

    return {
      result,
      modelUsed: modelId,
      providerUsed: response.provider,
    };
  } catch (error) {
    log.error('AI extraction failed', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`AI extraction failed: ${errorMessage}. Please try again or use a different AI model.`);
  }
}
