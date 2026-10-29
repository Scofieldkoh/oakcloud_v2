import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UploadBizFilePage from '@/app/(dashboard)/companies/upload/page';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  prepare: vi.fn(),
  upload: vi.fn(),
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.searchParams,
}));
vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({ data: { isSuperAdmin: false, tenantId: 'tenant-1' } }),
}));
vi.mock('@/hooks/use-companies', () => ({
  useCompany: () => ({ data: { id: 'company-1', name: 'Existing Pte. Ltd.', uen: '202400001A' } }),
}));
vi.mock('@/components/ui/workspace-selector', () => ({ useActiveWorkspaceId: () => 'tenant-1' }));
vi.mock('@/components/ui/ai-model-selector', () => ({
  AIModelSelector: () => <div>AI model selector</div>,
  buildFullContext: () => '',
}));
vi.mock('@/lib/browser-upload', () => ({ postFormDataWithFallback: mocks.upload }));
vi.mock('react-dropzone', () => ({
  useDropzone: ({ onDrop }: { onDrop: (files: File[]) => void }) => ({
    getRootProps: () => ({}),
    getInputProps: () => ({
      type: 'file',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onDrop(Array.from(event.target.files ?? [])),
    }),
    isDragActive: false,
  }),
}));
vi.mock('@/components/processing', () => ({
  DocumentPageViewer: () => <div>Document viewer</div>,
  ResizableSplitView: ({ leftPanel, rightPanel }: { leftPanel: React.ReactNode; rightPanel: React.ReactNode }) => (
    <div>{leftPanel}{rightPanel}</div>
  ),
}));

