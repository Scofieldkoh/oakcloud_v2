import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useActiveWorkspaceId: vi.fn(),
  useServicesWorkspaceSettings: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useSession: mocks.useSession,
}));

vi.mock('@/components/ui/workspace-selector', () => ({
  useActiveWorkspaceId: mocks.useActiveWorkspaceId,
}));

vi.mock('@/hooks/use-services-workspace-settings', () => ({
  useServicesWorkspaceSettings: mocks.useServicesWorkspaceSettings,
}));

vi.mock('@/components/services/admin/catalog/service-catalog-panel', () => ({
  ServiceCatalogPanel: ({
    workspaceId,
    canCreate,
    canUpdate,
    canDelete,
  }: {
    workspaceId: string;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
  }) => (
    <section aria-labelledby="service-catalog-heading">
      <h2 id="service-catalog-heading">Service catalog</h2>
      {canCreate && canUpdate && canDelete ? (
        <button type="button">Add service family</button>
      ) : null}
      <span data-testid="catalog-workspace">{workspaceId}</span>
    </section>
  ),
}));

vi.mock('@/components/services/admin/deadline-rules-panel', () => ({
  DeadlineRulesPanel: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="deadline-rules-content">Deadline rules · {workspaceId}</div>
  ),
}));

vi.mock('@/components/services/admin/business-calendar-panel', () => ({
  BusinessCalendarPanel: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="business-calendar-content">Business calendar · {workspaceId}</div>
  ),
}));

import {
  BusinessCalendarAdminPage,
  DeadlineRulesAdminPage,
  ServiceCatalogAdminPage,
} from '@/components/services/admin/services-admin-page';

const redirect = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
}));

vi.mock('next/navigation', () => ({ redirect }));

import ServicesAdminIndexPage from '@/app/(dashboard)/admin/services/page';

describe('Services administration pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useActiveWorkspaceId.mockReturnValue('workspace-1');
    mocks.useServicesWorkspaceSettings.mockReturnValue({
      data: { workspaceEnabled: true, deadlineWritesEnabled: true },
      isLoading: false,
      error: null,
    });
  });

  it('announces a loading state while the session is resolving', () => {
    mocks.useSession.mockReturnValue({ data: undefined, isLoading: true });

    render(<ServiceCatalogAdminPage />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading services administration…',
    );
  });

  it('keeps settings-error retry touch-safe and refetches from the accessible alert', () => {
    const refetch = vi.fn();
    mocks.useSession.mockReturnValue({
      data: { isSuperAdmin: false, isWorkspaceAdmin: true },
      isLoading: false,
    });
    mocks.useServicesWorkspaceSettings.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('settings unavailable'),
      refetch,
    });

    render(<ServiceCatalogAdminPage />);

    const alert = screen.getByRole('alert');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(alert).toHaveTextContent('Unable to load Services administration settings.');
    expect(retry).toHaveClass('min-h-11', 'sm:min-h-8');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not render catalog controls for non-admin users', () => {
    mocks.useSession.mockReturnValue({
      data: { isSuperAdmin: false, isWorkspaceAdmin: false },
      isLoading: false,
    });

    render(<ServiceCatalogAdminPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tenant Admin access is required',
    );
    expect(screen.getByRole('heading', { name: 'Service Catalog' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add service family' })).not.toBeInTheDocument();
  });

  it('explains when an administrator has no active workspace', () => {
    mocks.useSession.mockReturnValue({
      data: { isSuperAdmin: true, isWorkspaceAdmin: false },
      isLoading: false,
    });
    mocks.useActiveWorkspaceId.mockReturnValue(undefined);

    render(<DeadlineRulesAdminPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Select a workspace to administer services.',
    );
    expect(screen.queryByTestId('deadline-rules-content')).not.toBeInTheDocument();
  });

  it.each([
    { isSuperAdmin: false, isWorkspaceAdmin: true },
    { isSuperAdmin: true, isWorkspaceAdmin: false },
  ])('renders only the catalog on the Service Catalog page', (roles) => {
    mocks.useSession.mockReturnValue({ data: roles, isLoading: false });

    render(<ServiceCatalogAdminPage />);

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Service catalog' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add service family' })).toBeVisible();
    expect(screen.getByTestId('catalog-workspace')).toHaveTextContent('workspace-1');
    expect(screen.queryByTestId('deadline-rules-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('business-calendar-content')).not.toBeInTheDocument();
  });

  it('renders only its own panel on the Deadline Rules and Business Calendar pages', () => {
    mocks.useSession.mockReturnValue({
      data: { isSuperAdmin: false, isWorkspaceAdmin: true },
      isLoading: false,
    });

    const { unmount } = render(<DeadlineRulesAdminPage />);
    expect(screen.getByTestId('deadline-rules-content')).toHaveTextContent('workspace-1');
    expect(screen.queryByTestId('catalog-workspace')).not.toBeInTheDocument();
    unmount();

    render(<BusinessCalendarAdminPage />);
    expect(screen.getByTestId('business-calendar-content')).toHaveTextContent('workspace-1');
    expect(screen.queryByTestId('deadline-rules-content')).not.toBeInTheDocument();
  });

  it.each([
    [undefined, '/admin/services/catalog'],
    ['catalog', '/admin/services/catalog'],
    ['rules', '/admin/services/deadline-rules'],
    ['deadline-rules', '/admin/services/deadline-rules'],
    ['calendar', '/admin/services/business-calendar'],
    ['business-calendar', '/admin/services/business-calendar'],
  ])('redirects the old ?tab=%s link to its own page', async (tab, target) => {
    await expect(
      ServicesAdminIndexPage({ searchParams: Promise.resolve(tab ? { tab } : {}) }),
    ).rejects.toThrow(`redirect:${target}`);
  });
});
