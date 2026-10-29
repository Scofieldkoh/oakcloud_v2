import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  search: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: { createDocument: true, updateDocument: true, deleteDocument: true, exportDocument: true } }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/documents/document-table', () => ({
  DocumentTable: () => <div>document table</div>,
}));
vi.mock('@/components/documents/generation-batch', () => ({ GenerationBatchTable: () => null }));

import GeneratedDocumentsPage from '@/app/(dashboard)/generated-documents/page';

const fetchMock = vi.fn();

function listRequests(): URLSearchParams[] {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/api/generated-documents?'))
    .map((url) => new URLSearchParams(url.split('?')[1]));
}

describe('Generated Documents list page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (url.startsWith('/api/generated-documents?')
        ? { documents: [], total: 0, page: 1, limit: 20, totalPages: 0 }
        : { batches: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the filters, sort and page from the URL and keeps them there', async () => {
    mocks.search = 'q=lease&status=DRAFT&company=Acme&sortOrder=asc&page=2';
    render(<GeneratedDocumentsPage />);

    await waitFor(() => expect(listRequests()).toHaveLength(1));
    const request = listRequests()[0]!;
    expect(request.get('query')).toBe('lease');
    expect(request.get('status')).toBe('DRAFT');
    expect(request.get('companyName')).toBe('Acme');
    expect(request.get('sortOrder')).toBe('asc');
    expect(request.get('page')).toBe('2');

    // The older `company` key is rewritten to the one the page now writes.
    expect(mocks.replace).toHaveBeenCalledWith(
      '/generated-documents?q=lease&companyName=Acme&status=DRAFT&sortOrder=asc&page=2',
      { scroll: false },
    );
  });

  it('writes a quick filter to the URL and goes back to the first page', async () => {
    mocks.search = 'page=3';
    render(<GeneratedDocumentsPage />);
    await waitFor(() => expect(listRequests()).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'Show documents updated today' }));

    await waitFor(() => expect(listRequests()).toHaveLength(2));
    const request = listRequests()[1]!;
    expect(request.get('updatedFrom')).toBeTruthy();
    expect(request.get('updatedFrom')).toBe(request.get('updatedTo'));
    expect(request.get('page')).toBe('1');
    const lastUrl = mocks.replace.mock.calls.at(-1)?.[0] as string;
    expect(lastUrl).toContain(`updatedFrom=${request.get('updatedFrom')}`);
    expect(lastUrl).not.toContain('page=');
  });
});
