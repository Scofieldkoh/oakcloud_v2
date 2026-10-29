import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { OAKDOC_MIME_TYPE } from '@/lib/document-editor/oakdoc-template';
import { parsePlaceholdersFormField } from '@/lib/validations/document-template';
import {
  downloadOakDocPartial,
  updateOakDocPartial,
} from '@/services/oakdoc-partial.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/template-partials/[id]/oakdoc: the Word partial's current DOCX. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const tenantId = requireSessionWorkspaceId(session);
    const { id } = await params;

    const { buffer, metadata, version } = await downloadOakDocPartial(id, tenantId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': OAKDOC_MIME_TYPE,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.fileName)}"`,
        'Cache-Control': 'private, no-store',
        ETag: `"${metadata.sha256}"`,
        'X-OakDoc-Revision': String(version),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * PUT /api/template-partials/[id]/oakdoc
 * Save new DOCX bytes (multipart: file, expectedRevision, refreshPins?=all,
 * placeholders? as JSON to replace the partial's custom fields).
 * Templates that use this partial keep their pinned version.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');
    const tenantId = requireSessionWorkspaceId(session);
    const { id } = await params;

    const formData = await request.formData();
    const file = formData.get('file');
    const expectedRevision = Number(formData.get('expectedRevision'));
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'DOCX file is required' }, { status: 400 });
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return NextResponse.json({ error: 'expectedRevision is required' }, { status: 428 });
    }

    const partial = await updateOakDocPartial({
      id,
      expectedRevision,
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
      refreshPins: formData.get('refreshPins') === 'all' ? 'all' : undefined,
      placeholders: parsePlaceholdersFormField(formData.get('placeholders')),
    }, { tenantId, userId: session.id });
    return NextResponse.json({ ...partial, revision: partial.version });
  } catch (error) {
    return createErrorResponse(error);
  }
}
