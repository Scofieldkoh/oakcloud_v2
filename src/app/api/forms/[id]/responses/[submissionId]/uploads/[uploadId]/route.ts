import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse, buildContentDispositionHeader } from '@/lib/api-helpers';
import { storage } from '@/lib/storage';
import { deleteFormResponseUpload, getSubmissionUploadById } from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{
    id: string;
    submissionId: string;
    uploadId: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, submissionId, uploadId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const disposition = searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';

    const upload = await getSubmissionUploadById(id, submissionId, uploadId, tenantId);
    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    const content = await storage.download(upload.storageKey);

    return new NextResponse(new Uint8Array(content), {
      status: 200,
      headers: {
        'Content-Type': upload.mimeType,
        'Content-Disposition': buildContentDispositionHeader(disposition, upload.fileName),
        'Content-Length': String(content.length),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, submissionId, uploadId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'delete');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const reason = searchParams.get('reason') || undefined;

    const result = await deleteFormResponseUpload(
      id,
      submissionId,
      uploadId,
      {
        tenantId,
        userId: session.id,
      },
      reason
    );

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
