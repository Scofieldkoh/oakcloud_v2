import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSession = {
  id: 'user-1',
  tenantId: 'tenant-1',
  isSuperAdmin: true,
  isWorkspaceAdmin: true,
  hasAllCompaniesAccess: true,
  companyIds: [],
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    company: {
      findMany: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/companies/options/route';

describe('/api/companies/options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(requirePermission).mockResolvedValue(undefined);
  });

  it('returns the company metadata used by document generation summaries', async () => {
    vi.mocked(prisma.company.findMany).mockResolvedValue([{
      id: 'company-1',
      name: 'Flowmind AI Pte. Limited',
      uen: '202607297E',
      status: 'LIVE',
      incorporationDate: new Date('2026-07-29T00:00:00.000Z'),
      primarySsicDescription: null,
      homeCurrency: 'SGD',
      addresses: [{ fullAddress: '1 Robinson Road, Singapore 048542' }],
    }] as never);

    const response = await GET(new NextRequest(
      'http://localhost/api/companies/options?limit=1',
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      options: [{
        id: 'company-1',
        name: 'Flowmind AI Pte. Limited',
        uen: '202607297E',
        status: 'LIVE',
        registeredAddress: '1 Robinson Road, Singapore 048542',
        incorporationDate: '2026-07-29T00:00:00.000Z',
        primarySsicDescription: null,
        homeCurrency: 'SGD',
      }],
      hasMore: false,
      page: 0,
    });
  });
});
