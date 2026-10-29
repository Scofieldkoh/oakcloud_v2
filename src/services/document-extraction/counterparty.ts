/**
 * Counterparty hints: company context, the lightweight counterparty pass and
 * learning context from approved revisions.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import type { DocumentCategory, DocumentSubCategory } from '@/generated/prisma';
import {
  callAIWithConnector,
  getDocumentInputModeForModel,
  stripMarkdownCodeBlocks,
} from '@/lib/ai';
import { prepareImageUrlVisionInput } from '@/lib/ai/vision-input';
import type { AIModel } from '@/lib/ai/types';
import { PDFDocument } from 'pdf-lib';
import { extractStructuredWithMistralOCR } from '@/lib/ocr/mistral';
import { storage } from '@/lib/storage';
import { resolveVendor } from '@/services/vendor-resolution.service';
import { resolveCustomer } from '@/services/customer-resolution.service';
import { normalizeCompanyName } from '@/lib/utils';
import { normalizeVendorName } from '@/lib/vendor-name';
import {
  log,
  LIGHTWEIGHT_COUNTERPARTY_JSON_SCHEMA,
  LIGHTWEIGHT_COUNTERPARTY_MAX_OUTPUT_TOKENS,
  LEARNING_CONTEXT_MAX_RECORDS,
  LEARNING_CONTEXT_FALLBACK_SCAN_LIMIT,
  LEARNING_CONTEXT_MAX_LINE_ITEMS_PER_RECORD,
  LEARNING_CONTEXT_DESCRIPTION_MAX_CHARS,
  LEARNING_CONTEXT_MAX_CHARS,
  getDocumentMimeTypeFromStorageKey,
} from './shared';

interface LightweightCounterpartyPassResult {
  vendorName: string | null;
  customerName: string | null;
}

interface CounterpartyHintCompanyContext {
  name: string;
  uen: string;
  formerName?: string | null;
  formerNames: string[];
}

type HistoricalCounterpartySide = 'vendor' | 'customer';
type HistoricalCounterpartyMatchMode = 'CONTACT_ID' | 'NORMALIZED_NAME';

interface HistoricalRevisionContextRecord {
  id: string;
  documentCategory: DocumentCategory;
  documentSubCategory: DocumentSubCategory | null;
  vendorName: string | null;
  customerName: string | null;
  documentNumber: string | null;
  documentDate: Date | null;
  currency: string;
  subtotal: Prisma.Decimal | null;
  taxAmount: Prisma.Decimal | null;
  totalAmount: Prisma.Decimal;
  supplierGstNo: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  items: Array<{
    lineNo: number;
    description: string;
    quantity: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal | null;
    amount: Prisma.Decimal;
    gstAmount: Prisma.Decimal | null;
    taxCode: string | null;
    accountCode: string | null;
  }>;
}

interface CounterpartyLearningCandidate {
  side: HistoricalCounterpartySide;
  rawName: string;
  normalizedName: string;
  canonicalId?: string;
  canonicalName?: string;
  resolutionConfidence: number;
  resolutionStrategy: string;
  matchMode?: HistoricalCounterpartyMatchMode;
  revisions: HistoricalRevisionContextRecord[];
}

// ============================================================================
// Split Detection
// ============================================================================

async function getCounterpartyHintCompanyContext(
  companyId: string
): Promise<CounterpartyHintCompanyContext | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true,
      uen: true,
      formerName: true,
      formerNames: {
        select: {
          formerName: true,
        },
        orderBy: {
          effectiveFrom: 'desc',
        },
        take: 5,
      },
    },
  });

  if (!company) {
    return null;
  }

  const formerNames = Array.from(
    new Set(
      [
        company.formerName,
        ...company.formerNames.map((item) => item.formerName),
      ]
        .map((name) => sanitizeCounterpartyName(name))
        .filter((name): name is string => Boolean(name))
    )
  );

  return {
    name: company.name,
    uen: company.uen,
    formerName: company.formerName,
    formerNames,
  };
}

function buildLightweightCounterpartyPrompt(
  companyContext?: CounterpartyHintCompanyContext | null
): string {
  const parts = [
    'Extract only the counterparty names from the first page of this business document.',
    'Return JSON with exactly 2 keys: vendorName and customerName.',
    'Return AT MOST ONE non-null field whenever possible.',
    'vendorName = the external supplier, seller, issuer, charging party, or service provider organization shown on the document.',
    'customerName = the buyer, bill-to, ship-to, applicant, account holder, or customer organization shown on the document.',
    'Prefer the corporate or legal entity name over any contact person name.',
    'If the same organization appears in abbreviated and expanded form, prefer the expanded legal or corporate name shown on the document.',
    'Only return the actual accounting counterparty. Ignore product names, plans, packages, subscriptions, service modules, business-profile subjects, searched entities, regulated entities, and reference companies unless they are clearly the buyer or seller on the document.',
    'If another company is mentioned only as the company profile purchased, searched company, subject company, or service target, do not return it as customerName.',
    'Use null when a field is not clearly visible.',
    'Do not infer, explain, or add extra keys.',
  ];

  if (companyContext) {
    parts.push('');
    parts.push('Current processing company context:');
    parts.push(`- Official company name: ${companyContext.name}`);
    parts.push(`- UEN: ${companyContext.uen}`);
    if (companyContext.formerNames.length > 0) {
      parts.push(`- Known former names: ${companyContext.formerNames.join(' | ')}`);
    }
    parts.push('Use this context to disambiguate roles on the document:');
    parts.push('- If a visible organization matches the current company context, treat that as the in-scope company mention.');
    parts.push('- Do not mistake the in-scope company for the external issuer/supplier unless the document clearly shows the in-scope company is the seller or issuer.');
    parts.push('- If the in-scope company appears only as a searched entity, subject company, business-profile target, service target, regulated entity, or reference company, do not return it as customerName.');
    parts.push('- For vendor invoices and receipts issued to the in-scope company, prefer vendorName only.');
    parts.push('- For sales invoices issued by the in-scope company to an external customer, prefer customerName only.');
  }

  return parts.join('\n');
}

function sanitizeCounterpartyName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function alignNameToCompanyContext(
  value: string | null | undefined,
  companyContext?: CounterpartyHintCompanyContext | null
): string | null {
  const sanitizedValue = sanitizeCounterpartyName(value);
  if (!sanitizedValue || !companyContext) {
    return sanitizedValue;
  }

  const normalizedValue = normalizeVendorName(sanitizedValue);
  if (!normalizedValue) {
    return sanitizedValue;
  }

  const knownCompanyNames = [companyContext.name, ...companyContext.formerNames];
  const matchesCompany = knownCompanyNames.some((name) => normalizeVendorName(name) === normalizedValue);

  return matchesCompany ? companyContext.name : sanitizedValue;
}

function nameMatchesCompanyContext(
  value: string | null | undefined,
  companyContext?: CounterpartyHintCompanyContext | null
): boolean {
  const sanitizedValue = sanitizeCounterpartyName(value);
  if (!sanitizedValue || !companyContext) {
    return false;
  }

  const normalizedValue = normalizeVendorName(sanitizedValue);
  if (!normalizedValue) {
    return false;
  }

  return [companyContext.name, ...companyContext.formerNames].some(
    (name) => normalizeVendorName(name) === normalizedValue
  );
}

function normalizeLightweightCounterpartyResult(
  result: LightweightCounterpartyPassResult,
  companyContext?: CounterpartyHintCompanyContext | null
): LightweightCounterpartyPassResult {
  let vendorName = alignNameToCompanyContext(result.vendorName, companyContext);
  let customerName = alignNameToCompanyContext(result.customerName, companyContext);

  const vendorMatchesCompany = nameMatchesCompanyContext(vendorName, companyContext);
  const customerMatchesCompany = nameMatchesCompanyContext(customerName, companyContext);

  // Keep only the external accounting counterparty when both sides are returned.
  if (vendorName && customerName) {
    if (!vendorMatchesCompany && customerMatchesCompany) {
      customerName = null;
    } else if (vendorMatchesCompany && !customerMatchesCompany) {
      vendorName = null;
    } else if (vendorMatchesCompany && customerMatchesCompany) {
      customerName = null;
    }
  }

  return {
    vendorName,
    customerName,
  };
}

async function buildLightweightCounterpartyDocumentInput(
  documentBuffer: Buffer,
  mimeType: string
): Promise<{ base64: string; mimeType: string }> {
  if (mimeType !== 'application/pdf') {
    return {
      base64: documentBuffer.toString('base64'),
      mimeType,
    };
  }

  try {
    const sourcePdf = await PDFDocument.load(documentBuffer, { ignoreEncryption: true });
    if (sourcePdf.getPageCount() <= 1) {
      return {
        base64: documentBuffer.toString('base64'),
        mimeType: 'application/pdf',
      };
    }

    const singlePagePdf = await PDFDocument.create();
    const copiedPages = await singlePagePdf.copyPages(sourcePdf, [0]);
    singlePagePdf.addPage(copiedPages[0]);
    const singlePageBytes = await singlePagePdf.save();

    return {
      base64: Buffer.from(singlePageBytes).toString('base64'),
      mimeType: 'application/pdf',
    };
  } catch (error) {
    log.warn('Failed to reduce PDF to first page for lightweight counterparty pass', error);
    return {
      base64: documentBuffer.toString('base64'),
      mimeType: 'application/pdf',
    };
  }
}

async function runLightweightCounterpartyPass(params: {
  pages: Array<{ pageNumber: number; storageKey: string | null; imageFingerprint: string | null }>;
  tenantId: string;
  companyId: string;
  userId: string;
  modelId: AIModel | string | null;
  forceMistral: boolean;
}): Promise<LightweightCounterpartyPassResult | null> {
  const { pages, tenantId, companyId, userId, modelId, forceMistral } = params;
  const firstPage = pages[0];
  if (!firstPage?.storageKey) {
    return null;
  }

  const documentBuffer = await storage.download(firstPage.storageKey);
  const mimeType = getDocumentMimeTypeFromStorageKey(firstPage.storageKey);
  const document = await buildLightweightCounterpartyDocumentInput(documentBuffer, mimeType);
  const companyContext = await getCounterpartyHintCompanyContext(companyId);
  const prompt = buildLightweightCounterpartyPrompt(companyContext);

  if (forceMistral) {
    const response = await extractStructuredWithMistralOCR<LightweightCounterpartyPassResult>({
      document,
      prompt,
      tenantId,
      userId,
      operation: 'document_counterparty_hint',
      usageMetadata: {
        companyId,
        processingDocumentPageCount: 1,
        lightweightPass: true,
      },
      schemaName: 'processing_document_counterparty_hint',
      jsonSchema: LIGHTWEIGHT_COUNTERPARTY_JSON_SCHEMA,
    });

    return normalizeLightweightCounterpartyResult({
      vendorName: response.documentAnnotation?.vendorName ?? null,
      customerName: response.documentAnnotation?.customerName ?? null,
    }, companyContext);
  }

  if (!modelId) {
    return null;
  }

  const documentInputMode = await getDocumentInputModeForModel(tenantId, modelId);
  const connectorDocument =
    document.mimeType === 'application/pdf' && documentInputMode === 'image'
      ? await prepareImageUrlVisionInput(Buffer.from(document.base64, 'base64'), document.mimeType)
      : document;

  const response = await callAIWithConnector({
    model: modelId,
    tenantId,
    userId,
    userPrompt: prompt,
    jsonMode: true,
    images: [connectorDocument],
    operation: 'document_counterparty_hint',
    temperature: 0,
    maxTokens: LIGHTWEIGHT_COUNTERPARTY_MAX_OUTPUT_TOKENS,
    usageMetadata: {
      companyId,
      processingDocumentPageCount: 1,
      lightweightPass: true,
    },
  });

  const parsed = JSON.parse(
    stripMarkdownCodeBlocks(response.content)
  ) as Partial<LightweightCounterpartyPassResult>;

  return normalizeLightweightCounterpartyResult({
    vendorName: parsed.vendorName ?? null,
    customerName: parsed.customerName ?? null,
  }, companyContext);
}

export async function buildHistoricalCounterpartyLearningContext(params: {
  processingDocumentId: string;
  pages: Array<{ pageNumber: number; storageKey: string | null; imageFingerprint: string | null }>;
  tenantId: string;
  companyId: string;
  userId: string;
  modelId: AIModel | string | null;
  forceMistral: boolean;
}): Promise<string | undefined> {
  try {
    const lightweightPass = await runLightweightCounterpartyPass(params);
    if (!lightweightPass?.vendorName && !lightweightPass?.customerName) {
      return undefined;
    }

    const candidatePromises: Array<Promise<CounterpartyLearningCandidate | null>> = [];
    if (lightweightPass.vendorName) {
      candidatePromises.push(
        buildCounterpartyLearningCandidate({
          processingDocumentId: params.processingDocumentId,
          tenantId: params.tenantId,
          companyId: params.companyId,
          userId: params.userId,
          side: 'vendor',
          rawName: lightweightPass.vendorName,
        })
      );
    }
    if (lightweightPass.customerName) {
      candidatePromises.push(
        buildCounterpartyLearningCandidate({
          processingDocumentId: params.processingDocumentId,
          tenantId: params.tenantId,
          companyId: params.companyId,
          userId: params.userId,
          side: 'customer',
          rawName: lightweightPass.customerName,
        })
      );
    }

    const candidates = (await Promise.all(candidatePromises))
      .filter((candidate): candidate is CounterpartyLearningCandidate => Boolean(candidate))
      .filter((candidate) => candidate.revisions.length > 0);

    if (candidates.length === 0) {
      return undefined;
    }

    candidates.sort((a, b) => scoreCounterpartyLearningCandidate(b) - scoreCounterpartyLearningCandidate(a));
    const selectedCandidate = candidates[0];
    const context = formatHistoricalLearningContext(selectedCandidate);

    if (context) {
      log.info(
        `Added learned extraction context from ${selectedCandidate.revisions.length} recent ${selectedCandidate.side} records`
      );
    }

    return context;
  } catch (error) {
    log.warn('Lightweight counterparty pass failed; continuing without learned extraction context', error);
    return undefined;
  }
}

async function buildCounterpartyLearningCandidate(params: {
  processingDocumentId: string;
  tenantId: string;
  companyId: string;
  userId: string;
  side: HistoricalCounterpartySide;
  rawName: string;
}): Promise<CounterpartyLearningCandidate | null> {
  const normalizedName = sanitizeCounterpartyName(normalizeCompanyName(params.rawName) || params.rawName);
  if (!normalizedName) {
    return null;
  }

  if (params.side === 'vendor') {
    const resolution = await resolveVendor({
      tenantId: params.tenantId,
      companyId: params.companyId,
      rawVendorName: normalizedName,
      createdById: params.userId,
    });
    const history = await findRecentApprovedRevisionsForCounterparty({
      processingDocumentId: params.processingDocumentId,
      tenantId: params.tenantId,
      companyId: params.companyId,
      side: 'vendor',
      contactId: resolution.vendorId,
      normalizedName,
    });

    return {
      side: 'vendor',
      rawName: params.rawName,
      normalizedName,
      canonicalId: resolution.vendorId,
      canonicalName: resolution.vendorName,
      resolutionConfidence: resolution.confidence,
      resolutionStrategy: resolution.strategy,
      matchMode: history.matchMode,
      revisions: history.revisions,
    };
  }

  const resolution = await resolveCustomer({
    tenantId: params.tenantId,
    companyId: params.companyId,
    rawCustomerName: normalizedName,
    createdById: params.userId,
  });
  const history = await findRecentApprovedRevisionsForCounterparty({
    processingDocumentId: params.processingDocumentId,
    tenantId: params.tenantId,
    companyId: params.companyId,
    side: 'customer',
    contactId: resolution.customerId,
    normalizedName,
  });

  return {
    side: 'customer',
    rawName: params.rawName,
    normalizedName,
    canonicalId: resolution.customerId,
    canonicalName: resolution.customerName,
    resolutionConfidence: resolution.confidence,
    resolutionStrategy: resolution.strategy,
    matchMode: history.matchMode,
    revisions: history.revisions,
  };
}

async function findRecentApprovedRevisionsForCounterparty(params: {
  processingDocumentId: string;
  tenantId: string;
  companyId: string;
  side: HistoricalCounterpartySide;
  contactId?: string;
  normalizedName: string;
}): Promise<{
  matchMode?: HistoricalCounterpartyMatchMode;
  revisions: HistoricalRevisionContextRecord[];
}> {
  const sharedWhere: Prisma.DocumentRevisionWhereInput = {
    status: 'APPROVED',
    supersededAt: null,
    currentForDocument: {
      is: {
        id: { not: params.processingDocumentId },
        document: {
          tenantId: params.tenantId,
          companyId: params.companyId,
          deletedAt: null,
        },
      },
    },
  };

  const select = {
    id: true,
    documentCategory: true,
    documentSubCategory: true,
    vendorName: true,
    customerName: true,
    documentNumber: true,
    documentDate: true,
    currency: true,
    subtotal: true,
    taxAmount: true,
    totalAmount: true,
    supplierGstNo: true,
    approvedAt: true,
    createdAt: true,
    items: {
      orderBy: { lineNo: 'asc' as const },
      take: LEARNING_CONTEXT_MAX_LINE_ITEMS_PER_RECORD + 1,
      select: {
        lineNo: true,
        description: true,
        quantity: true,
        unitPrice: true,
        amount: true,
        gstAmount: true,
        taxCode: true,
        accountCode: true,
      },
    },
  };

  if (params.contactId) {
    const contactIdMatches = await prisma.documentRevision.findMany({
      where: params.side === 'vendor'
        ? { ...sharedWhere, vendorId: params.contactId }
        : { ...sharedWhere, customerId: params.contactId },
      orderBy: [{ approvedAt: 'desc' }, { createdAt: 'desc' }],
      take: LEARNING_CONTEXT_MAX_RECORDS,
      select,
    });

    if (contactIdMatches.length > 0) {
      return {
        matchMode: 'CONTACT_ID',
        revisions: contactIdMatches,
      };
    }
  }

  const normalizedMatchKey = normalizeVendorName(params.normalizedName);
  if (!normalizedMatchKey) {
    return { revisions: [] };
  }

  const recentNamedRevisions = await prisma.documentRevision.findMany({
    where: params.side === 'vendor'
      ? { ...sharedWhere, vendorName: { not: null } }
      : { ...sharedWhere, customerName: { not: null } },
    orderBy: [{ approvedAt: 'desc' }, { createdAt: 'desc' }],
    take: LEARNING_CONTEXT_FALLBACK_SCAN_LIMIT,
    select,
  });

  const normalizedMatches = recentNamedRevisions
    .filter((revision) => {
      const nameToCompare = params.side === 'vendor' ? revision.vendorName : revision.customerName;
      return normalizeVendorName(nameToCompare ?? '') === normalizedMatchKey;
    })
    .slice(0, LEARNING_CONTEXT_MAX_RECORDS);

  return normalizedMatches.length > 0
    ? {
        matchMode: 'NORMALIZED_NAME',
        revisions: normalizedMatches,
      }
    : { revisions: [] };
}

function scoreCounterpartyLearningCandidate(candidate: CounterpartyLearningCandidate): number {
  const matchModeScore = candidate.matchMode === 'CONTACT_ID' ? 100 : candidate.matchMode === 'NORMALIZED_NAME' ? 50 : 0;
  return (
    candidate.revisions.length * 1000 +
    matchModeScore +
    Math.round(candidate.resolutionConfidence * 100)
  );
}

function truncateContextValue(value: string | null | undefined, maxChars: number): string {
  const trimmed = value?.trim();
  if (!trimmed) return '-';
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 3)}...` : trimmed;
}

function formatHistoricalLearningContext(candidate: CounterpartyLearningCandidate): string | undefined {
  if (candidate.revisions.length === 0) {
    return undefined;
  }

  const contextLines = [
    '## Learned Counterparty Context',
    `Lightweight pass selected ${candidate.side}Name="${truncateContextValue(candidate.rawName, 120)}".`,
    `Normalized counterparty="${truncateContextValue(candidate.canonicalName ?? candidate.normalizedName, 120)}" using ${candidate.resolutionStrategy} matching (confidence ${candidate.resolutionConfidence.toFixed(2)}).`,
    `Database match mode=${candidate.matchMode ?? 'NONE'} using ${candidate.revisions.length} recent approved current records.`,
    'Use these records only as consistency hints for naming, sub-category tendencies, line descriptions, taxCode, and accountCode assignment.',
    'Do not copy document numbers, dates, quantities, or amounts unless they are visible on the current document.',
  ];

  candidate.revisions.forEach((revision, index) => {
    const approvedDate = revision.approvedAt ?? revision.createdAt;
    const isoDate = approvedDate.toISOString().slice(0, 10);
    contextLines.push(
      `Record ${index + 1}: category=${revision.documentCategory}; subCategory=${revision.documentSubCategory ?? '-'}; documentNumber=${revision.documentNumber ?? '-'}; documentDate=${revision.documentDate ? revision.documentDate.toISOString().slice(0, 10) : '-'}; currency=${revision.currency}; subtotal=${revision.subtotal?.toString() ?? '-'}; taxAmount=${revision.taxAmount?.toString() ?? '-'}; totalAmount=${revision.totalAmount.toString()}; supplierGstNo=${revision.supplierGstNo ?? '-'}; vendorName=${revision.vendorName ?? '-'}; customerName=${revision.customerName ?? '-'}; approvedAt=${isoDate}`
    );

    revision.items.slice(0, LEARNING_CONTEXT_MAX_LINE_ITEMS_PER_RECORD).forEach((item) => {
      contextLines.push(
        `- lineNo=${item.lineNo}; description=${truncateContextValue(item.description, LEARNING_CONTEXT_DESCRIPTION_MAX_CHARS)}; quantity=${item.quantity?.toString() ?? '-'}; unitPrice=${item.unitPrice?.toString() ?? '-'}; amount=${item.amount.toString()}; gstAmount=${item.gstAmount?.toString() ?? '-'}; taxCode=${item.taxCode ?? '-'}; accountCode=${item.accountCode ?? '-'}`
      );
    });

    if (revision.items.length > LEARNING_CONTEXT_MAX_LINE_ITEMS_PER_RECORD) {
      contextLines.push(
        `- ${revision.items.length - LEARNING_CONTEXT_MAX_LINE_ITEMS_PER_RECORD} additional line items omitted to keep context compact.`
      );
    }
  });

  const context = contextLines.join('\n');
  if (context.length <= LEARNING_CONTEXT_MAX_CHARS) {
    return context;
  }

  return `${context.slice(0, LEARNING_CONTEXT_MAX_CHARS - 40).trimEnd()}\n...[context truncated]`;
}
