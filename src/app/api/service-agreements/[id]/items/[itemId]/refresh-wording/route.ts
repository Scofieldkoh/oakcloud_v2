import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { NotFoundError } from '@/lib/errors';
import { requirePermission } from '@/lib/rbac';
import {
  getServiceAgreementDraftById,
  refreshServiceAgreementItemWording,
} from '@/services/service-agreement';

const refreshSchema = z.object({
  expectedVariantVersion: z.number().int().min(1),
  expectedPartialVersion: z.number().int().min(1),
});

interface RouteParams {
  params: Promise<{ id: string; itemId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');
    const tenantId = requireSessionWorkspaceId(session);
    const { id, itemId } = await params;
    const agreement = await getServiceAgreementDraftById(id, {
      tenantId,
      userId: session.id,
    });
    if (!agreement || !agreement.items.some((item) => item.id === itemId)) {
      throw new NotFoundError('Service agreement item not found');
    }
    const input = refreshSchema.parse(await request.json());
    const item = await refreshServiceAgreementItemWording(itemId, input, {
      tenantId,
      userId: session.id,
    });
    return NextResponse.json(item);
  } catch (error) {
    return createErrorResponse(error);
  }
}
