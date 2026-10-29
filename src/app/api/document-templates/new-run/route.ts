import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { resolveTemplateIdsForNewRun } from '@/services/oakdoc-migration.service';

const idsSchema = z.array(z.string().uuid()).min(1).max(20);

/**
 * GET /api/document-templates/new-run?templateId=...&templateId=...
 * Template IDs to use for a new generation run, in the same order: an A4
 * template with an approved Word replacement resolves to that replacement,
 * so old links and bookmarks keep working after A4 retirement.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const tenantId = requireSessionWorkspaceId(session);
    const parsed = idsSchema.safeParse(request.nextUrl.searchParams.getAll('templateId'));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Template IDs are invalid' }, { status: 400 });
    }
    const templateIds = await resolveTemplateIdsForNewRun(parsed.data, tenantId);
    return NextResponse.json({ templateIds });
  } catch (error) {
    return createErrorResponse(error);
  }
}
