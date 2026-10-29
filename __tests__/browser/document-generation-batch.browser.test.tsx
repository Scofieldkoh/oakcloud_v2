import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import '@/app/globals.css';
import {
  DocumentGenerationBatchWorkspace,
} from '@/components/documents/generation-batch';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
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

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

async function waitUntil(check: () => boolean, timeout = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting for browser state');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function button(host: HTMLElement, label: string) {
  const match = Array.from(host.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim().includes(label),
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

function itemDto(id: string, templateName: string, kind: 'STANDARD' | 'SERVICE_AGREEMENT'): any {
  return {
    key: id,
    id,
    templateId: `template-${id}`,
    templateName,
    templateKind: kind,
    templateVersion: 1,
    displayOrder: 0,
    status: 'NOT_STARTED',
    configuration: {
      version: 1,
      title: templateName,
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {},
      masterOverrides: {},
      useLetterhead: true,
      serviceAgreement: kind === 'SERVICE_AGREEMENT'
        ? {
            authorizedContactIds: [],
            signerContactIds: [],
            entityIds: ['company-1'],
            agreementDate: '2026-08-12',
            effectiveDate: null,
            termMonths: 12,
            items: [],
          }
        : null,
    },
    previewContent: null,
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: null,
    reviewedFingerprint: null,
    validationDiagnostics: null,
    lastError: null,
    generatedDocumentId: `child-${id}`,
    generatedDocumentTitle: null,
    serviceAgreement: null,
  };
}

function batchDto(items: any[], status = 'DRAFT'): any {
  return {
    id: 'batch-1',
    primaryCompanyId: 'company-1',
    company: { id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202600001A' },
    activeItemId: items[0]?.id ?? null,
    currentStage: 3,
    revision: 1,
    status,
    masterFieldValues: { 'client_name::text': 'Acme Pte. Ltd.' },
    masterFields: {
      fields: [{
        id: 'client_name::text',
        key: 'client_name',
        type: 'text',
        label: 'Client legal name',
        templateIds: ['template-1', 'template-2'],
        requiredTemplateIds: [],
        defaultsByTemplateId: {},
      }],
      conflicts: [],
    },
    taskContext: null,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    items,
  };
}

describe('document generation batch browser workflow', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // A fresh Response per call: option endpoints are queried alongside the
    // party options and a Response body can only be read once.
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/options')) {
        return Promise.resolve(new Response(
          JSON.stringify({ options: [] }),
          { status: 200 },
        ));
      }
      if (url.includes('/bulk-download')) {
        return Promise.resolve(new Response('zip-content', {
          status: 200,
          headers: { 'Content-Type': 'application/zip' },
        }));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ directors: [], shareholders: [], contacts: [] }),
        { status: 200 },
      ));
    });
    vi.stubGlobal('fetch', fetchMock);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
    vi.unstubAllGlobals();
  });

  it('creates, reviews, partially generates, and retries a mixed batch', async () => {
    const engagement = itemDto('item-1', 'Engagement Letter', 'STANDARD');
    const agreement = itemDto('item-2', 'Service Agreement', 'SERVICE_AGREEMENT');
    const kyc = itemDto('item-3', 'KYC Checklist', 'STANDARD');
    const draft = batchDto([engagement, agreement, kyc]);
    apiMock.createDocumentGenerationBatch.mockResolvedValue(draft);
    apiMock.saveDocumentGenerationBatch.mockResolvedValue(draft);
    apiMock.previewDocumentGenerationBatchItem.mockResolvedValue({
      ...draft,
      items: draft.items.map((entry: any) => ({
        ...entry,
        status: 'READY',
        previewContent: '<p>preview</p>',
        previewFingerprint: `fp-${entry.id}`,
        reviewedFingerprint: `rv-${entry.id}`,
      })),
    });
    apiMock.reviewDocumentGenerationBatchItem.mockResolvedValue({
      ...draft,
      items: draft.items.map((entry: any) => ({
        ...entry,
        status: 'READY',
        previewContent: '<p>preview</p>',
        previewFingerprint: `fp-${entry.id}`,
        reviewedFingerprint: `rv-${entry.id}`,
      })),
    });
    apiMock.preflightDocumentGenerationBatch.mockResolvedValue({
      ...draft,
      items: draft.items.map((entry: any) => ({
        ...entry,
        status: 'READY',
        previewFingerprint: `fp-${entry.id}`,
        reviewedFingerprint: `rv-${entry.id}`,
      })),
    });
    apiMock.generateDocumentGenerationBatch.mockResolvedValue({
      batchId: 'batch-1',
      revision: 2,
      batchStatus: 'PARTIAL',
      successes: [
        { itemId: 'item-1', documentId: 'child-item-1', title: 'Engagement Letter' },
        { itemId: 'item-3', documentId: 'child-item-3', title: 'KYC Checklist' },
      ],
      failures: [{
        itemId: 'item-2',
        code: 'GENERATION_FAILED',
        message: 'conversion failed',
        occurredAt: '2026-08-12T00:00:00.000Z',
      }],
    });
    apiMock.getDocumentGenerationBatch.mockResolvedValue(batchDto([
      { ...engagement, status: 'GENERATED', generatedDocumentTitle: 'Engagement Letter' },
      { ...agreement, status: 'FAILED', lastError: {
        itemId: 'item-2',
        code: 'GENERATION_FAILED',
        message: 'conversion failed',
        occurredAt: '2026-08-12T00:00:00.000Z',
      } },
      { ...kyc, status: 'GENERATED', generatedDocumentTitle: 'KYC Checklist' },
    ], 'PARTIAL'));
    apiMock.retryDocumentGenerationBatchItem.mockResolvedValue(batchDto([
      { ...engagement, status: 'GENERATED', generatedDocumentTitle: 'Engagement Letter' },
      { ...agreement, status: 'GENERATED', generatedDocumentTitle: 'Service Agreement' },
      { ...kyc, status: 'GENERATED', generatedDocumentTitle: 'KYC Checklist' },
    ], 'COMPLETED'));

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DocumentGenerationBatchWorkspace
            templates={[]}
            companies={[{
              id: 'company-1',
              name: 'Acme Pte. Ltd.',
              uen: '202600001A',
              status: 'ACTIVE',
            }]}
            contacts={[]}
            initialBatch={draft}
          />
        </QueryClientProvider>,
      );
    });

    await waitUntil(() => host.textContent?.includes('Review & generate') ?? false);
    const stageLabels = Array.from(
      host.querySelectorAll('ol[aria-label="Generation stages"] [data-stage-label]'),
    ).map((node) => node.textContent?.trim() ?? '');
    expect(stageLabels).toEqual([
      'Documents',
      'Shared setup',
      'Configure',
      'Review & generate',
    ]);

    // Previews are rendered automatically on entering the stage.
    await waitUntil(() => !button(host, 'Generate All').disabled);
    await act(async () => button(host, 'Generate All').click());

    // Generation is confirmed through the preflight summary dialog.
    await waitUntil(() => Array.from(document.body.querySelectorAll('button'))
      .some((candidate) => candidate.textContent?.trim() === 'Generate all'));
    await act(async () => button(document.body, 'Generate all').click());
    await waitUntil(() => host.textContent?.includes('conversion failed') ?? false);
    expect(host.textContent).toContain('2 generated, 1 failed');
    expect(host.querySelector('a[href="/generated-documents/child-item-1"]')).toBeTruthy();

    await act(async () => button(host, 'Download all').click());
    await waitUntil(() => fetchMock.mock.calls.some(([input]) => String(input).includes('/bulk-download')));
    const bulkDownloadCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/bulk-download'));
    expect(JSON.parse(String(bulkDownloadCall?.[1] && (bulkDownloadCall[1] as RequestInit).body))).toEqual({
      documentIds: ['child-item-1', 'child-item-3'],
    });

    await act(async () => button(host, 'Retry').click());
    await waitUntil(() => host.textContent?.includes('Batch complete') ?? false);
    expect(host.textContent).toContain('All documents were generated successfully.');
    expect(apiMock.generateDocumentGenerationBatch).toHaveBeenCalledTimes(1);
  });
});
