import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import { getFormResponses } from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const page = Math.max(1, Number(searchParams.get('page') || '1'));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') || '20')));
    const draftPage = Math.max(1, Number(searchParams.get('draftPage') || '1'));
    const draftLimit = Math.min(200, Math.max(1, Number(searchParams.get('draftLimit') || '20')));
    const submissionSortBy = searchParams.get('submissionSortBy') || undefined;
    const submissionSortOrder = searchParams.get('submissionSortOrder') === 'asc' ? 'asc' : 'desc';
    const rawSubmissionFilters = searchParams.get('submissionFilters');
    let submissionFilters: Record<string, string> | undefined;

    if (rawSubmissionFilters) {
      try {
        const parsed = JSON.parse(rawSubmissionFilters);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const normalized = Object.fromEntries(
            Object.entries(parsed)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
              .map(([key, value]) => [key, value.trim()])
              .filter(([, value]) => value.length > 0)
          );

          if (Object.keys(normalized).length > 0) {
            submissionFilters = normalized;
          }
        }
      } catch {
        submissionFilters = undefined;
      }
    }

    const responses = await getFormResponses(
      id,
      tenantId,
      page,
      limit,
      draftPage,
      draftLimit,
      {
        submissionSortBy,
        submissionSortOrder,
        submissionFilters,
      }
    );

    return NextResponse.json(responses);
  } catch (error) {
    return createErrorResponse(error);
  }
}
