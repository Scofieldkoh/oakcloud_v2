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
    await requirePermission(session, 'contact', 'read');

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('q') || searchParams.get('query') || '').trim();
    const parsedLimit = Number(searchParams.get('limit') || DEFAULT_LIMIT);
    const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_LIMIT, MAX_LIMIT));
    const effectiveTenantId = session.tenantId;

    const where: Prisma.ContactWhereInput = {
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
      where.companyRelations = {
        some: {
          deletedAt: null,
          companyId: { in: session.companyIds },
        },
      };
    }

    if (query) {
      where.OR = [
        { fullName: { contains: query, mode: 'insensitive' } },
        { identificationNumber: { contains: query, mode: 'insensitive' } },
        { corporateUen: { contains: query, mode: 'insensitive' } },
      ];
    }

    const contacts = await prisma.contact.findMany({
      where,
      select: {
        id: true,
        fullName: true,
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    return NextResponse.json({
      options: contacts.map((contact) => ({
        id: contact.id,
        name: contact.fullName,
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, { fallback: 'bad-request' });
  }
}
