import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ServiceRosterItem } from '@/services/service-roster';

const hooks = vi.hoisted(() => ({
  useServiceRoster: vi.fn(),
  useArchiveClientService: vi.fn(),
  useDeleteClientServicePermanently: vi.fn(),
  useUserPreference: vi.fn(),
  useUpsertUserPreference: vi.fn(),
  useServiceCatalog: vi.fn(),
  useServiceRosterFamilies: vi.fn(),
  useClientService: vi.fn(),
}));
const mutations = vi.hoisted(() => ({
  archive: vi.fn(),
  permanentDelete: vi.fn(),
  refetch: vi.fn(),
}));
const servicesSettingsMock = vi.hoisted(() => ({ useServicesWorkspaceSettings: vi.fn() }));

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/services',
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.searchParams,
}));

vi.mock('@/hooks/use-service-roster', () => ({ useServiceRoster: hooks.useServiceRoster }));
vi.mock('@/hooks/use-client-services', () => ({
  useArchiveClientService: hooks.useArchiveClientService,
  useDeleteClientServicePermanently: hooks.useDeleteClientServicePermanently,
  useClientService: hooks.useClientService,
}));
vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreference: hooks.useUserPreference,
  useUpsertUserPreference: hooks.useUpsertUserPreference,
}));
vi.mock('@/hooks/use-service-catalog', () => ({ useServiceCatalog: hooks.useServiceCatalog }));
vi.mock('@/hooks/use-service-roster-families', () => ({ useServiceRosterFamilies: hooks.useServiceRosterFamilies }));
vi.mock('@/hooks/use-services-workspace-settings', () => servicesSettingsMock);
vi.mock('@/hooks/use-all-company-options', () => ({
  useAllCompanyOptions: () => ({ data: [], isLoading: false, error: null }),
  useCompanyOptionsPage: () => ({ data: { options: [], hasMore: false, page: 0 }, isLoading: false, error: null }),
}));
vi.mock('@/components/companies/company-detail/client-service-creator', () => ({
  ClientServiceCreator: () => null,
}));
vi.mock('@/components/companies/company-detail/client-service-editor', () => ({
  ClientServiceEditor: (props: { readOnly?: boolean }) => <div role="dialog" aria-label={props.readOnly ? 'View service' : 'Edit service'} />,
}));

import { ServiceRoster } from '@/components/services/roster/service-roster';

const family = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Accounting',
  displayColor: '#3F6DA8',
};

const rosterItem: ServiceRosterItem = {
  id: '44444444-4444-4444-8444-444444444444',
  companyId: '22222222-2222-4222-8222-222222222222',
  agreementId: null,
  agreementItemId: null,
  serviceVariantId: '55555555-5555-4555-8555-555555555555',
  company: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
    displayAlias: null,
    displayLabel: 'OACS',
    uen: '202600001A',
  },
  family,
  familyName: family.name,
  familyDisplayColor: family.displayColor,
  variant: {
    id: '55555555-5555-4555-8555-555555555555',
    code: 'ACCT-001',
    name: 'Monthly accounting',
    version: 1,
    serviceCadence: 'MONTHLY',
    customCadenceLabel: null,
  },
  serviceVariant: {
    id: '55555555-5555-4555-8555-555555555555',
    code: 'ACCT-001',
    name: 'Monthly accounting',
    version: 1,
    serviceCadence: 'MONTHLY',
    customCadenceLabel: null,
  },
  service: {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Monthly accounting',
    source: 'MANUAL',
    status: 'ACTIVE',
    cadence: 'MONTHLY',
    serviceCadence: 'MONTHLY',
    customCadenceLabel: null,
    startDate: '2026-01-01',
    endDate: null,
  },
  serviceName: 'Monthly accounting',
  status: 'ACTIVE',
  cadence: 'MONTHLY',
  serviceCadence: 'MONTHLY',
  customCadenceLabel: null,
  startDate: '2026-01-01',
  endDate: null,
  source: 'MANUAL',
  hasRuleWarning: false,
  nextDeadline: null,
  applicability: {
    state: null,
    applicabilityState: null,
    hasWarning: false,
    ruleCount: 0,
    applicableCount: 0,
    notApplicableCount: 0,
    missingInputCount: 0,
    reasons: [],
  },
  applicabilityState: null,
  ruleWarning: {
    state: null,
    applicabilityState: null,
    hasWarning: false,
    ruleCount: 0,
    applicableCount: 0,
    notApplicableCount: 0,
    missingInputCount: 0,
    reasons: [],
  },
  warning: {
    state: null,
    applicabilityState: null,
    hasWarning: false,
    ruleCount: 0,
    applicableCount: 0,
    notApplicableCount: 0,
    missingInputCount: 0,
    reasons: [],
  },
  billingDisposition: 'CONFIGURED',
  billingCoverageIssue: null,
  nextBilling: {
    status: 'OPEN',
    expectedDate: '2026-08-31',
    timingState: 'UPCOMING',
  },
  updatedAt: '2026-08-18T00:00:00.000Z',
};

