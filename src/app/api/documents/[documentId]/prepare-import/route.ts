import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { evaluateFreshAuthorization } from '@/lib/fresh-authorization';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { issueBizFilePreparationToken } from '@/services/bizfile/application/preparation-token';
import { hashBizFileValue } from '@/services/bizfile/change-plan';
import { parseTaskLaunchContext } from '@/services/tasks/integration.service';
import {
  prepareBizFileImportCommand,
  type BizFileContactDecisionBinding,
  type ExtractedBizFileData,
} from '@/services/bizfile';
import {
  bizFileReviewSchema,
  issuesFromZodError,
  normalizeBizFileReviewDraft,
} from '@/lib/validations/bizfile-review';

const contactDecisionSchema = z.object({
  sourceRecordId: z.string().trim().min(1).max(200),
  decision: z.discriminatedUnion('action', [
    z.object({ action: z.literal('REUSE'), contactId: z.string().uuid() }),
    z.object({ action: z.literal('CREATE_SEPARATE'), reason: z.string().trim().min(10).max(500) }),
  ]),
  expectedContactUpdatedAt: z.string().datetime().optional(),
}).strict();

const requestSchema = z.object({
  extractedData: z.unknown().optional(),
  targetCompanyId: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(['CREATE', 'UPDATE']).optional(),
  sourceVersion: z.number().int().nonnegative().optional(),
  contactDecisions: z.record(contactDecisionSchema).optional(),
  selectedChangeIds: z.array(z.string().trim().min(1).max(300)).optional(),
  /** UI/task metadata is carried through preparation for recovery context. */
  taskContext: z.unknown().optional(),
  officerActions: z.array(z.object({
    officerId: z.string().min(1).max(200), action: z.enum(['cease', 'follow_up']),
    cessationDate: z.string().max(10).optional(),
  }).strict()).max(100).optional(),
}).strict();

function sourceHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceVersion(document: { sourceRevision?: number | null }): number {
  // sourceRevision is bumped whenever the source artifact or extraction changes.
  // The foundation default of zero is a real revision. Never substitute the
  // mutable document version because doing so would let the first source
  // update leave a prepared revision apparently current.
  return typeof document.sourceRevision === 'number' && Number.isSafeInteger(document.sourceRevision) && document.sourceRevision >= 0
    ? document.sourceRevision
    : 0;
}

function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

const SOURCE_ACCESS_FORBIDDEN = 'You do not have access to this source document. Ask a workspace administrator to grant document read access.';
const UPLOADER_RESTRICTION_FORBIDDEN = 'Only the uploader or a workspace administrator can prepare this document.';
const COMPANY_UPDATE_FORBIDDEN = 'You do not have permission to update the selected company. Ask a workspace administrator for access.';
const COMPANY_CREATE_FORBIDDEN = 'You do not have permission to create a company in this workspace. Ask a workspace administrator for access.';

