import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreferences: () => ({ data: {} }),
  useUpsertUserPreference: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/components/ui/company-select', () => ({
  CompanySelect: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (id: string, name?: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label="Filter batches by company"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { GenerationBatchTable } from '@/components/documents/generation-batch';
import type { DocumentGenerationBatchListItem } from '@/types/document-generation-batch';

function counts(overrides: Partial<DocumentGenerationBatchListItem['counts']> = {}) {
  return {
    NOT_STARTED: 0,
    NEEDS_INPUT: 0,
    PREVIEWED: 0,
    READY: 0,
    GENERATING: 0,
    GENERATED: 0,
    FAILED: 0,
    BLOCKED: 0,
    ...overrides,
  };
}

function batchFixture(overrides: Partial<DocumentGenerationBatchListItem> = {}): DocumentGenerationBatchListItem {
  return {
    id: 'batch-1',
    primaryCompanyId: 'company-1',
    companyName: 'Acme Pte. Ltd.',
    itemCount: 3,
    counts: counts({ READY: 2, NOT_STARTED: 1 }),
    status: 'DRAFT',
    currentStage: 2,
    createdBy: { firstName: 'Ava', lastName: 'Tan' },
    updatedAt: '2026-08-12T01:00:00.000Z',
    ...overrides,
  };
}

function bodyCells() {
  const table = screen.getByRole('table');
  const bodyRows = within(table).getAllByRole('row').slice(2);
  return { table, bodyRows };
}

describe('GenerationBatchTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders company, progress, status, and actions in columns', () => {
    render(<GenerationBatchTable batches={[batchFixture()]} onDiscard={vi.fn()} />);
    const { bodyRows } = bodyCells();
    const cells = within(bodyRows[0]).getAllByRole('cell');

    expect(cells[0]).toHaveTextContent('Acme Pte. Ltd.');
    expect(cells[1]).toHaveTextContent('3 documents');
    expect(cells[1]).toHaveTextContent('1 needs attention · 2 ready');
    expect(cells[2]).toHaveTextContent('Draft');
    expect(cells[3]).toHaveTextContent('Ava Tan');
    expect(within(cells[5]).getByRole('link', { name: /resume/i })).toBeInTheDocument();
  });

  it('filters by company with the reusable company select', () => {
    render(
      <GenerationBatchTable
        batches={[
          batchFixture(),
          batchFixture({ id: 'batch-2', companyName: 'Beta Pte. Ltd.', primaryCompanyId: 'company-2' }),
        ]}
        onDiscard={vi.fn()}
      />,
    );

    const table = screen.getByRole('table');
    const filterRow = within(table).getAllByRole('row')[0];
    fireEvent.change(
      within(filterRow).getByRole('textbox', { name: 'Filter batches by company' }),
      { target: { value: 'company-2' } },
    );

    const { bodyRows } = bodyCells();
    expect(bodyRows).toHaveLength(1);
    expect(within(bodyRows[0]).getAllByRole('cell')[0]).toHaveTextContent('Beta Pte. Ltd.');
  });

  it('resizes columns with the same resize handles as the documents table', () => {
    render(<GenerationBatchTable batches={[batchFixture()]} onDiscard={vi.fn()} />);
    const table = screen.getByRole('table');
    expect(table).toHaveClass('w-full', 'min-w-max');
    expect(table).not.toHaveClass('table-fixed');
    expect(table.style.width).toBe('');
    expect(table.style.minWidth).toBe('');
    expect((table.querySelectorAll('colgroup col').item(5) as HTMLElement).style.width).toBe('');
    expect(screen.queryByRole('separator', { name: 'Resize Actions column' })).not.toBeInTheDocument();

    const handle = screen.getByRole('separator', { name: 'Resize Company column' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(table.style.width).toBe('');
    expect(table.style.minWidth).toBe('');
    expect(table.querySelector('colgroup col')).toHaveStyle({ width: '250px' });
  });

  it('sorts rows by a column header', () => {
    render(
      <GenerationBatchTable
        batches={[
          batchFixture({ companyName: 'Zulu Pte. Ltd.', id: 'batch-z' }),
          batchFixture({ companyName: 'Alpha Pte. Ltd.', id: 'batch-a' }),
        ]}
        onDiscard={vi.fn()}
      />,
    );

    const { table, bodyRows } = bodyCells();
    expect(within(bodyRows[0]).getAllByRole('cell')[0]).toHaveTextContent('Zulu Pte. Ltd.');

    fireEvent.click(within(table).getByRole('button', { name: /company/i }));
    const reordered = bodyCells().bodyRows;
    expect(within(reordered[0]).getAllByRole('cell')[0]).toHaveTextContent('Alpha Pte. Ltd.');
  });

  it('discards a partial batch while preserving generated outputs', async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const partial = batchFixture({
      counts: counts({ GENERATED: 2, FAILED: 1, READY: 0, NOT_STARTED: 0 }),
      status: 'PARTIAL',
    });
    render(<GenerationBatchTable batches={[partial]} onDiscard={onDiscard} />);

    const table = screen.getByRole('table');
    await user.click(
      within(table).getByRole('button', { name: /discard unfinished work/i }),
    );
    expect(screen.getByText(/generated documents will be kept/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(onDiscard).toHaveBeenCalledWith('batch-1');
  });

  it('returns null when there are no active batches', () => {
    const { container } = render(<GenerationBatchTable batches={[]} onDiscard={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
