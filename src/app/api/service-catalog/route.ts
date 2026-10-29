import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  requireSessionWorkspaceId,
  resolveWorkspaceId,
} from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';
import { searchServiceCatalogSchema } from '@/lib/validations/service-catalog';
import {
  getSelectableServiceVariants,
  listServiceCatalog,
} from '@/services/service-catalog';
import { serviceCatalogErrorResponse } from './route-utils';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);

    if (searchParams.get('selectable') === 'true') {
      await requirePermission(session, 'document', 'read');
      const tenantId = requireSessionWorkspaceId(session);
      const variants = await getSelectableServiceVariants(tenantId);
      return NextResponse.json({ variants });
    }

    requireServiceAdministrator(session);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const isActiveParam = searchParams.get('isActive');
    const input = searchServiceCatalogSchema.parse({
      query: searchParams.get('query') || undefined,
      isActive:
        isActiveParam === null
          ? undefined
          : isActiveParam === 'true'
            ? true
            : isActiveParam === 'false'
              ? false
              : isActiveParam,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: searchParams.get('sortOrder') || undefined,
    });
    const catalog = await listServiceCatalog(input, {
      tenantId,
      userId: session.id,
    });
    return NextResponse.json(catalog);
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'GET /api/service-catalog');
  }
}
