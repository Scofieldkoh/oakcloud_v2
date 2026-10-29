import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import {
  createErrorResponse,
  requireSessionWorkspaceId,
} from '@/lib/api-helpers';
import { getDocumentPartyOptions } from '@/services/document-party.service';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const { id } = await params;

    return NextResponse.json(
      await getDocumentPartyOptions(id, requireSessionWorkspaceId(session)),
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}
