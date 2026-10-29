import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { confirmFirstFinancialYearEnd } from '@/services/compliance-monitoring/financial-periods';
import type { DateOnly } from '@/services/service-schedule';

const firstFyeSchema = z.object({
  firstFinancialYearEnd: z.string().date(),
}).strict();

/** Record the company's first financial year end; the first period and YA follow from it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'company', 'update', id);
    const tenantId = requireSessionWorkspaceId(session);
    const input = firstFyeSchema.parse(await request.json());
    const period = await confirmFirstFinancialYearEnd(
      { tenantId, companyId: id, userId: session.id },
      input.firstFinancialYearEnd as DateOnly,
    );
    return NextResponse.json(period, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
