import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { Modal } from '@/components/ui/modal';
import { EsigningStepFields } from '@/components/esigning/prepare/esigning-step-fields';
import { EsigningDetailPage } from '@/components/esigning/esigning-detail-page';
import type { EsigningEnvelopeDetailDto } from '@/types/esigning';
import '@/app/globals.css';

const hookMocks = vi.hoisted(() => ({
  envelope: null as EsigningEnvelopeDetailDto | null,
  mutateAsync: vi.fn().mockResolvedValue({}),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => {
  const LinkMock = ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  );
  LinkMock.displayName = 'LinkMock';
  return {
    __esModule: true,
    default: LinkMock,
    Link: LinkMock,
  };
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
    useEsigningEnvelope: () => ({ data: hookMocks.envelope, isLoading: false, refetch: vi.fn() }),
    attachGeneratedDocumentsRequest: vi.fn().mockImplementation(async () => hookMocks.envelope),
    useUpdateEsigningEnvelope: () => mutation(),
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
    useUpdateEsigningDocument: () => mutation(),
    useResendEsigningEnvelope: () => mutation(),
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
  }) => (
    <label>
      {label}
      <input data-testid="single-date-input" value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
}));

vi.mock('@/components/ui/company-searchable-select', () => ({
  CompanySearchableSelect: () => <div data-testid="company-searchable-select" />,
}));

vi.mock('@/components/ui/contact-search-select', () => ({
  ContactSearchSelect: () => <div data-testid="contact-search-select" />,
}));

vi.mock('@/components/processing/document-page-viewer', () => ({
  DocumentPageViewer: ({
    viewMode,
    renderPageOverlay,
  }: {
    viewMode?: string;
    renderPageOverlay?: (context: { pageNumber: number; width: number; height: number }) => ReactNode;
  }) => (
    <div
      data-document-scroll-container="true"
      data-view-mode={viewMode ?? 'single'}
      style={{ width: '100%', height: 600, overflow: 'auto' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {[1, 2, 3].map((pageNumber) => (
          <div
            key={pageNumber}
            data-document-page-number={pageNumber}
            style={{ position: 'relative', width: 600, height: 800, flexShrink: 0 }}
          >
            <div
              data-main-pdf-canvas="true"
              data-page-number={pageNumber}
              style={{ width: 600, height: 800 }}
            />
            {renderPageOverlay?.({ pageNumber, width: 600, height: 800 })}
          </div>
        ))}
      </div>
    </div>
  ),
  DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5],
}));

const pdfjsMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfjsMocks.getDocument,
}));

function makeFakePdf() {
  const page = {
    getViewport: () => ({ width: 800, height: 1000 }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    getTextContent: async () => ({ items: [] }),
  };
  return {
    numPages: 1,
    getPage: vi.fn(async () => page),
    destroy: vi.fn(),
  };
}

async function waitUntil(check: () => boolean, timeout = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) {
      throw new Error('Timed out waiting for E-signing preparation UI');
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function makeEnvelope(): EsigningEnvelopeDetailDto {
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
    recipientCount: 2,
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
      {
        id: 'recipient-2',
        name: 'CC Person',
        email: 'cc@example.com',
        type: 'CC',
        status: 'QUEUED',
        signingOrder: null,
        accessMode: 'EMAIL_LINK',
        hasAccessCode: false,
        colorTag: '#10b981',
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
  };
}

function makeLongEnvelope(): EsigningEnvelopeDetailDto {
  const base = makeEnvelope();
  const documentIds = ['document-1', 'document-2', 'document-3', 'document-4', 'document-5'];
  const signerIds = [
    'recipient-1',
    'recipient-3',
    'recipient-5',
    'recipient-7',
    'recipient-9',
    'recipient-11',
  ];
  const fields = signerIds.flatMap((recipientId, signerIndex) =>
    documentIds.map((documentId, documentIndex) => ({
      id: `field-${signerIndex}-${documentIndex}`,
      documentId,
      recipientId,
      type: 'SIGNATURE' as const,
      pageNumber: 1,
      xPercent: 0.4 + (documentIndex % 3) * 0.1,
      yPercent: 0.5,
      widthPercent: 0.2,
      heightPercent: 0.08,
      required: true,
      label: null,
      placeholder: null,
      sortOrder: documentIndex + 1,
    }))
  );
  return {
    ...base,
    documents: documentIds.map((id, index) => ({
      id,
      fileName: `document-${index + 1}.pdf`,
      pageCount: 1,
      sortOrder: index + 1,
      fileSize: 1024 * (index + 1),
      originalHash: `hash-${id}`,
      signedHash: null,
      pdfUrl: `/${id}.pdf`,
      signedPdfUrl: null,
    })),
    recipients: [
      ...base.recipients,
      ...Array.from({ length: 10 }, (_, index) => {
        const recipientIndex = index + 3;
        const isSigner = recipientIndex % 2 === 1;
        return {
          id: `recipient-${recipientIndex}`,
          name: `${isSigner ? 'Signer' : 'CC Person'} ${recipientIndex}`,
          email: `${isSigner ? 'signer' : 'cc'}${recipientIndex}@example.com`,
          type: (isSigner ? 'SIGNER' : 'CC') as 'SIGNER' | 'CC',
          status: 'QUEUED' as const,
          signingOrder: isSigner ? Math.ceil(recipientIndex / 2) : null,
          accessMode: 'EMAIL_LINK' as const,
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
          copyDeliveryStatus: 'AWAITING_COMPLETION' as const,
        };
      }),
    ],
    documentCount: 5,
    recipientCount: 12,
    signerCount: 6,
    fields,
  };
}

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" id="modal-opener" onClick={() => setOpen(true)}>
        Open modal
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Bottom sheet" placement="bottom">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>
    </div>
  );
}

