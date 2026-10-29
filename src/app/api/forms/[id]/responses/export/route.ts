import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse, buildContentDispositionHeader } from '@/lib/api-helpers';
import { FormSubmissionStatus } from '@/generated/prisma';
import {
  exportFormResponsesExcel,
  type FormResponsesExportStatus,
} from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseJsonStringArray(value: string | null): string[] | undefined {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;

    const ids = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return ids.length > 0 ? ids : undefined;
  } catch {
    return undefined;
  }
}

function parseSubmissionFilters(value: string | null): Record<string, string> | undefined {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

    const normalized = Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([key, filterValue]) => [key, filterValue.trim()])
        .filter(([, filterValue]) => filterValue.length > 0)
    );

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function parseStatus(value: string | null): FormResponsesExportStatus | undefined {
  if (!value || value === 'ALL') return undefined;
  if (value === 'DRAFT' || value === 'ALL_WITH_DRAFTS') return value;

  const validStatuses = Object.values(FormSubmissionStatus);
  return validStatuses.includes(value as FormSubmissionStatus)
    ? value as FormSubmissionStatus
    : undefined;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const fromDate = parseDateParam(searchParams.get('fromDate'));
    const toDate = parseDateParam(searchParams.get('toDate'));
    const status = parseStatus(searchParams.get('status'));
    const submissionIds = parseJsonStringArray(searchParams.get('submissionIds'));
    const draftIds = parseJsonStringArray(searchParams.get('draftIds'));
    const submissionFilters = parseSubmissionFilters(searchParams.get('submissionFilters'));
    const includeTags = parseJsonStringArray(searchParams.get('includeTags'));
    const excludeTags = parseJsonStringArray(searchParams.get('excludeTags'));

    const { buffer, fileName } = await exportFormResponsesExcel(id, tenantId, {
      fromDate,
      toDate,
      status,
      submissionIds,
      draftIds,
      submissionFilters,
      includeTags,
      excludeTags,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': buildContentDispositionHeader('attachment', fileName),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