/**
 * POST /api/documents/:documentId/prepare-import
 *
 * Build the server-trusted canonical BizFile proposal. This endpoint reads the
 * source and complete target baseline but never writes a company or receipt.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;
    const parsedBody = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsedBody.success) {
      return NextResponse.json({
        error: 'Invalid BizFile preparation request',
        issues: issuesFromZodError(parsedBody.error).issues,
      }, { status: 400 });
    }
    const body = parsedBody.data;
    const taskContext = parseTaskLaunchContext(body.taskContext);
    const document = await prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      select: { id: true, tenantId: true, uploadedById: true, extractedData: true, extractionStatus: true, storageKey: true, mimeType: true, originalFileName: true, version: true, sourceRevision: true },
    });
    if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    // Session/workspace fields are useful for the request shell, but they are
    // not the authority for a prepared proposal. Re-read the actor, workspace,
    // and source resource through the cache-free evaluator before touching
    // storage or exposing extracted content.
    const sourceDecision = await evaluateFreshAuthorization({
      userId: session.id,
      workspaceId: document.tenantId,
      permission: { resource: 'document', action: 'read' },
      resource: { kind: 'document', id: document.id },
    });
    if (!sourceDecision.allowed) return forbidden(SOURCE_ACCESS_FORBIDDEN);
    const freshActor = sourceDecision.actor;
    if (!freshActor) return forbidden(SOURCE_ACCESS_FORBIDDEN);
    if (document.uploadedById !== freshActor.id && !freshActor.isSuperAdmin && !freshActor.isWorkspaceAdmin) {
      return forbidden(UPLOADER_RESTRICTION_FORBIDDEN);
    }

    const candidate = body.extractedData ?? document.extractedData;
    const reviewed = bizFileReviewSchema.safeParse(candidate);
    if (!reviewed.success) {
      return NextResponse.json({
        error: 'Please correct the highlighted fields',
        issues: issuesFromZodError(reviewed.error).issues,
      }, { status: 400 });
    }
    const reviewedData = normalizeBizFileReviewDraft(reviewed.data) as ExtractedBizFileData;
    const mode = body.mode ?? (body.targetCompanyId ? 'UPDATE' : 'CREATE');
    if (mode === 'UPDATE' && !body.targetCompanyId) return NextResponse.json({ error: 'UPDATE requires targetCompanyId' }, { status: 400 });
    if (mode === 'CREATE' && body.targetCompanyId) return NextResponse.json({ error: 'CREATE cannot targetCompanyId' }, { status: 400 });

    if (body.targetCompanyId) {
      const company = await prisma.company.findFirst({ where: { id: body.targetCompanyId, tenantId: document.tenantId, deletedAt: null }, select: { id: true } });
      if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      const targetDecision = await evaluateFreshAuthorization({
        userId: session.id,
        workspaceId: document.tenantId,
        permission: { resource: 'company', action: 'update' },
        resource: { kind: 'company', id: body.targetCompanyId },
      });
      if (!targetDecision.allowed) return forbidden(COMPANY_UPDATE_FORBIDDEN);
    } else {
      const createDecision = await evaluateFreshAuthorization({
        userId: session.id,
        workspaceId: document.tenantId,
        permission: { resource: 'company', action: 'create' },
      });
      if (!createDecision.allowed) return forbidden(COMPANY_CREATE_FORBIDDEN);
    }

    if (!document.storageKey) return NextResponse.json({ error: 'Source document has no storage key' }, { status: 400 });
    let bytes: Buffer;
    try {
      bytes = await storage.download(document.storageKey);
    } catch {
      return NextResponse.json({ error: 'Source evidence is unavailable; prepare the import again when the original file is accessible' }, { status: 409 });
    }
    const prepared = await prepareBizFileImportCommand({
      tenantId: document.tenantId,
      documentId: document.id,
      reviewedData,
      targetCompanyId: body.targetCompanyId,
      // Never let a request body override the source revision bound to the
      // document row. A stale client must prepare against the current source.
      sourceVersion: sourceVersion(document),
      sourceHash: sourceHash(bytes),
      contactDecisions: body.contactDecisions as Record<string, BizFileContactDecisionBinding> | undefined,
      selectedChangeIds: body.selectedChangeIds,
      officerActions: body.officerActions,
    });
    if (prepared.plan.mode !== mode) return NextResponse.json({ error: 'Preparation mode does not match the target selection' }, { status: 409 });
    const { token, expiresAt } = issueBizFilePreparationToken({
      actorId: session.id, tenantId: document.tenantId, documentId,
      planHash: prepared.plan.canonicalHash, contextHash: hashBizFileValue(taskContext ?? null),
    });
    return NextResponse.json({
      success: true,
      plan: prepared.plan,
      source: { ...prepared.source, sourceRevision: sourceVersion(document) },
      contactCandidates: prepared.contactCandidates,
      preparationToken: token,
      expiresAt,
    });
  } catch (error) {
    console.error('BizFile prepare-import error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid BizFile preparation request', issues: issuesFromZodError(error).issues }, { status: 400 });
    }
    if (error instanceof Error && (error.message === 'BizFile source document not found' || error.message === 'BizFile target company not found')) {
      return NextResponse.json({ error: 'Document or company not found' }, { status: 404 });
    }
    if (error instanceof Error && error.name === 'BizFileChangePlanError') {
      const code = (error as Error & { code?: string }).code;
      if (code && ['OFFICER_ACTION_UNAVAILABLE', 'OFFICER_CESSATION_DATE', 'OFFICER_ACTION_CONFLICT'].includes(code)) {
        return NextResponse.json({ error: error.message }, { status: code === 'OFFICER_ACTION_CONFLICT' ? 409 : 400 });
      }
      return NextResponse.json({ error: 'BizFile preparation is stale; prepare the import again' }, { status: 409 });
    }
    // Do not expose provider, storage, database, or authorization details to a
    // caller when an unexpected preparation failure occurs.
    return routeErrorResponse(error);
  }
}
