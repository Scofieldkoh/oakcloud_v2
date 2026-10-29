import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { EsigningSignPage } from '@/components/esigning/esigning-sign-page';
import type { EsigningSigningSessionDto } from '@/types/esigning';
import '@/app/globals.css';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'browser-token' }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/hooks/use-media-query', () => ({
  useIsMobile: () => window.innerWidth < 768,
}));

vi.mock('@/components/esigning/signing/esigning-signature-modal', () => ({
  EsigningSignatureModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <button onClick={onClose}>Close signature editor</button> : null,
}));

vi.mock('@/components/esigning/signing/esigning-decline-modal', () => ({
  EsigningDeclineModal: () => null,
}));

vi.mock('@/components/esigning/signing/esigning-field-input-modal', () => ({
  EsigningFieldInputModal: ({
    isOpen,
    field,
  }: {
    isOpen: boolean;
    field: { id: string } | null;
  }) => (isOpen && field ? <div data-testid="active-field-input">{field.id}</div> : null),
}));

vi.mock('@/components/processing/document-page-viewer', () => ({
  DocumentPageViewer: ({
    className,
    highlights,
    initialPage = 1,
    renderHighlightContent,
    renderPageOverlay,
    viewMode = 'single',
  }: {
    className?: string;
    highlights: Array<{ label: string; pageNumber: number }>;
    initialPage?: number;
    renderHighlightContent: (
      highlight: { label: string; pageNumber: number },
      pixelRect: { x: number; y: number; width: number; height: number },
      index: number
    ) => ReactNode;
    renderPageOverlay?: (context: { pageNumber: number; width: number; height: number }) => ReactNode;
    viewMode?: 'single' | 'continuous';
  }) => {
    const pageNumbers = viewMode === 'continuous' ? [1, 2] : [initialPage];

    return (
      <div
        data-document-scroll-container="true"
        data-view-mode={viewMode}
        data-viewer-page={initialPage}
        className={className}
        style={{ overflow: 'auto' }}
      >
        <div className="flex flex-col items-center gap-4">
          {pageNumbers.map((pageNumber) => (
            <div
              key={pageNumber}
              data-document-page-number={pageNumber}
              className="relative shrink-0 bg-white"
              style={{ width: 600, height: 800 }}
            >
              {renderPageOverlay?.({ pageNumber, width: 600, height: 800 })}
              {highlights
                .filter((highlight) => highlight.pageNumber === pageNumber)
                .map((highlight, index) => (
                  <div key={highlight.label} className="h-12 w-40">
                    {renderHighlightContent(
                      highlight,
                      { x: 0, y: 0, width: 160, height: 48 },
                      index
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    );
  },
}));

function makeSigningSession(): EsigningSigningSessionDto {
  return {
    envelope: {
      id: 'envelope-1',
      title: 'Two-page agreement',
      message: null,
      status: 'IN_PROGRESS',
      pdfGenerationStatus: null,
      certificateId: 'certificate-1',
      companyName: null,
      tenantName: 'Oakcloud',
      senderName: 'Sender',
      completedAt: null,
      expiresAt: null,
      autoFilingStatus: 'NOT_REQUIRED',
      completionDeliveryStatus: 'NOT_TRACKED',
    },
    recipient: {
      id: 'recipient-1',
      name: 'Client',
      email: 'client@example.com',
      type: 'SIGNER',
      status: 'VIEWED',
      accessMode: 'EMAIL_LINK',
      consentedAt: '2026-08-12T08:00:00.000Z',
      viewedAt: '2026-08-12T08:01:00.000Z',
      signedAt: null,
      colorTag: '#06b6d4',
    },
    documents: [
      {
        id: 'document-1',
        fileName: 'agreement.pdf',
        pageCount: 2,
        sortOrder: 1,
        fileSize: 1024,
        originalHash: 'original-hash',
        signedHash: null,
        pdfUrl: '/agreement.pdf',
        signedPdfUrl: null,
      },
    ],
    recipients: [
      {
        id: 'recipient-1',
        name: 'Client',
        type: 'SIGNER',
        status: 'VIEWED',
        signingOrder: 1,
        colorTag: '#06b6d4',
      },
    ],
    fields: [
      {
        id: 'signature-field',
        documentId: 'document-1',
        recipientId: 'recipient-1',
        type: 'SIGNATURE',
        pageNumber: 1,
        xPercent: 0.1,
        yPercent: 0.1,
        widthPercent: 0.2,
        heightPercent: 0.08,
        required: true,
        label: null,
        placeholder: null,
        sortOrder: 1,
      },
      {
        id: 'page-two-text-field',
        documentId: 'document-1',
        recipientId: 'recipient-1',
        type: 'TEXT',
        pageNumber: 2,
        xPercent: 0.1,
        yPercent: 0.1,
        widthPercent: 0.2,
        heightPercent: 0.08,
        required: true,
        label: null,
        placeholder: null,
        sortOrder: 2,
      },
    ],
    fieldValues: [],
    downloadToken: null,
    currentRecipientDeliveryStatus: 'AWAITING_COMPLETION',
  };
}

async function waitUntil(check: () => boolean, timeout = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) {
      throw new Error('Timed out waiting for the client signing document');
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
  }
}

describe('E-signing client document browser flow', () => {
  let host: HTMLDivElement;
  let root: Root;
  const session = makeSigningSession();
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
    await page.viewport(1440, 900);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/esigning/sign/browser-token')) {
          return new Response(JSON.stringify({ requiresAccessCode: false }), { status: 200 });
        }
        if (url.endsWith('/api/public-bootstrap/esigning/session')) {
          return new Response(JSON.stringify({ session }), { status: 200 });
        }
        if (url.endsWith('/api/esigning/sign/session/view')) {
          return new Response(JSON.stringify(session), { status: 200 });
        }
        throw new Error(`Unexpected browser fetch: ${url}`);
      })
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    host.remove();
  });

  it.each([
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ])(
    'scrolls through both pages and opens a page-two signing field at $width x $height',
    async ({ width, height }) => {
      await page.viewport(width, height);
      await act(async () => root.render(<EsigningSignPage />));
      await waitUntil(() => Boolean(host.querySelector('[data-testid="signing-document"]')));

      expect(host.querySelector('[data-testid="signing-document"]')).not.toBeNull();

      const previewFrame = host.querySelector<HTMLElement>('[data-testid="signing-preview-frame"]');
      const postIt = host.querySelector<HTMLElement>('[data-testid="signing-post-it"]');
      if (width < 768) {
        expect(postIt).toBeNull();
        expect(previewFrame?.classList.contains('mr-14')).toBe(false);
        await page.getByRole('button', { name: 'Sign Here' }).click();
      } else {
        expect(postIt?.style.right).toBe('-56px');
        expect(postIt?.style.left).toBe('');
        expect(postIt?.style.position).toBe('absolute');
        expect(postIt?.offsetParent).toBe(previewFrame);
        const arrows = postIt?.querySelectorAll('button');
        expect(arrows?.[0].getBoundingClientRect().width).toBe(arrows?.[2].getBoundingClientRect().width);
        await page.getByRole('button', { name: 'Sign', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Close signature editor' }).click();
      const progressHint = host.querySelector<HTMLElement>(
        '[data-testid="signature-progress-banner-signature-field"]'
      );
      expect(progressHint?.textContent).toBe('0 out of 1 signedClick to continue tonext field');
      expect(progressHint?.dataset.side).toBe('right');

      await page.getByRole('button', { name: /0 out of 1 signed/ }).click();
      await waitUntil(() => host.querySelector('[data-viewer-page]')?.getAttribute('data-viewer-page') === '2');

      const scrollContainer = host.querySelector<HTMLElement>(
        '[data-document-scroll-container="true"]'
      );
      expect(scrollContainer?.dataset.viewMode).toBe('continuous');
      expect(host.querySelectorAll('[data-document-page-number]')).toHaveLength(2);
      expect(scrollContainer?.scrollHeight).toBeGreaterThan(scrollContainer?.clientHeight ?? 0);

      const pageTwoField = host.querySelector<HTMLElement>('[aria-label="Fill In"]');
      expect(pageTwoField).not.toBeNull();
      await act(async () => pageTwoField?.click());
      expect(host.querySelector('[data-testid="active-field-input"]')?.textContent).toBe(
        'page-two-text-field'
      );
    }
  );
});
