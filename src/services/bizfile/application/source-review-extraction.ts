import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { z } from 'zod';
import {
  callAIWithConnector,
  getBestAvailableModelForWorkspace,
  stripMarkdownCodeBlocks,
  type AIResponse,
  type ConnectorAIOptions,
} from '@/lib/ai';
import {
  BIZFILE_REVIEW_SECTIONS,
  type BizFileReviewSectionId,
} from '@/lib/validations/bizfile-review';
import { extractBizFileWithVision } from '../extractor';
import type {
  BizFileExtractionOptions,
  BizFileExtractionResult,
  BizFileVisionInput,
} from '../types';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
/** Conservative guard for a single independent review attempt. */
export const MAX_INDEPENDENT_REVIEW_PAGES = 100;
export const MAX_INDEPENDENT_REVIEW_BYTES = 10 * 1024 * 1024;
const MAX_PAGE_REFS = MAX_INDEPENDENT_REVIEW_PAGES;

export const bizFileIndependentSectionStatusSchema = z.enum([
  'REVIEWED',
  'ABSENT',
  'UNREADABLE',
  'UNSUPPORTED',
]);

export const bizFileIndependentSectionCoverageSchema = z.object({
  section: z.enum(BIZFILE_REVIEW_SECTIONS),
  status: bizFileIndependentSectionStatusSchema,
  pageRefs: z.array(z.number().int().positive().max(MAX_INDEPENDENT_REVIEW_PAGES)).max(MAX_PAGE_REFS),
  note: z.string().trim().min(1).max(500).optional(),
}).strict();

/**
 * This is the only shape accepted from the independent coverage assessor.
 * `complete` is intentionally absent: the server derives it after checking
 * the original bytes, page count, section statuses, and page references.
 */
export const bizFileIndependentCoverageAttestationSchema = z.object({
  schemaVersion: z.literal('1'),
  sourceHash: z.string().regex(SHA256_PATTERN),
  sections: z.array(bizFileIndependentSectionCoverageSchema).max(BIZFILE_REVIEW_SECTIONS.length),
}).strict();

export const bizFileIndependentSourceCoverageSchema = z.object({
  schemaVersion: z.literal('1'),
  sourceHash: z.string().regex(SHA256_PATTERN).nullable(),
  observedSourceHash: z.string().regex(SHA256_PATTERN).nullable(),
  hashVerified: z.boolean(),
  pageCount: z.number().int().positive().max(MAX_INDEPENDENT_REVIEW_PAGES).nullable(),
  sections: z.array(bizFileIndependentSectionCoverageSchema),
  assessedSections: z.array(z.enum(BIZFILE_REVIEW_SECTIONS)),
  reviewedSections: z.array(z.enum(BIZFILE_REVIEW_SECTIONS)),
  missingSections: z.array(z.enum(BIZFILE_REVIEW_SECTIONS)),
  unreadableSections: z.array(z.enum(BIZFILE_REVIEW_SECTIONS)),
  unsupportedSections: z.array(z.enum(BIZFILE_REVIEW_SECTIONS)),
  missingPages: z.array(z.number().int().positive().max(MAX_INDEPENDENT_REVIEW_PAGES)),
  validationErrors: z.array(z.string().trim().min(1).max(160)).max(50),
  complete: z.boolean(),
}).strict();

export type BizFileIndependentSectionStatus = z.infer<typeof bizFileIndependentSectionStatusSchema>;
export type BizFileIndependentSectionCoverage = z.infer<typeof bizFileIndependentSectionCoverageSchema>;
export type BizFileIndependentCoverageAttestation = z.infer<typeof bizFileIndependentCoverageAttestationSchema>;
export type BizFileIndependentSourceCoverage = z.infer<typeof bizFileIndependentSourceCoverageSchema>;

export interface BizFileIndependentCoverageValidation {
  coverage: BizFileIndependentSourceCoverage;
  /** True only when the returned value satisfied the strict attestation schema. */
  contractValid: boolean;
}

export interface BizFileIndependentCoverageValidationInput {
  sourceBytes: Uint8Array;
  expectedSourceHash?: string | null;
  mimeType: string;
  requiredSections?: readonly BizFileReviewSectionId[];
  reportedCoverage?: unknown;
}

export interface BizFileIndependentCoverageCall extends ConnectorAIOptions {
  operation: 'bizfile_independent_source_coverage';
}