const extractedData = {
  entityDetails: {
    uen: '202400001A',
    name: 'Example Pte. Ltd.',
    entityType: 'PRIVATE_LIMITED',
    status: 'LIVE',
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const aiMetadata = {
  modelUsed: 'gpt-5', modelName: 'GPT-5', providerUsed: 'openai',
  usage: { inputTokens: 1000, outputTokens: 234, totalTokens: 1234 }, formattedCost: '$0.01',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function reachPreview(updateMode = false) {
  mocks.searchParams = new URLSearchParams(updateMode ? 'companyId=company-1' : '');
  mocks.upload.mockResolvedValueOnce(jsonResponse({ documentId: 'doc-1' }));
  mocks.fetch.mockResolvedValueOnce(updateMode
    ? jsonResponse({
        extractedData,
        diff: { hasDifferences: true, differences: [], existingCompany: { name: 'Existing Pte. Ltd.', uen: '202400001A' } },
        companyUpdatedAt: '2026-07-12T00:00:00.000Z',
      })
    : jsonResponse({ extractedData, aiMetadata }));

  const view = render(<UploadBizFilePage />);
  const input = view.container.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files: [new File(['pdf'], 'bizfile.pdf', { type: 'application/pdf' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload & Extract' }));
  if (updateMode) await screen.findByText('Changes to Apply');
  else await screen.findByLabelText('Company name');
  return view;
}

async function approvePrepared(updateMode = false) {
  const approval = await screen.findByLabelText('I have reviewed these changes and contact decisions.');
  fireEvent.click(approval);
  fireEvent.click(screen.getByRole('button', { name: updateMode ? 'Confirm & Save Document' : 'Confirm & Save Company' }));
}

describe('companies upload BizFile review integration', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.prepare.mockReset();
    mocks.upload.mockReset();
    mocks.push.mockReset();
    mocks.searchParams = new URLSearchParams();
    mocks.prepare.mockImplementation((_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return Promise.resolve(jsonResponse({ preparationToken: 'prepared-hash', plan: {
          schemaVersion: 1, mode: body.mode, tenantId: 'tenant-1', documentId: 'doc-1', targetCompanyId: body.targetCompanyId,
          aggregateRevision: 'aggregate', expectedAggregateRevision: 1, baseline: { company: {} },
          reviewedData: body.extractedData, changes: [], selectedChangeIds: [], contactDecisions: {}, canonicalHash: 'prepared-hash',
        } }));
    });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/prepare-import')) return mocks.prepare(url, init);
      return init === undefined ? mocks.fetch(url) : mocks.fetch(url, init);
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('uses the compact upload heading without back navigation or extraction subtext', () => {
    render(<UploadBizFilePage />);
    expect(screen.getByRole('heading', { name: 'Upload BizFile' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Back to Companies' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Upload an ACRA BizFile document/)).not.toBeInTheDocument();
  });

  it('uses a one-line preview title, keeps review overflow internal, and shows AI usage in the footer', async () => {
    const view = await reachPreview();
    fireEvent.click(screen.getByRole('tab', { name: 'Document' }));
    expect(screen.getByText('BizFile Preview (File: bizfile.pdf)')).toBeVisible();
    expect(screen.queryByText('BizFile Preview', { selector: 'p' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByRole('contentinfo')).toHaveTextContent(/GPT-5 \(openai\).*1,234 tokens.*Est\. \$0\.01/);
    expect(view.container.firstElementChild).toHaveClass('overflow-hidden');
    expect(view.container.firstElementChild).toHaveClass('h-dvh');
    expect(view.container.firstElementChild).not.toHaveClass('h-[calc(100dvh-4rem)]');
  });

  it('resumes an uploaded task BizFile and opens the review workspace without uploading twice', async () => {
    mocks.searchParams = new URLSearchParams(
      'documentId=doc-1&fileName=task-bizfile.pdf&taskId=00000000-0000-4000-8000-000000000001&taskStageId=00000000-0000-4000-8000-000000000002&returnTo=%2Ftasks',
    );
    mocks.fetch
      .mockResolvedValueOnce(new Response(new Blob(['pdf'], { type: 'application/pdf' }), {
        headers: { 'Content-Type': 'application/pdf' },
      }))
      .mockResolvedValueOnce(jsonResponse({ extractedData }));

    render(<UploadBizFilePage />);

    expect(await screen.findByLabelText('Company name')).toBeVisible();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenNthCalledWith(1, '/api/documents/doc-1');
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/documents/doc-1/extract',
      expect.objectContaining({ method: 'POST' }),
    );

    mocks.fetch.mockResolvedValueOnce(jsonResponse({ companyId: 'company-new' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Save/i }));


    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(
      '/tasks?taskId=00000000-0000-4000-8000-000000000001&taskStageId=00000000-0000-4000-8000-000000000002&returnTo=%2Ftasks',
    ));
    expect(screen.queryByText('Company Created Successfully!')).not.toBeInTheDocument();
  });

  it('submits the corrected workspace draft once and completes successfully', async () => {
    await reachPreview();
    const sectionSelect = screen.getByRole('combobox', { name: 'Review section' });
    expect(within(sectionSelect).getAllByRole('option')).toHaveLength(10);

    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Corrected Pte. Ltd.' } });
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ companyId: 'company-new' }));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(screen.queryByText('Review company creation')).not.toBeInTheDocument();



    await screen.findByText('Company Created Successfully!');
    expect(screen.queryByText('Review company creation')).not.toBeInTheDocument();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    const confirmCalls = mocks.fetch.mock.calls.filter(([url]) => String(url).endsWith('/confirm'));
    expect(confirmCalls).toHaveLength(1);
    expect(JSON.parse(String(confirmCalls[0][1]?.body))).toMatchObject({
      extractedData: { entityDetails: { name: 'Corrected Pte. Ltd.' } },
      preparationToken: 'prepared-hash', operationId: expect.any(String),
      plan: { canonicalHash: 'prepared-hash', reviewedData: { entityDetails: { name: 'Corrected Pte. Ltd.' } } },
    });
    expect(screen.getByRole('link', { name: 'View Company' })).toHaveAttribute('href', '/companies/company-new');
  });

  it('keeps the reviewed draft when preparation fails and does not create the company', async () => {
    await reachPreview();
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Reviewed Pte. Ltd.' } });
    mocks.prepare.mockResolvedValueOnce(jsonResponse({ error: 'Please review the company details' }, 400));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Save/i }));

    expect(await screen.findByText('Please review the company details')).toBeVisible();
    expect(screen.getByLabelText('Company name')).toHaveValue('Reviewed Pte. Ltd.');
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false);
    expect(screen.getByRole('button', { name: /Confirm & Save/i })).toBeEnabled();
  });

  it('keeps the edited draft mounted and renders structured route issues for retry', async () => {
    await reachPreview();
    const name = screen.getByLabelText('Company name');
    fireEvent.change(name, { target: { value: 'Corrected Pte. Ltd.' } });
    mocks.fetch.mockResolvedValueOnce(jsonResponse({
      error: 'Please correct the highlighted fields',
      issues: [{ path: 'entityDetails.name', message: 'Name conflicts with UEN', section: 'entity' }],
    }, 400));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Save/i }));


    expect(await screen.findByText('Name conflicts with UEN')).toBeVisible();
    expect(screen.getByLabelText('Company name')).toHaveValue('Corrected Pte. Ltd.');
    expect(screen.queryByText('Review extracted information')).not.toBeInTheDocument();
  });

  it('keeps the workspace mounted and reports a generic 500 response', async () => {
    await reachPreview();
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Still Here Pte. Ltd.' } });
    mocks.fetch.mockResolvedValueOnce(new Response('<html>failure</html>', { status: 500 }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Save/i }));


    expect(await screen.findByText('Failed to save data (HTTP 500)')).toBeVisible();
    expect(screen.getByLabelText('Company name')).toHaveValue('Still Here Pte. Ltd.');
  });

  it('reports the exact JSON 400 error when no structured issues are returned', async () => {
    await reachPreview();
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ error: 'The submitted company is no longer available' }, 400));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Save/i }));


    expect(await screen.findByText('The submitted company is no longer available')).toBeVisible();
    expect(screen.queryByText('Failed to save data (HTTP 400)')).not.toBeInTheDocument();
  });

  it.each([
    ['resolution', (request: ReturnType<typeof deferred<Response>>) => request.resolve(jsonResponse({ companyId: 'stale-company' }))],
    ['rejection', (request: ReturnType<typeof deferred<Response>>) => request.reject(new Error('stale failure'))],
  ])('does not resurrect confirm state after cancel and late %s', async (_label, settle) => {
    await reachPreview();
    const request = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(request.promise);
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Save/i }));


    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(true));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Upload Different File' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Backspace', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload & Extract' })).toBeVisible());

    settle(request);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText('Company Created Successfully!')).not.toBeInTheDocument();
    expect(screen.queryByText('stale failure')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload & Extract' })).toBeVisible();
  });

  it('preserves update-mode markup and sends saves to apply-update', async () => {
    await reachPreview(true);
    expect(screen.getByText('Changes to Apply')).toBeVisible();
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ updatedFields: ['name'] }));
    fireEvent.click(screen.getByRole('button', { name: /Review document approval/i }));
    await approvePrepared(true);
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith('/apply-update'))).toBe(true));
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false);
  });

  it.each(['resolve', 'reject'])('ignores a late preparation %s after resetting the draft', async (outcome) => {
    await reachPreview();
    const pending = deferred<Response>();
    mocks.prepare.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Save/i }));
    fireEvent.keyDown(window, { key: 'Backspace', ctrlKey: true });
    await screen.findByRole('button', { name: 'Upload & Extract' });
    if (outcome === 'resolve') pending.resolve(jsonResponse({ plan: { documentId: 'doc-1' }, preparationToken: 'stale' }));
    else pending.reject(new Error('stale preparation'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('stale preparation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload & Extract' })).toBeVisible();
  });

  it('shows the nominee flag for an added shareholder in update mode', async () => {
    const nomineeShareholder = {
      name: 'Jamie Lim', type: 'INDIVIDUAL' as const, isNominee: true, shareClass: 'ORDINARY', numberOfShares: 1,
    };
    mocks.searchParams = new URLSearchParams('companyId=company-1');
    mocks.upload.mockResolvedValueOnce(jsonResponse({ documentId: 'doc-1' }));
    mocks.fetch.mockImplementation(() => Promise.resolve(jsonResponse({ matches: {} })));
    mocks.fetch.mockResolvedValueOnce(jsonResponse({
      extractedData: { ...extractedData, shareholders: [nomineeShareholder] },
      diff: {
        hasDifferences: true, differences: [], existingCompany: { name: 'Existing Pte. Ltd.', uen: '202400001A' },
        shareholderDiffs: [{
          type: 'added', sourceRecordId: 'shareholders.0', name: nomineeShareholder.name,
          shareholderType: 'INDIVIDUAL', extractedData: nomineeShareholder,
        }],
      },
      companyUpdatedAt: '2026-07-12T00:00:00.000Z',
    }));

    const view = render(<UploadBizFilePage />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['pdf'], 'bizfile.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload & Extract' }));
    expect(await screen.findByText('Nominee:')).toBeVisible();
    expect(screen.getByText('Yes')).toBeVisible();
  });

  it('requires and sends an explicit contact decision for an update-mode match', async () => {
    const officerData = {
      ...extractedData,
      officers: [{ name: '王小明', role: 'DIRECTOR' }],
    };
    const previewBody = { matches: {
      'officers.0': {
        contactId: '00000000-0000-4000-8000-000000000001', score: 1, automatic: true,
        blockedByIdentifierConflict: false, reasons: ['EXACT_CANONICAL_NAME'], conflicts: [],
        contact: {
          id: '00000000-0000-4000-8000-000000000001', fullName: '王小明',
          identificationType: null, identificationNumber: null, corporateUen: null, companies: [],
        },
      },
    } };
    mocks.searchParams = new URLSearchParams('companyId=company-1');
    mocks.upload.mockResolvedValueOnce(jsonResponse({ documentId: 'doc-1' }));
    mocks.fetch.mockImplementation(() => Promise.resolve(jsonResponse(previewBody)));
    mocks.fetch.mockResolvedValueOnce(jsonResponse({
      extractedData: officerData,
      diff: {
        hasDifferences: true, differences: [], existingCompany: { name: 'Existing Pte. Ltd.', uen: '202400001A' },
        officerDiffs: [{ type: 'added', sourceRecordId: 'officers.0', name: '王小明', role: 'DIRECTOR', extractedData: officerData.officers[0] }],
      },
      companyUpdatedAt: '2026-07-12T00:00:00.000Z',
    }));

    const view = render(<UploadBizFilePage />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['pdf'], 'bizfile.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload & Extract' }));
    expect(await screen.findByText('Existing contact match')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Use existing' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Review proposed changes/i })).toBeVisible());
    mocks.fetch.mockResolvedValueOnce(jsonResponse(previewBody));
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ updatedFields: [] }));
    fireEvent.click(screen.getByRole('button', { name: /Review proposed changes/i }));
    await approvePrepared(true);
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith('/apply-update'))).toBe(true));
    const applyCall = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith('/apply-update'))!;
    expect(JSON.parse(String(applyCall[1]?.body))).toMatchObject({
      extractedData: { officers: [{ contactResolution: {
        action: 'REUSE', contactId: '00000000-0000-4000-8000-000000000001',
      } }] },
    });
  });

  it('renders and applies independent decisions for duplicate update-mode rows', async () => {
    const officers = [
      { name: '王小明', role: 'DIRECTOR' },
      { name: '王小明', role: 'DIRECTOR' },
    ];
    const duplicateData = { ...extractedData, officers };
    const match = (index: number) => ({
      contactId: `00000000-0000-4000-8000-00000000000${index + 1}`,
      score: 1, automatic: true, blockedByIdentifierConflict: false,
      reasons: ['EXACT_CANONICAL_NAME'], conflicts: [],
      contact: {
        id: `00000000-0000-4000-8000-00000000000${index + 1}`,
        fullName: `王小明 ${index + 1}`, identificationType: null,
        identificationNumber: null, corporateUen: null, companies: [],
      },
    });
    const previewBody = { matches: { 'officers.0': match(0), 'officers.1': match(1) } };
    mocks.searchParams = new URLSearchParams('companyId=company-1');
    mocks.upload.mockResolvedValueOnce(jsonResponse({ documentId: 'doc-1' }));
    mocks.fetch.mockImplementation(() => Promise.resolve(jsonResponse(previewBody)));
    mocks.fetch.mockResolvedValueOnce(jsonResponse({
      extractedData: duplicateData,
      diff: {
        hasDifferences: true, differences: [], existingCompany: { name: 'Existing Pte. Ltd.', uen: '202400001A' },
        officerDiffs: officers.map((officer, index) => ({
          type: 'added', sourceRecordId: `officers.${index}`,
          name: officer.name, role: officer.role, extractedData: officer,
        })),
      },
      companyUpdatedAt: '2026-07-12T00:00:00.000Z',
    }));

    const view = render(<UploadBizFilePage />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['pdf'], 'bizfile.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload & Extract' }));
    const headings = await screen.findAllByText('Existing contact match');
    expect(headings).toHaveLength(2);
    const panels = headings.map((heading) => heading.parentElement!);
    expect(within(panels[0]).getByRole('link', { name: '王小明 1' })).toHaveAttribute('href', '/contacts/00000000-0000-4000-8000-000000000001');
    expect(within(panels[1]).getByRole('link', { name: '王小明 2' })).toHaveAttribute('href', '/contacts/00000000-0000-4000-8000-000000000002');
    fireEvent.click(within(panels[0]).getByRole('button', { name: 'Use existing' }));
    fireEvent.click(within(panels[1]).getByRole('button', { name: 'Use existing' }));

    mocks.fetch.mockResolvedValueOnce(jsonResponse(previewBody));
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ updatedFields: [] }));
    fireEvent.click(screen.getByRole('button', { name: /Review proposed changes/i }));
    await approvePrepared(true);
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith('/apply-update'))).toBe(true));
    const applyCall = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith('/apply-update'))!;
    const body = JSON.parse(String(applyCall[1]?.body));
    expect(body.extractedData.officers.map((officer: { contactResolution: { contactId: string } }) => officer.contactResolution.contactId))
      .toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
  });
});
