import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactMatchReviewRequiredError } from '@/hooks/use-contacts';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@/hooks/use-contacts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/use-contacts')>();
  return {
    ...original,
    useCreateContact: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  };
});
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: { createContact: true }, isLoading: false }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({ data: { tenantId: 'tenant-1', isSuperAdmin: false } }),
}));
vi.mock('@/hooks/use-unsaved-navigation-guard', () => ({
  useUnsavedNavigationGuard: () => ({ requestNavigation: vi.fn(), requestAction: vi.fn(), disarm: vi.fn(), rearm: vi.fn(), dialog: null }),
}));
vi.mock('@/components/ui/workspace-selector', () => ({ useActiveWorkspaceId: () => 'tenant-1' }));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/use-company-search', () => ({
  useCompanySearch: () => ({
    searchQuery: '', setSearchQuery: vi.fn(), options: [], isLoading: false,
    selectedCompany: null, setSelectedCompany: vi.fn(),
  }),
}));
vi.mock('@/components/contacts/purpose-toggle', () => ({ PurposeToggle: () => null }));
vi.mock('@/components/ui/async-search-select', () => ({ AsyncSearchSelect: () => null }));

import NewContactPage from '@/app/(dashboard)/contacts/new/page';

const match = {
  contactId: '11111111-1111-4111-8111-111111111111',
  score: 100,
  automatic: true,
  blockedByIdentifierConflict: false,
  reasons: ['EXACT_CANONICAL_NAME'] as const,
  conflicts: [],
};

describe('NewContactPage match decisions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('closes a stale decision dialog, shows the error, and preserves form input for a fresh preview', async () => {
    mocks.mutateAsync
      .mockRejectedValueOnce(new ContactMatchReviewRequiredError('Review required', match as never))
      .mockRejectedValueOnce(new Error('The contact match is no longer current; submit again to preview'));

    render(<NewContactPage />);
    const firstName = screen.getByPlaceholderText('John');
    fireEvent.change(firstName, { target: { value: 'çŽ‹å°æ˜Ž' } });
    fireEvent.click(screen.getByRole('button', { name: /create contact/i }));

    expect(await screen.findByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /use existing/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/match is no longer current/i);
    expect(firstName).toHaveValue('çŽ‹å°æ˜Ž');
    expect(screen.getByRole('button', { name: /create contact/i })).toBeEnabled();
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
  });
});
