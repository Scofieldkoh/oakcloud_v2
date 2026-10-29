/**
 * BizFile Extractor Service
 *
 * Handles AI-based extraction of BizFile documents using vision models.
 */

import { createLogger } from '@/lib/logger';
import {
  callAI,
  callAIWithConnector,
  getBestAvailableModel,
  getBestAvailableModelForWorkspace,
  getModelConfig,
  stripMarkdownCodeBlocks,
} from '@/lib/ai';
import type { AIModel, AIImageInput } from '@/lib/ai';
import {
  extractStructuredWithMistralOCR,
  MISTRAL_OCR_MODEL_ID,
  MistralOCRNotConfiguredError,
} from '@/lib/ocr/mistral';
import type {
  ExtractedBizFileData,
  BizFileVisionInput,
  BizFileExtractionOptions,
  BizFileExtractionResult,
} from './types';
import { enrichBizFileComplianceFromAcra } from './acra-enrichment';

const log = createLogger('bizfile-extractor');
const NO_AI_PROVIDER_ERROR =
  'No AI provider configured. Please configure an AI connector for this tenant ' +
  'or set one of: MISTRAL_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY, or OPENROUTER_API_KEY';

// ============================================================================
// AI Prompts
// ============================================================================

const EXTRACTION_SYSTEM_PROMPT = `You are a document extraction specialist with expertise in analyzing Singapore ACRA BizFile documents. You have excellent vision capabilities and can accurately read and extract information from document images.

Your task is to carefully analyze the provided document image and extract all relevant information with high accuracy and confidence.`;

