// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  storage: {},
}));

const {
  ESIGNING_RENDERER_VERSION,
  EsigningArtifactError,
  SOURCE_DIGEST_MISMATCH_PREFIX,
  formatSourceDigestMismatchMessage,
  isSourceDigestMismatchMessage,
  mergeIssuedPdfs,
} = await import('@/services/esigning-issued-artifacts');
const { CERTIFICATE_VERIFICATION_COPY, renderEsigningCertificatePdf } = await import(
  '@/services/esigning-certificate-pdf.renderer'
);

async function onePage(width: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage([width, 500]);
  return Buffer.from(await pdf.save());
}

describe('mergeIssuedPdfs', () => {
  it('puts the signed document before its certificate', async () => {
    const merged = await mergeIssuedPdfs([await onePage(401), await onePage(601)], new Date('2026-10-30T00:00:00Z'));
    const pdf = await PDFDocument.load(new Uint8Array(merged));

    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize().width).toBe(401);
    expect(pdf.getPage(1).getSize().width).toBe(601);
  });

  it('produces the same bytes for the same inputs regardless of when it runs', async () => {
    const inputs = [await onePage(401), await onePage(601)];
    const issuedAt = new Date('2026-10-30T00:00:00Z');

    const first = await mergeIssuedPdfs(inputs, issuedAt);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await mergeIssuedPdfs(inputs, issuedAt);

    expect(second.equals(first)).toBe(true);
  });
});

describe('source digest failures', () => {
  it('are typed and recognisable from the stored error text', () => {
    const message = formatSourceDigestMismatchMessage('agreement.pdf');
    const error = new EsigningArtifactError('SOURCE_DIGEST_MISMATCH', message, { documentId: 'd1' });

    expect(error.code).toBe('SOURCE_DIGEST_MISMATCH');
    expect(error.details).toEqual({ documentId: 'd1' });
    expect(message.startsWith(SOURCE_DIGEST_MISMATCH_PREFIX)).toBe(true);
    expect(message).toContain('agreement.pdf');
    expect(isSourceDigestMismatchMessage(message)).toBe(true);
    expect(isSourceDigestMismatchMessage('WinAnsi cannot encode "x"')).toBe(false);
    expect(isSourceDigestMismatchMessage(null)).toBe(false);
  });

  it('records the renderer version a row was produced with', () => {
    expect(Number.isInteger(ESIGNING_RENDERER_VERSION)).toBe(true);
  });
});

describe('certificate verification wording', () => {
  const at = (iso: string) => new Date(iso);
  const envelope = {
    id: 'env1',
    title: 'Services Agreement',
    status: 'COMPLETED',
    certificateId: 'OAK-ES-20261030-ABCDEF',
    completedAt: at('2026-10-30T03:05:00Z'),
    company: { id: 'c1', name: 'Oaktree Pte Ltd' },
    tenant: { id: 't1', name: 'Oaktree' },
    createdBy: { firstName: 'Jonathan', lastName: 'Reyes', email: 'jonathan@example.com' },
    recipients: [
      {
        id: 'r1',
        name: 'Priya Rao',
        email: 'priya@example.org',
        status: 'SIGNED',
        viewedAt: at('2026-10-30T02:00:00Z'),
        consentedAt: at('2026-10-30T02:01:00Z'),
        signedAt: at('2026-10-30T02:05:00Z'),
        consentIp: '203.0.113.24',
        consentUserAgent: 'Mozilla/5.0 Chrome/126',
        signedIp: '203.0.113.24',
        signedUserAgent: 'Mozilla/5.0 Chrome/126',
      },
    ],
    events: [
      { id: 'e1', action: 'CREATED', recipientId: null, createdAt: at('2026-10-30T01:00:00Z') },
      { id: 'e2', action: 'SIGNED', recipientId: 'r1', createdAt: at('2026-10-30T02:05:00Z') },
    ],
    documents: [],
    fieldDefinitions: [],
    fieldValues: [],
  };

  async function renderedTextItems() {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bytes = await renderEsigningCertificatePdf({ envelope: envelope as any });
    const pdf = await getDocument({
      data: new Uint8Array(bytes),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
    const items: Array<{ str: string; x: number; width: number; y: number }> = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      for (const item of content.items) {
        if ('str' in item && item.str.trim()) {
          items.push({ str: item.str, x: item.transform[4], width: item.width, y: item.transform[5] });
        }
      }
    }
    await pdf.destroy();
    return items;
  }

  it('describes what the upload check does and never claims tamper-evidence', async () => {
    const items = await renderedTextItems();
    const text = items.map((item) => item.str).join(' ').replace(/\s+/g, ' ');

    expect(CERTIFICATE_VERIFICATION_COPY).toBe(
      'This certificate records the signing process. Upload a copy at the link below to compare it with the fingerprints recorded at issue.',
    );
    expect(text).toContain(CERTIFICATE_VERIFICATION_COPY);
    expect(text.toLowerCase()).not.toContain('tamper');
  });

  it('renders the wording on ONE line, left of the QR code', async () => {
    const items = await renderedTextItems();
    const lines = items.filter((item) => CERTIFICATE_VERIFICATION_COPY.includes(item.str.trim()) && item.str.trim().length > 10);
    const qrLeft = (210 - 9 - 18) * (72 / 25.4);

    // The whole sentence is a single text run on a single baseline: it did not wrap.
    expect(lines).toHaveLength(1);
    expect(lines[0].str.trim()).toBe(CERTIFICATE_VERIFICATION_COPY);
    expect(lines[0].x + lines[0].width).toBeLessThanOrEqual(qrLeft);
    // And the verification URL sits on the next line, so nothing is pushed down by a second copy line.
    const urlLine = items.find((item) => item.str.includes('/verify/'));
    expect(urlLine).toBeDefined();
    expect(lines[0].y - (urlLine as { y: number }).y).toBeLessThan(20);
  });
});