export type BizFileIndependentCoverageCaller = (
  options: BizFileIndependentCoverageCall,
) => Promise<AIResponse>;

export interface BizFileIndependentSourceExtractionInput {
  /** Recheck caller-owned authorization and dispatch policy before each call. */
  beforeProviderDispatch?: () => Promise<void>;
  sourceBytes: Uint8Array;
  expectedSourceHash: string;
  mimeType: string;
  requiredSections?: readonly BizFileReviewSectionId[];
  extractionOptions?: BizFileExtractionOptions;
  /** Factual extraction is injectable so contract tests never call a provider. */
  factualExtractor?: (
    input: BizFileVisionInput,
    options?: BizFileExtractionOptions,
  ) => Promise<BizFileExtractionResult>;
  /** Coverage assessment is injectable so contract tests never call a provider. */
  coverageCaller?: BizFileIndependentCoverageCaller;
}

export interface BizFileIndependentSourceExtractionResult extends BizFileExtractionResult {
  sourceCoverage: BizFileIndependentSourceCoverage;
  /** Raw model attestation retained so the reviewer can revalidate it from bytes. */
  sourceCoverageAttestation?: BizFileIndependentCoverageAttestation;
}

function uniqueSections(value: readonly BizFileReviewSectionId[] | undefined): BizFileReviewSectionId[] {
  const requested = value === undefined ? BIZFILE_REVIEW_SECTIONS : value;
  return [...new Set(requested)].filter((section): section is BizFileReviewSectionId => BIZFILE_REVIEW_SECTIONS.includes(section));
}

function uniquePageRefs(value: readonly number[]): number[] {
  return [...new Set(value)].sort((left, right) => left - right);
}

export function hashBizFileSourceBytes(sourceBytes: Uint8Array): string | null {
  return sourceBytes.length > 0
    ? createHash('sha256').update(Buffer.from(sourceBytes)).digest('hex')
    : null;
}

/**
 * Determine the page count from the exact bytes being reviewed. PDFs are
 * parsed server-side; supported image inputs are one-page sources. Unknown
 * formats are rejected so an AI response cannot invent a page range.
 */
