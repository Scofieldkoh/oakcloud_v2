import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
  useSearchParams: () => navigation.params,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('@/components/documents/oakdoc/word-partial-editor', () => ({
  WordPartialEditor: ({ partialId, version }: { partialId: string; version: number }) => (
    <div data-testid="word-partial-editor">{`${partialId}@${version}`}</div>
  ),
}));

import { TemplateSourcePage } from '@/app/(dashboard)/template-partials/editor/template-source-page';

const wordAsset = {
  schemaVersion: 1,
  storageKey: `tenant-1/template-partials/p-2/oakdoc/${'a'.repeat(64)}.docx`,
  fileName: 'scope.docx',
  fileSize: 100,
  sha256: 'a'.repeat(64),
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  fieldTags: [],
};

function renderPage(search: string) {
  navigation.params = new URLSearchParams(search);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TemplateSourcePage />
    </QueryClientProvider>,
  );
}

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('TemplateSourcePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigation.replace.mockReset();
  });

  it('links an A4 template to its approved Word version', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((input) => (
      String(input).includes('/new-run')
        ? respond({ templateIds: ['t-word'] })
        : respond({ id: 't-1', name: 'Old engagement letter', content: '<p>Terms</p>', contentJson: null })
    ));
    renderPage('id=t-1&tab=templates');

    expect(await screen.findByRole('link', { name: 'Open the Word version' }))
      .toHaveAttribute('href', '/generated-documents/generate?editor=oakdoc&templateId=t-word');
  });

  it('shows a notice for an A4 template instead of opening it', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => respond({
      id: 't-1', name: 'Old engagement letter', content: '<p>Signed terms</p>', contentJson: null,
    }));
    const { container } = renderPage('id=t-1&tab=templates');

    expect(await screen.findByText('Old engagement letter')).toBeInTheDocument();
    expect(screen.getByText(/retired A4 editor/i)).toBeInTheDocument();
    expect(screen.queryByText('Signed terms')).not.toBeInTheDocument();
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });

  it('sends new templates and Word templates to the OakDoc editor', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => respond({
      id: 't-2', name: 'Word letter', content: '', contentJson: { oakDoc: wordAsset },
    }));
    renderPage('id=t-2&tab=templates');
    await waitFor(() => expect(navigation.replace)
      .toHaveBeenCalledWith('/generated-documents/generate?editor=oakdoc&templateId=t-2'));

    navigation.replace.mockReset();
    renderPage('tab=templates');
    await waitFor(() => expect(navigation.replace)
      .toHaveBeenCalledWith('/generated-documents/generate?editor=oakdoc'));
  });

  it('creates a Word partial from an uploaded DOCX', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(() => respond({ id: 'p-new' }, 201));
    renderPage('type=partial&tab=partials');

    await user.type(screen.getByLabelText('Name'), 'audit-scope');
    await user.upload(
      screen.getByLabelText('Word document (.docx, optional)'),
      new File(['docx'], 'scope.docx', { type: wordAsset.mimeType }),
    );
    await user.click(screen.getByRole('button', { name: 'Create Word partial' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/template-partials/oakdoc',
      expect.objectContaining({ method: 'POST' }),
    ));
    const body = fetchMock.mock.calls[0][1]!.body as FormData;
    expect(body.get('name')).toBe('audit-scope');
    await waitFor(() => expect(navigation.replace)
      .toHaveBeenCalledWith('/template-partials/editor?type=partial&tab=partials&id=p-new'));
  });

  it('creates a blank Word partial when no DOCX is chosen', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(() => respond({ id: 'p-blank' }, 201));
    renderPage('type=partial&tab=partials');

    await user.type(screen.getByLabelText('Name'), 'engagement-scope');
    await user.click(screen.getByRole('button', { name: 'Create blank partial' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/template-partials/oakdoc',
      expect.objectContaining({ method: 'POST' }),
    ));
    const file = (fetchMock.mock.calls[0][1]!.body as FormData).get('file') as File;
    expect(file.name).toBe('engagement-scope.docx');
    expect(file.size).toBeGreaterThan(0);
    await waitFor(() => expect(navigation.replace)
      .toHaveBeenCalledWith('/template-partials/editor?type=partial&tab=partials&id=p-blank'));
  });

  it('uploads a new version of a Word partial against its current version', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation((input) => (
      String(input).includes('/oakdoc')
        ? respond({ id: 'p-2', version: 5 })
        : respond({ id: 'p-2', name: 'scope', displayName: 'Audit scope', version: 4, content: '', contentJson: { oakDoc: wordAsset } })
    ));
    renderPage('type=partial&tab=partials&id=p-2');

    expect(await screen.findByText('Audit scope')).toBeInTheDocument();
    expect(screen.getByTestId('word-partial-editor')).toHaveTextContent('p-2@4');
    expect(screen.queryByLabelText('Replace with a .docx')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByRole('link', { name: /download current version/i }))
      .toHaveAttribute('href', '/api/template-partials/p-2/oakdoc');
    await user.upload(
      screen.getByLabelText('Replace with a .docx'),
      new File(['docx'], 'scope-v5.docx', { type: wordAsset.mimeType }),
    );
    await user.click(screen.getByRole('button', { name: 'Upload new version' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/template-partials/p-2/oakdoc',
      expect.objectContaining({ method: 'PUT' }),
    ));
    const put = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/oakdoc'))!;
    expect((put[1]!.body as FormData).get('expectedRevision')).toBe('4');
  });

  it('renames a Word partial against its current version', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation((input, init) => (
      init?.method === 'PATCH'
        ? respond({ id: 'p-2', name: 'SOW_Corp_Sec', displayName: 'SOW - Corporate Secretarial', version: 5, content: '', contentJson: { oakDoc: wordAsset } })
        : respond({ id: 'p-2', name: 'SOW_Corp_Tax', displayName: 'Copy of SOW - Corporate Secretarial Services', description: 'Copy of SOW_Corp_Sec', version: 4, content: '', contentJson: { oakDoc: wordAsset } })
    ));
    renderPage('type=partial&tab=partials&id=p-2');

    await user.click(await screen.findByRole('button', { name: 'Show details' }));
    const nameInput = screen.getByLabelText(/^Name/);
    expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled();
    await user.clear(nameInput);
    await user.type(nameInput, 'SOW_Corp_Sec');
    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'SOW - Corporate Secretarial');
    await user.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/template-partials/p-2',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]!.body))).toMatchObject({
      expectedRevision: 4,
      name: 'SOW_Corp_Sec',
      displayName: 'SOW - Corporate Secretarial',
      description: 'Copy of SOW_Corp_Sec',
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Partial details saved'));
    await user.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument();
  });
});
