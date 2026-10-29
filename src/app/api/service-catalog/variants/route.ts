import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId } from '@/lib/api-helpers';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';
import { createServiceVariantSchema } from '@/lib/validations/service-catalog';
import { createServiceVariant } from '@/services/service-catalog';
import { serviceCatalogErrorResponse } from '../route-utils';

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const body = await request.json();
    const tenantId = resolveWorkspaceId(
      session,
      typeof body.tenantId === 'string' ? body.tenantId : null,
    );
    const { tenantId: _tenantId, ...payload } = body;
    const input = createServiceVariantSchema.parse(payload);
    const variant = await createServiceVariant(input, {
      tenantId,
      userId: session.id,
    });
    return NextResponse.json(variant, { status: 201 });
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'POST /api/service-catalog/variants');
  }
}
