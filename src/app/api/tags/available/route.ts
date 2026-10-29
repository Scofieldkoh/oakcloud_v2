/**
 * Available Tags API
 *
 * GET /api/tags/available - Get all available tags for the current context
 * Returns tenant tags + company tags (if companyId is provided)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { getAvailableTags, searchTags, getRecentTags } from '@/services/document-tag.service';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);

    const companyId = searchParams.get('companyId');
    const tenantIdParam = searchParams.get('tenantId');
    const query = searchParams.get('query');
    const recent = searchParams.get('recent') === 'true';
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Determine tenantId: use query param, session's tenantId, or derive from companyId for super admins
    let tenantId = tenantIdParam || session.tenantId;

    if (!tenantId && session.isSuperAdmin && companyId) {
      // Super admin without tenant - get tenant from the company
      const { prisma } = await import('@/lib/prisma');
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { tenantId: true },
      });
      tenantId = company?.tenantId || null;
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found. Please select a tenant or company.' }, { status: 400 });
    }

    // Verify tenant access for non-super admins
    if (!session.isSuperAdmin && session.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // If companyId provided, verify access
    if (companyId && !(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let tags;
    if (recent) {
      // Get recently used tags
      tags = await getRecentTags(tenantId, companyId || undefined, 5);
    } else if (query !== null) {
      // Search tags by name
      tags = await searchTags(tenantId, companyId || undefined, query, Math.min(limit, 100));
    } else {
      // Get all available tags
      tags = await getAvailableTags(tenantId, companyId || undefined);
    }

    return NextResponse.json({ tags });
  } catch (error) {
    console.error('Error fetching available tags:', error);
    return routeErrorResponse(error);
  }
}
