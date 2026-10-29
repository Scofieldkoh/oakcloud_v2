import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { prisma } from '@/lib/prisma';
import { verifyPreparedBizFileRequest } from '@/services/bizfile/application/verify-prepared-request';
import { BizFilePreparationTokenError } from '@/services/bizfile/application/preparation-token';
import { normalizeExtractedData } from '@/services/bizfile/normalizer';
import { hashBizFileValue, processBizFileExtraction } from '@/services/bizfile';
import {
  bizFileReviewSchema,
  issuesFromZodError,
  normalizeBizFileReviewDraft,
} from '@/lib/validations/bizfile-review';
import {
  parseTaskLaunchContext,
  preflightTaskLaunchContext,
  safelyLinkCompanyTaskOutcome,
} from '@/services/tasks/integration.service';

/**
 * POST /api/documents/:documentId/confirm
 *
 * Save the previously extracted BizFile data.
 * Creates/updates the company and all related records.
 * Document must be in EXTRACTED status (set by the extract endpoint).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (!session.isSuperAdmin && document.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (
      document.uploadedById !== session.id &&
      !session.isSuperAdmin &&
      !session.isWorkspaceAdmin
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!document.extractionStatus || !['EXTRACTED', 'COMPLETED'].includes(document.extractionStatus)) {
      return NextResponse.json({ error: 'Document extraction not ready for confirmation' }, { status: 400 });
    }
    if (!document.extractedData) {
      return NextResponse.json(
        { error: 'No extracted data found on document' },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: 'Please correct the highlighted fields',
          issues: [{
            path: 'request',
            message: 'Enter a valid request body',
            section: 'entity',
          }],
        },
        { status: 400 }
      );
    }
    const candidate = typeof body === 'object' && body !== null && 'extractedData' in body
      ? (body as { extractedData: unknown }).extractedData
      : undefined;
    const taskContext = parseTaskLaunchContext(
      typeof body === 'object' && body !== null && 'taskContext' in body
        ? (body as { taskContext: unknown }).taskContext
        : undefined,
    );
    const rawPlan = typeof body === 'object' && body !== null && 'plan' in body
      ? (body as { plan: unknown }).plan
      : undefined;
    const operationId = typeof body === 'object' && body !== null && 'operationId' in body && typeof (body as { operationId?: unknown }).operationId === 'string'
      ? (body as { operationId: string }).operationId
      : undefined;
    const preparationToken = typeof body === 'object' && body !== null && 'preparationToken' in body && typeof (body as { preparationToken?: unknown }).preparationToken === 'string'
      ? (body as { preparationToken: string }).preparationToken
      : undefined;
    const parsed = bizFileReviewSchema.safeParse(candidate);

    if (!parsed.success) {
      const validation = issuesFromZodError(parsed.error);
      return NextResponse.json(
        { error: 'Please correct the highlighted fields', issues: validation.issues },
        { status: 400 }
      );
    }
    if (taskContext) {
      await preflightTaskLaunchContext(
        document.tenantId,
        taskContext,
        'COMPANY_PROFILE',
        session,
      );
    }

    const correctedData = normalizeBizFileReviewDraft(parsed.data);
    const { plan, operationId: canonicalOperationId } = await verifyPreparedBizFileRequest({
      plan: rawPlan, token: preparationToken, operationId, actorId: session.id,
      tenantId: document.tenantId, documentId, taskContext,
    });
    if (plan.mode !== 'CREATE' || plan.targetCompanyId) return NextResponse.json({ error: 'Confirm requires a CREATE BizFile plan for this source document' }, { status: 409 });
    if (hashBizFileValue(normalizeExtractedData(correctedData)) !== hashBizFileValue(plan.reviewedData)) return NextResponse.json({ error: 'Reviewed data changed after preparation. Prepare it again.' }, { status: 409 });
    if (document.extractionStatus === 'COMPLETED') {
      const committed = await prisma.bizFileOperationReceipt.findFirst({ where: {
        tenantId: document.tenantId, operationId: canonicalOperationId, documentId,
        payloadHash: plan.canonicalHash, status: 'COMMITTED',
      }, select: { id: true } });
      if (!committed) return NextResponse.json({ error: 'This document has already been confirmed by a different operation.' }, { status: 409 });
    }
    const operationContext = {
      operationId: canonicalOperationId,
      capabilityId: 'bizfile.import_and_review',
      capabilityVersion: '1.0',
      schemaVersion: '1',
      sourceEvidence: {
        documentId,
        sourceVersion: plan.sourceVersion ?? 0,
        sourceHash: plan.sourceHash ?? null,
        storageKey: document.storageKey,
        mimeType: document.mimeType,
      },
      effectIntents: [
        {
          tenantId: document.tenantId,
          effectKind: 'STORAGE_FINALIZE',
          target: `document:${documentId}`,
          payload: { documentId, storageKey: document.storageKey, sourceHash: plan.sourceHash ?? null, sourceRevision: plan.sourceVersion ?? 0 },
          payloadHash: hashBizFileValue({ documentId, storageKey: document.storageKey, sourceHash: plan.sourceHash ?? null, sourceRevision: plan.sourceVersion ?? 0 }),
        },
        {
          tenantId: document.tenantId,
          effectKind: 'PAGE_PREPARATION',
          target: `document:${documentId}`,
          payload: {
            documentId,
            storageKey: document.storageKey,
            mimeType: document.mimeType,
            sourceHash: plan.sourceHash ?? null,
            sourceRevision: plan.sourceVersion ?? 0,
            finalizedSourceRevision: (plan.sourceVersion ?? 0) + 1,
          },
          payloadHash: hashBizFileValue({
            documentId,
            storageKey: document.storageKey,
            mimeType: document.mimeType,
            sourceHash: plan.sourceHash ?? null,
            sourceRevision: plan.sourceVersion ?? 0,
            finalizedSourceRevision: (plan.sourceVersion ?? 0) + 1,
          }),
        },
      ],
    };
    const result = await processBizFileExtraction(
      documentId,
      correctedData,
      session.id,
      document.tenantId,
      document.storageKey || undefined,
      document.mimeType,
      taskContext,
      plan,
      operationContext,
    );
    if (taskContext) {
      await safelyLinkCompanyTaskOutcome({
        tenantId: document.tenantId,
        context: taskContext,
        authoritativeId: result.companyId,
        userId: session.id,
        session,
      });
    }

    return NextResponse.json({
      success: true,
      companyId: result.companyId,
      created: result.created,
      operationId: canonicalOperationId,
      operationReceiptId: result.operationReceiptId,
    });
  } catch (error) {
    if (error instanceof BizFilePreparationTokenError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid task context', details: error.errors },
        { status: 400 },
      );
    }
    console.error('Document confirm error:', error);
    return routeErrorResponse(error);
  }
}
