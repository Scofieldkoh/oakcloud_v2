import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma';
import { routeErrorResponse } from '@/lib/api-route-errors';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'company', 'read');

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('q') || searchParams.get('query') || '').trim();
    const parsedLimit = Number(searchParams.get('limit') || DEFAULT_LIMIT);
    const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_LIMIT, MAX_LIMIT));
    const parsedPage = Number(searchParams.get('page') || 0);
    const page = Math.max(0, Number.isFinite(parsedPage) ? Math.floor(parsedPage) : 0);

    const effectiveTenantId = session.tenantId;

    const where: Prisma.CompanyWhereInput = {
      deletedAt: null,
    };

    if (effectiveTenantId) {
      where.tenantId = effectiveTenantId;
    } else {
      return NextResponse.json({ options: [] });
    }

    if (!session.isSuperAdmin && !session.isWorkspaceAdmin && !session.hasAllCompaniesAccess) {
      if (!session.companyIds.length) {
        return NextResponse.json({ options: [] });
      }
      where.id = { in: session.companyIds };
    }

    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { uen: { contains: query, mode: 'insensitive' } },
      ];
    }

    const companies = await prisma.company.findMany({
      where,
      select: {
        id: true,
        name: true,
        uen: true,
        status: true,
        incorporationDate: true,
        addresses: {
          where: {
            isCurrent: true,
            addressType: 'REGISTERED_OFFICE',
          },
          select: { fullAddress: true },
          take: 1,
        },
        primarySsicDescription: true,
        homeCurrency: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      skip: page * limit,
    });

    const hasMore = companies.length > limit;
    const pageCompanies = companies.slice(0, limit);

    return NextResponse.json({
      options: pageCompanies.map((company) => ({
        id: company.id,
        name: company.name,
        uen: company.uen,
        status: company.status,
        registeredAddress: company.addresses[0]?.fullAddress ?? null,
        incorporationDate: company.incorporationDate?.toISOString() ?? null,
        primarySsicDescription: company.primarySsicDescription,
        homeCurrency: company.homeCurrency,
      })),
      hasMore,
      page,
    });
  } catch (error) {
    return routeErrorResponse(error, { fallback: 'bad-request' });
  }
}
