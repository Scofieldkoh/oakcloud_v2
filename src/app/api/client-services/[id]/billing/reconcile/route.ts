import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { ApiError, ErrorCodes } from '@/lib/errors';
import { getClientService } from '@/services/client-service';
import {
  enqueueScheduleReconciliation,
  processScheduleReconciliationBatch,
  requireServicesWorkspaceEnabled,
} from '@/services/schedule-reconciliation';
import { prisma } from '@/lib/prisma';

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

export async function POST(_request: NextRequest, { params }: Context): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const id = idSchema.parse((await params).id);
    const tenantId = requireSessionWorkspaceId(session);
    await requireServicesWorkspaceEnabled(tenantId);
    const actor = {
      tenantId,
      userId: session.id,
      accessibleCompanyIds: session.hasAllCompaniesAccess || session.isSuperAdmin ? undefined : session.companyIds ?? [],
      allCompaniesAccess: session.hasAllCompaniesAccess || session.isSuperAdmin,
    };
    const service = await getClientService(id, actor);
    await requirePermission(session, 'company', 'update', service.companyId);
    const requestRef = await prisma.$transaction((tx) => enqueueScheduleReconciliation(tx, {
      tenantId,
      scopeType: 'CLIENT_SERVICE',
      scopeId: id,
      triggerType: 'BILLING_MANUAL_RECONCILE',
      correlationId: `billing-manual-reconcile-${id}`,
      requestedById: session.id,
      notBefore: new Date(),
    }));
    try {
      // Process the newly queued request before the client refetches. If the
      // immediate attempt fails, the durable request remains available for the
      // scheduler to retry.
      await processScheduleReconciliationBatch();
    } catch (error) {
      console.error('Immediate billing reconciliation batch failed:', error);
    }
    return NextResponse.json({
      status: 'PENDING',
      requestId: requestRef.id,
      dedupeKey: requestRef.dedupeKey,
    }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid client service id',
        400,
        { issues: error.issues },
      ));
    }
    return createErrorResponse(error);
  }
}
