import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { contactDuplicateListQuerySchema } from '@/lib/validations/contact-duplicate';
import { listContactDuplicateGroups } from '@/services/contact-duplicate.service';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'contact', 'read');
    if (!session.tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }
    if (!session.hasAllCompaniesAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const searchParams = new URL(request.url).searchParams;
    const query = contactDuplicateListQuerySchema.parse({
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });
    return NextResponse.json(await listContactDuplicateGroups({ tenantId: session.tenantId, ...query }));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'Invalid pagination', issues: error.issues }, { status: 400 });
    }
    return routeErrorResponse(error);
  }
}
