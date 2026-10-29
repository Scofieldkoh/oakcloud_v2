import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { cloneDocumentSchema } from '@/lib/validations/generated-document';
import { cloneDocument } from '@/services/document-generator.service';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/generated-documents/[id]/clone
 * Clone a document
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check create permission (cloning creates a new document)
    await requirePermission(session, 'document', 'create');

    const body = await request.json();
    const data = cloneDocumentSchema.parse({ ...body, id });

    const tenantId = requireSessionWorkspaceId(session);

    const document = await cloneDocument(data, { tenantId, userId: session.id });

    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
