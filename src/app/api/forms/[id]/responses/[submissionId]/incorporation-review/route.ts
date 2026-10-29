import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import {
  companyIncorporationReviewUpdateSchema,
  getCompanyIncorporationReview,
  updateCompanyIncorporationReview,
} from '@/services/company-incorporation-review.service';

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

    const review = await getCompanyIncorporationReview(id, submissionId, { tenantId, userId: session.id }, {
      sourceQuery: searchParams.get('sourceQuery'),
    });
    return NextResponse.json(review);
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
    const update = companyIncorporationReviewUpdateSchema.parse(body);

    const review = await updateCompanyIncorporationReview(id, submissionId, update, { tenantId, userId: session.id });
    return NextResponse.json(review);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid checklist update', details: error.errors }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}