const EXTRACTION_PROMPT = `Extract all relevant information from this Singapore ACRA BizFile document image.

Return a JSON object with the following structure (include only fields that have data):

{
  "entityDetails": {
    "uen": "string - Unique Entity Number",
    "name": "string - Current company name using its correct brand casing; preserve acronyms such as DAP, while legal suffixes must use title case such as Pte Ltd, never PTE LTD",
    "displayAlias": "string - Short company alias for internal display, derived from the current company name; maximum 10 characters, preserve meaningful brand casing, omit only when no useful alias can be determined",
    "formerName": "string - Previous company name if any (from 'former_name' field)",
    "dateOfNameChange": "YYYY-MM-DD - Date when name was changed",
    "formerNames": [{ "name": "string", "effectiveFrom": "YYYY-MM-DD", "effectiveTo": "YYYY-MM-DD" }],
    "entityType": "PRIVATE_LIMITED | EXEMPTED_PRIVATE_LIMITED | PUBLIC_LIMITED | SOLE_PROPRIETORSHIP | PARTNERSHIP | LIMITED_PARTNERSHIP | LIMITED_LIABILITY_PARTNERSHIP | FOREIGN_COMPANY | VARIABLE_CAPITAL_COMPANY | OTHER (use EXEMPTED_PRIVATE_LIMITED for 'Exempt Private Company Limited by Shares')",
    "status": "LIVE | STRUCK_OFF | WINDING_UP | DISSOLVED | IN_LIQUIDATION | IN_RECEIVERSHIP | AMALGAMATED | CONVERTED | OTHER",
    "statusDate": "YYYY-MM-DD - Date when status became effective (from 'status_date')",
    "incorporationDate": "YYYY-MM-DD",
    "registrationDate": "YYYY-MM-DD"
  },
  "ssicActivities": {
    "primary": { "code": "string", "description": "string" },
    "secondary": { "code": "string", "description": "string" }
  },
  "registeredAddress": {
    "block": "string",
    "streetName": "string",
    "level": "string",
    "unit": "string",
    "buildingName": "string",
    "postalCode": "string",
    "effectiveFrom": "YYYY-MM-DD - Date of address (from 'date_of_address')"
  },
  "mailingAddress": { ... same as registeredAddress },
  "paidUpCapital": {
    "amount": number,
    "currency": "SGD"
  },
  "issuedCapital": {
    "amount": number,
    "currency": "SGD"
  },
  "shareCapital": [{
    "shareClass": "ORDINARY | PREFERENCE | etc",
    "currency": "SGD",
    "numberOfShares": number,
    "parValue": number - IGNORED: par value is strictly recalculated by the system as totalValue / numberOfShares; do not extract or calculate this field,
    "totalValue": number - the full total value of the share class as printed in the document (for example, 150000 shares of SGD 1.00 each has totalValue 150000). Always extract it directly from the document; never copy the per-share parValue into totalValue and never compute it as parValue x numberOfShares,
    "isPaidUp": boolean,
    "isTreasury": boolean
  }],
  "treasuryShares": {
    "numberOfShares": number,
    "currency": "string"
  },
  "shareholders": [{
    "name": "string",
    "type": "INDIVIDUAL | CORPORATE",
    "isNominee": "boolean - true when the shareholder holds shares as a nominee",
    "identificationType": "NRIC | FIN | PASSPORT | UEN | OTHER",
    "identificationNumber": "string",
    "nationality": "string",
    "placeOfOrigin": "string - For corporate shareholders",
    "address": "string - Full address",
    "shareClass": "ORDINARY",
    "numberOfShares": number,
    "percentageHeld": number,
    "currency": "SGD"
  }],
  "officers": [{
    "name": "string",
    "role": "DIRECTOR | MANAGING_DIRECTOR | ALTERNATE_DIRECTOR | NOMINEE_DIRECTOR | SECRETARY | CEO | CFO | AUDITOR | LIQUIDATOR | RECEIVER | JUDICIAL_MANAGER",
    "identificationType": "NRIC | FIN | PASSPORT",
    "identificationNumber": "string",
    "nationality": "string",
    "address": "string - Full address",
    "appointmentDate": "YYYY-MM-DD",
    "cessationDate": "YYYY-MM-DD or null if current"
  }],
  "auditor": {
    "name": "string",
    "address": "string",
    "appointmentDate": "YYYY-MM-DD"
  },
  "financialYear": {
    "endDay": number (1-31),
    "endMonth": number (1-12)
  },
  "homeCurrency": "string - Company's home currency (default SGD)",
  "compliance": {
    "lastAgmDate": "YYYY-MM-DD (from 'date_of_last_agm')",
    "lastArFiledDate": "YYYY-MM-DD (from 'date_of_last_annual_return')",
    "fyeAsAtLastAr": "YYYY-MM-DD (from 'financial_year_end_as_at_last_ar')",
    "accountsDueDate": "YYYY-MM-DD"
  },
  "charges": [{
    "chargeNumber": "string (from 'charge_number')",
    "chargeType": "string",
    "description": "string",
    "chargeHolderName": "string (from 'chargee')",
    "amountSecured": number (only if numeric),
    "amountSecuredText": "string (use for text like 'All Monies')",
    "currency": "SGD",
    "registrationDate": "YYYY-MM-DD (from 'date_registered')",
    "dischargeDate": "YYYY-MM-DD or null if not discharged"
  }],
  "documentMetadata": {
    "receiptNo": "string - The ACRA receipt number (e.g., 'ACRA250807001467')",
    "receiptDate": "YYYY-MM-DD - Date the BizFile was generated"
  }
}

Important:
- Parse all dates in YYYY-MM-DD format
- Include all officers (current and ceased)
- Include all shareholders with their nationality and address
- Extract share capital structure completely including treasury shares
- For every share-capital row, extract totalValue directly from the document's printed class total (for example, "150,000 shares of SGD 1.00 each" has totalValue 150,000) - never use the per-share value as the total. Do not extract or calculate parValue; the system strictly recalculates it as totalValue divided by numberOfShares (for example, 168 SGD / 168 shares = 1 SGD per share)
- IMPORTANT: Extract paidUpCapital and issuedCapital amounts directly from the "PAID-UP CAPITAL" and "ISSUED/REGISTERED CAPITAL" sections in the document - do NOT calculate from share capital
- Mark cessation dates as null for current officers
- Include both primary and secondary SSIC codes if available
- Extract any charges/encumbrances registered against the company
- For charges with text amounts like "All Monies", use amountSecuredText field
- Extract status_date as the date when the company status became effective
- Read text carefully from the document image, even if it appears small or faded
- If text is unclear, make reasonable inferences based on document context
- IMPORTANT: Extract the receipt number and date from the END of the document, typically formatted as:
  RECEIPT NO. : ACRA250807001467
  DATE : 07 AUG 2025
  Parse the date format (DD MMM YYYY) into YYYY-MM-DD format for receiptDate
- For FREE BUSINESS PROFILE documents (no receipt number), use "FREE" as the receiptNo value
- Country names and nationalities must use title case (e.g. "Singapore", "Malaysia", "United States"), never full caps (e.g. NOT "SINGAPORE")
- Preserve meaningful uppercase brand acronyms in company names (for example "DAP Atelier"), but always format legal suffixes in title case (for example "Pte Ltd", never "PTE LTD")
- Extract a concise company alias into entityDetails.displayAlias for internal display. Keep it to a maximum of 10 characters, preserve meaningful brand casing, and do not include legal suffixes unless they are part of the useful short name.

Respond ONLY with valid JSON, no markdown or explanation.`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build the user prompt with optional additional context
 */
