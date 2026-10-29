import { createElement } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { EsigningDetailPage } from '@/components/esigning/esigning-detail-page';
import type { EsigningEnvelopeDetailDto } from '@/types/esigning';

const hookMocks = vi.hoisted(() => ({
  envelope: null as EsigningEnvelopeDetailDto | null,
  mutateAsync: vi.fn().mockResolvedValue({}),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => {
  const LinkMock = ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement('a', { href, ...props }, children);
  LinkMock.displayName = 'LinkMock';
  return { __esModule: true, default: LinkMock, Link: LinkMock };
});

vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({
    data: {
      id: 'user-1',
      tenantId: 'tenant-1',
      firstName: 'Sender',
      lastName: '',
      email: 'sender@example.com',
      isSuperAdmin: false,
    },
  }),
}));

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    can: {
      readEsigning: true,
      createEsigning: true,
      updateEsigning: true,
      deleteEsigning: true,
      manageEsigning: true,
    },
  }),
}));

vi.mock('@/hooks/use-companies', () => ({
  useCompanies: () => ({ data: { companies: [], total: 0 }, isLoading: false }),
}));

vi.mock('@/hooks/use-esigning', () => {
  const mutation = (overrides: Record<string, unknown> = {}) => ({
    isPending: false,
    mutateAsync: hookMocks.mutateAsync,
    ...overrides,
  });
  return {
    useEsigningEnvelope: () => ({ data: hookMocks.envelope, isLoading: false }),
    useUpdateEsigningEnvelope: () => mutation(),
    useUpdateEsigningDocument: () => mutation(),
    useUploadEsigningDocument: () => mutation(),
    useSaveEsigningFields: () => mutation(),
    useSendEsigningEnvelope: () => mutation(),
    useVoidEsigningEnvelope: () => mutation(),
    useRetryEsigningEnvelopeProcessing: () => mutation(),
    useDeleteEsigningEnvelope: () => mutation(),
    useDuplicateEsigningEnvelope: () => mutation(),
    useAddEsigningRecipient: () => mutation(),
    useReorderEsigningRecipients: () => mutation(),
    useUpdateEsigningRecipient: () => mutation(),
    useRemoveEsigningRecipient: () => mutation(),
    useDeleteEsigningDocument: () => mutation(),
    useResendEsigningRecipient: () => mutation(),
    useEsigningRecipientManualLink: () => mutation(),
  };
});

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/components/esigning/esigning-upload-files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/esigning/esigning-upload-files')>();
  return {
    ...actual,
    isAllowedEsigningUploadFile: () => true,
    useEsigningWordUploadAvailability: () => false,
  };
});

vi.mock('@/components/ui/single-date-input', () => ({
  SingleDateInput: ({
    label,
    value,
    onChange,
  }: {
    label?: string;
    value?: string;
    onChange: (value: string) => void;
  }) =>
    createElement(
      'label',
      null,
      label,
      createElement('input', {
        'data-testid': 'single-date-input',
        value: value ?? '',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
      })
    ),
}));

vi.mock('@/components/ui/company-searchable-select', () => ({
  CompanySearchableSelect: () => createElement('div', { 'data-testid': 'company-searchable-select' }),
}));

vi.mock('@/components/ui/contact-search-select', () => ({
  ContactSearchSelect: () => createElement('div', { 'data-testid': 'contact-search-select' }),
}));

vi.mock('@/hooks/use-contacts', () => ({
  useCreateContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/workspace-selector', () => ({
  useActiveWorkspaceId: () => 'tenant-1',
}));

vi.mock('@/components/processing/document-page-viewer', () => ({
  DocumentPageViewer: () =>
    createElement('div', {
      'data-main-pdf-canvas': 'true',
      'data-document-scroll-container': 'true',
    }),
  DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5],
}));