export async function parseBizFileSourcePageCount(sourceBytes: Uint8Array, mimeType: string): Promise<number> {
  if (sourceBytes.length === 0) throw new Error('SOURCE_BYTES_MISSING');
  if (sourceBytes.length > MAX_INDEPENDENT_REVIEW_BYTES) throw new Error('SOURCE_SIZE_LIMIT_EXCEEDED');
  if (mimeType === 'application/pdf') {
    if (Buffer.from(sourceBytes).subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('SOURCE_PAGE_COUNT_UNAVAILABLE');
    const document = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
    const pageCount = document.getPageCount();
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_INDEPENDENT_REVIEW_PAGES) {
      throw new Error('SOURCE_PAGE_COUNT_INVALID');
    }
    return pageCount;
  }

  if (mimeType.startsWith('image/')) {
    try {
      const image = sharp(sourceBytes, { failOn: 'error', limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) throw new Error('SOURCE_IMAGE_INVALID');
      if (metadata.pages && metadata.pages > 1) throw new Error('SOURCE_MULTIPAGE_IMAGE_UNSUPPORTED');
      await image.clone().raw().toBuffer();
      return 1;
    } catch (error) {
      if (error instanceof Error && error.message === 'SOURCE_MULTIPAGE_IMAGE_UNSUPPORTED') throw error;
      if (error instanceof Error && /pixel limit/i.test(error.message)) throw new Error('SOURCE_IMAGE_PIXEL_LIMIT_EXCEEDED');
      throw new Error('SOURCE_PAGE_COUNT_UNAVAILABLE');
    }
  }
  throw new Error('SOURCE_FORMAT_UNSUPPORTED');
}

function fallbackCoverage(
  observedSourceHash: string | null,
  reportedSourceHash: string | null,
  hashVerified: boolean,
  pageCount: number | null,
  requiredSections: readonly BizFileReviewSectionId[],
  validationErrors: readonly string[],
  sections: readonly BizFileIndependentSectionCoverage[] = [],
): BizFileIndependentSourceCoverage {
  const assessedSections = [...new Set(sections.map((section) => section.section))];
  const reviewedSections = [...new Set(sections
    .filter((section) => section.status === 'REVIEWED')
    .map((section) => section.section))];
  const missingSections = requiredSections.filter((section) => !assessedSections.includes(section));
  const unreadableSections = [...new Set(sections
    .filter((section) => section.status === 'UNREADABLE')
    .map((section) => section.section))];
  const unsupportedSections = [...new Set(sections
    .filter((section) => section.status === 'UNSUPPORTED')
    .map((section) => section.section))];
  const referencedPages = pageCount === null
    ? []
    : uniquePageRefs(sections.flatMap((section) => section.pageRefs).filter((page) => page <= pageCount));
  const missingPages = pageCount === null
    ? []
    : Array.from({ length: pageCount }, (_, index) => index + 1).filter((page) => !referencedPages.includes(page));
  const errors = [...new Set(validationErrors)];
  const complete = Boolean(
    hashVerified
      && requiredSections.length > 0
      && pageCount !== null
      && missingSections.length === 0
      && unreadableSections.length === 0
      && unsupportedSections.length === 0
      && missingPages.length === 0
      && errors.length === 0,
  );

  return bizFileIndependentSourceCoverageSchema.parse({
    schemaVersion: '1',
    sourceHash: reportedSourceHash,
    observedSourceHash,
    hashVerified,
    pageCount,
    sections,
    assessedSections,
    reviewedSections,
    missingSections,
    unreadableSections,
    unsupportedSections,
    missingPages,
    validationErrors: errors,
    complete,
  });
}

/**
 * Validate an independent coverage attestation against the original bytes.
 * This is deliberately asynchronous because PDF page count is parsed from
 * the source bytes rather than accepted from the model or caller.
 */
export async function validateBizFileIndependentSourceCoverage(
  input: BizFileIndependentCoverageValidationInput,
): Promise<BizFileIndependentCoverageValidation> {
  const requiredSections = uniqueSections(input.requiredSections);
  const observedSourceHash = hashBizFileSourceBytes(input.sourceBytes);
  const expectedSourceHash = typeof input.expectedSourceHash === 'string' && SHA256_PATTERN.test(input.expectedSourceHash)
    ? input.expectedSourceHash
    : null;
  const hashVerified = Boolean(expectedSourceHash && observedSourceHash && expectedSourceHash === observedSourceHash);
  const errors: string[] = [];
  if (!observedSourceHash) errors.push('SOURCE_BYTES_MISSING');
  if (!expectedSourceHash) errors.push('SOURCE_HASH_UNAVAILABLE');
  if (observedSourceHash && expectedSourceHash && observedSourceHash !== expectedSourceHash) errors.push('SOURCE_HASH_MISMATCH');

  let pageCount: number | null = null;
  if (hashVerified) {
    try {
      pageCount = await parseBizFileSourcePageCount(input.sourceBytes, input.mimeType);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      errors.push(code === 'SOURCE_FORMAT_UNSUPPORTED'
        || code === 'SOURCE_SIZE_LIMIT_EXCEEDED'
        || code === 'SOURCE_IMAGE_PIXEL_LIMIT_EXCEEDED'
        || code === 'SOURCE_MULTIPAGE_IMAGE_UNSUPPORTED'
          ? code
          : 'SOURCE_PAGE_COUNT_UNAVAILABLE');
    }
  }

  const parsed = bizFileIndependentCoverageAttestationSchema.safeParse(input.reportedCoverage);
  if (!parsed.success) {
    errors.push('SOURCE_COVERAGE_CONTRACT_INVALID');
    return {
      contractValid: false,
      coverage: fallbackCoverage(observedSourceHash, null, hashVerified, pageCount, requiredSections, errors),
    };
  }

  const attestation = parsed.data;
  if (attestation.sourceHash !== observedSourceHash) errors.push('SOURCE_COVERAGE_HASH_MISMATCH');
  const seenSections = new Set<BizFileReviewSectionId>();
  for (const section of attestation.sections) {
    if (seenSections.has(section.section)) errors.push(`SOURCE_SECTION_DUPLICATE:${section.section}`);
    seenSections.add(section.section);
    if (pageCount !== null) {
      const invalidPage = section.pageRefs.find((page) => page > pageCount);
      if (invalidPage !== undefined) errors.push(`SOURCE_PAGE_REFERENCE_INVALID:${section.section}:${invalidPage}`);
    }
    if (section.status !== 'UNSUPPORTED' && section.pageRefs.length === 0) {
      errors.push(`SOURCE_PAGE_REFERENCE_MISSING:${section.section}`);
    }
  }

  return {
    contractValid: true,
    coverage: fallbackCoverage(
      observedSourceHash,
      attestation.sourceHash,
      hashVerified,
      pageCount,
      requiredSections,
      errors,
      attestation.sections,
    ),
  };
}

const COVERAGE_SYSTEM_PROMPT = `You are an independent source-coverage assessor for a Singapore ACRA BizFile document.
Inspect only the supplied original document. Do not use approved change values, persisted company state, executor history, conversation history, or user preferences.
Return only the requested JSON attestation. Mark a section REVIEWED only after inspecting its relevant source content. Mark ABSENT when the document is readable but the section is not present. Mark UNREADABLE when the relevant page content cannot be read. Mark UNSUPPORTED when the document does not support assessment of that section.
Use one-based page numbers in pageRefs. Do not invent pages. Do not return a complete flag; the server derives completeness.`;

function buildCoveragePrompt(sourceHash: string, pageCount: number, requiredSections: readonly BizFileReviewSectionId[]): string {
  return `${COVERAGE_SYSTEM_PROMPT}

The server verified sourceHash ${sourceHash} and parsed pageCount ${pageCount} from the original bytes.
Assess each requested section exactly once: ${requiredSections.join(', ')}.

Return this shape:
{
  "schemaVersion": "1",
  "sourceHash": "${sourceHash}",
  "sections": [
    { "section": "entity", "status": "REVIEWED", "pageRefs": [1] }
  ]
}`;
}

function decodeCoverageResponse(content: string): unknown {
  try {
    return JSON.parse(stripMarkdownCodeBlocks(content.trim())) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Connector-aware, read-only source extraction. Factual field extraction and
 * page/section coverage are separate calls and neither receives approved
 * values or executor history.
 */
export async function extractBizFileForIndependentReview(
  input: BizFileIndependentSourceExtractionInput,
): Promise<BizFileIndependentSourceExtractionResult> {
  const observedSourceHash = hashBizFileSourceBytes(input.sourceBytes);
  if (!SHA256_PATTERN.test(input.expectedSourceHash) || !observedSourceHash) throw new Error('SOURCE_HASH_UNAVAILABLE');
  if (observedSourceHash !== input.expectedSourceHash) throw new Error('SOURCE_HASH_MISMATCH');

  const requiredSections = uniqueSections(input.requiredSections);
  const pageCount = await parseBizFileSourcePageCount(input.sourceBytes, input.mimeType);
  const visionInput: BizFileVisionInput = {
    base64: Buffer.from(input.sourceBytes).toString('base64'),
    mimeType: input.mimeType,
  };
  await input.beforeProviderDispatch?.();
  const factual = await (input.factualExtractor ?? extractBizFileWithVision)(visionInput, input.extractionOptions);
  const model = factual.modelUsed || await getBestAvailableModelForWorkspace(input.extractionOptions?.tenantId ?? null);
  if (!model) throw new Error('NO_AI_PROVIDER');
  await input.beforeProviderDispatch?.();
  const coverageResponse = await (input.coverageCaller ?? callAIWithConnector)({
    tenantId: input.extractionOptions?.tenantId ?? null,
    userId: input.extractionOptions?.userId,
    model,
    systemPrompt: COVERAGE_SYSTEM_PROMPT,
    userPrompt: buildCoveragePrompt(input.expectedSourceHash, pageCount, requiredSections),
    images: [visionInput],
    jsonMode: true,
    temperature: 0,
    maxTokens: 2_000,
    operation: 'bizfile_independent_source_coverage',
    usageMetadata: {
      extractionType: 'independent_source_coverage',
      companyId: input.extractionOptions?.companyId,
      documentId: input.extractionOptions?.documentId,
      sourceHash: input.expectedSourceHash,
    },
  });
  const decodedCoverage = decodeCoverageResponse(coverageResponse.content);
  const parsedCoverage = bizFileIndependentCoverageAttestationSchema.safeParse(decodedCoverage);
  const validation = await validateBizFileIndependentSourceCoverage({
    sourceBytes: input.sourceBytes,
    expectedSourceHash: input.expectedSourceHash,
    mimeType: input.mimeType,
    requiredSections,
    reportedCoverage: decodedCoverage,
  });
  return {
    ...factual,
    sourceCoverage: validation.coverage,
    ...(parsedCoverage.success ? { sourceCoverageAttestation: parsedCoverage.data } : {}),
  };
}