function buildUserPrompt(additionalContext?: string): string {
  let prompt = EXTRACTION_PROMPT;
  if (additionalContext?.trim()) {
    prompt += `\n\nAdditional context from user:\n${additionalContext.trim()}`;
  }
  return prompt;
}

/**
 * Clean AI response content by removing markdown code blocks, thinking tags, etc.
 * Delegates to the shared stripMarkdownCodeBlocks utility.
 */
function cleanJsonResponse(content: string): string {
  return stripMarkdownCodeBlocks(content);
}

/**
 * Validate parsed extraction data
 */
function validateExtractionData(parsed: ExtractedBizFileData): ExtractedBizFileData {
  // Basic validation of required fields
  if (!parsed.entityDetails?.uen || !parsed.entityDetails?.name) {
    throw new Error('AI extraction missing required fields (UEN or company name)');
  }

  return parsed;
}

/**
 * Parse and validate AI response
 */
function parseExtractionResponse(content: string): ExtractedBizFileData {
  let parsed: ExtractedBizFileData;

  // Clean the response (remove markdown code blocks, etc.)
  const cleanedContent = cleanJsonResponse(content);

  try {
    parsed = JSON.parse(cleanedContent) as ExtractedBizFileData;
  } catch {
    log.error('Failed to parse AI response:', content.substring(0, 500));
    log.error('Cleaned content:', cleanedContent.substring(0, 500));
    throw new Error('Failed to parse AI extraction response. The AI returned invalid JSON.');
  }

  return validateExtractionData(parsed);
}

/**
 * Finalize an extraction result: enrich compliance dates from the local ACRA
 * records (by UEN) before the result is stored or returned.
 */
async function finalizeExtractionResult(
  data: ExtractedBizFileData,
  modelUsed: string,
  providerUsed: string,
  usage?: BizFileExtractionResult['usage'],
): Promise<BizFileExtractionResult> {
  const enriched = await enrichBizFileComplianceFromAcra(data);
  return { data: enriched.data, modelUsed, providerUsed, usage };
}

function buildMistralPrompt(additionalContext?: string): string {
  return `${EXTRACTION_SYSTEM_PROMPT}\n\n${buildUserPrompt(additionalContext)}`;
}

function getStaticModelConfig(modelId: string) {
  try {
    return getModelConfig(modelId as AIModel);
  } catch {
    return null;
  }
}

async function resolveBizFileModel(
  options?: BizFileExtractionOptions
): Promise<AIModel | string | null> {
  if (options?.tenantId !== undefined) {
    return options.modelId || (await getBestAvailableModelForWorkspace(options.tenantId));
  }

  return options?.modelId || getBestAvailableModel();
}

