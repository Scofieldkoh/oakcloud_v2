import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthSessionPayload: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
  servicesWorkspace: vi.fn(() => null),
}));

vi.mock('@/lib/auth-session', () => ({ getAuthSessionPayload: mocks.getAuthSessionPayload }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/services/services-workspace', () => ({ ServicesWorkspace: mocks.servicesWorkspace }));

import ServicesPage from '@/app/(dashboard)/services/page';
import DeadlinesPage from '@/app/(dashboard)/deadlines/page';
import BillingPage from '@/app/(dashboard)/billing/page';

describe('standalone services pages', () => {
  beforeEach(() => {
    mocks.getAuthSessionPayload.mockReset();
    mocks.redirect.mockClear();
    mocks.servicesWorkspace.mockClear();
    mocks.getAuthSessionPayload.mockResolvedValue({
      user: { tenantId: 'tenant-1' },
      isSuperAdmin: false,
      isWorkspaceAdmin: false,
      permissions: ['company:update'],
    });
  });

  it('redirects legacy deadline and billing tabs to their standalone routes while preserving filters', async () => {
    await expect(ServicesPage({
      searchParams: Promise.resolve({ tab: 'billing', query: 'payroll', statuses: ['OPEN', 'DUE'] }),
    })).rejects.toThrow('redirect:/billing?query=payroll&statuses=OPEN&statuses=DUE');
    expect(mocks.getAuthSessionPayload).not.toHaveBeenCalled();
  });

  it('renders all standalone routes through the shared workspace with the current permissions', async () => {
    const pages = await Promise.all([
      ServicesPage({ searchParams: Promise.resolve({}) }),
      DeadlinesPage(),
      BillingPage(),
    ]);

    expect(pages.every((page) => page?.type === mocks.servicesWorkspace)).toBe(true);
    expect(pages[0]?.props).toEqual({
      workspaceId: 'tenant-1',
      canEdit: true,
      canCreate: true,
    });
  });
});