function makeEnvelope(
  overrides: Partial<EsigningEnvelopeDetailDto> = {}
): EsigningEnvelopeDetailDto {
  return {
    id: 'envelope-1',
    tenantId: 'tenant-1',
    title: 'NDA',
    message: null,
    completionCopyEmails: [],
    status: 'DRAFT',
    signingOrder: 'PARALLEL',
    expiresAt: null,
    reminderFrequencyDays: null,
    reminderStartDays: null,
    expiryWarningDays: null,
    companyId: null,
    companyName: null,
    certificateId: 'certificate-1',
    completedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    voidedAt: null,
    voidReason: null,
    pdfGenerationStatus: null,
    pdfGenerationError: null,
    createdById: 'user-1',
    createdByName: 'Sender',
    canEdit: true,
    canDelete: true,
    canSend: true,
    canVoid: false,
    canDuplicate: false,
    canRetryCompletionProcessing: false,
    emailDelivery: { status: 'ok', lastFailureAt: null, failures: [] },
    postCompletion: {
      artifactStatus: null,
      autoFilingStatus: 'NOT_REQUIRED',
      completionDeliveryStatus: 'NOT_TRACKED',
      failedCompletionDeliveryCount: 0,
    },
    documentCount: 1,
    signerCount: 1,
    recipientCount: 1,
    completedSignerCount: 0,
    documents: [
      {
        id: 'document-1',
        fileName: 'nda.pdf',
        pageCount: 1,
        sortOrder: 1,
        fileSize: 1024,
        originalHash: 'hash-original',
        signedHash: null,
        pdfUrl: '/nda.pdf',
        signedPdfUrl: null,
      },
    ],
    recipients: [
      {
        id: 'recipient-1',
        name: 'Signer',
        email: 'signer@example.com',
        type: 'SIGNER',
        status: 'QUEUED',
        signingOrder: 1,
        accessMode: 'EMAIL_LINK',
        hasAccessCode: false,
        colorTag: '#06b6d4',
        consentedAt: null,
        viewedAt: null,
        signedAt: null,
        declinedAt: null,
        declineReason: null,
        fieldsAssigned: 0,
        requiredFieldsAssigned: 0,
        signatureFieldsAssigned: 0,
        copyDeliveryStatus: 'AWAITING_COMPLETION',
      },
    ],
    fields: [],
    fieldValues: [],
    events: [],
    ...overrides,
  };
}

