import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: { updateContact: true, createContact: false, deleteContact: true },
  isWorkspaceAdmin: false,
  session: { tenantId: 'tenant-1', isSuperAdmin: false, companyIds: [] as string[] },
  duplicateTotal: 3,
  duplicateError: null as Error | null,
}));

vi.mock('@/hooks/use-contacts', () => ({
  useContacts: () => ({ data: { contacts: [{ id: 'contact-1', contactType: 'INDIVIDUAL', _count: { companyRelations: 0 } }], total: 1, page: 1, limit: 20, totalPages: 1 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }),
  useDeleteContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBulkDeleteContacts: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useContactDuplicateGroups: () => ({ data: { groups: [], total: mocks.duplicateTotal, page: 1, limit: 1, totalPages: 3 }, error: mocks.duplicateError }),
}));
vi.mock('@/hooks/use-permissions', () => ({ usePermissions: () => ({ can: mocks.permissions, isWorkspaceAdmin: mocks.isWorkspaceAdmin }) }));
vi.mock('@/hooks/use-auth', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('@/components/ui/workspace-selector', () => ({ useActiveWorkspaceId: () => 'tenant-1' }));
vi.mock('@/hooks/use-user-preferences', () => ({ useUserPreference: () => ({ data: null }), useUpsertUserPreference: () => ({ mutate: vi.fn() }) }));
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/contacts/contact-filters', () => ({ ContactFilters: () => <div>Filters</div> }));
vi.mock('@/components/contacts/contact-table', () => ({ ContactTable: ({ onToggleOne, selectedIds }: { onToggleOne: (id: string) => void; selectedIds: Set<string> }) => <button onClick={() => onToggleOne('contact-1')}>Selection {selectedIds.size}</button> }));
vi.mock('@/components/ui/pagination', () => ({ Pagination: () => null }));
vi.mock('@/components/ui/collapsible-section', () => ({ MobileCollapsibleSection: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/ui/bulk-actions-toolbar', () => ({ BulkActionsToolbar: () => null }));
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/contacts/contact-duplicate-review-modal', () => ({ ContactDuplicateReviewModal: ({ open }: { open: boolean }) => open ? <div role="dialog">Duplicate review modal</div> : null }));

import ContactsPage from '@/app/(dashboard)/contacts/page';

describe('Contacts page duplicate review entry', () => {
  beforeEach(() => {
    mocks.permissions.updateContact = true;
    mocks.isWorkspaceAdmin = false;
    mocks.session.companyIds = [];
    mocks.duplicateTotal = 3;
    mocks.duplicateError = null;
  });

  it('shows the pending count to workspace-wide editors and preserves contact selection when opened', async () => {
    render(<ContactsPage />);
    fireEvent.click(screen.getByRole('button', { name: /selection 0/i }));
    fireEvent.click(screen.getByRole('button', { name: /review duplicates/i }));

    expect(screen.getByRole('button', { name: /review duplicates.*3 pending/i })).toBeVisible();
    expect(await screen.findByRole('dialog')).toHaveTextContent('Duplicate review modal');
    expect(screen.getByRole('button', { name: /selection 1/i })).toBeVisible();
  });

  it('hides the entry point without workspace-wide access or contact update permission', () => {
    mocks.session.companyIds = ['company-1'];
    const { rerender } = render(<ContactsPage />);
    expect(screen.queryByRole('button', { name: /review duplicates/i })).not.toBeInTheDocument();

    mocks.session.companyIds = [];
    mocks.permissions.updateContact = false;
    rerender(<ContactsPage />);
    expect(screen.queryByRole('button', { name: /review duplicates/i })).not.toBeInTheDocument();
  });

  it('shows an unavailable count instead of zero when the summary query fails', () => {
    mocks.duplicateError = new Error('Unavailable');
    render(<ContactsPage />);

    expect(screen.getByRole('button', { name: /review duplicates, count unavailable/i })).toBeVisible();
    expect(screen.queryByText('0 pending')).not.toBeInTheDocument();
    expect(screen.getByText('Count unavailable')).toBeVisible();
  });
});