describe('E-signing preparation responsive layout', () => {
  let host: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  beforeEach(async () => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
    await page.viewport(390, 844);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('renders bottom placement as a focus-trapped dialog with Escape close and focus restoration', async () => {
    await act(async () => root.render(<ModalHarness />));
    const opener = document.querySelector<HTMLButtonElement>('#modal-opener');
    if (!opener) throw new Error('Modal opener missing');
    await act(async () => opener.focus());
    await act(async () => opener.click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain('Bottom sheet');
    expect(document.body.style.overflow).toBe('hidden');

    const lastButton = [...(dialog?.querySelectorAll('button') ?? [])].at(-1) as HTMLButtonElement;
    await act(async () => lastButton.focus());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    await waitUntil(() => !document.querySelector('[role="dialog"]'));
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('keeps center placement dialog semantics unchanged', async () => {
    await act(async () =>
      root.render(
        <Modal isOpen onClose={() => undefined} title="Center sheet">
          content
        </Modal>
      )
    );
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const content = dialog?.firstElementChild as HTMLElement | null;
    expect(content?.className).toContain('rounded-2xl');
  });

  it('opens the mobile palette as an overlay and auto-closes after field selection', async () => {
    const envelope = makeEnvelope();
    await act(async () =>
      root.render(
        <EsigningStepFields
          envelope={envelope}
          fields={[]}
          onFieldsChange={vi.fn()}
          onSaveFields={vi.fn().mockResolvedValue(undefined)}
          isSaving={false}
          canUndo={false}
          canRedo={false}
          onUndo={vi.fn()}
          onRedo={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
          canEdit
        />
      )
    );

    const canvas = document.querySelector<HTMLElement>('[data-main-pdf-canvas="true"]');
    if (!canvas) throw new Error('Canvas stub missing');
    const canvasWidth = canvas.getBoundingClientRect().width;
    expect(canvasWidth).toBeGreaterThan(0);

    const paletteButton = document.querySelector<HTMLButtonElement>('button[aria-label="Open field palette"]');
    if (!paletteButton) throw new Error('Mobile palette button missing');
    await act(async () => paletteButton.click());
    await waitUntil(() => Boolean(document.querySelector('[role="dialog"]')));
    expect(canvas.getBoundingClientRect().width).toBe(canvasWidth);

    const signatureButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Signature')
    );
    if (!signatureButton) throw new Error('Signature palette option missing');
    await act(async () => signatureButton.click());

    await waitUntil(() => !document.querySelector('[role="dialog"]'));
    expect(host.textContent).toContain('Placing: Signature');
    expect(canvas.getBoundingClientRect().width).toBe(canvasWidth);
  });
});

describe('E-signing preparation browser matrix', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let consoleErrors: string[];
  const originalConsoleError = console.error;
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  beforeEach(async () => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    hookMocks.envelope = makeLongEnvelope();
    await page.viewport(390, 844);

    consoleErrors = [];
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
      originalConsoleError(...args);
    };
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('.pdf')) {
          return new Response(new Uint8Array([37, 80, 68, 70]).buffer, {
            status: 200,
            headers: { 'Content-Type': 'application/pdf' },
          });
        }
        return originalFetch(input);
      })
    );
    pdfjsMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(makeFakePdf()),
      destroy: vi.fn(),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
    console.error = originalConsoleError;
    vi.unstubAllGlobals();
    const thumbnailErrors = consoleErrors.filter(
      (message) =>
        message.includes('e-signing thumbnail') ||
        message.includes('thumbnail source') ||
        message.includes('Failed to fetch PDF')
    );
    expect(thumbnailErrors).toEqual([]);
  });

  async function renderWizard() {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <EsigningDetailPage envelopeId="envelope-1" />
        </QueryClientProvider>
      )
    );
    await waitUntil(() => host.textContent?.includes('Upload documents') ?? false);
  }

  async function renderFields() {
    await act(async () =>
      root.render(
        <EsigningStepFields
          envelope={makeEnvelope()}
          fields={[]}
          onFieldsChange={vi.fn()}
          onSaveFields={vi.fn().mockResolvedValue(undefined)}
          isSaving={false}
          canUndo={false}
          canRedo={false}
          onUndo={vi.fn()}
          onRedo={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
          canEdit
        />
      )
    );
    await waitUntil(() => Boolean(document.querySelector('[data-main-pdf-canvas="true"]')));
  }

  it('resets scroll and focus when advancing from Upload to Fields at 390px', async () => {
    await renderWizard();
    const wizardMain = document.querySelector<HTMLElement>('[data-wizard-main="true"]');
    if (!wizardMain) throw new Error('Wizard main missing');

    wizardMain.scrollTop = wizardMain.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
    expect(window.scrollY).toBeGreaterThan(0);

    const nextButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Next')
    );
    if (!nextButton) throw new Error('Next button missing');
    await act(async () => nextButton.click());

    await waitUntil(
      () => document.querySelector('#esigning-step-2-heading') === document.activeElement
    );
    expect(window.scrollY).toBe(0);
    expect(wizardMain.scrollTop).toBe(0);
    expect(document.activeElement?.textContent).toContain('Place fields');
  });

  it('resets scroll and focus for Fields to Review and indicator navigation', async () => {
    await renderWizard();
    const nextButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Next')
    );
    if (!nextButton) throw new Error('Next button missing');
    await act(async () => nextButton.click());
    await waitUntil(
      () => document.querySelector('#esigning-step-2-heading') === document.activeElement
    );

    const nextToReview = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Next')
    );
    if (!nextToReview) throw new Error('Fields Next button missing');
    await act(async () => nextToReview.click());
    await waitUntil(
      () => document.querySelector('#esigning-step-3-heading') === document.activeElement
    );
    expect(document.activeElement?.textContent).toContain('Review and send');

    const uploadIndicator = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Upload')
    );
    if (!uploadIndicator) throw new Error('Upload indicator missing');
    await act(async () => uploadIndicator.click());
    await waitUntil(
      () => document.querySelector('#esigning-step-1-heading') === document.activeElement
    );
    expect(document.activeElement?.textContent).toContain('Upload documents');
  });

  it('keeps the fields workspace inside the viewport instead of creating an outer scrollbar', async () => {
    await page.viewport(1440, 640);
    await renderWizard();

    const nextButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Next')
    );
    if (!nextButton) throw new Error('Next button missing');
    await act(async () => nextButton.click());
    await waitUntil(
      () => document.querySelector('#esigning-step-2-heading') === document.activeElement
    );

    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight + 1);
  });

  it.each([320, 390] as const)(
    'keeps the canvas full width and uses overlay panels at %ipx',
    async (width) => {
      await page.viewport(width, 844);
      await renderFields();

      expect(document.querySelector('button[aria-label="Open field palette"]')).not.toBeNull();
      expect(document.querySelector('button[aria-label="Expand field palette"]')).toBeNull();
      expect(
        [...document.querySelectorAll('[role="separator"]')].some((separator) =>
          separator.getAttribute('aria-label')?.includes('Resize')
        )
      ).toBe(false);

      const canvas = document.querySelector<HTMLElement>('[data-main-pdf-canvas="true"]');
      if (!canvas) throw new Error('Canvas missing');
      expect(canvas.getBoundingClientRect().width).toBeGreaterThanOrEqual(width - 64);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth
      );
      await page.screenshot({ path: `__screenshots__/esigning-preparation-${width}.png` });
    }
  );

  it('stacks every PDF page inside the viewer scroll area at desktop size', async () => {
    await page.viewport(1440, 640);
    await renderWizard();

    const nextButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Next')
    );
    if (!nextButton) throw new Error('Next button missing');
    await act(async () => nextButton.click());
    await waitUntil(
      () => document.querySelector('#esigning-step-2-heading') === document.activeElement
    );

    const scrollContainer = document.querySelector<HTMLElement>(
      '[data-document-scroll-container="true"]'
    );
    if (!scrollContainer) throw new Error('Document scroll container missing');

    expect(scrollContainer.getAttribute('data-view-mode')).toBe('continuous');
    expect(document.querySelectorAll('[data-esigning-page-overlay]')).toHaveLength(3);
    expect(scrollContainer.scrollHeight).toBeGreaterThan(scrollContainer.clientHeight);
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight + 1);
  });

  it('uses tablet panels with a usable center canvas at 768px', async () => {
    await page.viewport(768, 1024);
    await renderFields();

    expect(document.querySelector('button[aria-label="Open field palette"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Collapse field palette"]')).not.toBeNull();
    const canvas = document.querySelector<HTMLElement>('[data-main-pdf-canvas="true"]');
    if (!canvas) throw new Error('Canvas missing');
    expect(canvas.getBoundingClientRect().width).toBeGreaterThanOrEqual(470);
    await page.screenshot({ path: '__screenshots__/esigning-preparation-768.png' });
  });

  it('operates the initial upload with keyboard at 390px', async () => {
    await renderWizard();
    const uploadButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Drop PDF documents here')
    );
    if (!uploadButton) throw new Error('Upload button missing');
    expect(uploadButton.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error('File input missing');
    let clickCount = 0;
    fileInput.addEventListener('click', () => {
      clickCount += 1;
    });

    uploadButton.focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(clickCount).toBeGreaterThanOrEqual(2);
  });

  it('leaves arrow keys native when the canvas does not own a visible selection', async () => {
    await renderFields();
    document.body.focus();

    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

});
