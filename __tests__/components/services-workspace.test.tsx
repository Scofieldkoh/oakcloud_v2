import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useServicesWorkspaceSettings: vi.fn(),
  useServiceRoster: vi.fn(),
  useServiceCatalog: vi.fn(),
  useServiceRosterFamilies: vi.fn(),
  deadlineWorkspace: vi.fn(),
  billingWorkspace: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  pathname: '/services',
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.searchParams,
}));

vi.mock('@/hooks/use-services-workspace-settings', () => ({
  useServicesWorkspaceSettings: mocks.useServicesWorkspaceSettings,
}));
vi.mock('@/hooks/use-service-roster', () => ({ useServiceRoster: mocks.useServiceRoster }));
vi.mock('@/hooks/use-service-roster-families', () => ({ useServiceRosterFamilies: mocks.useServiceRosterFamilies }));
vi.mock('@/hooks/use-service-catalog', () => ({ useServiceCatalog: mocks.useServiceCatalog }));
vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreference: () => ({ data: { value: null }, isLoading: false }),
  useUpsertUserPreference: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/use-all-company-options', () => ({
  useAllCompanyOptions: () => ({ data: [], isLoading: false, error: null }),
  useCompanyOptionsPage: () => ({ data: { options: [], hasMore: false, page: 0 }, isLoading: false, error: null }),
}));
vi.mock('@/components/companies/company-detail/client-service-creator', () => ({ ClientServiceCreator: () => null }));
vi.mock('@/components/companies/company-detail/client-service-editor', () => ({ ClientServiceEditor: () => null }));
vi.mock('@/components/services/deadlines/deadline-workspace', () => ({
  DeadlineViewToggle: () => (
    <div role="group" aria-label="Deadline view">
      <button type="button">Table view</button>
      <button type="button">Calendar view</button>
    </div>
  ),
  DeadlineWorkspace: (props: { deadlineWritesEnabled?: boolean }) => {
    mocks.deadlineWorkspace(props);
    return <div aria-label="Deadline workspace stub" />;
  },
}));
vi.mock('@/components/services/billing/billing-workspace', () => ({
  BillingWorkspace: () => {
    mocks.billingWorkspace();
    return <div aria-label="Billing workspace stub" />;
  },
}));

import { ServicesWorkspace } from '@/components/services/services-workspace';

describe('ServicesWorkspace', () => {
  beforeEach(() => {
    navigation.pathname = '/services';
    navigation.searchParams = new URLSearchParams();
    navigation.replace.mockReset();
    mocks.deadlineWorkspace.mockReset();
    mocks.billingWorkspace.mockReset();
  });

  it('renders a compact unavailable state and does not query the roster when disabled', () => {
    mocks.useServicesWorkspaceSettings.mockReturnValue({
      data: { workspaceEnabled: false, deadlineWritesEnabled: false },
      isLoading: false,
      error: null,
    });

    render(<ServicesWorkspace />);

    expect(screen.getByRole('status')).toHaveTextContent(/services workspace is unavailable/i);
    expect(mocks.useServiceRoster).not.toHaveBeenCalled();
  });

  it('renders the Services page without the former subheader or tab strip', () => {
    mocks.useServicesWorkspaceSettings.mockReturnValue({
      data: { workspaceEnabled: true, deadlineWritesEnabled: false },
      isLoading: false,
      error: null,
    });
    mocks.useServiceRoster.mockReturnValue({ data: { items: [], total: 0, page: 1, limit: 20, totalPages: 0 }, isLoading: false, isFetching: false, error: null });
    mocks.useServiceRosterFamilies.mockReturnValue({ data: [], isLoading: false, error: null });
    mocks.useServiceCatalog.mockReturnValue({ data: { families: [], total: 0 }, isLoading: false });

    render(<ServicesWorkspace />);

    const heading = screen.getByRole('heading', { name: 'Services' });
    const header = heading.closest('header');
    expect(header).not.toBeNull();
    expect(header).toHaveClass('flex', 'sm:flex-row', 'sm:justify-between');
    expect(within(header!).getByRole('button', { name: 'Add service' })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Services' })).queryByRole('button', { name: 'Add service' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Services workspace sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Services roster' })).not.toBeInTheDocument();
    expect(mocks.useServiceRoster).toHaveBeenCalled();
  });

  it('renders the Deadlines page from its standalone route and passes the write flag', () => {
    navigation.pathname = '/deadlines';
    mocks.useServicesWorkspaceSettings.mockReturnValue({
      data: { workspaceEnabled: true, deadlineWritesEnabled: false },
      isLoading: false,
      error: null,
    });
    mocks.useServiceRoster.mockReturnValue({ data: { items: [], total: 0, page: 1, limit: 20, totalPages: 0 }, isLoading: false, isFetching: false, error: null });
    mocks.useServiceRosterFamilies.mockReturnValue({ data: [], isLoading: false, error: null });
    mocks.useServiceCatalog.mockReturnValue({ data: { families: [], total: 0 }, isLoading: false });

    render(<ServicesWorkspace />);

    const heading = screen.getByRole('heading', { name: 'Deadlines' });
    const header = heading.closest('header');
    expect(header).not.toBeNull();
    expect(within(header!).getByRole('group', { name: 'Deadline view' })).toBeVisible();
    expect(screen.queryByRole('tablist', { name: 'Services workspace sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Deadlines' })).toBeVisible();
    expect(mocks.deadlineWorkspace).toHaveBeenCalledWith({ deadlineWritesEnabled: false, canEdit: true });
  });

  it('renders the Billing page from its standalone route without the former subheader', () => {
    navigation.pathname = '/billing';
    mocks.useServicesWorkspaceSettings.mockReturnValue({
      data: { workspaceEnabled: true, deadlineWritesEnabled: false },
      isLoading: false,
      error: null,
    });

    render(<ServicesWorkspace />);

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeVisible();
    expect(screen.queryByRole('tablist', { name: 'Services workspace sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Manual billing tracking' })).not.toBeInTheDocument();
    expect(mocks.billingWorkspace).toHaveBeenCalled();
  });
});
