import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { ApiError } from '@/lib/errors';
import { createErrorResponse } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { getSharePointFilingSettings } from '@/services/sharepoint-filing-settings.service';
import { isSharePointSignedFilingDeploymentEnabled } from '@/services/sharepoint-filing-settings.service';
import { SharePointServiceError } from '@/services/sharepoint.service';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await requirePermission(session, 'connector', 'read');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });

    const connectorId = new URL(request.url).searchParams.get('connectorId')
      ?? (await prisma.connector.findFirst({ where: { workspaceId: session.tenantId, provider: 'SHAREPOINT', deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true } }))?.id;
    const settings = connectorId ? await getSharePointFilingSettings({ workspaceId: session.tenantId, connectorId }) : null;
    const where = { tenantId: session.tenantId } as const;
    const grouped = await prisma.esigningSharePointFiling.groupBy({ by: ['status'], where, _count: { _all: true } });
    const pendingStatuses: Array<'PENDING' | 'FAILED_RETRYABLE'> = ['PENDING', 'FAILED_RETRYABLE'];
    const waitingForSource = await prisma.esigningSharePointFiling.count({
      where: {
        tenantId: session.tenantId,
        status: { in: pendingStatuses },
        OR: [
          { envelope: { status: { not: 'COMPLETED' } } },
          { envelope: { pdfGenerationStatus: { not: 'COMPLETED' } } },
          { envelopeDocument: { signedStoragePath: null } },
        ],
      },
    });
    const oldestReady = await prisma.esigningSharePointFiling.findFirst({
      where: {
        tenantId: session.tenantId,
        status: { in: pendingStatuses },
        envelope: { status: 'COMPLETED', pdfGenerationStatus: 'COMPLETED' },
        envelopeDocument: { signedStoragePath: { not: null } },
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const counts = Object.fromEntries(grouped.map((row) => [row.status.toLowerCase(), row._count._all]));
    return NextResponse.json({
      deploymentEnabled: isSharePointSignedFilingDeploymentEnabled(),
      connectorId: connectorId ?? null,
      configuration: settings,
      counts,
      reviewRequired: counts.review_required ?? 0,
      waitingForSource,
      oldestSourceReadyPendingAt: oldestReady?.createdAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof SharePointServiceError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode ?? 400 });
    if (error instanceof ApiError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode });
    return createErrorResponse(error, 'SharePoint filing status failed');
  }
}
