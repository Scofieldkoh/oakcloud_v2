import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigationMock = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigationMock.push }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const companyOption = {
  id: 'company-1',
  name: 'Acme Pte. Ltd.',
  label: 'Acme Pte. Ltd.',
  description: '202600001A',
  uen: '202600001A',
  status: 'LIVE',
  registeredAddress: '1 Main Street, Singapore 123456',
  incorporationDate: '2026-07-29T00:00:00.000Z',
};
const replacementCompanyOption = {
  ...companyOption,
  id: 'company-2',
  name: 'Beta Pte. Ltd.',
  label: 'Beta Pte. Ltd.',
  description: '202600002B',
  uen: '202600002B',
};

vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({ data: { tenantId: 'tenant-1', isSuperAdmin: false } }),
}));

vi.mock('@/hooks/use-template-partials', () => ({
  useAllTemplatePartials: () => ({ data: { partials: [] } }),
}));

vi.mock('@/hooks/use-company-search', () => ({
  useCompanySearch: () => ({
    searchQuery: '',
    setSearchQuery: vi.fn(),
    options: [companyOption, replacementCompanyOption],
    isLoading: false,
    known: new Map([
      [companyOption.id, companyOption],
      [replacementCompanyOption.id, replacementCompanyOption],
    ]),
    error: null,
  }),
}));

const apiMock = vi.hoisted(() => ({
  createDocumentGenerationBatch: vi.fn(),
  saveDocumentGenerationBatch: vi.fn(),
  getDocumentGenerationBatch: vi.fn(),
  previewDocumentGenerationBatchItem: vi.fn(),
  reviewDocumentGenerationBatchItem: vi.fn(),
  preflightDocumentGenerationBatch: vi.fn(),
  generateDocumentGenerationBatch: vi.fn(),
  retryDocumentGenerationBatchItem: vi.fn(),
}));

vi.mock('@/lib/document-generation-batch-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/document-generation-batch-api')>()),
  ...apiMock,
}));

import {
  DocumentGenerationBatchWorkspace,
  type DocumentGenerationBatchWorkspaceProps,
} from '@/components/documents/generation-batch';
import type {
  EditableDocumentGenerationBatch,
} from '@/components/documents/generation-batch';
import type { DocumentTemplateSummary } from '@/types/document-generation';

const templates: DocumentTemplateSummary[] = [
  {
    id: 'template-a',
    name: 'Engagement Letter',
    category: 'LETTER',
    compositionType: 'STANDARD',
    version: 1,
    isActive: true,
    engine: 'A4',
    content: '<p>x</p>',
    placeholders: [],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'template-b',
    name: 'Service Agreement',
    category: 'CONTRACT',
    compositionType: 'SERVICE_AGREEMENT',
    version: 1,
    isActive: true,
    engine: 'A4',
    content: '<p>x</p>',
    placeholders: [],
    createdAt: '',
    updatedAt: '',
  },
];

const companies = [
  {
    id: 'company-1',
    name: 'Acme Pte. Ltd.',
    uen: '202600001A',
    status: 'LIVE',
    registeredAddress: '1 Main Street, Singapore 123456',
    incorporationDate: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'company-2',
    name: 'Beta Pte. Ltd.',
    uen: '202600002B',
    status: 'LIVE',
    registeredAddress: '2 Main Street, Singapore 123456',
    incorporationDate: '2026-07-29T00:00:00.000Z',
  },
];
const contacts: Array<{ id: string; fullName: string }> = [];

