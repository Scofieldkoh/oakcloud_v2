import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routerPush = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
    prefetch: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, prefetch: _prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreferences: () => ({
    data: {
      'generated-documents:list:columns:v1': {
        key: 'generated-documents:list:columns:v1',
        value: {},
        updatedAt: null,
      },
    },
  }),
  useUpsertUserPreference: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/components/ui/company-select', () => ({
  CompanySelect: ({
    value,
    placeholder,
  }: {
    value: string;
    placeholder?: string;
  }) => <input aria-label="Filter by company" placeholder={placeholder} value={value} readOnly />,
}));

import { DocumentTable, type GeneratedDocument } from '@/components/documents/document-table';

function documentFixture(overrides: Partial<GeneratedDocument> = {}): GeneratedDocument {
  return {
    id: 'doc-1',
    title: 'Annual minutes',
    status: 'DRAFT',
    content: '<p>Draft</p>',
    useLetterhead: true,
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-02T08:00:00.000Z',
    company: { id: 'company-1', name: 'Acme Pte Ltd', uen: '202600001A' },
    createdBy: { firstName: 'Sam', lastName: 'Tan' },
    template: { id: 'template-1', name: 'Board Minutes', category: 'CORPORATE' },
    _count: { comments: 0, drafts: 0 },
    ...overrides,
  };
}

describe('DocumentTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Vault-style inline filters above their matching columns', () => {
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();
    render(
      <DocumentTable
        documents={[documentFixture()]}
        filters={{}}
        onFilterChange={onFilterChange}
        onSortChange={onSortChange}
      />,
    );

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[0]).toHaveAttribute('data-filter-row');
    expect(rows[1]).toHaveAttribute('data-column-header-row');
    expect(within(rows[1]).getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['Document', 'Company', 'Template', 'Status', 'Signed On', 'Created By', 'Updated', 'Actions']);

    expect(within(rows[0]).getByRole('searchbox', { name: 'Filter documents by title' })).toBeInTheDocument();
    expect(within(rows[0]).getByPlaceholderText('All companies')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('searchbox', { name: 'Filter documents by template' })).toBeInTheDocument();
    expect(within(rows[0]).getByRole('combobox', { name: 'All statuses' })).toBeInTheDocument();
    expect(within(rows[0]).getByRole('searchbox', { name: 'Filter documents by creator' })).toBeInTheDocument();
    expect(within(rows[0]).getAllByText('All dates')).toHaveLength(2);
    expect(screen.getByRole('separator', { name: 'Resize Document column' })).toBeInTheDocument();

    fireEvent.change(
      within(rows[0]).getByRole('searchbox', { name: 'Filter documents by title' }),
      { target: { value: 'minutes' } },
    );
    expect(onFilterChange).toHaveBeenCalledWith({ title: 'minutes' });

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Signed On' }));
    expect(onSortChange).toHaveBeenCalledWith('signedAt');
  });

  it('shows template names in their own column', () => {
    render(
      <DocumentTable
        documents={[documentFixture()]}
        filters={{}}
      />,
    );

    const bodyRows = screen.getAllByRole('row').slice(2);
    const dataCells = within(bodyRows[0]).getAllByRole('cell');
    expect(dataCells[2]).toHaveTextContent('Board Minutes');
    expect(dataCells[0]).not.toHaveTextContent('Board Minutes');
  });

  it('resizes columns with the same Vault-style resize handles', () => {
    render(
      <DocumentTable
        documents={[documentFixture()]}
        filters={{}}
      />,
    );

    const table = screen.getByRole('table');
    expect(table).toHaveClass('w-full', 'min-w-max');
    expect(table).not.toHaveClass('table-fixed');
    expect(table.style.width).toBe('');
    expect(table.style.minWidth).toBe('');
    expect(screen.queryByTestId('document-column-header-band')).not.toBeInTheDocument();
    expect(screen.queryByTestId('document-filter-row-band')).not.toBeInTheDocument();
    expect((table.querySelectorAll('colgroup col').item(7) as HTMLElement).style.width).toBe('');
    expect(screen.queryByRole('separator', { name: 'Resize Actions column' })).not.toBeInTheDocument();

    const handle = screen.getByRole('separator', { name: 'Resize Document column' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(table.style.width).toBe('');
    expect(table.style.minWidth).toBe('');
    expect(table.querySelector('colgroup col')).toHaveStyle({ width: '626px' });
  });

  it('uses the Document Vault alternate-row surface', () => {
    render(
      <DocumentTable
        documents={[
          documentFixture(),
          documentFixture({ id: 'doc-2', title: 'Second document' }),
        ]}
        filters={{}}
      />,
    );

    const bodyRows = screen.getAllByRole('row').slice(2);
    expect(bodyRows[0]).not.toHaveClass('bg-oak-row-alt');
    expect(bodyRows[1]).toHaveClass('bg-oak-row-alt', 'hover:bg-oak-row-alt-hover');
  });

  it('shows the signing date after Status and a placeholder when unsigned', () => {
    render(
      <DocumentTable
        documents={[
          documentFixture({ signedAt: '2026-08-03T08:00:00.000Z' }),
          documentFixture({ id: 'doc-2', title: 'Unsigned document', signedAt: null }),
        ]}
        filters={{}}
      />,
    );

    const bodyRows = screen.getAllByRole('row').slice(2);
    expect(within(bodyRows[0]).getAllByRole('cell')[4]).toHaveTextContent('3 Aug 2026');
    expect(within(bodyRows[0]).getAllByRole('cell')[6]).toHaveTextContent('2 Aug 2026');
    expect(within(bodyRows[1]).getAllByRole('cell')[4]).toHaveTextContent('—');
  });

  it('opens the document detail page from a desktop row click', () => {
    render(
      <DocumentTable
        documents={[documentFixture()]}
        filters={{}}
      />,
    );

    const bodyRows = screen.getAllByRole('row').slice(2);
    fireEvent.click(bodyRows[0]);

    expect(routerPush).toHaveBeenCalledWith('/generated-documents/doc-1');
  });

  it('opens the delete dialog, not the detail page, when the delete icon is clicked', () => {
    const onDelete = vi.fn();
    render(
      <DocumentTable
        documents={[documentFixture({ status: 'FINALIZED' })]}
        filters={{}}
        onDelete={onDelete}
      />,
    );

    const deleteButton = screen.getAllByRole('button', { name: 'Delete Annual minutes' })
      .find((button) => button.closest('tr'));
    const icon = deleteButton?.querySelector('svg');
    expect(icon).toBeTruthy();
    fireEvent.click(icon!);

    expect(onDelete).toHaveBeenCalledWith('doc-1');
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('resumes generation sessions from a row click instead of the detail page', () => {
    render(
      <DocumentTable
        documents={[documentFixture({
          metadata: {
            generationSession: {
              version: 2,
              currentStep: 2,
              templateId: '11111111-1111-4111-8111-111111111111',
              companyId: '22222222-2222-4222-8222-222222222222',
              contactIds: [],
              selectedDirectorId: null,
              selectedShareholderId: null,
              selectedContactId: null,
              serviceAgreementId: null,
              title: 'Annual minutes',
              customData: {},
              useLetterhead: true,
              previewContent: '<p>Draft</p>',
              editedContent: null,
              editedContentJson: null,
            },
          },
        })]}
        filters={{}}
      />,
    );

    const bodyRows = screen.getAllByRole('row').slice(2);
    fireEvent.click(bodyRows[0]);

    expect(routerPush).toHaveBeenCalledWith('/generated-documents/generate?draft=doc-1');
  });
});
