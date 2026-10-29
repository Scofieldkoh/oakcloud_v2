import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId } from '@/lib/api-helpers';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';
import {
  archiveServiceCatalogItemSchema,
  updateServiceVariantSchema,
} from '@/lib/validations/service-catalog';
import {
  archiveServiceVariant,
  getServiceVariant,
  updateServiceVariant,
} from '@/services/service-catalog';
import { serviceCatalogErrorResponse } from '../../route-utils';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const variant = await getServiceVariant(id, {
      tenantId,
      userId: session.id,
    });
    return NextResponse.json(variant);
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'GET /api/service-catalog/variants/[id]');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const { id } = await params;
    const body = await request.json();
    const tenantId = resolveWorkspaceId(
      session,
      typeof body.tenantId === 'string' ? body.tenantId : null,
    );
    const { tenantId: _tenantId, ...payload } = body;
    const input = updateServiceVariantSchema.parse(payload);
    const variant = await updateServiceVariant(id, input, {
      tenantId,
      userId: session.id,
    });
    return NextResponse.json(variant);
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'PATCH /api/service-catalog/variants/[id]');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const { reason } = archiveServiceCatalogItemSchema.parse({
      reason: searchParams.get('reason'),
    });
    const result = await archiveServiceVariant(id, reason, {
      tenantId,
      userId: session.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'DELETE /api/service-catalog/variants/[id]');
  }
}
