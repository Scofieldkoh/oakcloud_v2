import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { getDocumentPartyOptions } from '@/services/document-party.service';
import { GET } from '@/app/api/companies/[id]/document-parties/route';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(),
}));

vi.mock('@/services/document-party.service', () => ({
  getDocumentPartyOptions: vi.fn(),
}));

describe('company document parties route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads document parties inside the session workspace', async () => {
    const session = { id: 'user-1', tenantId: 'tenant-1' } as never;
    vi.mocked(requireAuth).mockResolvedValue(session);
    vi.mocked(getDocumentPartyOptions).mockResolvedValue({
      directors: [],
      shareholders: [],
      contacts: [],
      officers: [],
    });

    const response = await GET(
      new NextRequest(
        'http://localhost/api/companies/company-1/document-parties',
      ),
      { params: Promise.resolve({ id: 'company-1' }) },
    );

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(session, 'document', 'read');
    expect(getDocumentPartyOptions).toHaveBeenCalledWith(
      'company-1',
      'tenant-1',
    );
    expect(await response.json()).toEqual({
      directors: [],
      shareholders: [],
      contacts: [],
      officers: [],
    });
  });
});
