/**
 * Document Processing Service
 *
 * Handles document ingestion, pipeline management, and processing lifecycle
 * as defined in Oakcloud_Document_Processing_Spec_v3.3 Phase 1A.
 */

import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { Prisma } from '@/generated/prisma';
import type {
  PipelineStatus,
  ProcessingPriority,
  UploadSource,
  ProcessingStep,
  CheckpointStatus,
  AttemptStatus,
  DuplicateStatus,
  RevisionStatus,
  DocumentCategory,
  DocumentSubCategory,
} from '@/generated/prisma';
import { PDFDocument } from 'pdf-lib';
import { storage } from '@/lib/storage';
import { hashBlake3, generateFingerprint } from '@/lib/encryption';
import { clearDuplicateReferencesToDocument } from '@/services/duplicate-detection.service';

type Decimal = Prisma.Decimal;

const log = createLogger('document-processing');

// ============================================================================
// Types
// ============================================================================

export interface UploadDocumentInput {
  documentId: string;
  tenantId: string;
  companyId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;  // Storage key for file in object storage
  priority?: ProcessingPriority;
  uploadSource?: UploadSource;
  metadata?: Record<string, unknown>;
}

export interface ProcessingDocumentWithRelations {
  id: string;
  documentId: string;
  isContainer: boolean;
  parentProcessingDocId: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  pageCount: number | null;
  pipelineStatus: PipelineStatus;
  processingPriority: ProcessingPriority;
  duplicateStatus: string;
  currentRevisionId: string | null;
  lockVersion: number;
  createdAt: Date;
  updatedAt: Date;
  // Versioning
  version: number;
  rootDocumentId: string | null;
}

export interface SplitRange {
  pageFrom: number;
  pageTo: number;
  confidence?: number;
  category?: string;
}

export interface ProcessingJobResult {
  success: boolean;
  jobId: string;
  documentId: string;
  error?: {
    code: string;
    message: string;
  };
}

// Processing limits from spec
const PROCESSING_LIMITS = {
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024, // 50MB
  MAX_PAGES_CONTAINER: 50,
  MAX_PAGES_CHILD_EXTRACTION: 20,
  MAX_CONCURRENT_UPLOADS_PER_TENANT: 10,
  MAX_BATCH_SIZE: 100,
  DEFAULT_LOCK_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes
  LOCK_EXTENSION_MS: 2 * 60 * 1000, // 2 minutes
};

// SLA deadlines by priority (in seconds)
const SLA_DEADLINES = {
  CRITICAL: 30,
  HIGH: 120, // 2 min
  NORMAL: 600, // 10 min
  LOW: 14400, // 4 hours
};

// Retry configuration from spec
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 4,
};

// ============================================================================
// Document Upload & Ingestion
// ============================================================================

/**
 * Upload and initialize a document for processing
 */
export async function uploadDocument(
  input: UploadDocumentInput
): Promise<{ processingDocument: ProcessingDocumentWithRelations; jobId: string }> {
  const {
    documentId,
    tenantId,
    companyId,
    fileName,
    mimeType,
    fileSize,
    storageKey,
    priority = 'NORMAL',
    uploadSource = 'WEB',
  } = input;

  log.info(`Uploading document ${documentId} for processing`);

  // Validate file size
  if (fileSize > PROCESSING_LIMITS.MAX_FILE_SIZE_BYTES) {
    throw new Error(`File size ${fileSize} exceeds maximum allowed ${PROCESSING_LIMITS.MAX_FILE_SIZE_BYTES}`);
  }

  // Calculate file hash for duplicate detection
  const fileHash = await calculateFileHash(storageKey);

  // Calculate SLA deadline based on priority
  const slaDeadline = new Date(Date.now() + SLA_DEADLINES[priority] * 1000);

  // Create processing document record
  const processingDocument = await prisma.processingDocument.create({
    data: {
      documentId,
      tenantId,
      isContainer: true,
      pipelineStatus: 'UPLOADED',
      processingPriority: priority,
      uploadSource,
      fileHash,
      contentTypeDetected: mimeType,
      slaDeadline,
    },
  });

  // Create initial state event
  await createStateEvent({
    processingDocumentId: processingDocument.id,
    tenantId,
    companyId,
    eventType: 'DOCUMENT_UPLOADED',
    toState: 'UPLOADED',
    metadata: { fileName, fileSize, mimeType },
  });

  // Generate job ID for tracking
  const jobId = `job_upload_${crypto.randomUUID()}`;

  log.info(`Document ${documentId} uploaded, job ${jobId} created`);

  return {
    processingDocument: processingDocument as ProcessingDocumentWithRelations,
    jobId,
  };
}

/**
 * Check for exact file hash duplicates within the same tenant
 * Duplicate detection is tenant-scoped to ensure data isolation
 * Filters through document relation since ProcessingDocument inherits tenant from Document
 */
export async function checkExactDuplicate(
  fileHash: string,
  tenantId: string,
  companyId?: string
): Promise<{ isDuplicate: boolean; originalDocumentId?: string }> {
  // Build document filter - tenant is required, company is optional
  const documentFilter: Prisma.DocumentWhereInput = {
    tenantId,
  };
  if (companyId) {
    documentFilter.companyId = companyId;
  }

  const where: Prisma.ProcessingDocumentWhereInput = {
    fileHash,
    deletedAt: null,
    document: documentFilter,
  };

  const existing = await prisma.processingDocument.findFirst({
    where,
    select: {
      documentId: true,
    },
  });

  if (existing) {
    log.info(`Found exact duplicate for hash ${fileHash.substring(0, 16)}... in tenant ${tenantId}`);
    return {
      isDuplicate: true,
      originalDocumentId: existing.documentId,
    };
  }

  return { isDuplicate: false };
}

// ============================================================================
// Pipeline Status Management
// ============================================================================

/**
 * Transition document to next pipeline status
 */
