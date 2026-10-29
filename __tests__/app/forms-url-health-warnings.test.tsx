import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FormsPage from '@/app/(dashboard)/forms/page';

vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({ data: { id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false } }),
}));
vi.mock('@/components/ui/workspace-selector', () => ({ useActiveWorkspaceId: () => 'tenant-1' }));
vi.mock('@/hooks/use-form-url-health', () => ({
  useFormUrlWarningSummaries: () => ({
    data: [{ formId: 'form-1', warningCount: 2, lastCheckedAt: '2026-08-01T02:00:00.000Z' }],
  }),
}));
vi.mock('@/hooks/use-forms', () => ({
  useForms: (params: { status?: string }) => ({
    data: {
      forms: params.status === 'PUBLISHED' ? [{
        id: 'form-1', title: 'Client Intake', slug: 'client-intake', status: 'PUBLISHED',
        fieldCount: 4, responseCount: 1, conversionRate: 25, updatedAt: '2026-08-01T00:00:00.000Z',
      }] : [],
      total: params.status === 'PUBLISHED' ? 1 : 0,
      page: 1, limit: 20, totalPages: 1,
    },
    isLoading: false,
    error: null,
  }),
  useRecentFormSubmissions: () => ({ data: [], isLoading: false, error: null }),
  useFormsWithWarnings: () => ({ data: [], isLoading: false, error: null }),
  useCreateForm: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDuplicateForm: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteForm: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useHardDeleteForm: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/forms/preset-list-manager', () => ({ PresetListManager: () => null }));

describe('Forms URL health warnings', () => {
  it('shows a compact broken-link count on affected forms', () => {
    render(<FormsPage />);
    expect(screen.getByLabelText('2 broken links')).toBeVisible();
  });

  it('allows action tooltips to extend beyond the form card', () => {
    render(<FormsPage />);

    const formCard = screen.getByLabelText('View responses').closest('article');
    expect(formCard).not.toBeNull();
    expect(formCard).toHaveClass('overflow-visible');
    expect(formCard).not.toHaveClass('overflow-hidden');
  });
});
