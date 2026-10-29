import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessingDocumentListItem } from '@/hooks/use-processing-documents';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  documents: [] as ProcessingDocumentListItem[],
  savePreference: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => new URLSearchParams('needsReview=true'),
}));
vi.mock('@/hooks/use-permissions', () => ({ usePermissions: () => ({ can: { createDocument: true } }) }));
vi.mock('@/hooks/use-auth', () => ({ useSession: () => ({ data: { isSuperAdmin: false, tenantId: 'tenant-1' } }) }));
vi.mock('@/components/ui/workspace-selector', () => ({ useActiveWorkspaceId: () => 'tenant-1' }));
vi.mock('@/components/ui/company-selector', () => ({ useActiveCompanyId: () => undefined }));
vi.mock('@/components/ui/company-select', () => ({ CompanySelect: () => <div>company filter</div> }));
vi.mock('@/components/processing/bulk-actions-toolbar', () => ({ BulkActionsToolbar: () => null }));
vi.mock('@/components/processing/processing-filters', () => ({ ProcessingFilters: () => <div>mobile filters</div> }));
vi.mock('@/components/processing/document-tags', () => ({ DocumentTags: () => null }));
vi.mock('@/hooks/use-document-tags', () => ({ useAvailableTags: () => ({ data: [] }) }));
vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreferences: () => ({ data: {} }),
  useUpsertUserPreference: () => ({ mutate: mocks.savePreference }),
}));
vi.mock('@/hooks/use-processing-documents', () => ({
  useProcessingDocuments: () => ({
    data: { documents: mocks.documents, total: mocks.documents.length, page: 1, limit: 20, totalPages: 1 },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSelectAllProcessingDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDocumentNavigation: () => ({ data: undefined, refetch: vi.fn() }),
}));

import ProcessingDocumentsPage from '@/app/(dashboard)/processing/page';

function doc(overrides: Partial<ProcessingDocumentListItem> = {}): ProcessingDocumentListItem {
  return {
    id: 'pd-1',
    documentId: 'doc-1',
    isContainer: false,
    parentProcessingDocId: null,
    pageFrom: null,
    pageTo: null,
    pageCount: 1,
    pipelineStatus: 'EXTRACTION_DONE',
    duplicateStatus: 'NONE',
    currentRevisionId: 'rev-1',
    lockVersion: 1,
    createdAt: '2026-09-01T02:00:00.000Z',
    document: { id: 'doc-1', fileName: 'acme-invoice.pdf', mimeType: 'application/pdf', fileSize: 100, companyId: 'co-1', company: { id: 'co-1', name: 'Acme Pte Ltd' } },
    currentRevision: {
      id: 'rev-1', revisionNumber: 1, status: 'DRAFT', documentCategory: null, documentSubCategory: null,
      vendorName: 'Acme Supplies', documentNumber: 'INV-7', documentDate: '2026-08-30', currency: 'SGD',
      subtotal: '100.00', taxAmount: '9.00', totalAmount: '109.00', homeCurrency: 'SGD', homeSubtotal: '100.00',
      homeTaxAmount: '9.00', homeEquivalent: '109.00',
    },
    ...overrides,
  } as ProcessingDocumentListItem;
}

describe('Document Processing list page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents = [doc()];
  });

  it('shows statistics, the filter chip from the URL and the document in the table', () => {
    render(<ProcessingDocumentsPage />);
    expect(screen.getByText('Statistics')).toBeInTheDocument();
    expect(screen.getByText('Active filters:')).toBeInTheDocument();
    expect(screen.getByText('Needs Review')).toBeInTheDocument();
    const row = screen.getAllByText('acme-invoice.pdf').map((node) => node.closest('tr')).find(Boolean) as HTMLElement;
    expect(within(row).getByText('Acme Supplies')).toBeInTheDocument();
    expect(within(row).getByText('INV-7')).toBeInTheDocument();
  });

  it('shows the filtered empty state when nothing matches', () => {
    mocks.documents = [];
    render(<ProcessingDocumentsPage />);
    expect(screen.getAllByText(/No matching documents/i).length).toBeGreaterThan(0);
  });

  it('hides a column from the Adjust columns dialog and saves the choice', async () => {
    const user = userEvent.setup();
    render(<ProcessingDocumentsPage />);
    await user.click(screen.getByRole('button', { name: /Adjust columns|Columns/i }));
    const dialog = screen.getByRole('dialog', { name: 'Adjust columns' });
    await user.click(within(dialog).getByLabelText('Vendor'));
    expect(mocks.savePreference).toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({ vendor: false }) }));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Adjust columns' })).not.toBeInTheDocument();
  });
});