export async function transitionPipelineStatus(
  processingDocumentId: string,
  toStatus: PipelineStatus,
  tenantId: string,
  companyId: string,
  options?: {
    reason?: string;
    error?: { code: string; message: string; details?: unknown };
    actorUserId?: string;
  }
): Promise<void> {
  const doc = await prisma.processingDocument.findUnique({
    where: { id: processingDocumentId },
    select: { pipelineStatus: true, errorCount: true, firstErrorAt: true },
  });

  if (!doc) {
    throw new Error(`Processing document ${processingDocumentId} not found`);
  }

  const fromStatus = doc.pipelineStatus;

  // Update document status
  const updateData: Prisma.ProcessingDocumentUpdateInput = {
    pipelineStatus: toStatus,
    updatedAt: new Date(),
  };

  // Track error information for failed states
  if (toStatus === 'FAILED_RETRYABLE' || toStatus === 'FAILED_PERMANENT') {
    updateData.lastError = options?.error as unknown as Prisma.InputJsonValue;
    updateData.errorCount = doc.errorCount + 1;
    if (!doc.firstErrorAt) {
      updateData.firstErrorAt = new Date();
    }

    // Calculate next retry time with exponential backoff
    if (toStatus === 'FAILED_RETRYABLE') {
      const delay = Math.min(
        RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, doc.errorCount),
        RETRY_CONFIG.maxDelayMs
      );
      updateData.nextRetryAt = new Date(Date.now() + delay);
    }

    // Check if we've exceeded max retries
    if (doc.errorCount >= RETRY_CONFIG.maxRetries) {
      updateData.pipelineStatus = 'DEAD_LETTER';
      updateData.deadLetterAt = new Date();
      updateData.canRetry = false;
    }
  }

  await prisma.processingDocument.update({
    where: { id: processingDocumentId },
    data: updateData,
  });

  // Create state event
  await createStateEvent({
    processingDocumentId,
    tenantId,
    companyId,
    eventType: 'PIPELINE_STATUS_CHANGED',
    fromState: fromStatus,
    toState: updateData.pipelineStatus as string,
    reason: options?.reason,
    metadata: options?.error ? { error: options.error } : undefined,
    actorUserId: options?.actorUserId,
  });

  log.info(`Document ${processingDocumentId} transitioned from ${fromStatus} to ${updateData.pipelineStatus}`);
}

/**
 * Reset retry/dead-letter state before a user-triggered fresh extraction attempt.
 * This prevents old transient failures from poisoning the next manual run.
 */
export async function resetProcessingRetryState(processingDocumentId: string): Promise<void> {
  await prisma.processingDocument.update({
    where: { id: processingDocumentId },
    data: {
      errorCount: 0,
      firstErrorAt: null,
      lastError: Prisma.JsonNull,
      nextRetryAt: null,
      deadLetterAt: null,
      canRetry: true,
      updatedAt: new Date(),
    },
  });
}

// ============================================================================
// PDF Metadata Extraction
// ============================================================================

interface PdfMetadata {
  pageCount: number;
  pages: Array<{
    pageNumber: number;
    width: number;  // in PDF points (1/72 inch)
    height: number;
  }>;
}

/**
 * Extract PDF metadata using pdf-lib with pdfjs-dist fallback
 * Some PDFs have internal structures that pdf-lib can't parse, so we fall back to pdfjs-dist
 */
async function extractPdfMetadata(storageKey: string): Promise<PdfMetadata> {
  const pdfBytes = await storage.download(storageKey);

  // Try pdf-lib first (faster, lightweight)
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    const pageCount = pdfDoc.getPageCount();
    const pages: PdfMetadata['pages'] = [];

    for (let i = 0; i < pageCount; i++) {
      const page = pdfDoc.getPage(i);
      const { width, height } = page.getSize();
      pages.push({
        pageNumber: i + 1,
        width: Math.round(width),
        height: Math.round(height),
      });
    }

    log.info(`Extracted metadata for ${pageCount} pages from PDF using pdf-lib`);
    return { pageCount, pages };
  } catch (pdfLibError) {
    log.warn(`pdf-lib failed, falling back to pdfjs-dist: ${pdfLibError instanceof Error ? pdfLibError.message : 'Unknown error'}`);
  }

  // Fallback to pdfjs-dist (more compatible with various PDF structures)
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

    const pageCount = pdfDoc.numPages;
    const pages: PdfMetadata['pages'] = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      pages.push({
        pageNumber: i,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
      });
    }

    log.info(`Extracted metadata for ${pageCount} pages from PDF using pdfjs-dist`);
    return { pageCount, pages };
  } catch (pdfjsError) {
    log.error('Both pdf-lib and pdfjs-dist failed to extract PDF metadata:', pdfjsError);
    throw new Error(`PDF metadata extraction failed: ${pdfjsError instanceof Error ? pdfjsError.message : 'Unknown error'}`);
  }
}

/**
 * Prepare document pages for processing
 * Creates DocumentPage records from the uploaded file
 * - For images: creates a single page
 * - For PDFs: creates pages for each page in the document
 */
