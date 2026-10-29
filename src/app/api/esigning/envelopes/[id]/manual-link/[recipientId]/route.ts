import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { getEsigningEnvelopeRecipientManualLink } from '@/services/esigning-envelope.service';

interface RouteParams {
  params: Promise<{ id: string; recipientId: string }>;
}

function getRequestBaseUrl(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, recipientId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'update');

    const body = await request.json().catch(() => ({}));
    const tenantId = resolveWorkspaceId(session, body.tenantId);
    const appBaseUrl = getRequestBaseUrl(request);

    const result = await getEsigningEnvelopeRecipientManualLink(
      session,
      tenantId,
      id,
      recipientId,
      appBaseUrl
    );
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
