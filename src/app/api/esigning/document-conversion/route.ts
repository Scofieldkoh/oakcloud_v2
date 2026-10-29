import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { hasMicrosoftGraphDocumentConversionConnector } from '@/services/microsoft-graph-document-conversion.service';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'update');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const wordUploadEnabled = await hasMicrosoftGraphDocumentConversionConnector(tenantId);

    return NextResponse.json({ wordUploadEnabled });
  } catch (error) {
    return createErrorResponse(error);
  }
}