export async function prepareDocumentPages(
  processingDocumentId: string,
  storageKey: string,
  mimeType: string
): Promise<{ pageCount: number }> {
  log.info(`Preparing pages for document ${processingDocumentId}, type: ${mimeType}`);

  // Check if pages already exist
  const existingPages = await prisma.documentPage.count({
    where: { processingDocumentId },
  });

  if (existingPages > 0) {
    log.info(`Document ${processingDocumentId} already has ${existingPages} pages`);
    return { pageCount: existingPages };
  }

  // For image files, create a single page
  if (mimeType.startsWith('image/')) {
    await prisma.documentPage.create({
      data: {
        processingDocumentId,
        pageNumber: 1,
        storageKey,
        widthPx: 0, // Will be updated when image is processed
        heightPx: 0,
        renderDpi: 200,
        imageFingerprint: generateFingerprint(storageKey),
      },
    });

    // Update page count on processing document
    await prisma.processingDocument.update({
      where: { id: processingDocumentId },
      data: { pageCount: 1 },
    });

    log.info(`Created 1 page for image document ${processingDocumentId}`);
    return { pageCount: 1 };
  }

  // For PDFs, extract metadata only (client-side rendering via pdfjs-dist)
  if (mimeType === 'application/pdf') {
    try {
      // Extract PDF metadata (page count, dimensions)
      const metadata = await extractPdfMetadata(storageKey);

      // Create DocumentPage records for each page (no image rendering)
      for (const page of metadata.pages) {
        await prisma.documentPage.create({
          data: {
            processingDocumentId,
            pageNumber: page.pageNumber,
            storageKey, // Store original PDF storage key - rendered client-side
            widthPx: page.width,
            heightPx: page.height,
            renderDpi: 72, // PDF points are 72 DPI
            imageFingerprint: generateFingerprint(`${storageKey}:${page.pageNumber}`),
          },
        });
      }

      // Update page count on processing document
      await prisma.processingDocument.update({
        where: { id: processingDocumentId },
        data: { pageCount: metadata.pageCount },
      });

      log.info(`Created ${metadata.pageCount} page records for PDF document ${processingDocumentId}`);
      return { pageCount: metadata.pageCount };
    } catch (error) {
      // If metadata extraction fails, create a single placeholder page
      log.warn(`PDF metadata extraction failed for ${processingDocumentId}, creating placeholder:`, error);

      await prisma.documentPage.create({
        data: {
          processingDocumentId,
          pageNumber: 1,
          storageKey,
          widthPx: 612, // Default US Letter width in points
          heightPx: 792, // Default US Letter height in points
          renderDpi: 72,
          imageFingerprint: generateFingerprint(storageKey),
        },
      });

      await prisma.processingDocument.update({
        where: { id: processingDocumentId },
        data: { pageCount: 1 },
      });

      return { pageCount: 1 };
    }
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

/**
 * Queue document for processing
 * Prepares pages and transitions status to QUEUED
 */
export async function queueDocumentForProcessing(
  processingDocumentId: string,
  tenantId: string,
  companyId: string,
  storageKey?: string,
  mimeType?: string
): Promise<string> {
  // If file info provided, prepare pages first
  if (storageKey && mimeType) {
    await prepareDocumentPages(processingDocumentId, storageKey, mimeType);
  }

  await transitionPipelineStatus(processingDocumentId, 'QUEUED', tenantId, companyId, {
    reason: 'Document queued for processing',
  });

  const jobId = `job_process_${crypto.randomUUID()}`;
  log.info(`Document ${processingDocumentId} queued with job ${jobId}`);
  return jobId;
}

// ============================================================================
// Processing Checkpoints
// ============================================================================

/**
 * Create or update a processing checkpoint
 */
export async function saveCheckpoint(
  processingDocumentId: string,
  step: ProcessingStep,
  status: CheckpointStatus,
  stateJson?: Record<string, unknown>
): Promise<void> {
  await prisma.processingCheckpoint.upsert({
    where: {
      processingDocumentId_step: {
        processingDocumentId,
        step,
      },
    },
    create: {
      processingDocumentId,
      step,
      status,
      stateJson: stateJson as Prisma.InputJsonValue,
    },
    update: {
      status,
      stateJson: stateJson as Prisma.InputJsonValue,
    },
  });
}

/**
 * Get last completed checkpoint for resume
 */
export async function getLastCompletedCheckpoint(processingDocumentId: string): Promise<{
  step: ProcessingStep;
  stateJson: unknown;
} | null> {
  const checkpoint = await prisma.processingCheckpoint.findFirst({
    where: {
      processingDocumentId,
      status: 'COMPLETED',
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return checkpoint ? { step: checkpoint.step, stateJson: checkpoint.stateJson } : null;
}

// ============================================================================
// Processing Attempts
// ============================================================================

/**
 * Record a processing attempt
 */
export async function recordProcessingAttempt(
  processingDocumentId: string,
  step: ProcessingStep,
  status: AttemptStatus,
  options?: {
    errorCode?: string;
    errorMessage?: string;
    errorDetails?: unknown;
    providerLatencyMs?: number;
    providerRequestId?: string;
  }
): Promise<void> {
  // Get current attempt number
  const lastAttempt = await prisma.processingAttempt.findFirst({
    where: { processingDocumentId },
    orderBy: { attemptNumber: 'desc' },
  });

  const attemptNumber = (lastAttempt?.attemptNumber ?? 0) + 1;

  await prisma.processingAttempt.create({
    data: {
      processingDocumentId,
      attemptNumber,
      step,
      status,
      startedAt: new Date(),
      completedAt: status !== 'RUNNING' ? new Date() : undefined,
      errorCode: options?.errorCode,
      errorMessage: options?.errorMessage,
      errorDetails: options?.errorDetails as Prisma.InputJsonValue,
      providerLatencyMs: options?.providerLatencyMs,
      providerRequestId: options?.providerRequestId,
    },
  });
}

// ============================================================================
// Document Locking
// ============================================================================

/**
 * Acquire lock on a document for editing
 */
export async function acquireDocumentLock(
  processingDocumentId: string,
  userId: string,
  tenantId: string,
  companyId: string,
  expectedLockVersion: number
): Promise<{ success: boolean; newLockVersion: number; expiresAt: Date }> {
  const doc = await prisma.processingDocument.findUnique({
    where: { id: processingDocumentId },
    select: { lockVersion: true, lockedById: true, lockExpiresAt: true },
  });

  if (!doc) {
    throw new Error(`Document ${processingDocumentId} not found`);
  }

  // Check lock version for optimistic concurrency
  if (doc.lockVersion !== expectedLockVersion) {
    return { success: false, newLockVersion: doc.lockVersion, expiresAt: new Date() };
  }

  // Check if already locked by another user
  if (doc.lockedById && doc.lockedById !== userId) {
    if (doc.lockExpiresAt && doc.lockExpiresAt > new Date()) {
      return { success: false, newLockVersion: doc.lockVersion, expiresAt: doc.lockExpiresAt };
    }
  }

  const expiresAt = new Date(Date.now() + PROCESSING_LIMITS.DEFAULT_LOCK_TIMEOUT_MS);

  await prisma.processingDocument.update({
    where: { id: processingDocumentId, lockVersion: expectedLockVersion },
    data: {
      lockedById: userId,
      lockedAt: new Date(),
      lockExpiresAt: expiresAt,
      lockVersion: expectedLockVersion + 1,
    },
  });

  await createStateEvent({
    processingDocumentId,
    tenantId,
    companyId,
    eventType: 'LOCK_ACQUIRED',
    metadata: { userId, expiresAt: expiresAt.toISOString() },
    actorUserId: userId,
  });

  return { success: true, newLockVersion: expectedLockVersion + 1, expiresAt };
}

/**
 * Release lock on a document
 */
export async function releaseDocumentLock(
  processingDocumentId: string,
  userId: string,
  tenantId: string,
  companyId: string,
  expectedLockVersion: number
): Promise<{ success: boolean; newLockVersion: number }> {
  const doc = await prisma.processingDocument.findUnique({
    where: { id: processingDocumentId },
    select: { lockVersion: true, lockedById: true },
  });

  if (!doc) {
    throw new Error(`Document ${processingDocumentId} not found`);
  }

  // Only the lock holder can release
  if (doc.lockedById !== userId) {
    return { success: false, newLockVersion: doc.lockVersion };
  }

  // Check lock version
  if (doc.lockVersion !== expectedLockVersion) {
    return { success: false, newLockVersion: doc.lockVersion };
  }

  await prisma.processingDocument.update({
    where: { id: processingDocumentId, lockVersion: expectedLockVersion },
    data: {
      lockedById: null,
      lockedAt: null,
      lockExpiresAt: null,
      lockVersion: expectedLockVersion + 1,
    },
  });

  await createStateEvent({
    processingDocumentId,
    tenantId,
    companyId,
    eventType: 'LOCK_RELEASED',
    metadata: { userId },
    actorUserId: userId,
  });

  return { success: true, newLockVersion: expectedLockVersion + 1 };
}

// ============================================================================
// Document Splitting
// ============================================================================

/**
 * Create split plan for a container document
 */
export async function createSplitPlan(
  processingDocumentId: string,
  tenantId: string,
  companyId: string,
  ranges: SplitRange[],
  method: 'AUTO' | 'MANUAL',
  createdById?: string
): Promise<{ splitPlanId: string }> {
  // Supersede any existing split plans
  await prisma.splitPlan.updateMany({
    where: {
      processingDocumentId,
      supersededAt: null,
    },
    data: {
      supersededAt: new Date(),
    },
  });

  const splitPlan = await prisma.splitPlan.create({
    data: {
      processingDocumentId,
      tenantId,
      companyId,
      method,
      schemaVersion: '1.0',
      rangesJson: ranges as unknown as Prisma.InputJsonValue,
      createdById,
    },
  });

  log.info(`Created split plan ${splitPlan.id} with ${ranges.length} ranges`);

  return { splitPlanId: splitPlan.id };
}

/**
 * Create child documents from a split plan
 */
export async function createChildDocuments(
  parentProcessingDocId: string,
  splitPlanId: string,
  tenantId: string,
  companyId: string
): Promise<{ childDocumentIds: string[] }> {
  const splitPlan = await prisma.splitPlan.findUnique({
    where: { id: splitPlanId },
    select: { rangesJson: true },
  });

  if (!splitPlan) {
    throw new Error(`Split plan ${splitPlanId} not found`);
  }

  const ranges = splitPlan.rangesJson as unknown as SplitRange[];
  const childDocumentIds: string[] = [];

  for (const range of ranges) {
    // Create a new Document first (linking to existing document system)
    const newDocumentId = crypto.randomUUID();

    // Create processing document for child
    const childDoc = await prisma.processingDocument.create({
      data: {
        documentId: newDocumentId,
        tenantId,
        isContainer: false,
        parentProcessingDocId,
        pageFrom: range.pageFrom,
        pageTo: range.pageTo,
        pageCount: range.pageTo - range.pageFrom + 1,
        pipelineStatus: 'QUEUED',
        processingPriority: 'NORMAL',
        uploadSource: 'WEB',
      },
    });

    childDocumentIds.push(childDoc.id);

    await createStateEvent({
      processingDocumentId: childDoc.id,
      tenantId,
      companyId,
      eventType: 'CHILD_DOCUMENT_CREATED',
      toState: 'QUEUED',
      metadata: { parentProcessingDocId, pageFrom: range.pageFrom, pageTo: range.pageTo },
    });
  }

  log.info(`Created ${childDocumentIds.length} child documents from split plan ${splitPlanId}`);

  return { childDocumentIds };
}

// ============================================================================
// Document Retrieval
// ============================================================================

/**
 * Get processing document by ID
 */
export async function getProcessingDocument(
  processingDocumentId: string
): Promise<ProcessingDocumentWithRelations | null> {
  return prisma.processingDocument.findUnique({
    where: { id: processingDocumentId },
  }) as Promise<ProcessingDocumentWithRelations | null>;
}

/**
 * Get processing document by document ID
 */
export async function getProcessingDocumentByDocumentId(
  documentId: string
): Promise<ProcessingDocumentWithRelations | null> {
  return prisma.processingDocument.findUnique({
    where: { documentId },
  }) as Promise<ProcessingDocumentWithRelations | null>;
}

/**
 * List processing documents with cursor-based pagination
 * Requires tenantId for data isolation
 * Filters through document relation since ProcessingDocument inherits tenant from Document
 */
export async function listProcessingDocuments(options: {
  tenantId: string;
  companyId?: string;
  status?: PipelineStatus[];
  isContainer?: boolean;
  limit?: number;
  cursor?: string;
}): Promise<{ items: ProcessingDocumentWithRelations[]; nextCursor: string | null }> {
  const { tenantId, companyId, status, isContainer, limit = 50, cursor } = options;

  // Build document filter - tenant is required, company is optional
  const documentFilter: Prisma.DocumentWhereInput = {
    tenantId,
  };
  if (companyId) {
    documentFilter.companyId = companyId;
  }

  // Filter through document relation for tenant isolation
  const where: Prisma.ProcessingDocumentWhereInput = {
    deletedAt: null,
    document: documentFilter,
  };

  if (status && status.length > 0) {
    where.pipelineStatus = { in: status };
  }

  if (isContainer !== undefined) {
    where.isContainer = isContainer;
  }

  const documents = await prisma.processingDocument.findMany({
    where,
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { createdAt: 'desc' },
  });

  let nextCursor: string | null = null;
  if (documents.length > limit) {
    const nextItem = documents.pop();
    nextCursor = nextItem!.id;
  }

  return {
    items: documents as ProcessingDocumentWithRelations[],
    nextCursor,
  };
}

/**
 * List processing documents with page-based pagination
 * Supports filtering by pipelineStatus, duplicateStatus, isContainer
 * Supports sorting by various fields
 *
 * Note: tenantId and companyIds are filtered through the document relation
 * since ProcessingDocument inherits these from its associated Document
 */
export async function listProcessingDocumentsPaged(options: {
  tenantId: string | null;
  companyIds?: string[];
  pipelineStatus?: PipelineStatus;
  duplicateStatus?: DuplicateStatus;
  revisionStatus?: RevisionStatus;
  needsReview?: boolean;
  isContainer?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /**
   * Skip tenant filter - ONLY for SUPER_ADMIN operations that require
   * cross-tenant access. Regular operations MUST always provide tenantId.
   */
  skipTenantFilter?: boolean;
  // Date range filters
  uploadDateFrom?: Date;
  uploadDateTo?: Date;
  documentDateFrom?: Date;
  documentDateTo?: Date;
  // Text search filters
  search?: string;
  vendorName?: string;
  documentNumber?: string;
  fileName?: string;
  // Category filters
  documentCategory?: string;
  documentSubCategory?: string;
  // Tag filter
  tagIds?: string[];
  // Currency filters
  currency?: string;
  homeCurrency?: string;
  // Amount filters - single value mode
  subtotal?: number;
  tax?: number;
  total?: number;
  homeSubtotal?: number;
  homeTax?: number;
  homeTotal?: number;
  // Amount filters - range mode
  subtotalFrom?: number;
  subtotalTo?: number;
  taxFrom?: number;
  taxTo?: number;
  totalFrom?: number;
  totalTo?: number;
  homeSubtotalFrom?: number;
  homeSubtotalTo?: number;
  homeTaxFrom?: number;
  homeTaxTo?: number;
  homeTotalFrom?: number;
  homeTotalTo?: number;
}): Promise<{
  documents: ProcessingDocumentWithDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const {
    tenantId,
    companyIds,
    pipelineStatus,
    duplicateStatus,
    revisionStatus,
    needsReview,
    isContainer,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    skipTenantFilter = false,
    // New filter parameters
    uploadDateFrom,
    uploadDateTo,
    documentDateFrom,
    documentDateTo,
    search,
    vendorName,
    documentNumber,
    fileName,
    documentCategory,
    documentSubCategory,
    tagIds,
    // Currency filters
    currency: filterCurrency,
    homeCurrency: filterHomeCurrency,
    // Amount filters
    subtotal: filterSubtotal,
    tax: filterTax,
    total: filterTotal,
    homeSubtotal: filterHomeSubtotal,
    homeTax: filterHomeTax,
    homeTotal: filterHomeTotal,
    subtotalFrom,
    subtotalTo,
    taxFrom,
    taxTo,
    totalFrom,
    totalTo,
    homeSubtotalFrom,
    homeSubtotalTo,
    homeTaxFrom,
    homeTaxTo,
    homeTotalFrom,
    homeTotalTo,
  } = options;

  // SECURITY: Tenant ID is required to prevent cross-tenant data access unless explicitly skipped for SUPER_ADMIN
  if (!tenantId && !skipTenantFilter) {
    throw new Error('Tenant ID is required for processing documents list');
  }

  // Build where clause — use tenantId directly on processing_documents for index efficiency
  const where: Prisma.ProcessingDocumentWhereInput = {
    deletedAt: null,
  };

  // Tenant scope (skip for SUPER_ADMIN cross-tenant operations)
  if (tenantId && !skipTenantFilter) {
    where.tenantId = tenantId;
  }

  // companyId lives on Document — only join when needed
  if (companyIds && companyIds.length > 0) {
    where.document = { companyId: { in: companyIds } };
  }

  if (pipelineStatus) {
    where.pipelineStatus = pipelineStatus;
  }

  if (duplicateStatus) {
    where.duplicateStatus = duplicateStatus;
  }

  if (revisionStatus) {
    // Filter against ANY revision so unapproved documents (no currentRevisionId yet) can still be found.
    where.revisions = { some: { status: revisionStatus } };
  }

  if (needsReview) {
    const existingAND = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];
    where.AND = [
      ...existingAND,
      {
        OR: [
          { duplicateStatus: 'SUSPECTED' },
          { revisions: { some: { status: 'DRAFT' } } },
          { revisions: { some: { validationStatus: { in: ['WARNINGS', 'INVALID'] } } } },
        ],
      },
    ];
  }

  if (isContainer !== undefined) {
    where.isContainer = isContainer;
  }

  // Upload date range filter (createdAt on ProcessingDocument)
  if (uploadDateFrom || uploadDateTo) {
    where.createdAt = {};
    if (uploadDateFrom) {
      where.createdAt.gte = uploadDateFrom;
    }
    if (uploadDateTo) {
      where.createdAt.lte = uploadDateTo;
    }
  }

  // Document date range filter (via currentRevision.documentDate)
  if (documentDateFrom || documentDateTo) {
    const revisionFilter: Prisma.DocumentRevisionWhereInput = where.currentRevision as Prisma.DocumentRevisionWhereInput || {};
    revisionFilter.documentDate = {};
    if (documentDateFrom) {
      revisionFilter.documentDate.gte = documentDateFrom;
    }
    if (documentDateTo) {
      revisionFilter.documentDate.lte = documentDateTo;
    }
    where.currentRevision = revisionFilter;
  }

  // General text search (OR across multiple fields)
  if (search) {
    where.OR = [
      { document: { originalFileName: { contains: search, mode: 'insensitive' } } },
      { document: { fileName: { contains: search, mode: 'insensitive' } } },
      { currentRevision: { vendorName: { contains: search, mode: 'insensitive' } } },
      { currentRevision: { documentNumber: { contains: search, mode: 'insensitive' } } },
    ];
  }

  // Specific vendor name filter
  if (vendorName) {
    const revisionFilter: Prisma.DocumentRevisionWhereInput = where.currentRevision as Prisma.DocumentRevisionWhereInput || {};
    revisionFilter.vendorName = { contains: vendorName, mode: 'insensitive' };
    where.currentRevision = revisionFilter;
  }

  // Specific document number filter
  if (documentNumber) {
    const revisionFilter: Prisma.DocumentRevisionWhereInput = where.currentRevision as Prisma.DocumentRevisionWhereInput || {};
    revisionFilter.documentNumber = { contains: documentNumber, mode: 'insensitive' };
    where.currentRevision = revisionFilter;
  }

  // Specific file name filter
  if (fileName) {
    where.document = {
      ...((where.document as Prisma.DocumentWhereInput) ?? {}),
      OR: [
        { originalFileName: { contains: fileName, mode: 'insensitive' } },
        { fileName: { contains: fileName, mode: 'insensitive' } },
      ],
    };
  }

  // Document category filter
  if (documentCategory) {
    const revisionFilter: Prisma.DocumentRevisionWhereInput = where.currentRevision as Prisma.DocumentRevisionWhereInput || {};
    revisionFilter.documentCategory = documentCategory as DocumentCategory;
    where.currentRevision = revisionFilter;
  }

  // Document sub-category filter
  if (documentSubCategory) {
    const revisionFilter: Prisma.DocumentRevisionWhereInput = where.currentRevision as Prisma.DocumentRevisionWhereInput || {};
    revisionFilter.documentSubCategory = documentSubCategory as DocumentSubCategory;
    where.currentRevision = revisionFilter;
  }

  // Tag filter - documents must have ALL specified tags
  if (tagIds && tagIds.length > 0) {
    where.documentTags = {
      some: {
        tagId: { in: tagIds },
      },
    };
  }

  // Currency filter (exact match, case-insensitive)
  if (filterCurrency) {
    const revisionFilter: Prisma.DocumentRevisionWhereInput = where.currentRevision as Prisma.DocumentRevisionWhereInput || {};
    revisionFilter.currency = { equals: filterCurrency, mode: 'insensitive' };
    where.currentRevision = revisionFilter;
  }

  // Home currency filter (exact match, case-insensitive)
  if (filterHomeCurrency) {
    const revisionFilter: Prisma.DocumentRevisionWhereInput = where.currentRevision as Prisma.DocumentRevisionWhereInput || {};
    revisionFilter.homeCurrency = { equals: filterHomeCurrency, mode: 'insensitive' };
    where.currentRevision = revisionFilter;
  }

  // Amount filters (via currentRevision fields)
  // Helper to get/create revision filter
  const getRevisionFilter = (): Prisma.DocumentRevisionWhereInput => {
    if (!where.currentRevision || typeof where.currentRevision !== 'object') {
      where.currentRevision = {};
    }
    return where.currentRevision as Prisma.DocumentRevisionWhereInput;
  };

  // Subtotal filters
  if (filterSubtotal !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.subtotal = new Prisma.Decimal(filterSubtotal);
  } else if (subtotalFrom !== undefined || subtotalTo !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.subtotal = {};
    if (subtotalFrom !== undefined) {
      revisionFilter.subtotal.gte = new Prisma.Decimal(subtotalFrom);
    }
    if (subtotalTo !== undefined) {
      revisionFilter.subtotal.lte = new Prisma.Decimal(subtotalTo);
    }
  }

  // Tax filters
  if (filterTax !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.taxAmount = new Prisma.Decimal(filterTax);
  } else if (taxFrom !== undefined || taxTo !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.taxAmount = {};
    if (taxFrom !== undefined) {
      revisionFilter.taxAmount.gte = new Prisma.Decimal(taxFrom);
    }
    if (taxTo !== undefined) {
      revisionFilter.taxAmount.lte = new Prisma.Decimal(taxTo);
    }
  }

  // Total filters
  if (filterTotal !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.totalAmount = new Prisma.Decimal(filterTotal);
  } else if (totalFrom !== undefined || totalTo !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.totalAmount = {};
    if (totalFrom !== undefined) {
      revisionFilter.totalAmount.gte = new Prisma.Decimal(totalFrom);
    }
    if (totalTo !== undefined) {
      revisionFilter.totalAmount.lte = new Prisma.Decimal(totalTo);
    }
  }

  // Home subtotal filters
  if (filterHomeSubtotal !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.homeSubtotal = new Prisma.Decimal(filterHomeSubtotal);
  } else if (homeSubtotalFrom !== undefined || homeSubtotalTo !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.homeSubtotal = {};
    if (homeSubtotalFrom !== undefined) {
      revisionFilter.homeSubtotal.gte = new Prisma.Decimal(homeSubtotalFrom);
    }
    if (homeSubtotalTo !== undefined) {
      revisionFilter.homeSubtotal.lte = new Prisma.Decimal(homeSubtotalTo);
    }
  }

  // Home tax filters
  if (filterHomeTax !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.homeTaxAmount = new Prisma.Decimal(filterHomeTax);
  } else if (homeTaxFrom !== undefined || homeTaxTo !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.homeTaxAmount = {};
    if (homeTaxFrom !== undefined) {
      revisionFilter.homeTaxAmount.gte = new Prisma.Decimal(homeTaxFrom);
    }
    if (homeTaxTo !== undefined) {
      revisionFilter.homeTaxAmount.lte = new Prisma.Decimal(homeTaxTo);
    }
  }

  // Home total filters
  if (filterHomeTotal !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.homeEquivalent = new Prisma.Decimal(filterHomeTotal);
  } else if (homeTotalFrom !== undefined || homeTotalTo !== undefined) {
    const revisionFilter = getRevisionFilter();
    revisionFilter.homeEquivalent = {};
    if (homeTotalFrom !== undefined) {
      revisionFilter.homeEquivalent.gte = new Prisma.Decimal(homeTotalFrom);
    }
    if (homeTotalTo !== undefined) {
      revisionFilter.homeEquivalent.lte = new Prisma.Decimal(homeTotalTo);
    }
  }

  // Build orderBy based on sortBy field (supports nested relation sorts)
  const buildOrderBy = (
    field: string,
    order: 'asc' | 'desc'
  ): Prisma.ProcessingDocumentOrderByWithRelationInput | Prisma.ProcessingDocumentOrderByWithRelationInput[] => {
    switch (field) {
      case 'createdAt':
      case 'updatedAt':
      case 'pipelineStatus':
      case 'duplicateStatus':
        return [{ [field]: order }, { createdAt: 'desc' }, { id: 'desc' }];

      // Document fields
      case 'fileName':
        return [
          { document: { fileName: order } },
          { document: { originalFileName: order } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ];
      case 'companyName':
        return [{ document: { company: { name: order } } }, { createdAt: 'desc' }, { id: 'desc' }];

      // Revision fields (currentRevision)
      case 'revisionStatus':
        return [{ currentRevision: { status: order } }, { createdAt: 'desc' }, { id: 'desc' }];
      case 'documentCategory':
        return [{ currentRevision: { documentCategory: order } }, { createdAt: 'desc' }, { id: 'desc' }];
      case 'documentSubCategory':
        return [{ currentRevision: { documentSubCategory: order } }, { createdAt: 'desc' }, { id: 'desc' }];
      case 'vendorName':
        return [{ currentRevision: { vendorName: order } }, { createdAt: 'desc' }, { id: 'desc' }];
      case 'documentNumber':
        return [{ currentRevision: { documentNumber: order } }, { createdAt: 'desc' }, { id: 'desc' }];
      case 'documentDate':
        return [{ currentRevision: { documentDate: order } }, { createdAt: 'desc' }, { id: 'desc' }];
      case 'subtotal':
        return [
          { currentRevision: { currency: 'asc' } },
          { currentRevision: { subtotal: order } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ];
      case 'taxAmount':
        return [
          { currentRevision: { currency: 'asc' } },
          { currentRevision: { taxAmount: order } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ];
      case 'totalAmount':
        return [
          { currentRevision: { currency: 'asc' } },
          { currentRevision: { totalAmount: order } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ];
      case 'currency':
        return [{ currentRevision: { currency: order } }, { createdAt: 'desc' }, { id: 'desc' }];
      case 'homeCurrency':
        return [{ currentRevision: { homeCurrency: order } }, { createdAt: 'desc' }, { id: 'desc' }];
      case 'homeSubtotal':
        return [{ currentRevision: { homeSubtotal: order } }, { createdAt: 'desc' }, { id: 'desc' }];
      case 'homeTaxAmount':
        return [{ currentRevision: { homeTaxAmount: order } }, { createdAt: 'desc' }, { id: 'desc' }];
      case 'homeEquivalent':
        return [{ currentRevision: { homeEquivalent: order } }, { createdAt: 'desc' }, { id: 'desc' }];

      default:
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  };

  const orderBy = buildOrderBy(sortBy, sortOrder);

  const skip = (page - 1) * limit;

  // Get total count and documents in parallel
  const [total, documents] = await Promise.all([
    prisma.processingDocument.count({ where }),
    prisma.processingDocument.findMany({
      where,
      include: {
        document: {
          select: {
            id: true,
            fileName: true,
            originalFileName: true,
            mimeType: true,
            fileSize: true,
            tenantId: true,
            companyId: true,
            company: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        currentRevision: {
          select: {
            id: true,
            revisionNumber: true,
            status: true,
            documentCategory: true,
            documentSubCategory: true,
            vendorName: true,
            documentNumber: true,
            documentDate: true,
            currency: true,
            subtotal: true,
            taxAmount: true,
            totalAmount: true,
            homeCurrency: true,
            homeSubtotal: true,
            homeTaxAmount: true,
            homeEquivalent: true,
          },
        },
        // Include latest revision so list pages can show extracted data before approval.
        revisions: {
          take: 1,
          orderBy: { revisionNumber: 'desc' },
          select: {
            id: true,
            revisionNumber: true,
            status: true,
            documentCategory: true,
            documentSubCategory: true,
            vendorName: true,
            documentNumber: true,
            documentDate: true,
            currency: true,
            subtotal: true,
            taxAmount: true,
            totalAmount: true,
            homeCurrency: true,
            homeSubtotal: true,
            homeTaxAmount: true,
            homeEquivalent: true,
          },
        },
      },
      orderBy,
      skip,
      take: limit,
    }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    documents: documents.map((doc) => {
      const latestRevision = (doc as unknown as { revisions?: Array<ProcessingDocumentWithDocument['currentRevision']> }).revisions?.[0] ?? null;
      return {
        ...(doc as unknown as ProcessingDocumentWithDocument),
        // `currentRevisionId` represents the approved revision pointer.
        // For list UX, expose a "display revision" so extracted drafts show up immediately after upload.
        currentRevision: (doc as unknown as ProcessingDocumentWithDocument).currentRevision ?? latestRevision,
      };
    }) as ProcessingDocumentWithDocument[],
    total,
    page,
    limit,
    totalPages,
  };
}

export async function getProcessingDocumentSummary(options: {
  tenantId: string | null;
  companyIds?: string[];
  skipTenantFilter?: boolean;
}): Promise<{
  total: number;
  byPipelineStatus: Record<string, number>;
  byDuplicateStatus: Record<string, number>;
  byRevisionStatus: Record<string, number>;
  needsReview: number;
}> {
  const { tenantId, companyIds, skipTenantFilter = false } = options;

  if (!tenantId && !skipTenantFilter) {
    throw new Error('Tenant ID is required for processing document summary');
  }

  const where: Prisma.ProcessingDocumentWhereInput = {
    deletedAt: null,
  };

  if (tenantId && !skipTenantFilter) {
    where.tenantId = tenantId;
  }

  if (companyIds?.length) {
    where.document = { companyId: { in: companyIds } };
  }

  const [total, byPipelineStatus, byDuplicateStatus, byRevisionPointer, needsReview] =
    await Promise.all([
      prisma.processingDocument.count({ where }),
      prisma.processingDocument.groupBy({
        by: ['pipelineStatus'],
        where,
        _count: true,
      }),
      prisma.processingDocument.groupBy({
        by: ['duplicateStatus'],
        where,
        _count: true,
      }),
      prisma.processingDocument.groupBy({
        by: ['currentRevisionId'],
        where: {
          ...where,
          currentRevision: { isNot: null },
        },
        _count: true,
      }),
      prisma.processingDocument.count({
        where: {
          ...where,
          currentRevision: { status: 'DRAFT' },
        },
      }),
    ]);

  const revisionIds = byRevisionPointer
    .map((row) => row.currentRevisionId)
    .filter((id): id is string => Boolean(id));
  const revisions = revisionIds.length
    ? await prisma.documentRevision.findMany({
        where: { id: { in: revisionIds } },
        select: { id: true, status: true },
      })
    : [];
  const revisionStatusById = new Map(revisions.map((revision) => [revision.id, revision.status]));

  return {
    total,
    byPipelineStatus: Object.fromEntries(
      byPipelineStatus.map((row) => [row.pipelineStatus, row._count])
    ),
    byDuplicateStatus: Object.fromEntries(
      byDuplicateStatus.map((row) => [row.duplicateStatus, row._count])
    ),
    byRevisionStatus: byRevisionPointer.reduce<Record<string, number>>((acc, row) => {
      const status = row.currentRevisionId ? revisionStatusById.get(row.currentRevisionId) : undefined;
      if (!status) return acc;
      acc[status] = (acc[status] ?? 0) + row._count;
      return acc;
    }, {}),
    needsReview,
  };
}

// Type for the paged list result with document relations
// Note: tenantId and companyId are accessed through the document relation
export interface ProcessingDocumentWithDocument {
  id: string;
  documentId: string;
  isContainer: boolean;
  parentProcessingDocId: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  pageCount: number | null;
  pipelineStatus: PipelineStatus;
  duplicateStatus: DuplicateStatus;
  currentRevisionId: string | null;
  lockVersion: number;
  createdAt: Date;
  updatedAt: Date;
  document: {
    id: string;
    fileName: string;
    originalFileName: string | null;
    mimeType: string | null;
    fileSize: number | null;
    tenantId: string;
    companyId: string | null;
    company: {
      id: string;
      name: string;
    } | null;
  };
  currentRevision: {
    id: string;
    revisionNumber: number;
    status: RevisionStatus;
    documentCategory: DocumentCategory | null;
    documentSubCategory: string | null;
    vendorName: string | null;
    documentNumber: string | null;
    documentDate: Date | null;
    currency: string;
    subtotal: Decimal | null;
    taxAmount: Decimal | null;
    totalAmount: Decimal;
    homeCurrency: string | null;
    homeSubtotal: Decimal | null;
    homeTaxAmount: Decimal | null;
    homeEquivalent: Decimal | null;
  } | null;
}

/**
 * Get documents pending retry
 * When called without tenantId, returns all pending retries (for system-wide worker)
 * When tenantId is provided, scopes to that tenant
 */
export async function getDocumentsPendingRetry(options: {
  limit?: number;
  tenantId?: string;
} = {}): Promise<ProcessingDocumentWithRelations[]> {
  const { limit = 100, tenantId } = options;

  const where: Prisma.ProcessingDocumentWhereInput = {
    pipelineStatus: 'FAILED_RETRYABLE',
    canRetry: true,
    nextRetryAt: { lte: new Date() },
  };

  if (tenantId) {
    where.tenantId = tenantId;
  }

  return prisma.processingDocument.findMany({
    where,
    orderBy: [{ processingPriority: 'desc' }, { nextRetryAt: 'asc' }],
    take: limit,
  }) as Promise<ProcessingDocumentWithRelations[]>;
}

// ============================================================================
// Archive & Version Management
// ============================================================================

/**
 * Archive a document (when superseded by new version)
 */
export async function archiveDocument(
  processingDocumentId: string,
  tenantId: string,
  companyId: string,
  archivedById: string,
  reason: string
): Promise<void> {
  await prisma.processingDocument.update({
    where: { id: processingDocumentId },
    data: {
      deletedAt: new Date(),
      deletedReason: reason,
    },
  });

  // Clear duplicate references pointing to this document
  await clearDuplicateReferencesToDocument(processingDocumentId);

  await createStateEvent({
    processingDocumentId,
    tenantId,
    companyId,
    eventType: 'DOCUMENT_ARCHIVED',
    metadata: { reason },
    actorUserId: archivedById,
  });
}

/**
 * Mark document as new version of existing document
 */
export async function markAsNewVersion(
  newProcessingDocId: string,
  originalProcessingDocId: string,
  tenantId: string,
  companyId: string,
  userId: string
): Promise<void> {
  const original = await prisma.processingDocument.findUnique({
    where: { id: originalProcessingDocId },
    select: { rootDocumentId: true, version: true },
  });

  if (!original) {
    throw new Error(`Original document ${originalProcessingDocId} not found`);
  }

  const rootId = original.rootDocumentId || originalProcessingDocId;

  await prisma.$transaction([
    // Update new document with version chain info
    prisma.processingDocument.update({
      where: { id: newProcessingDocId },
      data: {
        rootDocumentId: rootId,
        version: original.version + 1,
        duplicateStatus: 'NONE',
      },
    }),
    // Soft delete the original (superseded)
    prisma.processingDocument.update({
      where: { id: originalProcessingDocId },
      data: {
        deletedAt: new Date(),
        deletedReason: 'SUPERSEDED_BY_NEW_VERSION',
      },
    }),
  ]);

  // Clear duplicate references pointing to the archived original document
  await clearDuplicateReferencesToDocument(originalProcessingDocId);

  await createStateEvent({
    processingDocumentId: newProcessingDocId,
    tenantId,
    companyId,
    eventType: 'MARKED_AS_NEW_VERSION',
    metadata: { originalProcessingDocId, rootDocumentId: rootId },
    actorUserId: userId,
  });
}

// ============================================================================
// Derived Files
// ============================================================================

/**
 * Create derived file record
 */
export async function createDerivedFile(input: {
  processingDocumentId: string;
  tenantId: string;
  companyId: string;
  kind: 'CHILD_PDF' | 'THUMBNAIL' | 'REDACTED_PDF';
  storageKey: string;
  mimeType: string;
  sizeBytes?: number;
  fingerprint?: string;
}): Promise<{ derivedFileId: string }> {
  const derivedFile = await prisma.documentDerivedFile.create({
    data: {
      processingDocumentId: input.processingDocumentId,
      tenantId: input.tenantId,
      companyId: input.companyId,
      kind: input.kind,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      fingerprint: input.fingerprint,
    },
  });

  return { derivedFileId: derivedFile.id };
}

/**
 * Get derived file by document and kind
 */
export async function getDerivedFile(
  processingDocumentId: string,
  kind: 'CHILD_PDF' | 'THUMBNAIL' | 'REDACTED_PDF'
): Promise<{ storageKey: string; mimeType: string } | null> {
  const file = await prisma.documentDerivedFile.findFirst({
    where: { processingDocumentId, kind },
    select: { storageKey: true, mimeType: true },
  });

  return file;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a state event for audit trail
 */
async function createStateEvent(input: {
  processingDocumentId: string;
  tenantId: string;
  companyId: string;
  eventType: string;
  fromState?: string;
  toState?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  actorUserId?: string;
  actorServiceId?: string;
}): Promise<void> {
  await prisma.documentStateEvent.create({
    data: {
      processingDocumentId: input.processingDocumentId,
      tenantId: input.tenantId,
      companyId: input.companyId,
      eventType: input.eventType,
      fromState: input.fromState,
      toState: input.toState,
      reason: input.reason,
      metadata: input.metadata as Prisma.InputJsonValue,
      actorUserId: input.actorUserId,
      actorServiceId: input.actorServiceId,
    },
  });
}

/**
 * Calculate BLAKE3 hash of file for duplicate detection
 *
 * BLAKE3 is 3-10x faster than SHA-256 while maintaining
 * cryptographic security. Ideal for large file deduplication.
 */
async function calculateFileHash(storageKey: string): Promise<string> {
  try {
    const fileBuffer = await storage.download(storageKey);
    return hashBlake3(fileBuffer);
  } catch (error) {
    log.error(`Failed to read file for hash calculation: ${storageKey}`, error);
    // Fallback: use key-based hash if file read fails
    return hashBlake3(storageKey);
  }
}

/**
 * Migrate BizFile Document to Processing Pipeline
 * 
 * Called when a company is created from a BizFile upload.
 * Moves the document from pending/ to companies/{companyId}/documents/
 * and creates ProcessingDocument + DocumentPage records.
 */
export async function migrateBizFileToProcessing(
  documentId: string,
  companyId: string,
  tenantId: string
): Promise<{ processingDocumentId: string; pageCount: number }> {
  log.info(`Migrating BizFile document ${documentId} to processing pipeline for company ${companyId}`);

  // Get the document
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      tenantId: true,
      storageKey: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      originalFileName: true,
    },
  });

  if (!document) {
    throw new Error(`Document ${documentId} not found`);
  }

  if (document.tenantId !== tenantId) {
    throw new Error(`Document ${documentId} does not belong to tenant ${tenantId}`);
  }

  // Check if already migrated (has ProcessingDocument)
  const existing = await prisma.processingDocument.findUnique({
    where: { documentId },
  });

  if (existing) {
    log.info(`Document ${documentId} already has ProcessingDocument ${existing.id}`);
    return {
      processingDocumentId: existing.id,
      pageCount: existing.pageCount || 0,
    };
  }

  // Generate new storage key for company documents folder
  const extension = document.fileName.match(/\.[^.]+$/)?.[0] || '';
  const newStorageKey = `${tenantId}/companies/${companyId}/documents/${documentId}/original${extension}`;

  // Move file in MinIO
  try {
    await storage.move(document.storageKey, newStorageKey);
    log.info(`Moved file from ${document.storageKey} to ${newStorageKey}`);
  } catch (error) {
    log.error(`Failed to move file from ${document.storageKey} to ${newStorageKey}:`, error);
    throw new Error(`Failed to move document file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Update document record in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Update Document with new storage key and company association
    await tx.document.update({
      where: { id: documentId },
      data: {
        companyId,
        storageKey: newStorageKey,
      },
    });

    // Calculate file hash for duplicate detection
    const fileHash = await calculateFileHash(newStorageKey);

    // Create ProcessingDocument
    const processingDoc = await tx.processingDocument.create({
      data: {
        documentId,
        tenantId,
        isContainer: true,
        pipelineStatus: 'UPLOADED',
        processingPriority: 'NORMAL',
        uploadSource: 'WEB',
        fileHash,
        contentTypeDetected: document.mimeType,
      },
    });

    // Create DocumentPage records
    const { pageCount } = await prepareDocumentPages(
      processingDoc.id,
      newStorageKey,
      document.mimeType || 'application/pdf'
    );

    log.info(`Created ProcessingDocument ${processingDoc.id} with ${pageCount} pages`);

    return {
      processingDocumentId: processingDoc.id,
      pageCount,
    };
  });

  return result;
}

// Export constants for use in other modules
export { PROCESSING_LIMITS, SLA_DEADLINES, RETRY_CONFIG };
