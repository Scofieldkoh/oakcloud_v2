/**
 * Connector Test API Route
 *
 * POST /api/connectors/[id]/test - Test connector connection
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { testConnector } from '@/services/connector.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await testConnector(id, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Access denied')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return createErrorResponse(error);
  }
}
