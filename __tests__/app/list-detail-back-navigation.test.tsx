import { act, cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
  shortcuts: [] as Array<{ key: string; ctrl?: boolean; handler: () => void }>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: (shortcuts: typeof mocks.shortcuts) => {
    mocks.shortcuts = shortcuts;
  },
}));

vi.mock('@/hooks/use-contacts', () => ({
  useContact: () => ({ data: null, isLoading: false, error: new Error('missing'), refetch: vi.fn(), isFetching: false }),
  useDeleteContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLinkContactToCompany: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkContactFromCompany: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveOfficerPosition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveShareholding: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateOfficerPosition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateShareholding: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useContactLinkInfo: () => ({ data: null }),
}));

vi.mock('@/hooks/use-companies', () => ({
  useCompanies: () => ({ data: { companies: [] }, isLoading: false }),
  useCompany: () => ({ data: null, isLoading: false, error: new Error('missing'), refetch: vi.fn(), isFetching: false }),
  useCompanyBizFile: () => ({ data: null }),
  useDeleteCompany: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetrieveAcra: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCompany: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/use-contact-details', () => ({
  useCompanyContactDetails: () => ({ data: null, refetch: vi.fn(), isFetching: false }),
}));

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    can: {
      createContact: false,
      updateContact: false,
      deleteContact: false,
      updateCompany: false,
      deleteCompany: false,
      updateDocument: false,
    },
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/components/companies/company-detail', () => ({
  CompanyProfileTab: () => null,
  ContactDetailsTab: () => null,
  CompanyTabs: () => null,
  useTabState: () => ['profile', vi.fn()],
}));

import ContactDetailPage from '@/app/(dashboard)/contacts/[id]/page';
import CompanyDetailPage from '@/app/(dashboard)/companies/[id]/page';

describe('list detail back navigation', () => {
  beforeEach(() => {
    cleanup();
    mocks.push.mockReset();
    mocks.replace.mockReset();
    mocks.searchParams = new URLSearchParams();
    mocks.shortcuts = [];
  });

  it('uses the validated Contacts return URL for the link and keyboard shortcut', async () => {
    await act(async () => {
      render(
        <ContactDetailPage
          params={Promise.resolve({ id: 'contact-1' })}
          searchParams={Promise.resolve({ returnTo: '/contacts?page=3&limit=50&q=Jane' })}
        />,
      );
    });

    expect(await screen.findByRole('link', { name: 'Back to Contacts' }))
      .toHaveAttribute('href', '/contacts?page=3&limit=50&q=Jane');

    mocks.shortcuts.find((shortcut) => shortcut.key === 'Backspace' && shortcut.ctrl)?.handler();
    expect(mocks.push).toHaveBeenCalledWith('/contacts?page=3&limit=50&q=Jane');
  });

  it('falls back to Contacts for an external return URL', async () => {
    await act(async () => {
      render(
        <ContactDetailPage
          params={Promise.resolve({ id: 'contact-1' })}
          searchParams={Promise.resolve({ returnTo: 'https://evil.example/contacts?page=3' })}
        />,
      );
    });

    expect(await screen.findByRole('link', { name: 'Back to Contacts' }))
      .toHaveAttribute('href', '/contacts');
  });

  it('uses the validated Companies return URL for the link and keyboard shortcut', async () => {
    mocks.searchParams = new URLSearchParams('returnTo=%2Fcompanies%3Fpage%3D4%26status%3DLIVE');
    await act(async () => {
      render(<CompanyDetailPage params={Promise.resolve({ id: 'company-1' })} />);
    });

    expect(await screen.findByRole('link', { name: 'Back to Companies' }))
      .toHaveAttribute('href', '/companies?page=4&status=LIVE');

    mocks.shortcuts.find((shortcut) => shortcut.key === 'Backspace' && shortcut.ctrl)?.handler();
    expect(mocks.push).toHaveBeenCalledWith('/companies?page=4&status=LIVE');
  });

  it('falls back to Companies for a cross-section return URL', async () => {
    mocks.searchParams = new URLSearchParams('returnTo=%2Fcontacts%3Fpage%3D4');
    await act(async () => {
      render(<CompanyDetailPage params={Promise.resolve({ id: 'company-1' })} />);
    });

    expect(await screen.findByRole('link', { name: 'Back to Companies' }))
      .toHaveAttribute('href', '/companies');
  });
});