describe('E-signing detail hydration', () => {
  let container: HTMLDivElement;
  let renderedRoot: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.replaceChildren(container);
    hookMocks.envelope = makeEnvelope();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    renderedRoot?.unmount();
    renderedRoot = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('hydrates a newly opened draft without server/client divergence', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const tree = createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(EsigningDetailPage, { envelopeId: 'envelope-1' })
    );

    const serverHtml = renderToString(tree);
    container.innerHTML = serverHtml;

    const recoverableErrors: Error[] = [];
    renderedRoot = hydrateRoot(container, tree, {
      onRecoverableError: (error) => recoverableErrors.push(error as Error),
    });

    await waitFor(() => {
      expect(recoverableErrors).toHaveLength(0);
    });
    expect(container.textContent).toContain('Upload documents');
    const deleteDraftButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Delete draft'));
    expect(deleteDraftButton?.className).toContain('bg-red-600');
    expect(container.textContent).not.toContain('NDA');
  });

  it('hydrates a completed envelope detail without server/client divergence', async () => {
    hookMocks.envelope = makeEnvelope({
      status: 'COMPLETED',
      completedAt: '2026-08-02T00:00:00.000Z',
      pdfGenerationStatus: 'COMPLETED',
      documents: [
        {
          ...makeEnvelope().documents[0],
          signedHash: 'hash-signed',
          signedPdfUrl: '/nda-signed.pdf',
        },
      ],
      recipients: [
        {
          ...makeEnvelope().recipients[0],
          status: 'SIGNED',
          signedAt: '2026-08-02T00:00:00.000Z',
        },
      ],
      completedSignerCount: 1,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const tree = createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(EsigningDetailPage, { envelopeId: 'envelope-1' })
    );

    const serverHtml = renderToString(tree);
    container.innerHTML = serverHtml;

    const recoverableErrors: Error[] = [];
    renderedRoot = hydrateRoot(container, tree, {
      onRecoverableError: (error) => recoverableErrors.push(error as Error),
    });

    await waitFor(() => {
      expect(recoverableErrors).toHaveLength(0);
    });
    expect(container.textContent).toContain('COMPLETED');
    expect(container.textContent).toContain('Parallel signing');
    expect(screen.getByTestId('envelope-detail-recipients')).toBeInTheDocument();
    expect(screen.getByTestId('envelope-detail-documents')).toBeInTheDocument();
    expect(screen.getByTestId('envelope-detail-activity')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Envelope download options' }));
    expect(screen.getByRole('menuitem', { name: 'Document only' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Document + Certificate' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Certificate only' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More envelope actions' }));
    expect(screen.getByRole('menuitem', { name: 'Delete envelope' })).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Download options for nda.pdf' })
    );
    expect(screen.getByRole('menuitem', { name: 'Original' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Document only' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Document + Certificate' })).toBeInTheDocument();

    expect(screen.getAllByTestId('envelope-detail-recipient-row')).toHaveLength(1);
    expect(screen.getAllByTestId('envelope-detail-document-row')).toHaveLength(1);
  });

  it('uses the same shared detail layout for an in-progress envelope', async () => {
    const base = makeEnvelope();
    hookMocks.envelope = makeEnvelope({
      status: 'IN_PROGRESS',
      canEdit: false,
      canSend: false,
      canVoid: true,
      canDuplicate: true,
      recipients: [
        {
          ...base.recipients[0],
          status: 'NOTIFIED',
          accessMode: 'MANUAL_LINK',
        },
      ],
      events: [
        {
          id: 'event-sent',
          recipientId: 'recipient-1',
          recipientName: 'Signer',
          action: 'SENT',
          createdAt: '2026-08-02T00:00:00.000Z',
          metadata: null,
        },
      ],
    });

    renderedRoot = createRoot(container);
    renderedRoot.render(
      <QueryClientProvider client={new QueryClient()}>
        <EsigningDetailPage envelopeId="envelope-1" />
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('envelope-detail-header')).toBeInTheDocument();
    expect(screen.getByTestId('envelope-detail-recipients')).toBeInTheDocument();
    expect(screen.getByTestId('envelope-detail-documents')).toBeInTheDocument();
    expect(screen.getByTestId('envelope-detail-activity')).toBeInTheDocument();
    expect(screen.getByText('IN PROGRESS')).toBeInTheDocument();
    expect(screen.getByText('Parallel signing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More envelope actions' }));
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete envelope' })).toBeInTheDocument();
  });

  it('filters completed activity by recipient name', async () => {
    const base = makeEnvelope();
    hookMocks.envelope = makeEnvelope({
      status: 'COMPLETED',
      completedAt: '2026-08-02T00:00:00.000Z',
      pdfGenerationStatus: 'COMPLETED',
      recipients: [
        {
          ...base.recipients[0],
          id: 'recipient-1',
          name: 'Signer One',
          status: 'SIGNED',
          signedAt: '2026-08-02T00:00:00.000Z',
        },
        {
          ...base.recipients[0],
          id: 'recipient-2',
          name: 'Signer Two',
          email: 'two@example.com',
          status: 'SIGNED',
          signedAt: '2026-08-02T00:01:00.000Z',
        },
      ],
      recipientCount: 2,
      signerCount: 2,
      completedSignerCount: 2,
      events: [
        {
          id: 'event-completed',
          recipientId: null,
          recipientName: null,
          action: 'COMPLETED',
          createdAt: '2026-08-02T00:02:00.000Z',
          metadata: null,
        },
        {
          id: 'event-one',
          recipientId: 'recipient-1',
          recipientName: 'Signer One',
          action: 'SIGNED',
          createdAt: '2026-08-02T00:00:00.000Z',
          metadata: null,
        },
        {
          id: 'event-two',
          recipientId: 'recipient-2',
          recipientName: 'Signer Two',
          action: 'SIGNED',
          createdAt: '2026-08-02T00:01:00.000Z',
          metadata: null,
        },
      ],
    });

    renderedRoot = createRoot(container);
    renderedRoot.render(
      <QueryClientProvider client={new QueryClient()}>
        <EsigningDetailPage envelopeId="envelope-1" />
      </QueryClientProvider>
    );

    expect(await screen.findByText('Signed by Signer One')).toBeInTheDocument();
    expect(screen.getByText('Signed by Signer Two')).toBeInTheDocument();
    expect(screen.getByText('Envelope completed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Filter activity by recipient' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Signer One' }));

    expect(screen.getByText('Signed by Signer One')).toBeInTheDocument();
    expect(screen.queryByText('Signed by Signer Two')).not.toBeInTheDocument();
    expect(screen.queryByText('Envelope completed')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Filter activity by recipient' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'All recipients' }));

    expect(screen.getByText('Signed by Signer Two')).toBeInTheDocument();
    expect(screen.getByText('Envelope completed')).toBeInTheDocument();
  });

  it.each(['SENT', 'IN_PROGRESS'] as const)('submits only name and email when adding an email after %s', async (status) => {
    hookMocks.envelope = makeEnvelope({
      status,
      canEdit: false,
      recipients: [{
        ...makeEnvelope().recipients[0],
        email: null,
        accessMode: 'MANUAL_LINK',
        status: 'NOTIFIED',
      }],
    });
    hookMocks.mutateAsync.mockClear();
    hookMocks.mutateAsync.mockResolvedValueOnce({ manualLinks: [] });
    renderedRoot = createRoot(container);
    renderedRoot.render(
      <QueryClientProvider client={new QueryClient()}>
        <EsigningDetailPage envelopeId="envelope-1" />
      </QueryClientProvider>
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByLabelText('Email (optional)'), 'signer@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(hookMocks.mutateAsync).toHaveBeenCalledExactlyOnceWith({
      name: 'Signer',
      email: 'signer@example.com',
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Correct recipient' })).not.toBeInTheDocument());
  });

  it('prompts the sender to auto-sign after sending when a saved specimen is available', async () => {
    const sentEnvelope = makeEnvelope({
      status: 'SENT',
      canEdit: false,
      recipients: [
        {
          ...makeEnvelope().recipients[0],
          email: 'sender@example.com',
          accessMode: 'MANUAL_LINK',
          status: 'NOTIFIED',
        },
      ],
    });
    hookMocks.envelope = sentEnvelope;
    hookMocks.mutateAsync.mockResolvedValueOnce({
      envelope: sentEnvelope,
      manualLinks: [
        {
          recipientId: 'recipient-1',
          recipientName: 'Sender',
          recipientEmail: 'sender@example.com',
          signingUrl: 'https://app.example.com/esigning/sign/token-1',
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ dataUrl: 'data:image/png;base64,c2ln' }), { status: 200 })
    );

    renderedRoot = createRoot(container);
    renderedRoot?.render(
      <QueryClientProvider client={new QueryClient()}>
        <EsigningDetailPage envelopeId="envelope-1" />
      </QueryClientProvider>
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Send envelope' }));

    expect(await screen.findByRole('heading', { name: 'Auto-sign your portion?' })).toBeInTheDocument();
    expect(screen.getByAltText('Saved signature specimen')).toHaveAttribute(
      'src',
      'data:image/png;base64,c2ln'
    );

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await userEvent.click(screen.getByRole('button', { name: 'Auto-sign' }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://app.example.com/esigning/sign/token-1?autoSign=1',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
