import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import {
  deleteFormResponse,
  getFormResponseById,
  updateFormResponseReviewStatus,
  updateFormResponseTags,
} from '@/services/form-builder.service';
import { FORM_RESPONSE_REVIEW_STATUS_OPTIONS, type FormResponseReviewStatus } from '@/lib/form-utils';

interface RouteParams {
  params: Promise<{
    id: string;
    submissionId: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, submissionId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    const response = await getFormResponseById(id, submissionId, tenantId);
    return NextResponse.json(response);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, submissionId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const body = await request.json().catch(() => ({}));
    const reviewStatus = typeof body.reviewStatus === 'string' &&
      FORM_RESPONSE_REVIEW_STATUS_OPTIONS.some((option) => option.value === body.reviewStatus)
      ? body.reviewStatus as FormResponseReviewStatus
      : null;

    if (reviewStatus) {
      const result = await updateFormResponseReviewStatus(
        id,
        submissionId,
        reviewStatus,
        {
          tenantId,
          userId: session.id,
        }
      );

      return NextResponse.json(result);
    }

    const tags = Array.isArray(body.tags)
      ? body.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
      : [];

    const result = await updateFormResponseTags(
      id,
      submissionId,
      tags,
      {
        tenantId,
        userId: session.id,
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, submissionId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'delete');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const reason = searchParams.get('reason') || undefined;

    const result = await deleteFormResponse(
      id,
      submissionId,
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
