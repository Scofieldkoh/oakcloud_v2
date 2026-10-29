import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(),
}));

vi.mock('@/services/microsoft-graph-document-conversion.service', () => ({
  hasMicrosoftGraphDocumentConversionConnector: vi.fn(),
}));

describe('GET /api/esigning/document-conversion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns whether Word upload is enabled for the active workspace', async () => {
    const { requireAuth } = await import('@/lib/auth');
    const { requirePermission } = await import('@/lib/rbac');
    const { hasMicrosoftGraphDocumentConversionConnector } = await import(
      '@/services/microsoft-graph-document-conversion.service'
    );
    const { GET } = await import('@/app/api/esigning/document-conversion/route');

    vi.mocked(requireAuth).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      tenantId: 'tenant-session',
      isSuperAdmin: true,
      isWorkspaceAdmin: true,
      hasAllCompaniesAccess: true,
      companyIds: [],
    });
    vi.mocked(requirePermission).mockResolvedValue(undefined);
    vi.mocked(hasMicrosoftGraphDocumentConversionConnector).mockResolvedValue(false);

    const request = new NextRequest(
      'http://localhost/api/esigning/document-conversion?tenantId=tenant-selected'
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ wordUploadEnabled: false });
    expect(requirePermission).toHaveBeenCalledWith(expect.any(Object), 'esigning', 'update');
    expect(hasMicrosoftGraphDocumentConversionConnector).toHaveBeenCalledWith('tenant-selected');
  });
});
