import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { getDocumentStats } from '@/services/document-generator.service';

/**
 * GET /api/generated-documents/stats
 * Get document statistics
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check read permission
    await requirePermission(session, 'document', 'read');

    const tenantId = requireSessionWorkspaceId(session);
    const stats = await getDocumentStats(tenantId);

    return NextResponse.json(stats);
  } catch (error) {
    return createErrorResponse(error);
  }
}
