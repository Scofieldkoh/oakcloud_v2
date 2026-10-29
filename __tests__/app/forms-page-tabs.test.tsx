import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FormsPage from '@/app/(dashboard)/forms/page';

vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({ data: { id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false } }),
}));

vi.mock('@/components/ui/workspace-selector', () => ({
  useActiveWorkspaceId: () => 'tenant-1',
}));

vi.mock('@/hooks/use-form-url-health', () => ({
  useFormUrlWarningSummaries: () => ({ data: [] }),
}));

vi.mock('@/hooks/use-forms', () => ({
  useForms: (params: { status?: string }) => {
    const totals: Record<string, number> = {
      all: 2,
      DRAFT: 1,
      PUBLISHED: 1,
      ARCHIVED: 3,
    };

    return {
      data: {
        forms: params.status === 'ARCHIVED'
          ? [{
              id: 'archived-form',
              title: 'Archived Form',
              slug: 'archived-archived-form',
              status: 'ARCHIVED',
              fieldCount: 1,
              responseCount: 0,
              conversionRate: 0,
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }]
          : [],
        total: totals[params.status ?? 'all'],
        page: 1,
        limit: 20,
        totalPages: 1,
      },
      isLoading: false,
      error: null,
    };
  },
  useRecentFormSubmissions: () => ({ data: [], isLoading: false, error: null }),
  useFormsWithWarnings: () => ({ data: [], isLoading: false, error: null }),
  useCreateForm: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDuplicateForm: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteForm: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useHardDeleteForm: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/components/forms/preset-list-manager', () => ({
  PresetListManager: ({ isOpen }: { isOpen: boolean }) => isOpen
    ? <div role="dialog" aria-label="Preset lists">Preset manager</div>
    : null,
}));

describe('FormsPage tabs', () => {
  it('opens preset list management from the compact header action', () => {
    render(<FormsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Preset lists' }));
    expect(screen.getByRole('dialog', { name: 'Preset lists' })).toBeVisible();
  });

  it('shows the loaded count badge without requiring navigation to the active tab', () => {
    render(<FormsPage />);

    expect(screen.getByRole('button', { name: 'All2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Published1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archived3' })).toBeInTheDocument();
  });

  it('defaults to the published tab', () => {
    render(<FormsPage />);

    expect(screen.getByRole('button', { name: 'Published1' })).toHaveClass('text-oak-primary');
    expect(screen.getByRole('button', { name: 'All2' })).not.toHaveClass('text-oak-primary');
  });

  it('shows permanent delete for archived forms only when the archived tab is active', () => {
    render(<FormsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Archived3' }));
    fireEvent.click(screen.getByLabelText('More actions for Archived Form'));

    expect(screen.getByText('Delete permanently')).toBeInTheDocument();
    expect(screen.queryByText('Archive form')).not.toBeInTheDocument();
  });
});
