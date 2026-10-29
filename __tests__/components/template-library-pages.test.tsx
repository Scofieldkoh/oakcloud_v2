import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
const pageState = vi.hoisted(() => ({
  activeTenantId: 'tenant-1' as string | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
  redirect: navigation.redirect,
}));

vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({
    data: { tenantId: 'tenant-1', isSuperAdmin: false },
  }),
}));

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    can: {
      createDocument: true,
      updateDocument: true,
      deleteDocument: true,
    },
  }),
}));

vi.mock('@/components/ui/workspace-selector', () => ({
  useActiveWorkspaceId: () => pageState.activeTenantId,
}));

import TemplateLibraryIndexPage from '@/app/(dashboard)/template-partials/page';
import DocumentTemplatesPage from '@/app/(dashboard)/template-partials/documents/page';
import PartialTemplatesPage from '@/app/(dashboard)/template-partials/partials/page';

async function redirectTargetFor(query: Record<string, string | string[]>) {
  await expect(TemplateLibraryIndexPage({ searchParams: Promise.resolve(query) })).rejects.toThrow('NEXT_REDIRECT');
  return navigation.redirect.mock.calls.at(-1)?.[0];
}

function renderWithProviders(page: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>{page}</ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Document Templates pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageState.activeTenantId = 'tenant-1';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ templates: [], partials: [], total: 0 }))));
  });

  it('sends the old Document Templates URL and its tabs to the new pages', async () => {
    expect(await redirectTargetFor({})).toBe('/template-partials/documents');
    expect(await redirectTargetFor({ tab: 'templates' })).toBe('/template-partials/documents');
    expect(await redirectTargetFor({ tab: 'partials' })).toBe('/template-partials/partials');
    expect(await redirectTargetFor({ tab: 'services' })).toBe('/admin/services');
  });

  it('shows document templates on their own page without tabs', async () => {
    renderWithProviders(<DocumentTemplatesPage />);

    expect(screen.getByRole('heading', { name: 'Document Templates' })).toBeVisible();
    expect(await screen.findByRole('button', { name: 'New Word Template' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Partials' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Word partial/i })).not.toBeInTheDocument();
  });

  it('shows partials on their own page without tabs', async () => {
    renderWithProviders(<PartialTemplatesPage />);

    expect(screen.getByRole('heading', { name: 'Partials' })).toBeVisible();
    expect(await screen.findByRole('button', { name: 'New Word partial' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Document Templates' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Word Template' })).not.toBeInTheDocument();
  });

  it('lists templates in the shared table with filters, sorting, columns and selection', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/user-preferences')) {
        return new Response(JSON.stringify({ data: { key: 'k', value: null, updatedAt: null } }));
      }
      return new Response(JSON.stringify({
        templates: [
          { id: 't1', name: 'First Board Resolution', description: 'Directors resolution', category: 'RESOLUTION', content: '', contentJson: { oakDoc: { schemaVersion: 1 } }, isActive: true, version: 3, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', _count: { generatedDocuments: 4 } },
          { id: 't2', name: 'Engagement Letter', description: null, category: 'LETTER', content: '', contentJson: { oakDoc: { schemaVersion: 1 } }, isActive: false, version: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', _count: { generatedDocuments: 0 } },
        ],
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const templateCalls = () => fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/api/document-templates?'));

    renderWithProviders(<DocumentTemplatesPage />);

    await waitFor(() => expect(screen.getByRole('table')).toHaveTextContent('First Board Resolution'));
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    // Filter row, header row, then the two templates; the second template row is banded.
    expect(rows).toHaveLength(4);
    expect(rows[3].className).toContain('bg-oak-row-alt');
    for (const name of ['Filter by template name', 'Filter by description', 'Filter by version']) {
      expect(within(table).getByRole(name === 'Filter by version' ? 'spinbutton' : 'searchbox', { name })).toBeVisible();
    }
    const filterRow = rows[0];
    const filterCells = within(filterRow).getAllByRole('columnheader').slice(1, -1);
    // Every data column (not the selection box or Actions) carries an inline filter.
    for (const cell of filterCells) {
      expect(cell.childElementCount).toBeGreaterThan(0);
    }
    expect(within(table).getByRole('button', { name: 'Sort by Documents' })).toBeVisible();
    expect(within(table).getByRole('separator', { name: 'Resize Template column' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Columns/ })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Resolutions' }));
    await waitFor(() => expect(templateCalls().at(-1)).toContain('category=RESOLUTION'));
    expect(screen.getByRole('button', { name: 'Remove Category filter' })).toBeVisible();

    fireEvent.click(within(table).getByRole('button', { name: 'Sort by Documents' }));
    await waitFor(() => expect(templateCalls().at(-1)).toContain('sortBy=usage'));

    expect(templateCalls().every((url) => url.includes('editor=oakdoc'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Archived A4' })).not.toBeInTheDocument();

    fireEvent.click(within(table).getByRole('button', { name: 'Select First Board Resolution' }));
    expect(screen.getByText('selected')).toBeVisible();
    expect(screen.getByRole('button', { name: /Deactivate/ })).toBeVisible();
  });

  it('keeps the partial table filters on screen when nothing matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/user-preferences')) {
        return new Response(JSON.stringify({ data: { key: 'k', value: null, updatedAt: null } }));
      }
      return new Response(JSON.stringify({ partials: [], total: 0, page: 1, limit: 20, totalPages: 0 }));
    }));

    renderWithProviders(<PartialTemplatesPage />);

    await waitFor(() => expect(screen.getByRole('table')).toHaveTextContent('No Word partials yet'));
    const table = screen.getByRole('table');
    for (const name of ['Filter by partial name', 'Filter by reference', 'Filter by description']) {
      expect(within(table).getByRole('searchbox', { name })).toBeVisible();
    }
    expect(screen.getByRole('button', { name: 'Resolutions' })).toBeVisible();
  });
});