async function tryExtractBizFileWithMistral(
  fileInput: BizFileVisionInput,
  options: BizFileExtractionOptions | undefined,
  extractionType: 'vision' | 'text'
): Promise<BizFileExtractionResult | null> {
  if (options?.modelId) {
    return null;
  }

  try {
    const result = await extractStructuredWithMistralOCR<ExtractedBizFileData>({
      document: fileInput,
      prompt: buildMistralPrompt(options?.additionalContext),
      tenantId: options?.tenantId ?? null,
      userId: options?.userId,
      operation: 'bizfile_extraction',
      usageMetadata: {
        companyId: options?.companyId,
        documentId: options?.documentId,
        extractionType,
      },
    });

    log.info(`Using Mistral OCR model: ${result.model} (mistral)`);

    return finalizeExtractionResult(
      validateExtractionData(result.documentAnnotation),
      result.model || MISTRAL_OCR_MODEL_ID,
      result.provider,
      result.usage,
    );
  } catch (error) {
    if (error instanceof MistralOCRNotConfiguredError) {
      log.info('Mistral OCR not configured, falling back to standard AI extraction');
      return null;
    }

    throw error;
  }
}

// ============================================================================
// Main Extraction Functions
// ============================================================================

/**
 * Extract data from BizFile using AI vision (recommended for higher accuracy)
 *
 * This function sends the document directly to the AI model as an image,
 * allowing the model to visually analyze the document for better extraction accuracy.
 * Supports PDF, PNG, JPG, and other image formats.
 *
 * When a tenantId is provided, uses connector-aware AI resolution:
 * 1. First looks for tenant-specific AI connector
 * 2. Falls back to system connector (if tenant has access)
 * 3. Falls back to environment variables
 *
 * @param fileInput - The base64-encoded file with MIME type
 * @param options - Optional extraction options including model selection, context, and tenant ID
 * @returns Extracted data with model metadata
 */
export async function extractBizFileWithVision(
  fileInput: BizFileVisionInput,
  options?: BizFileExtractionOptions
): Promise<BizFileExtractionResult> {
  if (!options?.modelId) {
    const configuredModel = await getBestAvailableModelForWorkspace(
      options?.tenantId ?? null, 'bizfileExtraction', { configuredOnly: true },
    );
    if (configuredModel) options = { ...options, modelId: configuredModel };
  }
  const mistralResult = await tryExtractBizFileWithMistral(fileInput, options, 'vision');
  if (mistralResult) {
    return mistralResult;
  }

  // Determine which model to use based on tenant context
  const modelId = await resolveBizFileModel(options);

  if (!modelId) {
    throw new Error(NO_AI_PROVIDER_ERROR);
  }

  const staticModelConfig = getStaticModelConfig(modelId);
  const modelName = staticModelConfig?.name || modelId;
  const modelProvider = staticModelConfig?.provider || 'connector';

  log.info(`Using AI vision model: ${modelName} (${modelProvider})`);
  log.info(`File type: ${fileInput.mimeType}, size: ${Math.round(fileInput.base64.length * 0.75 / 1024)}KB`);
  if (options?.tenantId !== undefined) {
    log.info(`Using connector-aware AI for tenant: ${options.tenantId || 'system'}`);
  }

  // Prepare the image input for the AI
  const images: AIImageInput[] = [
    {
      base64: fileInput.base64,
      mimeType: fileInput.mimeType,
    },
  ];

  // Build user prompt with optional context
  const userPrompt = buildUserPrompt(options?.additionalContext);

  // Call the appropriate AI service (connector-aware or direct)
  let response;
  if (options?.tenantId !== undefined) {
    // Use connector-aware AI call
    response = await callAIWithConnector({
      model: modelId,
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userPrompt,
      images,
      jsonMode: true,
      temperature: 0.1,
      tenantId: options.tenantId,
      userId: options.userId,
      operation: 'bizfile_extraction',
      usageMetadata: {
        companyId: options.companyId,
        documentId: options.documentId,
        extractionType: 'vision',
      },
    });
  } else {
    // Use direct AI call (environment variables)
    response = await callAI({
      model: modelId,
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userPrompt,
      images,
      jsonMode: true,
      temperature: 0.1,
    });
  }

  // Parse and validate the response
  const parsed = parseExtractionResponse(response.content);

  return finalizeExtractionResult(parsed, modelId, response.provider, response.usage);
}