const advisoryFamily = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Advisory',
  displayColor: '#B85C38',
};

function setup(items: ServiceRosterItem[] = [rosterItem]) {
  navigation.searchParams = new URLSearchParams();
  navigation.replace.mockReset();
  hooks.useServiceRoster.mockReset();
  mutations.archive.mockReset();
  mutations.archive.mockResolvedValue({ id: rosterItem.id, archived: true });
  mutations.permanentDelete.mockReset();
  mutations.permanentDelete.mockResolvedValue({ id: rosterItem.id, deleted: true, deletedCounts: {} });
  mutations.refetch.mockReset();
  hooks.useServiceRoster.mockReturnValue({
    data: { items, total: items.length, page: 1, limit: 20, totalPages: items.length > 0 ? 1 : 0 },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mutations.refetch,
  });
  hooks.useUserPreference.mockReturnValue({ data: { value: null }, isLoading: false });
  hooks.useUpsertUserPreference.mockReturnValue({ mutate: vi.fn(), isPending: false });
  hooks.useServiceCatalog.mockReturnValue({ data: { families: [{ ...family, variants: [] }], total: 1 }, isLoading: false });
  hooks.useServiceRosterFamilies.mockReturnValue({ data: [family, advisoryFamily], isLoading: false, error: null });
  hooks.useClientService.mockReturnValue({ data: { id: rosterItem.id }, isLoading: false, error: null });
  hooks.useArchiveClientService.mockReturnValue({ mutateAsync: mutations.archive, isPending: false });
  hooks.useDeleteClientServicePermanently.mockReturnValue({ mutateAsync: mutations.permanentDelete, isPending: false });
  servicesSettingsMock.useServicesWorkspaceSettings.mockReturnValue({ data: { workspaceEnabled: true, deadlineWritesEnabled: true }, isLoading: false, error: null });
}