function batch(items: Array<{
  key: string;
  templateId: string;
  templateName: string;
  kind: 'STANDARD' | 'SERVICE_AGREEMENT';
  status?: EditableDocumentGenerationBatch['items'][number]['status'];
}>, overrides: Partial<EditableDocumentGenerationBatch> = {}): EditableDocumentGenerationBatch {
  return {
    id: 'batch-1',
    primaryCompanyId: 'company-1',
    company: companies[0],
    activeItemId: items[0]?.key ?? null,
    currentStage: 3,
    revision: 1,
    status: 'DRAFT',
    masterFieldValues: {},
    masterFields: { fields: [], conflicts: [] },
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    items: items.map((entry) => ({
      key: entry.key,
      id: entry.key,
      templateId: entry.templateId,
      templateName: entry.templateName,
      templateKind: entry.kind,
      templateVersion: 1,
      templateEngine: 'A4',
      status: entry.status ?? 'NOT_STARTED',
      configuration: {
        version: 1,
        title: entry.templateName,
        contactIds: [],
        selectedDirectorId: null,
        selectedShareholderId: null,
        selectedContactId: null,
        itemValues: {},
        masterOverrides: {},
        useLetterhead: true,
        serviceAgreement: null,
      },
      previewContent: null,
      editedContent: null,
      editedContentJson: null,
      previewFingerprint: null,
      reviewedFingerprint: null,
      validationDiagnostics: null,
      lastError: null,
      generatedDocumentId: `child-${entry.key}`,
    })),
    ...overrides,
  };
}

function props(overrides: Partial<DocumentGenerationBatchWorkspaceProps> = {}) {
  return {
    templates,
    companies,
    contacts,
    ...overrides,
  };
}

function stageLabels() {
  return within(screen.getByRole('list', { name: /generation stages/i }))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');
}

