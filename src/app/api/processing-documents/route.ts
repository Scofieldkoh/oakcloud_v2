/**
 * Processing Documents API
 *
 * POST /api/processing-documents - Upload document for processing
 * GET /api/processing-documents - List processing documents
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import {
  uploadDocument,
  prepareDocumentPages,
  queueDocumentForProcessing,
  listProcessingDocumentsPaged,
  PROCESSING_LIMITS,
} from '@/services/document-processing.service';
import {
  checkForDuplicates,
  updateDuplicateStatus,
} from '@/services/duplicate-detection.service';
import {
  extractFields,
} from '@/services/document-extraction.service';
import { storage, StorageKeys } from '@/lib/storage';
import type { ProcessingPriority, UploadSource, PipelineStatus, DuplicateStatus, RevisionStatus } from '@/generated/prisma';

const INTERNAL_DEFAULT_TIME_ZONE = 'Asia/Singapore';

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value || '';

  // Examples: "GMT+8", "GMT+08:00", "UTC", "GMT"
  const match = /(?:GMT|UTC)([+-]\d{1,2})(?::(\d{2}))?/.exec(tz);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  return hours * 60 + Math.sign(hours) * minutes;
}

function dateOnlyToUtcStartEnd(isoDate: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = isoDate.split('-').map((v) => parseInt(v, 10));
  const utcMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));

  let offset = getTimeZoneOffsetMinutes(utcMidnight, timeZone);
  let start = new Date(utcMidnight.getTime() - offset * 60_000);
  const offset2 = getTimeZoneOffsetMinutes(start, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    start = new Date(utcMidnight.getTime() - offset * 60_000);
  }

  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

function nowDateOnlyInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

/**
 * GET /api/processing-documents
 * List processing documents with page-based pagination and filters
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 200)
 * - sortBy: Sort field (createdAt, updatedAt, pipelineStatus, duplicateStatus)
 * - sortOrder: Sort direction (asc, desc)
 * - pipelineStatus: Filter by pipeline status
 * - duplicateStatus: Filter by duplicate status
 * - isContainer: Filter by container/child type
 * - companyId: Optional company filter (if not provided, shows all accessible companies)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const pageStr = searchParams.get('page');
    const limitStr = searchParams.get('limit');
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';
    const pipelineStatus = searchParams.get('pipelineStatus') as PipelineStatus | null;
    const duplicateStatus = searchParams.get('duplicateStatus') as DuplicateStatus | null;
    const revisionStatus = searchParams.get('revisionStatus') as RevisionStatus | null;
    const needsReview = searchParams.get('needsReview') === 'true' ? true : undefined;
    const isContainerStr = searchParams.get('isContainer');
    const companyId = searchParams.get('companyId');

    // New filter parameters
    const uploadDatePreset = searchParams.get('uploadDatePreset') as 'TODAY' | null;
    const uploadDateFrom = searchParams.get('uploadDateFrom');
    const uploadDateTo = searchParams.get('uploadDateTo');
    const documentDateFrom = searchParams.get('documentDateFrom');
    const documentDateTo = searchParams.get('documentDateTo');
    const search = searchParams.get('search');
    const vendorName = searchParams.get('vendorName');
    const documentNumber = searchParams.get('documentNumber');
    const fileName = searchParams.get('fileName');
    const documentCategory = searchParams.get('documentCategory') || undefined;
    const documentSubCategory = searchParams.get('documentSubCategory') || undefined;
    const tagIds = searchParams.get('tagIds')?.split(',').filter(Boolean) || undefined;

    // Currency filters
    const currency = searchParams.get('currency') || undefined;
    const homeCurrency = searchParams.get('homeCurrency') || undefined;

    // Amount filters - single value mode
    const subtotal = searchParams.get('subtotal');
    const tax = searchParams.get('tax');
    const total = searchParams.get('total');
    const homeSubtotal = searchParams.get('homeSubtotal');
    const homeTax = searchParams.get('homeTax');
    const homeTotal = searchParams.get('homeTotal');

    // Amount filters - range mode
    const subtotalFrom = searchParams.get('subtotalFrom');
    const subtotalTo = searchParams.get('subtotalTo');
    const taxFrom = searchParams.get('taxFrom');
    const taxTo = searchParams.get('taxTo');
    const totalFrom = searchParams.get('totalFrom');
    const totalTo = searchParams.get('totalTo');
    const homeSubtotalFrom = searchParams.get('homeSubtotalFrom');
    const homeSubtotalTo = searchParams.get('homeSubtotalTo');
    const homeTaxFrom = searchParams.get('homeTaxFrom');
    const homeTaxTo = searchParams.get('homeTaxTo');
    const homeTotalFrom = searchParams.get('homeTotalFrom');
    const homeTotalTo = searchParams.get('homeTotalTo');

    const page = pageStr ? parseInt(pageStr, 10) : 1;
    const parsedLimit = limitStr ? parseInt(limitStr, 10) : 20;
    const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 20, 200));
    const isContainer =
      isContainerStr === 'true' ? true : isContainerStr === 'false' ? false : undefined;

    const effectiveTenantId: string | null = session.tenantId;

    // Determine accessible company IDs
    let companyIds: string[] | undefined;

    if (companyId) {
      // If specific company requested, verify access
      if (!(await canAccessCompany(session, companyId))) {
        return NextResponse.json(
          {
            success: false,
            error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
          },
          { status: 403 }
        );
      }
      companyIds = [companyId];
    } else if (!session.isSuperAdmin && !session.isWorkspaceAdmin && !session.hasAllCompaniesAccess) {
      // Company-scoped users: filter by their assigned companies
      companyIds = session.companyIds;
    }
    // SUPER_ADMIN, TENANT_ADMIN, and users with hasAllCompaniesAccess see all documents in the tenant

    // Internal app date filters use the default workspace timezone. Avoid a
    // tenant settings lookup on every processing list request.
    const timeZone = INTERNAL_DEFAULT_TIME_ZONE;

    // For TIMESTAMP fields (createdAt/uploadDate): convert using tenant timezone
    const parseTimestampFrom = (value: string | null): Date | undefined => {
      if (!value) return undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return dateOnlyToUtcStartEnd(value, timeZone).start;
      }
      const dt = new Date(value);
      return isNaN(dt.getTime()) ? undefined : dt;
    };

    const parseTimestampTo = (value: string | null): Date | undefined => {
      if (!value) return undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return dateOnlyToUtcStartEnd(value, timeZone).end;
      }
      const dt = new Date(value);
      return isNaN(dt.getTime()) ? undefined : dt;
    };

    // For DATE fields (documentDate): use midnight UTC, no timezone conversion needed
    // PostgreSQL DATE columns have no time component, so comparing at midnight UTC is correct
    const parseDateOnly = (value: string | null): Date | undefined => {
      if (!value) return undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map((v) => parseInt(v, 10));
        return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
      }
      const dt = new Date(value);
      return isNaN(dt.getTime()) ? undefined : dt;
    };

    let effectiveUploadDateFrom: Date | undefined;
    let effectiveUploadDateTo: Date | undefined;

    if (uploadDatePreset === 'TODAY') {
      const today = nowDateOnlyInTimeZone(timeZone);
      const range = dateOnlyToUtcStartEnd(today, timeZone);
      effectiveUploadDateFrom = range.start;
      effectiveUploadDateTo = range.end;
    } else {
      effectiveUploadDateFrom = parseTimestampFrom(uploadDateFrom);
      effectiveUploadDateTo = parseTimestampTo(uploadDateTo);
    }

    // Document date uses DATE column - no timezone conversion needed
    const effectiveDocumentDateFrom = parseDateOnly(documentDateFrom);
    const effectiveDocumentDateTo = parseDateOnly(documentDateTo);

    // Parse amount filters (convert strings to numbers)
    const parseAmount = (value: string | null): number | undefined => {
      if (!value) return undefined;
      const num = parseFloat(value);
      return isNaN(num) ? undefined : num;
    };

    const loadPagedDocuments = () =>
      listProcessingDocumentsPaged({
        tenantId: effectiveTenantId,
        companyIds,
        pipelineStatus: pipelineStatus ?? undefined,
      duplicateStatus: duplicateStatus ?? undefined,
      revisionStatus: revisionStatus ?? undefined,
      needsReview,
      isContainer,
      page,
      limit,
      sortBy,
      sortOrder,
      // New filter parameters
      uploadDateFrom: effectiveUploadDateFrom,
      uploadDateTo: effectiveUploadDateTo,
      documentDateFrom: effectiveDocumentDateFrom,
      documentDateTo: effectiveDocumentDateTo,
      search: search ?? undefined,
      vendorName: vendorName ?? undefined,
      documentNumber: documentNumber ?? undefined,
      fileName: fileName ?? undefined,
      documentCategory: documentCategory ?? undefined,
      documentSubCategory: documentSubCategory ?? undefined,
      tagIds,
      // Currency filters
      currency,
      homeCurrency,
      // Amount filters - single value mode
      subtotal: parseAmount(subtotal),
      tax: parseAmount(tax),
      total: parseAmount(total),
      homeSubtotal: parseAmount(homeSubtotal),
      homeTax: parseAmount(homeTax),
      homeTotal: parseAmount(homeTotal),
      // Amount filters - range mode
      subtotalFrom: parseAmount(subtotalFrom),
      subtotalTo: parseAmount(subtotalTo),
      taxFrom: parseAmount(taxFrom),
      taxTo: parseAmount(taxTo),
      totalFrom: parseAmount(totalFrom),
      totalTo: parseAmount(totalTo),
      homeSubtotalFrom: parseAmount(homeSubtotalFrom),
      homeSubtotalTo: parseAmount(homeSubtotalTo),
      homeTaxFrom: parseAmount(homeTaxFrom),
      homeTaxTo: parseAmount(homeTaxTo),
        homeTotalFrom: parseAmount(homeTotalFrom),
        homeTotalTo: parseAmount(homeTotalTo),
      });

    // Get documents with paged results. Reconciliation is intentionally not
    // performed during list reads; use the explicit reconcile endpoint instead.
    const result = await loadPagedDocuments();

    // Transform for API response (convert Decimal to string, Date to ISO string)
    const documents = result.documents.map((doc) => ({
      id: doc.id,
      documentId: doc.documentId,
      isContainer: doc.isContainer,
      parentProcessingDocId: doc.parentProcessingDocId,
      pageFrom: doc.pageFrom,
      pageTo: doc.pageTo,
      pageCount: doc.pageCount,
      pipelineStatus: doc.pipelineStatus,
      duplicateStatus: doc.duplicateStatus,
      currentRevisionId: doc.currentRevisionId,
      lockVersion: doc.lockVersion,
      createdAt: doc.createdAt.toISOString(),
      document: {
        id: doc.document.id,
        fileName: doc.document.fileName || doc.document.originalFileName,
        mimeType: doc.document.mimeType,
        fileSize: doc.document.fileSize,
        companyId: doc.document.companyId,
        company: doc.document.company,
      },
      currentRevision: doc.currentRevision
        ? {
          id: doc.currentRevision.id,
          revisionNumber: doc.currentRevision.revisionNumber,
          status: doc.currentRevision.status,
          documentCategory: doc.currentRevision.documentCategory,
          documentSubCategory: doc.currentRevision.documentSubCategory,
          vendorName: doc.currentRevision.vendorName,
          documentNumber: doc.currentRevision.documentNumber,
          documentDate: doc.currentRevision.documentDate?.toISOString() ?? null,
          currency: doc.currentRevision.currency,
          subtotal: doc.currentRevision.subtotal?.toString() ?? null,
          taxAmount: doc.currentRevision.taxAmount?.toString() ?? null,
          totalAmount: doc.currentRevision.totalAmount.toString(),
          homeCurrency: doc.currentRevision.homeCurrency,
          homeSubtotal: doc.currentRevision.homeSubtotal?.toString() ?? null,
          homeTaxAmount: doc.currentRevision.homeTaxAmount?.toString() ?? null,
          homeEquivalent: doc.currentRevision.homeEquivalent?.toString() ?? null,
        }
        : undefined,
      // Tags removed - fetched lazily by DocumentTags component
    }));

    return NextResponse.json({
      success: true,
      data: {
        documents,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error, 'processing-documents');
  }
}

/**
 * POST /api/processing-documents
 * Upload document for processing
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const companyId = formData.get('companyId') as string;
    const priority = (formData.get('priority') as ProcessingPriority) || 'NORMAL';
    const uploadSource = (formData.get('uploadSource') as UploadSource) || 'WEB';
    const metadataStr = formData.get('metadata') as string | null;
    const idempotencyKey = request.headers.get('Idempotency-Key');
    const skipExtraction = formData.get('skipExtraction') === 'true';
    const batchMode = formData.get('batchMode') === 'true';
    // AI model selection (optional - consistent with BizFile upload)
    const modelId = formData.get('modelId') as string | null;
    const additionalContext = formData.get('additionalContext') as string | null;

    // Validate required fields
    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'No file provided' },
        },
        { status: 400 }
      );
    }

    if (!companyId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'companyId is required' },
        },
        { status: 400 }
      );
    }

    // Check permission
    await requirePermission(session, 'document', 'create', companyId);

    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    // Validate file size
    if (file.size > PROCESSING_LIMITS.MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File size exceeds maximum of ${PROCESSING_LIMITS.MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
          },
        },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/tiff',
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_FILE_TYPE',
            message: 'Only PDF and image files are allowed',
          },
        },
        { status: 400 }
      );
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { key: idempotencyKey },
      });

      if (existing && existing.expiresAt > new Date()) {
        return NextResponse.json(existing.response, {
          status: existing.statusCode,
        });
      }
    }

    // Get company for tenant context
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { tenantId: true },
    });

    if (!company) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Company not found' },
        },
        { status: 404 }
      );
    }

    // Generate document ID and storage key
    const documentId = uuidv4();
    const extension = StorageKeys.getExtension(file.name, file.type);
    const storageKey = StorageKeys.documentOriginal(company.tenantId, companyId, documentId, extension);

    // Upload file to storage
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await storage.upload(storageKey, buffer, {
      contentType: file.type,
      metadata: {
        originalFileName: file.name,
        uploadedBy: session.id,
      },
    });

    // Create base document record
    const document = await prisma.document.create({
      data: {
        id: documentId,
        tenantId: company.tenantId,
        companyId,
        uploadedById: session.id,
        documentType: 'UPLOADED',
        fileName: `${documentId}${extension}`,
        originalFileName: file.name,
        storageKey,
        fileSize: file.size,
        mimeType: file.type,
        version: 1,
        extractionStatus: 'PENDING',
      },
    });

    // Upload document for processing (this calculates file hash internally)
    const { processingDocument, jobId } = await uploadDocument({
      documentId: document.id,
      tenantId: company.tenantId,
      companyId,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      storageKey,
      priority,
      uploadSource,
      metadata: metadataStr ? JSON.parse(metadataStr) : undefined,
    });

    // Check for duplicates using the file hash calculated during upload
    const duplicateCheckResult = await checkForDuplicates(
      processingDocument.id,
      company.tenantId,
      companyId
    );

    // Update duplicate status on the processing document if duplicates found
    if (duplicateCheckResult.hasPotentialDuplicate) {
      await updateDuplicateStatus(processingDocument.id, duplicateCheckResult);
    }

    if (skipExtraction) {
      // Keep status at UPLOADED so users can manually enter fields or trigger extraction later.
      await prepareDocumentPages(processingDocument.id, storageKey, file.type);
    } else {
      // Queue for processing - pass storage key so pages can be created
      await queueDocumentForProcessing(
        processingDocument.id,
        company.tenantId,
        companyId,
        storageKey,
        file.type
      );
    }

    if (!skipExtraction) {
      // Auto-trigger extraction immediately after upload (async, don't block response)
      // This runs in the background so users don't have to manually trigger extraction
      // Pass model and context if specified by user
      const extractionConfig: { model?: string; additionalContext?: string; batchMode?: boolean } = {};
      if (modelId) {
        extractionConfig.model = modelId;
      }
      if (additionalContext) {
        extractionConfig.additionalContext = additionalContext;
      }
      if (batchMode) {
        extractionConfig.batchMode = true;
      }

      extractFields(processingDocument.id, company.tenantId, companyId, session.id, extractionConfig)
        .then((result) => {
          if (!result.success) {
            console.error(`Auto-extraction failed for document ${processingDocument.id}:`, result.error);
          }
        })
        .catch((error) => {
          console.error(`Auto-extraction error for document ${processingDocument.id}:`, error);
        });
    }

    // Create audit log
    await createAuditLog({
      tenantId: company.tenantId,
      userId: session.id,
      companyId,
      action: 'UPLOAD',
      entityType: 'ProcessingDocument',
      entityId: processingDocument.id,
      entityName: file.name,
      summary: `Uploaded document for processing: "${file.name}"`,
      changeSource: 'MANUAL',
      metadata: {
        priority,
        uploadSource,
        fileSize: file.size,
        skipExtraction,
        batchMode,
      },
    });

    const response = {
      success: true,
      data: {
        document: {
          id: processingDocument.id,
          documentId: document.id,
          fileName: file.name,
          pipelineStatus: processingDocument.pipelineStatus,
          isContainer: processingDocument.isContainer,
          duplicateStatus: duplicateCheckResult.hasPotentialDuplicate ? 'SUSPECTED' : 'NONE',
          autoExtractionTriggered: !skipExtraction,
        },
        jobId,
        duplicateWarning: duplicateCheckResult.hasPotentialDuplicate
          ? {
            originalDocumentId: duplicateCheckResult.exactFileHashMatch?.documentId
              || duplicateCheckResult.candidates[0]?.documentId,
            message: duplicateCheckResult.exactFileHashMatch
              ? 'An exact duplicate of this file already exists'
              : `Potential duplicate detected (${(duplicateCheckResult.candidates[0]?.score.totalScore * 100).toFixed(0)}% match)`,
          }
          : undefined,
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    };

    // Store idempotency record
    if (idempotencyKey) {
      await prisma.idempotencyRecord.create({
        data: {
          key: idempotencyKey,
          tenantId: company.tenantId,
          endpoint: '/api/processing-documents',
          method: 'POST',
          requestHash: '',
          response: response as object,
          statusCode: 202,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });
    }

    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    return handleApiError(error, 'processing-documents');
  }
}
