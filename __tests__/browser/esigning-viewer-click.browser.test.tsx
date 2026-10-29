import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { DocumentPageViewer } from '@/components/processing/document-page-viewer';
import '@/app/globals.css';

vi.mock('@/hooks/use-processing-documents', () => ({
  useDocumentPages: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  useAppendPages: () => ({ appendPages: vi.fn(), isAppending: false }),
  useReorderPages: () => ({ reorderPages: vi.fn(), isReordering: false }),
  useDeletePages: () => ({ deletePages: vi.fn(), isDeleting: false }),
}));
vi.mock('@/hooks/use-media-query', () => ({ useIsMobile: () => false }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({
    numPages: 2,
    getPage: async () => ({
      getViewport: () => ({ width: 600, height: 700 }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      getTextContent: async () => ({ items: [] }),
    }),
    destroy: vi.fn(),
  }) }),
}));

it.each(['single', 'continuous'] as const)(
  'allows pointer clicks through decorative signing overlays in %s view',
  async (viewMode) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onSign = vi.fn();
    const onNext = vi.fn();
    try {
      await page.viewport(1000, 900);
      await act(async () => root.render(
        <DocumentPageViewer
          pdfUrl="/signing-click.pdf"
          viewMode={viewMode}
          className="h-[800px]"
          pageOverlayInteractive={false}
          showPageSideNavigation={false}
          showHighlightsToggle={false}
          renderPageOverlay={({ pageNumber }) => pageNumber === 1 ? (
            <button onClick={onNext} style={{ pointerEvents: 'auto', position: 'absolute', top: 240 }}>Continue to next field</button>
          ) : null}
          highlights={[{ pageNumber: 1, x: 0.2, y: 0.2, width: 0.3, height: 0.1, label: 'signature' }]}
          renderHighlightContent={() => <button onClick={onSign} style={{ width: '100%', height: '100%' }}>Sign here</button>}
        />
      ));
      await page.getByRole('button', { name: 'Sign here' }).click();
      expect(onSign).toHaveBeenCalledOnce();
      await page.getByRole('button', { name: 'Continue to next field' }).click();
      expect(onNext).toHaveBeenCalledOnce();
      expect(host.querySelector('button.sticky')).toBeNull();
      expect(host.querySelector('[title="Hide bounding boxes"]')).toBeNull();
      expect(host.querySelector('[data-document-scroll-container]')?.className).not.toContain('cursor-grabbing');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  }
);
