import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { prisma } from '@/lib/prisma';
import { verifyPreparedBizFileRequest } from '@/services/bizfile/application/verify-prepared-request';
import { BizFilePreparationTokenError } from '@/services/bizfile/application/preparation-token';
import { normalizeExtractedData } from '@/services/bizfile/normalizer';
import { hashBizFileValue, processBizFileExtractionSelective, type ExtractedBizFileData, type OfficerAction } from '@/services/bizfile';
import { bizFileReviewSchema, normalizeBizFileReviewDraft } from '@/lib/validations/bizfile-review';
import {
  parseTaskLaunchContext,
  preflightTaskLaunchContext,
  safelyLinkCompanyTaskOutcome,
} from '@/services/tasks/integration.service';

/**
 * POST /api/documents/:documentId/apply-update
 *
 * Apply selective BizFile update to an existing company.
 * Only updates fields that have differences.
 *
 * Request body:
 * - companyId: string - The existing company ID to update
 * - extractedData: ExtractedBizFileData - The extracted data from preview
 * - officerActions?: OfficerAction[] - Actions for potentially ceased officers
 *
 * Permissions:
 * - TENANT_ADMIN or COMPANY_ADMIN with update permission
 * - SUPER_ADMIN for any company
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    // Parse request body
    const body = await request.json();
    const taskContext = parseTaskLaunchContext(body.taskContext);
    const { companyId, extractedData: rawExtractedData, officerActions, plan: rawPlan, operationId, preparationToken } = body as {
      companyId: string;
      extractedData: unknown;
      officerActions?: OfficerAction[];
      expectedUpdatedAt?: string; // ISO string from preview-diff for concurrent update detection
      plan?: unknown;
      operationId?: string;
      preparationToken?: string;
    };

    if (!companyId) {
      return NextResponse.json(
        { error: 'companyId is required' },
        { status: 400 }
      );
    }
    const parsed = bizFileReviewSchema.safeParse(rawExtractedData);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please correct the highlighted fields' },
        { status: 400 }
      );
    }
    const extractedData = normalizeBizFileReviewDraft(parsed.data) as ExtractedBizFileData;

    // Get document
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Get company for permission check
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, tenantId: true, name: true, uen: true, updatedAt: true },
    });

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Check tenant access
    if (document.tenantId !== company.tenantId || document.deletedAt) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!session.isSuperAdmin) {
      if (document.tenantId !== session.tenantId || company.tenantId !== session.tenantId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    if (company.uen !== extractedData.entityDetails.uen) {
      return NextResponse.json({ error: 'The reviewed UEN does not match the target company.' }, { status: 400 });
    }

    // Verify user can update this company
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      const canUpdate = session.companyIds?.includes(companyId);
      if (!canUpdate) {
        return NextResponse.json(
          { error: 'You do not have permission to update this company' },
          { status: 403 }
        );
      }
    }
    if (taskContext) {
      await preflightTaskLaunchContext(
        company.tenantId,
        taskContext,
        'COMPANY_PROFILE',
        session,
      );
    }

    const { plan, operationId: canonicalOperationId } = await verifyPreparedBizFileRequest({
      plan: rawPlan, token: preparationToken, operationId, actorId: session.id,
      tenantId: company.tenantId, documentId, taskContext,
    });
    if (plan.targetCompanyId !== companyId || plan.mode !== 'UPDATE') return NextResponse.json({ error: 'BizFile plan target or source mismatch' }, { status: 409 });
    if (hashBizFileValue(normalizeExtractedData(extractedData)) !== hashBizFileValue(plan.reviewedData)) return NextResponse.json({ error: 'Reviewed data changed after preparation. Prepare it again.' }, { status: 409 });
    if (hashBizFileValue(officerActions ?? []) !== hashBizFileValue(plan.officerActions ?? [])) return NextResponse.json({ error: 'Officer choices changed after preparation. Prepare them again.' }, { status: 409 });
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
          tenantId: company.tenantId,
          effectKind: 'STORAGE_FINALIZE',
          target: `document:${documentId}`,
          payload: { documentId, storageKey: document.storageKey, sourceHash: plan.sourceHash ?? null, sourceRevision: plan.sourceVersion ?? 0 },
          payloadHash: hashBizFileValue({ documentId, storageKey: document.storageKey, sourceHash: plan.sourceHash ?? null, sourceRevision: plan.sourceVersion ?? 0 }),
        },
        {
          tenantId: company.tenantId,
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

    // Apply selective update
    const result = await processBizFileExtractionSelective(documentId, extractedData, session.id, company.tenantId, companyId, officerActions, taskContext, plan, operationContext);
    if (taskContext) {
      await safelyLinkCompanyTaskOutcome({
        tenantId: company.tenantId,
        context: taskContext,
        authoritativeId: result.companyId,
        userId: session.id,
        session,
      });
    }

    // Build detailed message
    const messageParts: string[] = [];
    if (result.updatedFields.length > 0) {
      messageParts.push(`${result.updatedFields.length} company field(s)`);
    }
    if (result.officerChanges.added > 0 || result.officerChanges.updated > 0 || result.officerChanges.ceased > 0) {
      const officerParts = [];
      if (result.officerChanges.added > 0) officerParts.push(`${result.officerChanges.added} added`);
      if (result.officerChanges.updated > 0) officerParts.push(`${result.officerChanges.updated} updated`);
      if (result.officerChanges.ceased > 0) officerParts.push(`${result.officerChanges.ceased} ceased`);
      messageParts.push(`Officers: ${officerParts.join(', ')}`);
    }
    if (result.shareholderChanges.added > 0 || result.shareholderChanges.updated > 0 || result.shareholderChanges.removed > 0) {
      const shareholderParts = [];
      if (result.shareholderChanges.added > 0) shareholderParts.push(`${result.shareholderChanges.added} added`);
      if (result.shareholderChanges.updated > 0) shareholderParts.push(`${result.shareholderChanges.updated} updated`);
      if (result.shareholderChanges.removed > 0) shareholderParts.push(`${result.shareholderChanges.removed} removed`);
      messageParts.push(`Shareholders: ${shareholderParts.join(', ')}`);
    }

    const message = messageParts.length > 0
      ? `Updated: ${messageParts.join('; ')}`
      : 'No changes were needed - company data is already up to date';

    return NextResponse.json({
      success: true,
      companyId: result.companyId,
      created: result.created,
      updatedFields: result.updatedFields,
      officerChanges: result.officerChanges,
      shareholderChanges: result.shareholderChanges,
      operationId: canonicalOperationId,
      message,
    });
  } catch (error) {
    if (error instanceof BizFilePreparationTokenError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    console.error('BizFile apply-update error:', error);
    return routeErrorResponse(error);
  }
}
