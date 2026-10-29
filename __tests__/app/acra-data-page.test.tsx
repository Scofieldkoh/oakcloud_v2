import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useAcraRecords: vi.fn(),
  refetch: vi.fn(),
  savePref: vi.fn(),
  triggerSyncMutate: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useSession: mocks.useSession,
}));

vi.mock('@/hooks/use-acra-records', () => ({
  useAcraRecords: mocks.useAcraRecords,
  buildAcraRecordsSearchParams: () => new URLSearchParams(),
  isAcraSyncing: (syncState: { lastStartedAt?: string | null; lastCompletedAt?: string | null } | null) => {
    if (!syncState?.lastStartedAt) return false;
    if (!syncState.lastCompletedAt) return true;
    return new Date(syncState.lastStartedAt) > new Date(syncState.lastCompletedAt);
  },
  useTriggerAcraSync: () => ({
    mutate: mocks.triggerSyncMutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreferences: () => ({ data: undefined }),
  useUpsertUserPreference: () => ({ mutate: mocks.savePref }),
}));

vi.mock('@/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: () => {},
}));

vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: Array<{ value: string; label: string }>;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <select
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({
    onChange,
    placeholder,
  }: {
    onChange: (value: { mode: 'range'; range: { from?: Date; to?: Date } } | undefined) => void;
    placeholder?: string;
  }) => (
    <input
      type="text"
      aria-label={placeholder}
      placeholder={placeholder}
      onChange={(event) =>
        onChange(
          event.target.value
            ? { mode: 'range', range: { from: new Date('2026-08-01'), to: new Date('2026-08-14') } }
            : undefined
        )
      }
    />
  ),
}));

function acraData(overrides: Record<string, unknown> = {}) {
  return {
    records: [
      {
        id: 'record-1',
        uen: '201904999E',
        entityName: 'ACME HOLDINGS PTE. LTD.',
        entityStatus: 'Live Company',
        entityType: 'Local Company',
        companyTypeDescription: 'EXEMPT PRIVATE COMPANY LIMITED BY SHARES',
        registrationIncorporateDate: '04/05/2019',
        block: '123',
        streetName: 'MAIN STREET',
        levelNo: '05',
        unitNo: '01',
        buildingName: 'ACME BUILDING',
        postalCode: '123456',
        address: '123 MAIN STREET ACME BUILDING #05-01 SINGAPORE 123456',
        accountDueDate: '04/11/2026',
        annualReturnDate: '04/05/2026',
        primarySsicCode: '69201',
        primarySsicDescription: 'ACCOUNTING AND AUDITING SERVICES',
        secondarySsicCode: '70201',
        secondarySsicDescription: 'MANAGEMENT CONSULTANCY SERVICES',
        noOfOfficers: '3',
        formerEntityName1: 'OLD ACME PTE. LTD.',
        uenOfAuditFirm1: 'T08LL0001A',
        dataAsOf: '2026-08-14T14:07:42+08:00',
        createdAt: '2026-08-14T06:07:42.000Z',
        updatedAt: '2026-08-14T06:07:42.000Z',
      },
      {
        id: 'record-2',
        uen: '202000002B',
        entityName: 'BETA PTE. LTD.',
        entityStatus: 'In Liquidation - Creditors',
        entityType: 'Foreign Company',
        companyTypeDescription: null,
        registrationIncorporateDate: null,
        block: null,
        streetName: null,
        levelNo: null,
        unitNo: null,
        buildingName: null,
        postalCode: null,
        address: null,
        accountDueDate: null,
        annualReturnDate: null,
        primarySsicCode: null,
        primarySsicDescription: null,
        secondarySsicCode: null,
        secondarySsicDescription: null,
        noOfOfficers: null,
        formerEntityName1: null,
        uenOfAuditFirm1: null,
        dataAsOf: '2026-08-14T14:07:42+08:00',
        createdAt: '2026-08-14T06:08:42.000Z',
        updatedAt: '2026-08-14T06:08:42.000Z',
      },
    ],
    total: 466_583,
    page: 1,
    limit: 50,
    totalPages: 9_332,
    syncState: {
      collectionLastUpdatedAt: '2026-08-14T14:07:42+08:00',
      entityCount: 466_583,
      lastStartedAt: null,
      lastCompletedAt: '2026-08-14T12:10:45.000Z',
      lastError: null,
    },
    ...overrides,
  };
}