describe('DocumentGenerationBatchWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 320,
      height: 36,
      top: 0,
      left: 0,
      bottom: 36,
      right: 320,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    } as unknown as DOMRect);
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({ ...batch([], {}), revision: 2 });
    // A fresh Response per call: the workspace now also queries the company and
    // contact option endpoints, and a Response body can only be read once.
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/companies/options')) {
        return Promise.resolve(new Response(
          JSON.stringify({ options: companies }),
          { status: 200 },
        ));
      }
      if (url.includes('/api/contacts/options')) {
        return Promise.resolve(new Response(
          JSON.stringify({ options: [] }),
          { status: 200 },
        ));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ directors: [], shareholders: [], contacts: [] }),
        { status: 200 },
      ));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses exactly the same four stages for standard, service agreement, and mixed batches', () => {
    for (const initialBatch of [
      batch([{ key: 'item-a', templateId: 'template-a', templateName: 'Engagement Letter', kind: 'STANDARD' }]),
      batch([{ key: 'item-b', templateId: 'template-b', templateName: 'Service Agreement', kind: 'SERVICE_AGREEMENT' }]),
      batch([
        { key: 'item-a', templateId: 'template-a', templateName: 'Engagement Letter', kind: 'STANDARD' },
        { key: 'item-b', templateId: 'template-b', templateName: 'Service Agreement', kind: 'SERVICE_AGREEMENT' },
      ]),
    ]) {
      const { unmount } = render(
        <DocumentGenerationBatchWorkspace {...props({ initialBatch })} />,
      );
      const labels = stageLabels();
      expect(labels).toEqual([
        expect.stringContaining('Documents'),
        expect.stringContaining('Shared setup'),
        expect.stringContaining('Configure'),
        expect.stringContaining('Review & generate'),
      ]);
      unmount();
    }
  });

  it('renders the selected company metadata in Shared setup', () => {
    const initialBatch = batch([
      { key: 'item-a', templateId: 'template-a', templateName: 'Engagement Letter', kind: 'STANDARD' },
    ], { currentStage: 1 });

    render(<DocumentGenerationBatchWorkspace {...props({ initialBatch })} />);

    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('1 Main Street, Singapore 123456')).toBeInTheDocument();
    expect(screen.getByText('Jul 29, 2026')).toBeInTheDocument();
  });

  it('updates the shared primary company when it is changed from Step 3', async () => {
    const user = userEvent.setup();
    const initialBatch = batch([
      { key: 'item-sa', templateId: 'template-b', templateName: 'Service Agreement', kind: 'SERVICE_AGREEMENT' },
    ], { currentStage: 2 });
    initialBatch.items[0].configuration.serviceAgreement = {
      authorizedContactIds: [],
      signerContactIds: [],
      entityIds: ['company-1'],
      agreementDate: '2026-08-12',
      effectiveDate: null,
      termMonths: 12,
      items: [],
    };

    render(<DocumentGenerationBatchWorkspace {...props({ initialBatch })} />);

    const primaryCompany = screen.getByRole('combobox', { name: 'Primary company' });
    await user.click(primaryCompany);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Beta Pte\. Ltd\./ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('option', { name: /Beta Pte\. Ltd\./ }));

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Primary company' }))
        .toHaveTextContent('Beta Pte. Ltd.');
    });
  });

  it('gives the review stage a viewport-height layout contract', () => {
    const initialBatch = batch([
      { key: 'item-a', templateId: 'template-a', templateName: 'Engagement Letter', kind: 'STANDARD' },
    ]);

    render(<DocumentGenerationBatchWorkspace {...props({ initialBatch })} />);

    expect(screen.getByTestId('document-generation-batch-workspace'))
      .toHaveClass('lg:h-dvh');
    expect(screen.getByRole('main')).toHaveClass('min-h-0');
  });

  it('freezes Documents and Shared setup for partial batches', () => {
    const partial = batch(
      [{ key: 'item-a', templateId: 'template-a', templateName: 'Engagement Letter', kind: 'STANDARD', status: 'GENERATED' }],
      { status: 'PARTIAL' },
    );
    const { unmount } = render(
      <DocumentGenerationBatchWorkspace {...props({ initialBatch: partial })} />,
    );
    const stageList = within(screen.getByRole('list', { name: /generation stages/i }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('button'));
    expect(stageList[0]).toBeDisabled();
    expect(stageList[1]).toBeDisabled();
    unmount();
  });

  it('saves the draft from the header action', () => {
    const initialBatch = batch([
      { key: 'item-a', templateId: 'template-a', templateName: 'Engagement Letter', kind: 'STANDARD' },
    ]);
    apiMock.saveDocumentGenerationBatch.mockResolvedValue(initialBatch);
    const { unmount } = render(
      <DocumentGenerationBatchWorkspace {...props({ initialBatch })} />,
    );
    const saveButtons = screen.getAllByRole('button', { name: /save draft/i });
    fireEvent.click(saveButtons[saveButtons.length - 1]);
    expect(apiMock.saveDocumentGenerationBatch).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ expectedRevision: 1 }),
    );
    unmount();
  });

  it('auto-generates the preview when entering the review stage', async () => {
    const initialBatch = batch([
      { key: 'item-a', templateId: 'template-a', templateName: 'Engagement Letter', kind: 'STANDARD' },
    ]);
    apiMock.previewDocumentGenerationBatchItem.mockResolvedValue({ ...initialBatch, revision: 3 });
    const { unmount } = render(
      <DocumentGenerationBatchWorkspace {...props({ initialBatch })} />,
    );
    await waitFor(() => {
      expect(apiMock.previewDocumentGenerationBatchItem).toHaveBeenCalledWith(
        'batch-1',
        'item-a',
        expect.objectContaining({ replaceEditedContent: false }),
        expect.any(AbortSignal),
      );
    });
    unmount();
  });

  it('stays on Review & generate after refreshing a preview', async () => {
    const configureBatch = batch(
      [{
        key: 'item-a',
        templateId: 'template-a',
        templateName: 'Engagement Letter',
        kind: 'STANDARD',
        status: 'PREVIEWED',
      }],
      { currentStage: 2, activeItemId: 'item-a' },
    );
    configureBatch.items[0].previewContent = '<p>content</p>';
    configureBatch.items[0].previewFingerprint = 'fp';
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({
      ...configureBatch,
      currentStage: 3,
      revision: 2,
    });
    apiMock.previewDocumentGenerationBatchItem.mockResolvedValue({
      ...configureBatch,
      currentStage: 3,
      revision: 3,
    });
    const { unmount } = render(
      <DocumentGenerationBatchWorkspace {...props({ initialBatch: configureBatch })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /review & generate/i }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /refresh preview/i })).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: /refresh preview/i }));

    await waitFor(() => {
      expect(apiMock.previewDocumentGenerationBatchItem).toHaveBeenCalled();
    });
    expect(apiMock.saveDocumentGenerationBatch).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ currentStage: 3 }),
    );
    expect(screen.queryByRole('button', { name: /refresh preview/i })).not.toBeNull();
    unmount();
  });

  it('returns to the task next stage after a task-launched batch completes', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const taskStageId = '22222222-2222-4222-8222-222222222222';
    const initialBatch = batch([
      {
        key: 'item-a',
        templateId: 'template-a',
        templateName: 'Engagement Letter',
        kind: 'STANDARD',
        status: 'READY',
      },
    ], {
      taskContext: { taskId, taskStageId, returnTo: '/tasks' },
    });
    initialBatch.items[0].previewContent = '<p>preview</p>';
    initialBatch.items[0].previewFingerprint = 'preview-fingerprint';
    initialBatch.items[0].reviewedFingerprint = 'reviewed-fingerprint';
    apiMock.preflightDocumentGenerationBatch.mockResolvedValue({
      ...initialBatch,
      revision: 2,
    });
    apiMock.generateDocumentGenerationBatch.mockResolvedValue({
      batchId: 'batch-1',
      revision: 3,
      batchStatus: 'COMPLETED',
      successes: [{ itemId: 'item-a', documentId: 'document-a', title: 'Engagement Letter' }],
      failures: [],
    });
    apiMock.getDocumentGenerationBatch.mockResolvedValue({
      ...initialBatch,
      revision: 3,
      status: 'COMPLETED',
      items: [{
        ...initialBatch.items[0],
        status: 'GENERATED',
        generatedDocumentId: 'document-a',
        generatedDocumentTitle: 'Engagement Letter',
      }],
    });

    const { unmount } = render(
      <DocumentGenerationBatchWorkspace {...props({ initialBatch })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate All' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate all' }));

    await waitFor(() => {
      expect(navigationMock.push).toHaveBeenCalledWith(
        `/tasks?taskId=${taskId}&taskStageId=${taskStageId}&returnTo=%2Ftasks`,
      );
    });
    unmount();
  });

  it('returns to the task next stage after the final failed item is retried', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const taskStageId = '22222222-2222-4222-8222-222222222222';
    const initialBatch = batch([
      {
        key: 'item-a',
        templateId: 'template-a',
        templateName: 'Engagement Letter',
        kind: 'STANDARD',
        status: 'READY',
      },
    ], {
      taskContext: { taskId, taskStageId, returnTo: '/tasks' },
    });
    initialBatch.items[0].previewContent = '<p>preview</p>';
    initialBatch.items[0].previewFingerprint = 'preview-fingerprint';
    initialBatch.items[0].reviewedFingerprint = 'reviewed-fingerprint';
    const partialBatch = {
      ...initialBatch,
      revision: 3,
      status: 'PARTIAL' as const,
      items: [{
        ...initialBatch.items[0],
        status: 'FAILED' as const,
        lastError: {
          itemId: 'item-a',
          code: 'GENERATION_FAILED',
          message: 'Conversion failed',
          occurredAt: '2026-08-29T00:00:00.000Z',
        },
      }],
    };
    const completedBatch = {
      ...initialBatch,
      revision: 4,
      status: 'COMPLETED' as const,
      items: [{
        ...initialBatch.items[0],
        status: 'GENERATED' as const,
        generatedDocumentId: 'document-a',
        generatedDocumentTitle: 'Engagement Letter',
      }],
    };
    apiMock.preflightDocumentGenerationBatch.mockResolvedValue({
      ...initialBatch,
      revision: 2,
    });
    apiMock.generateDocumentGenerationBatch.mockResolvedValue({
      batchId: 'batch-1',
      revision: 3,
      batchStatus: 'PARTIAL',
      successes: [],
      failures: [partialBatch.items[0].lastError],
    });
    apiMock.getDocumentGenerationBatch.mockResolvedValue(partialBatch);
    apiMock.retryDocumentGenerationBatchItem.mockResolvedValue(completedBatch);

    const { unmount } = render(
      <DocumentGenerationBatchWorkspace {...props({ initialBatch })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate All' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate all' }));
    const retryButton = await screen.findByRole('button', {
      name: 'Retry Engagement Letter',
    });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(navigationMock.push).toHaveBeenCalledWith(
        `/tasks?taskId=${taskId}&taskStageId=${taskStageId}&returnTo=%2Ftasks`,
      );
    });
    unmount();
  });
});
