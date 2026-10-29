import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const navigationMock = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => navigationMock.searchParams,
  usePathname: () => '/',
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

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
    options: [],
    isLoading: false,
    known: new Map(),
    error: null,
  }),
}));

import GenerateDocumentPage from '@/app/(dashboard)/generated-documents/generate/page';

const legacyDocumentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const templateId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const companyId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const template = {
  id: templateId,
  name: 'Engagement Letter',
  category: 'LETTER',
  compositionType: 'STANDARD',
  version: 2,
  isActive: true,
  content: '<p>{{custom.reference}}</p>',
  contentJson: {
    oakDoc: {
      schemaVersion: 1,
      storageKey: 'tenant/templates/oakdoc/assets/master.docx',
      fileName: 'master.docx',
      fileSize: 100,
      sha256: 'a'.repeat(64),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fieldTags: [],
    },
  },
  placeholders: [
    {
      key: 'custom.reference',
      label: 'Reference',
      type: 'text',
      source: 'custom',
      category: 'custom',
      required: false,
    },
  ],
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
};

const company = {
  id: companyId,
  name: 'Acme Pte. Ltd.',
  uen: '202600001A',
  status: 'LIVE',
};

function lookupResponse(url: string): Response {
  if (url.includes('/api/document-templates')) {
    return new Response(JSON.stringify({ templates: [template] }), { status: 200 });
  }
  if (url.includes('/api/companies/options')) {
    return new Response(JSON.stringify({ options: [company] }), { status: 200 });
  }
  if (url.includes('/api/contacts/options')) {
    return new Response(JSON.stringify({ options: [] }), { status: 200 });
  }
  if (url.includes('/api/template-partials')) {
    return new Response(JSON.stringify({ partials: [] }), { status: 200 });
  }
  if (url.includes('/api/generated-documents/generation-sessions/')) {
    return new Response(JSON.stringify({
      id: legacyDocumentId,
      savedAt: '2026-08-12T00:00:00.000Z',
      state: {
        version: 2,
        currentStep: 2,
        templateId,
        companyId: null,
        contactIds: [],
        selectedDirectorId: null,
        selectedShareholderId: null,
        selectedContactId: null,
        title: 'Legacy draft',
        customData: {},
        useLetterhead: true,
        previewContent: '<p>preview</p>',
        editedContent: null,
        editedContentJson: null,
        serviceAgreementId: null,
      },
      agreement: null,
    }), { status: 200 });
  }
  if (url.includes('/api/document-generation-batches/')) {
    return new Response(JSON.stringify({
      id: 'batch-1',
      primaryCompanyId: null,
      company: null,
      activeItemId: 'item-1',
      currentStage: 0,
      revision: 0,
      status: 'DRAFT',
      masterFieldValues: {},
      masterFields: { fields: [], conflicts: [] },
      taskContext: null,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
      items: [],
    }), { status: 200 });
  }
  if (url.includes('/api/companies/')) {
    return new Response(JSON.stringify(company), { status: 200 });
  }
  return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
}

describe('GenerateDocumentPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/document-generation-batches')) {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'batch-1',
          primaryCompanyId: null,
          company: null,
          activeItemId: 'item-1',
          currentStage: 0,
          revision: 1,
          status: 'DRAFT',
          masterFieldValues: {},
          masterFields: { fields: [], conflicts: [] },
          taskContext: null,
          createdAt: '2026-08-12T00:00:00.000Z',
          updatedAt: '2026-08-12T00:00:00.000Z',
          items: [{
            id: 'item-1',
            templateId,
            templateName: 'Engagement Letter',
            templateKind: 'STANDARD',
            templateVersion: 2,
            displayOrder: 0,
            status: 'NOT_STARTED',
            configuration: {
              version: 1,
              title: 'Legacy draft',
              contactIds: [],
              selectedDirectorId: null,
              selectedShareholderId: null,
              selectedContactId: null,
              itemValues: {},
              masterOverrides: {},
              useLetterhead: true,
              serviceAgreement: null,
            },
            previewContent: '<p>preview</p>',
            editedContent: null,
            editedContentJson: null,
            previewFingerprint: null,
            reviewedFingerprint: null,
            validationDiagnostics: null,
            lastError: null,
            generatedDocumentId: legacyDocumentId,
            generatedDocumentTitle: 'Legacy draft',
            serviceAgreement: null,
          }],
        }), { status: 200 }));
      }
      return Promise.resolve(lookupResponse(url));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads an old draft locally and adopts it on the first explicit save', async () => {
    navigationMock.searchParams = new URLSearchParams({ draft: legacyDocumentId });
    render(<GenerateDocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('document-generation-batch-workspace')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText('Legacy draft').length).toBeGreaterThan(0);
    });
    const fetchMock = vi.mocked(fetch);
    const createCalls = fetchMock.mock.calls.filter(([url, init]) =>
      String(url).endsWith('/api/document-generation-batches')
      && init?.method === 'POST');
    expect(createCalls).toHaveLength(0);

    const saveButtons = screen.getAllByRole('button', { name: /save draft/i });
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).endsWith('/api/document-generation-batches')
        && init?.method === 'POST');
      expect(calls.length).toBeGreaterThan(0);
      expect(JSON.parse(String(calls[0][1]?.body))).toEqual(
        expect.objectContaining({ legacyDraftId: legacyDocumentId }),
      );
    });
  });

  it('seeds a one-item batch from template and company links', async () => {
    navigationMock.searchParams = new URLSearchParams({
      templateId,
      companyId,
    });
    render(<GenerateDocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('document-generation-batch-workspace')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Engagement Letter').length).toBeGreaterThan(0);
  });
});