describe('ACRA Data admin page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({
      data: { isSuperAdmin: true, isWorkspaceAdmin: false },
    });
    mocks.useAcraRecords.mockReturnValue({
      data: acraData(),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mocks.refetch,
    });
  });

  it('renders the records table with the sync summary', async () => {
    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    expect(screen.getByRole('heading', { name: 'ACRA Data' })).toBeTruthy();
    expect(screen.getByText('466,583 entities')).toBeTruthy();
    expect(screen.getAllByText('ACME HOLDINGS PTE. LTD.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BETA PTE. LTD.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('201904999E').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Live Company').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In Liquidation - Creditors').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Local Company').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Foreign Company').length).toBeGreaterThan(0);
  }, 15_000);

  it('renders the CSV export button', async () => {
    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
  });

  it('shows the empty state when there are no records', async () => {
    mocks.useAcraRecords.mockReturnValue({
      data: acraData({ records: [], total: 0, totalPages: 0 }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mocks.refetch,
    });

    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    expect(screen.getAllByText('No ACRA records found').length).toBeGreaterThan(0);
  }, 15_000);

  it('renders inline filters for every column', async () => {
    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    // 6 date columns render the date range picker
    expect(screen.getAllByLabelText('All dates')).toHaveLength(6);
    // 25 columns - 1 type select - 6 date pickers = 18 free-text filters
    expect(screen.getAllByPlaceholderText('All')).toHaveLength(18);
  });

  it('adds a filter chip when a date range inline filter is applied', async () => {
    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    const dataAsOfPicker = screen.getAllByLabelText('All dates')[0] as HTMLInputElement;
    await fireEvent.change(dataAsOfPicker, { target: { value: '2026-08-01' } });

    expect(screen.getAllByText(/2026-08-01 - 2026-08-14/).length).toBeGreaterThan(0);
  });

  it('renders the new ACRA fields (address, SSIC, dates, former name)', async () => {
    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    expect(screen.getAllByText('ACCOUNTING AND AUDITING SERVICES').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MANAGEMENT CONSULTANCY SERVICES').length).toBeGreaterThan(0);
    expect(screen.getAllByText('EXEMPT PRIVATE COMPANY LIMITED BY SHARES').length).toBeGreaterThan(0);
    expect(screen.getAllByText('OLD ACME PTE. LTD.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('123 MAIN STREET ACME BUILDING #05-01 SINGAPORE 123456').length).toBeGreaterThan(0);
  });

  it('collapses mobile card details by default and expands all fields on click', async () => {
    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    const card = screen
      .getAllByText('201904999E')
      .map((element) => element.closest('.card'))
      .find((element) => element !== null) as HTMLElement;

    // Collapsed: only name, UEN, and status are visible
    expect(within(card).getByText('ACME HOLDINGS PTE. LTD.')).toBeTruthy();
    expect(within(card).getByText('201904999E')).toBeTruthy();
    expect(within(card).getByText('Live Company')).toBeTruthy();
    expect(within(card).queryByText('Data As Of')).toBeNull();
    expect(within(card).queryByText('Address')).toBeNull();

    await fireEvent.click(card);

    // Expanded: every record field is shown
    expect(within(card).getByText('Data As Of')).toBeTruthy();
    expect(within(card).getByText('Company Type')).toBeTruthy();
    expect(within(card).getByText('EXEMPT PRIVATE COMPANY LIMITED BY SHARES')).toBeTruthy();
    expect(within(card).getByText('ACCOUNTING AND AUDITING SERVICES')).toBeTruthy();
    expect(within(card).getByText('Secondary SSIC Description')).toBeTruthy();
    expect(within(card).getByText('OLD ACME PTE. LTD.')).toBeTruthy();
    expect(within(card).getByText('T08LL0001A')).toBeTruthy();
    expect(within(card).getByText('123 MAIN STREET ACME BUILDING #05-01 SINGAPORE 123456')).toBeTruthy();
    expect(within(card).getByText('Postal Code')).toBeTruthy();

    await fireEvent.click(card);

    // Collapses again
    expect(within(card).queryByText('Data As Of')).toBeNull();
  });

  it('triggers the manual sync when the Sync now button is clicked', async () => {
    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    await fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    expect(mocks.triggerSyncMutate).toHaveBeenCalledTimes(1);
  });

  it('shows a syncing state while a sync is running', async () => {
    mocks.useAcraRecords.mockReturnValue({
      data: acraData({
        syncState: {
          collectionLastUpdatedAt: '2026-08-14T14:07:42+08:00',
          entityCount: 466_583,
          lastStartedAt: '2026-08-14T12:00:00.000Z',
          lastCompletedAt: '2026-08-14T11:00:00.000Z',
          lastError: null,
        },
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mocks.refetch,
    });

    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    expect(screen.getByText('Sync in progress...')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Syncing...' })).toBeTruthy();
  });

  it('shows the sync error when the last sync failed', async () => {
    mocks.useAcraRecords.mockReturnValue({
      data: acraData({
        syncState: {
          collectionLastUpdatedAt: null,
          entityCount: 0,
          lastCompletedAt: null,
          lastError: 'dataset download failed',
        },
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mocks.refetch,
    });

    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    expect(screen.getByText(/Sync error: dataset download failed/)).toBeTruthy();
  });

  it('denies access to non-admin users', async () => {
    mocks.useSession.mockReturnValue({
      data: { isSuperAdmin: false, isWorkspaceAdmin: false },
    });

    const { default: AcraDataPage } = await import('@/app/(dashboard)/admin/acra-data/page');
    render(<AcraDataPage />);

    expect(screen.getByText('You do not have permission to access this page.')).toBeTruthy();
    expect(screen.queryByText('ACME HOLDINGS PTE. LTD.')).toBeNull();
  });
});

describe('sidebar navigation', () => {
  it('lists ACRA Records as an ungrouped admin item like Connectors', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ui/sidebar.tsx'), 'utf8');

    const ungroupedIndex = source.indexOf('const ungroupedAdminItems');
    const acraItemIndex = source.indexOf("name: 'ACRA Records'");
    const groupsIndex = source.indexOf('const adminNavGroups');

    expect(ungroupedIndex).toBeGreaterThan(-1);
    expect(acraItemIndex).toBeGreaterThan(ungroupedIndex);
    expect(acraItemIndex).toBeLessThan(groupsIndex);
    expect(source).toContain("{ name: 'ACRA Records', href: '/admin/acra-data', icon: Database, adminOnly: true }");
    expect(source).not.toContain("id: 'acra-data'");
  });
});
