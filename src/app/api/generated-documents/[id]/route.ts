import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { updateGeneratedDocumentSchema } from '@/lib/validations/generated-document';
import {
  getGeneratedDocumentById,
  updateGeneratedDocument,
  deleteGeneratedDocument,
  archiveDocument,
} from '@/services/document-generator.service';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { readGeneratedDocumentEngine } from '@/lib/document-editor/document-engine';
import {
  downloadGeneratedOakDoc,
  saveGeneratedOakDocDocument,
} from '@/services/oakdoc-generation.service';
import { saveOakDocBatchDraft } from '@/services/document-generation-batch/oakdoc-draft.service';
import { OAKDOC_PACKAGE_LIMITS } from '@/lib/document-editor/oakdoc-package-policy';
import { ValidationError } from '@/lib/errors';
import { RevisionPreconditionRequiredError } from '@/lib/document-editor/revision-concurrency';
import type { OakDocSnapshotIdentity } from '@/types/oakdoc';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseExpectedRevision(value: string | null): number | undefined {
  if (value === null) return undefined;
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error('expectedRevision must be a non-negative integer');
  }
  return revision;
}

function parseRequiredRevision(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : null;
}

function parseOperationId(value: string | null): string | undefined {
  if (!value) return undefined;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(value)) {
    throw new ValidationError('operationId is invalid');
  }
  return value;
}

function parseSnapshotIdentity(searchParams: URLSearchParams): OakDocSnapshotIdentity | undefined {
  const sessionKey = searchParams.get('sessionKey');
  const writerInstanceId = searchParams.get('writerInstanceId');
  const localRevision = parseRequiredRevision(searchParams.get('localRevision'));
  const baseRevision = parseRequiredRevision(searchParams.get('baseRevision'));
  if (!sessionKey || !writerInstanceId || localRevision === null || baseRevision === null) return undefined;
  if (sessionKey.length > 200 || writerInstanceId.length > 200) {
    throw new ValidationError('OakDoc snapshot identity is invalid');
  }
  return { sessionKey, writerInstanceId, localRevision, baseRevision };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = requireSessionWorkspaceId(session);
    const includeDeleted = searchParams.get('includeDeleted') === 'true' && session.isWorkspaceAdmin;
    const includeComments = searchParams.get('includeComments') === 'true';
    const wantsOakDocBytes = searchParams.get('format') === 'docx';
    const document = await getGeneratedDocumentById(id, tenantId, {
      includeDeleted,
      includeComments,
      includeBatchDrafts: wantsOakDocBytes,
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    if (wantsOakDocBytes) {
      if (readGeneratedDocumentEngine(document.metadata) !== 'OAKDOC') {
        return NextResponse.json(
          { error: 'DOCX download is only available for OakDoc documents' },
          { status: 409 },
        );
      }
      const asset = await downloadGeneratedOakDoc(id, tenantId);
      return new NextResponse(new Uint8Array(asset.buffer), {
        headers: {
          'Content-Type': asset.metadata.mimeType,
          'Content-Disposition': `attachment; filename="${asset.metadata.fileName.replace(/"/g, '')}"`,
          'Content-Length': String(asset.buffer.byteLength),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    return NextResponse.json(document);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'update');
    const tenantId = requireSessionWorkspaceId(session);
    const { searchParams } = new URL(request.url);

    if (searchParams.get('format') === 'docx') {
      const declaredLength = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(declaredLength) && declaredLength > OAKDOC_PACKAGE_LIMITS.draftCompressedBytes) {
        return NextResponse.json(
          { error: 'The OakDoc document exceeds the 50 MB limit' },
          { status: 413 },
        );
      }
      const expectedBatchRevisionParam = searchParams.get('expectedBatchRevision');
      const bytes = new Uint8Array(await request.arrayBuffer());

      if (expectedBatchRevisionParam !== null) {
        const expectedBatchRevision = parseRequiredRevision(expectedBatchRevisionParam);
        const previewFingerprint = searchParams.get('previewFingerprint') ?? '';
        if (expectedBatchRevision === null) {
          return NextResponse.json(
            { error: 'expectedBatchRevision must be a non-negative integer' },
            { status: 400 },
          );
        }
        const batch = await saveOakDocBatchDraft({
          generatedDocumentId: id,
          expectedBatchRevision,
          previewFingerprint,
          bytes,
        }, {
          tenantId,
          userId: session.id,
        });
        return NextResponse.json(batch);
      }

      // A missing query value must not become revision 0 through Number(null).
      const expectedRevision = parseRequiredRevision(searchParams.get('expectedRevision'));
      if (expectedRevision === null) {
        throw new RevisionPreconditionRequiredError('generated-document');
      }
      const receipt = await saveGeneratedOakDocDocument({
        documentId: id,
        expectedRevision,
        bytes,
        operationId: parseOperationId(request.headers.get('idempotency-key') ?? searchParams.get('operationId')),
        snapshot: parseSnapshotIdentity(searchParams),
      }, {
        tenantId,
        userId: session.id,
      });
      return NextResponse.json(receipt);
    }

    const body = await request.json();
    const data = updateGeneratedDocumentSchema.parse({ ...body, id });
    const document = await updateGeneratedDocument(
      data,
      { tenantId, userId: session.id },
      body.reason,
    );
    return NextResponse.json(document);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'delete');

    const { searchParams } = new URL(request.url);
    const reason = searchParams.get('reason');
    if (!reason) {
      return NextResponse.json({ error: 'Reason is required for deletion' }, { status: 400 });
    }
    const expectedRevision = parseExpectedRevision(searchParams.get('expectedRevision'));
    const tenantId = requireSessionWorkspaceId(session);
    const document = await deleteGeneratedDocument(
      id,
      { tenantId, userId: session.id },
      reason,
      expectedRevision,
    );
    return NextResponse.json(document);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'update');

    const body = await request.json();
    if (body.action !== 'archive') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    if (!body.reason) {
      return NextResponse.json({ error: 'Reason is required for archiving' }, { status: 400 });
    }
    if (
      body.expectedRevision !== undefined
      && (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)
    ) {
      return NextResponse.json({ error: 'expectedRevision must be a non-negative integer' }, { status: 400 });
    }

    const tenantId = requireSessionWorkspaceId(session);
    const document = await archiveDocument(
      id,
      { tenantId, userId: session.id },
      body.reason,
      body.expectedRevision,
    );
    return NextResponse.json(document);
  } catch (error) {
    return createErrorResponse(error);
  }
}
