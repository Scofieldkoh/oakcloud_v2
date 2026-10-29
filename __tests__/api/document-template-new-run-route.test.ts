// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveTemplateIdsForNewRun = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false })),
}));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn(async () => undefined) }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/services/oakdoc-migration.service', () => ({
  resolveTemplateIdsForNewRun: (...args: unknown[]) => resolveTemplateIdsForNewRun(...args),
}));

const { GET } = await import('@/app/api/document-templates/new-run/route');

const a4 = '11111111-1111-4111-8111-111111111111';
const word = '33333333-3333-4333-8333-333333333333';

beforeEach(() => resolveTemplateIdsForNewRun.mockReset());

describe('new-run template route', () => {
  it('returns the approved Word replacements for the workspace', async () => {
    resolveTemplateIdsForNewRun.mockResolvedValue([word]);
    const response = await GET(new NextRequest(`http://localhost/api/document-templates/new-run?templateId=${a4}`));
    await expect(response.json()).resolves.toEqual({ templateIds: [word] });
    expect(resolveTemplateIdsForNewRun).toHaveBeenCalledWith([a4], 'tenant-1');
  });

  it('rejects missing or malformed IDs', async () => {
    expect((await GET(new NextRequest('http://localhost/api/document-templates/new-run'))).status).toBe(400);
    expect((await GET(new NextRequest('http://localhost/api/document-templates/new-run?templateId=x'))).status).toBe(400);
  });
});
