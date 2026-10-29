import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { findPostpaidQuantityPrompts } from '@/services/billing/postpaid';

const querySchema = z.object({
  obligationCode: z.string().trim().min(1).max(100),
  yearOfAssessment: z.coerce.number().int().min(2000).max(2100),
}).strict();

/**
 * Before a company filing is set to Filed: the tiered postpaid fees it bills
 * that need a quantity.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'company', 'read', id);
    const tenantId = requireSessionWorkspaceId(session);
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      obligationCode: searchParams.get('obligationCode') ?? undefined,
      yearOfAssessment: searchParams.get('yearOfAssessment') ?? undefined,
    });
    const prompts = await findPostpaidQuantityPrompts({ tenantId, companyId: id, ...query });
    return NextResponse.json({ prompts });
  } catch (error) {
    return createErrorResponse(error);
  }
}