describe('ServiceRoster', () => {
  it('renders billing as its own roster column without duplicating it in Warnings', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    expect(within(table).getByRole('columnheader', { name: 'Billing' })).toBeVisible();
    const rows = within(table).getAllByRole('row');
    const cells = rows.at(-1)?.querySelectorAll('td');
    expect(cells).toBeDefined();
    expect(cells?.[8]).not.toHaveTextContent('Configured');
    expect(cells?.[9]).toHaveTextContent('Open · Upcoming');
  });

  it('hides the historical trigger when workspace writes are disabled', () => {
    setup();
    servicesSettingsMock.useServicesWorkspaceSettings.mockReturnValue({ data: { workspaceEnabled: true, deadlineWritesEnabled: false }, isLoading: false, error: null });
    render(<ServiceRoster workspaceId="workspace-1" canEdit />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Monthly accounting' })[0]);
    expect(screen.queryByText('Trigger historical cycle')).not.toBeInTheDocument();
  });

  it('keeps the historical trigger hidden while workspace settings load', () => {
    setup();
    servicesSettingsMock.useServicesWorkspaceSettings.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<ServiceRoster workspaceId="workspace-1" canEdit />);
    expect(screen.queryByText('Trigger historical cycle')).not.toBeInTheDocument();
  });

  it('uses a Vault-style toolbar with inactive defaults and a compact family selector', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    const toolbar = screen.getByRole('group', { name: 'Service filters' });
    expect(toolbar).toHaveClass('border', 'rounded-lg', 'p-4');
    expect(within(toolbar).getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(toolbar).getByRole('button', { name: 'Paused' })).toBeVisible();
    expect(within(toolbar).getByRole('button', { name: 'Ended' })).toBeVisible();
    expect(within(toolbar).getByRole('button', { name: 'Families' })).toBeVisible();
    expect(within(toolbar).getByRole('button', { name: 'Columns' })).toBeVisible();
    expect(screen.queryByLabelText('Active filters')).not.toBeInTheDocument();
  });

  it('does not show a services-count subtext after selecting a family filter', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Families' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accounting' }));

    expect(screen.queryByText('1 services')).not.toBeInTheDocument();
  });

  it('keeps spaces while typing, shows one clear control, and waits 300ms before searching', () => {
    vi.useFakeTimers();
    try {
      setup();
      render(<ServiceRoster workspaceId="workspace-1" />);
      const search = screen.getByRole('searchbox', { name: 'Search services' });

      expect(search).toHaveAttribute('type', 'text');
      fireEvent.change(search, { target: { value: 'Annual return' } });

      expect(search).toHaveValue('Annual return');
      expect(screen.getAllByRole('button', { name: 'Clear search' })).toHaveLength(1);
      expect(navigation.replace).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(299));
      expect(navigation.replace).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(1));
      expect(navigation.replace).toHaveBeenCalledWith('/services?query=Annual+return&page=1', { scroll: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the status URL key and sends no status constraint after clearing the last status', () => {
    setup();
    navigation.searchParams = new URLSearchParams('statuses=ACTIVE');
    render(<ServiceRoster workspaceId="workspace-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    expect(navigation.replace).toHaveBeenCalledWith('/services?page=1', { scroll: false });
    expect(hooks.useServiceRoster).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: [] }));
    expect(screen.queryByText('Status: None')).not.toBeInTheDocument();
  });

  it('uses the shared Vault-style alternating rows and shows the full company name without its alias', () => {
    const secondItem: ServiceRosterItem = {
      ...rosterItem,
      id: '77777777-7777-4777-8777-777777777777',
      serviceName: 'Annual return',
      service: { ...rosterItem.service, id: '77777777-7777-4777-8777-777777777777', name: 'Annual return' },
      updatedAt: '2026-08-19T00:00:00.000Z',
    };
    setup([rosterItem, secondItem]);
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    expect(within(table).queryByText('OACS')).not.toBeInTheDocument();
    const companyNames = within(table).getAllByText('Oaktree Accounting & Corporate Solution Pte. Ltd.');
    expect(companyNames).toHaveLength(2);
    companyNames.forEach((name) => expect(name).toBeVisible());
    const bodyRows = within(table).getAllByRole('row').slice(2);
    expect(bodyRows[0]).not.toHaveClass('bg-oak-row-alt');
    expect(bodyRows[1]).toHaveClass('bg-oak-row-alt', 'hover:bg-oak-row-alt-hover');
  });

  it('renders the Family column as plain truncated text on the desktop roster', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    const familyCell = within(table).getByText('Accounting').closest('td');
    expect(familyCell).not.toBeNull();
    expect(familyCell?.querySelector('.rounded-full')).toBeNull();
    expect(familyCell?.querySelector('.truncate')).toHaveTextContent('Accounting');
  });

  it('vertically centers every visible body cell', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    const bodyCells = within(table).getAllByRole('row').at(-1)?.querySelectorAll('td');
    expect(bodyCells).toHaveLength(11);
    bodyCells?.forEach((cell) => expect(cell).toHaveClass('align-middle'));
  });

  it('keeps the table columns visible when no services are found', () => {
    setup([]);
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    expect(within(table).getByRole('columnheader', { name: 'Company' })).toBeVisible();
    const emptyMessage = within(table).getByText('No services yet');
    expect(emptyMessage.closest('tbody')).not.toBeNull();
    expect(emptyMessage.closest('td')).toHaveAttribute('colspan', '11');
    expect(screen.queryByText('No services match the selected filters.')).not.toBeInTheDocument();
  });

  it('selects a service row and shows the bulk action toolbar with selected-row styling', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    const row = within(table).getAllByRole('row').at(-1);
    if (!row) throw new Error('Roster data row missing');
    const checkbox = within(row).getByRole('checkbox', { name: 'Select Monthly accounting for Oaktree Accounting & Corporate Solution Pte. Ltd.' });

    fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(row).toHaveClass('bg-oak-row-selected');
    expect(screen.getByRole('toolbar', { name: 'Selected service actions' })).toHaveTextContent('1 selected');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeVisible();
  });

  it('selects all visible services and removes the selection when toggled again', () => {
    const secondItem: ServiceRosterItem = {
      ...rosterItem,
      id: '77777777-7777-4777-8777-777777777777',
      serviceName: 'Annual return',
      service: { ...rosterItem.service, id: '77777777-7777-4777-8777-777777777777', name: 'Annual return' },
      updatedAt: '2026-08-19T00:00:00.000Z',
    };
    setup([rosterItem, secondItem]);
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    const selectAll = within(table).getByRole('checkbox', { name: 'Select all services' });
    fireEvent.click(selectAll);

    expect(selectAll).toBeChecked();
    expect(screen.getByRole('toolbar', { name: 'Selected service actions' })).toHaveTextContent('2 selected');

    fireEvent.click(selectAll);

    expect(selectAll).not.toBeChecked();
    expect(screen.queryByRole('toolbar', { name: 'Selected service actions' })).not.toBeInTheDocument();
  });

  it('archives selected services with one required reason and clears the selection after success', async () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Select Monthly accounting for Oaktree Accounting & Corporate Solution Pte. Ltd.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(screen.getByRole('dialog', { name: 'Archive selected service?' })).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Archive reason' }), { target: { value: 'No longer offered by the firm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Archive service' }));

    await waitFor(() => expect(mutations.archive).toHaveBeenCalledWith({
      id: rosterItem.id,
      companyId: rosterItem.companyId,
      reason: 'No longer offered by the firm',
    }));
    expect(mutations.refetch).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Selected service actions' })).not.toBeInTheDocument());
  });

  it('permanently deletes selected services with their roster version and required reason', async () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Select Monthly accounting for Oaktree Accounting & Corporate Solution Pte. Ltd.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(screen.getByRole('dialog', { name: 'Permanently delete selected service?' })).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Deletion reason' }), { target: { value: 'Remove obsolete service history' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete service permanently' }));

    await waitFor(() => expect(mutations.permanentDelete).toHaveBeenCalledWith({
      id: rosterItem.id,
      companyId: rosterItem.companyId,
      expectedUpdatedAt: rosterItem.updatedAt,
      reason: 'Remove obsolete service history',
    }));
    expect(mutations.refetch).toHaveBeenCalled();
  });

  it('renders an inline filter for every data column', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    for (const label of ['Company', 'Family', 'Service', 'Status', 'Cadence', 'Next deadline', 'Start/end', 'Warnings', 'Billing']) {
      expect(screen.getByRole('searchbox', { name: `Filter ${label}` })).toBeVisible();
    }
    expect(screen.queryByRole('searchbox', { name: 'Filter Actions' })).not.toBeInTheDocument();
  });

  it('places inline filters above the sortable column headers', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    const headerRows = within(table).getAllByRole('row').slice(0, 2);

    expect(within(headerRows[0]).getByRole('searchbox', { name: 'Filter Company' })).toBeVisible();
    expect(within(headerRows[1]).getByRole('columnheader', { name: 'Company' })).toBeVisible();
  });

  it('opens a read-only view when a roster row is clicked', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    const dataRow = within(screen.getByRole('table', { name: 'Services roster table' })).getAllByRole('row').at(-1);
    if (!dataRow) throw new Error('Roster data row missing');
    fireEvent.click(dataRow);

    expect(screen.getByRole('dialog', { name: 'View service' })).toBeVisible();
  });

  it('shows text and an accent cue for a selected family chip', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Families' }));
    const familyChip = screen.getByRole('button', { name: 'Accounting' });
    expect(familyChip).toHaveAttribute('aria-pressed', 'false');
    expect(familyChip.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(familyChip).toHaveStyle({ '--family-color': '#3F6DA8' });
    fireEvent.click(familyChip);
    expect(hooks.useServiceRoster).toHaveBeenLastCalledWith(
      expect.objectContaining({ familyIds: [family.id] }),
    );
  });

  it('keeps complete family options when the current roster page is filtered', () => {
    setup();
    render(<ServiceRoster workspaceId="workspace-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Families' }));
    expect(screen.getByRole('button', { name: 'Advisory' })).toBeVisible();
  });

  it('does not fall back to page-local families when facets fail and offers retry', () => {
    setup();
    const refetch = vi.fn();
    hooks.useServiceRosterFamilies.mockReturnValue({ data: undefined, isLoading: false, error: new Error('facet unavailable'), refetch });
    render(<ServiceRoster workspaceId="workspace-1" />);

    expect(screen.queryByRole('button', { name: 'Accounting' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert', { name: 'Family filters unavailable' })).toHaveTextContent('facet unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry family filters' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('routes inline filters to the canonical server query and resets the page', () => {
    setup();
    navigation.searchParams = new URLSearchParams('page=3');
    render(<ServiceRoster workspaceId="workspace-1" />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Company' }), { target: { value: 'Oaktree' } });

    expect(hooks.useServiceRoster).toHaveBeenLastCalledWith(expect.objectContaining({
      companyQuery: 'Oaktree',
      page: 1,
    }));
    expect(navigation.replace).toHaveBeenCalledWith('/services?page=1&companyQuery=Oaktree', { scroll: false });
  });

  it('synchronizes roster requests when browser navigation changes the URL', () => {
    setup();
    const view = render(<ServiceRoster workspaceId="workspace-1" />);
    navigation.searchParams = new URLSearchParams('page=2&statuses=PAUSED&familyQuery=Advisory');
    view.rerender(<ServiceRoster workspaceId="workspace-1" />);

    expect(hooks.useServiceRoster).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 2,
      statuses: ['PAUSED'],
      familyQuery: 'Advisory',
    }));
  });

  it('restores and exposes the complete table preference controls', () => {
    setup();
    hooks.useUserPreference.mockReturnValue({
      data: {
        value: {
          version: 1,
          columnWidths: { company: 340 },
          columnOrder: ['service', 'company'],
          columnVisibility: { family: false },
          sortBy: 'service',
          sortOrder: 'desc',
          pageSize: 50,
        },
      },
      isLoading: false,
    });
    render(<ServiceRoster workspaceId="workspace-1" />);

    expect(screen.getByRole('combobox', { name: 'Per page:' })).toHaveValue('50');
    expect(screen.queryByRole('option', { name: '200' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add service' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    expect(screen.getByRole('dialog', { name: 'Adjust columns' })).toBeVisible();
    const familyCheckbox = screen.getByRole('checkbox', { name: 'Show Family column' });
    expect(familyCheckbox).not.toBeChecked();
    expect(familyCheckbox.closest('label')).toHaveClass('self-stretch', 'min-h-11');
    expect(screen.getByRole('button', { name: 'Move Service column down' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Move Service column down' })).toHaveClass('min-h-11', 'min-w-11');
  });

  it('writes resized widths after pointer release instead of every pointer move', async () => {
    setup();
    const mutate = vi.fn();
    hooks.useUpsertUserPreference.mockReturnValue({ mutate, isPending: false });
    render(<ServiceRoster workspaceId="workspace-1" />);

    const resize = screen.getByRole('separator', { name: 'Resize Company column' });
    fireEvent.pointerDown(resize, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 180 });
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 180 });

    await waitFor(() => expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      key: 'services.roster.table.v1',
      value: expect.objectContaining({ version: 1, columnWidths: expect.objectContaining({ company: 459 }) }),
    })));
  });

  it('uses a Vault-style separator handle with keyboard resizing and a width-driven table', async () => {
    setup();
    const mutate = vi.fn();
    hooks.useUpsertUserPreference.mockReturnValue({ mutate, isPending: false });
    render(<ServiceRoster workspaceId="workspace-1" />);

    const table = screen.getByRole('table', { name: 'Services roster table' });
    expect(table).toHaveClass('w-full', 'min-w-max');
    expect(table).not.toHaveClass('table-fixed');
    expect(table.style.width).toBe('');
    expect(table.style.minWidth).toBe('');
    expect(table.querySelector('colgroup col')).toHaveStyle({ width: '48px' });
    expect((table.querySelectorAll('colgroup col').item(10) as HTMLElement).style.width).toBe('');
    expect(screen.queryByRole('separator', { name: 'Resize Actions column' })).not.toBeInTheDocument();

    const resize = screen.getByRole('separator', { name: 'Resize Company column' });
    expect(resize).toHaveAttribute('aria-orientation', 'vertical');
    expect(resize).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(resize, { key: 'ArrowRight' });

    expect(table.style.width).toBe('');
    expect(table.style.minWidth).toBe('');
    expect(table.querySelectorAll('colgroup col')[1]).toHaveStyle({ width: '389px' });
    await waitFor(() => expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({
      key: 'services.roster.table.v1',
      value: expect.objectContaining({ columnWidths: expect.objectContaining({ company: 389 }) }),
    })));
  });

  it('merges newer table actions into a pending resize save', () => {
    vi.useFakeTimers();
    try {
      setup();
      const mutate = vi.fn();
      hooks.useUpsertUserPreference.mockReturnValue({ mutate, isPending: false });
      render(<ServiceRoster workspaceId="workspace-1" />);

      const resize = screen.getByRole('separator', { name: 'Resize Company column' });
      fireEvent.pointerDown(resize, { clientX: 100 });
      fireEvent.pointerMove(window, { clientX: 180 });
      fireEvent.pointerUp(window, { clientX: 180 });

      fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show Family column' }));
      fireEvent.click(screen.getByRole('button', { name: 'Move Company column down' }));
      fireEvent.click(screen.getByRole('button', { name: 'Sort by Service' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Per page:' }), { target: { value: '50' } });

      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({
        value: expect.objectContaining({
          columnWidths: expect.objectContaining({ company: 459 }),
          columnVisibility: expect.objectContaining({ family: false }),
          columnOrder: expect.arrayContaining(['family', 'company']),
          sortBy: 'service',
          pageSize: 50,
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists visibility, order, sorting, and page-size changes in the versioned preference', () => {
    setup();
    const mutate = vi.fn();
    hooks.useUpsertUserPreference.mockReturnValue({ mutate, isPending: false });
    render(<ServiceRoster workspaceId="workspace-1" />);

    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Family column' }));
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({
      value: expect.objectContaining({ version: 1, columnVisibility: expect.objectContaining({ family: false }) }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Move Company column down' }));
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({
      value: expect.objectContaining({ columnOrder: expect.arrayContaining(['family', 'company']) }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Service' }));
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({
      value: expect.objectContaining({ sortBy: 'service', sortOrder: 'asc' }),
    }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Per page:' }), { target: { value: '50' } });
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({
      value: expect.objectContaining({ pageSize: 50 }),
    }));
  });
});
