/**
 * Single Connector API Routes
 *
 * GET    /api/connectors/[id] - Get connector details
 * PATCH  /api/connectors/[id] - Update connector
 * DELETE /api/connectors/[id] - Delete connector
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { updateConnectorSchema } from '@/lib/validations/connector';
import {
  getConnectorWithMaskedCredentials,
  updateConnector,
  deleteConnector,
} from '@/services/connector.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const connector = await getConnectorWithMaskedCredentials(id, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    if (!connector) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
    }

    return NextResponse.json(connector);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Access denied')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const data = updateConnectorSchema.parse(body);

    const connector = await updateConnector(id, data, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json(connector);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Access denied')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { reason } = body;

    if (!reason || reason.length < 10) {
      return NextResponse.json(
        { error: 'Reason must be at least 10 characters' },
        { status: 400 }
      );
    }

    await deleteConnector(
      id,
      {
        tenantId: session.tenantId,
        userId: session.id,
        isSuperAdmin: session.isSuperAdmin,
      },
      reason
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Access denied')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return createErrorResponse(error);
  }
}
