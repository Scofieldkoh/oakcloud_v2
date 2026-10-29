import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/storage', () => ({ storage: {}, StorageKeys: {} }));
vi.mock('@/lib/encryption', () => ({ hashBlake3: () => 'hash' }));
vi.mock('@/services/esigning-notification.service', () => ({
  sendEsigningPdfFailureEmailToSender: vi.fn(),
}));
vi.mock('@/services/esigning-email-delivery.service', () => ({
  recordEsigningEnvelopeEmailDeliveryResults: vi.fn(),
  withEsigningDeliveryTarget: vi.fn(),
}));

const {
  buildCertificatePdf,
  buildEmailAttachments,
  composeEsigningDocumentPackage,
  composeEsigningEnvelopePackage,
  mergePdfBuffers,
} = await import('@/services/esigning-pdf.service');

function at(iso: string) {
  return new Date(iso);
}

function buildEnvelope(overrides: Record<string, unknown> = {}) {
  const recipients = [
    {
      id: 'r1',
      name: 'Alexandra Fitzgerald-Montgomery',
      email: 'alexandra.fitzgerald@averylongcompanydomain.example.com',
      status: 'SIGNED',
      viewedAt: at('2026-08-01T09:12:00Z'),
      consentedAt: at('2026-08-01T09:13:00Z'),
      signedAt: at('2026-08-01T09:20:00Z'),
      consentIp: '203.0.113.24',
      consentUserAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      signedIp: '203.0.113.24',
      signedUserAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    },
    {
      id: 'r2',
      name: 'Priya Raghunathan',
      email: 'priya@example.org',
      status: 'PENDING',
      viewedAt: null,
      consentedAt: null,
      signedAt: null,
      consentIp: null,
      consentUserAgent: null,
      signedIp: null,
      signedUserAgent: null,
    },
  ];

  const events = [
    { id: 'e1', action: 'CREATED', recipientId: null, createdAt: at('2026-08-01T08:00:00Z') },
    { id: 'e2', action: 'SENT', recipientId: 'r1', createdAt: at('2026-08-01T08:01:00Z') },
    { id: 'e3', action: 'VIEWED', recipientId: 'r1', createdAt: at('2026-08-01T09:12:00Z') },
    { id: 'e4', action: 'CONSENTED', recipientId: 'r1', createdAt: at('2026-08-01T09:13:00Z') },
    { id: 'e5', action: 'SIGNED', recipientId: 'r1', createdAt: at('2026-08-01T09:20:00Z') },
  ];

  return {
    id: 'env1',
    title: 'Master Services Agreement and Statement of Work 2026',
    status: 'COMPLETED',
    certificateId: 'OAK-ES-20260802-4F9A2C',
    completedAt: at('2026-08-02T03:05:00Z'),
    company: { id: 'c1', name: 'Oaktree Accounting & Corporate Solutions Pte Ltd' },
    tenant: { id: 't1', name: 'Oaktree' },
    createdBy: { firstName: 'Jonathan', lastName: 'Reyes', email: 'jonathan@example.com' },
    recipients,
    events,
    documents: [],
    fieldDefinitions: [],
    fieldValues: [],
    ...overrides,
  };
}

const documentFixture = {
  id: 'd1',
  fileName: 'master-services-agreement-2026-final-execution-copy.pdf',
  originalHash: 'a3f1c9d2e4b5768900112233445566778899aabbccddeeff00112233445566778899aabb',
  signedHash: 'ff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff001122',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
async function render(envelope: unknown, document: unknown = documentFixture) {
  return buildCertificatePdf({ envelope: envelope as any, document: document as any });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('buildCertificatePdf', () => {
  it('renders an A4 certificate with document metadata', async () => {
    const buffer = await render(buildEnvelope());

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');

    const pdf = await PDFDocument.load(new Uint8Array(buffer));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdf.getTitle()).toContain('Certificate of Completion');
    expect(pdf.getCreator()).toBe('OakCloud e-Sign');
    expect(pdf.getAuthor()).toBe('Oaktree Accounting & Corporate Solutions Pte Ltd');

    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('does not throw on names outside the WinAnsi range', async () => {
    const envelope = buildEnvelope({
      title: '\u670D\u52D9\u5951\u7D04\u66F8 \u2014 2026',
      recipients: [
        {
          id: 'r1',
          name: '\u9648\u4F1F \uD83D\uDE00',
          email: 'wei.chen@example.com',
          status: 'SIGNED',
          viewedAt: at('2026-08-02T02:00:00Z'),
          consentedAt: at('2026-08-02T02:01:00Z'),
          signedAt: at('2026-08-02T02:05:00Z'),
          consentIp: '198.51.100.7',
          consentUserAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile Safari/604.1',
          signedIp: '198.51.100.7',
          signedUserAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile Safari/604.1',
        },
      ],
      events: [
        { id: 'e1', action: 'CREATED', recipientId: null, createdAt: at('2026-08-02T01:00:00Z') },
        { id: 'e2', action: 'SIGNED', recipientId: 'r1', createdAt: at('2026-08-02T02:05:00Z') },
      ],
    });

    await expect(render(envelope)).resolves.toBeInstanceOf(Buffer);
  });

  it('paginates long audit trails and keeps every page footer-safe', async () => {
    const events = Array.from({ length: 80 }, (_, index) => ({
      id: `e${index}`,
      action: index % 2 === 0 ? 'VIEWED' : 'SIGNED',
      recipientId: 'r1',
      createdAt: at(`2026-08-01T09:${String(index % 60).padStart(2, '0')}:00Z`),
    }));

    const buffer = await render(buildEnvelope({ events }));
    const pdf = await PDFDocument.load(new Uint8Array(buffer));

    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });

  it('flags a missing signed hash instead of failing', async () => {
    await expect(
      render(buildEnvelope(), { ...documentFixture, signedHash: null }),
    ).resolves.toBeInstanceOf(Buffer);
  });
});

describe('mergePdfBuffers', () => {
  it('keeps the signed document before its certificate', async () => {
    const signedDocument = await PDFDocument.create();
    signedDocument.addPage([400, 500]);
    const certificate = await PDFDocument.create();
    certificate.addPage([600, 700]);
    certificate.addPage([600, 700]);

    const merged = await mergePdfBuffers([
      new Uint8Array(await signedDocument.save()),
      new Uint8Array(await certificate.save()),
    ]);
    const mergedPdf = await PDFDocument.load(new Uint8Array(merged));

    expect(mergedPdf.getPageCount()).toBe(3);
    expect(mergedPdf.getPage(0).getSize()).toMatchObject({ width: 400, height: 500 });
    expect(mergedPdf.getPage(1).getSize()).toMatchObject({ width: 600, height: 700 });
  });
});

describe('composeEsigningDocumentPackage', () => {
  it('places exactly one envelope certificate after the selected signed document', async () => {
    const signedDocument = await PDFDocument.create();
    signedDocument.addPage([401, 500]);
    const certificate = await PDFDocument.create();
    certificate.addPage([601, 700]);

    const buffer = await composeEsigningDocumentPackage({
      signedBuffer: Buffer.from(await signedDocument.save()),
      certificateBuffer: Buffer.from(await certificate.save()),
    });
    const pdf = await PDFDocument.load(new Uint8Array(buffer));

    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize().width).toBe(401);
    expect(pdf.getPage(1).getSize().width).toBe(601);
  });
});

describe('composeEsigningEnvelopePackage', () => {
  async function onePage(width: number): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.addPage([width, 500]);
    return Buffer.from(await pdf.save());
  }

  it('appends one envelope certificate after all signed documents', async () => {
    const signedA = await onePage(401);
    const signedB = await onePage(402);
    const certificate = await onePage(601);

    const buffer = await composeEsigningEnvelopePackage({
      variant: 'documents_with_certificates',
      signedBuffers: [signedA, signedB],
      certificateBuffer: certificate,
    });
    const pdf = await PDFDocument.load(new Uint8Array(buffer));

    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getPage(0).getSize().width).toBe(401);
    expect(pdf.getPage(1).getSize().width).toBe(402);
    expect(pdf.getPage(2).getSize().width).toBe(601);
  });

  it('returns exactly one certificate regardless of document count', async () => {
    const signedBuffers = await Promise.all(
      Array.from({ length: 10 }, (_, index) => onePage(400 + index))
    );
    const certificate = await onePage(601);

    const buffer = await composeEsigningEnvelopePackage({
      variant: 'certificates',
      signedBuffers,
      certificateBuffer: certificate,
    });
    const pdf = await PDFDocument.load(new Uint8Array(buffer));

    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize().width).toBe(601);
  });

  it('returns all signed documents without a certificate for document-only', async () => {
    const signedA = await onePage(401);
    const signedB = await onePage(402);
    const certificate = await onePage(601);

    const buffer = await composeEsigningEnvelopePackage({
      variant: 'documents',
      signedBuffers: [signedA, signedB],
      certificateBuffer: certificate,
    });
    const pdf = await PDFDocument.load(new Uint8Array(buffer));

    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize().width).toBe(401);
    expect(pdf.getPage(1).getSize().width).toBe(402);
  });
});

describe('buildEmailAttachments', () => {
  it('attaches each signed PDF with its certificate appended', async () => {
    const signedDocument = await PDFDocument.create();
    signedDocument.addPage([400, 500]);
    const certificate = await PDFDocument.create();
    certificate.addPage([600, 700]);
    certificate.addPage([600, 700]);

    const attachments = await buildEmailAttachments({
      documents: [{
        fileName: 'agreement.pdf',
        signedBuffer: Buffer.from(await signedDocument.save()),
        certificateBuffer: Buffer.from(await certificate.save()),
      }],
    });

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      filename: 'agreement-signed.pdf',
      contentType: 'application/pdf',
    });
    const attachedPdf = await PDFDocument.load(new Uint8Array(attachments[0].content));
    expect(attachedPdf.getPageCount()).toBe(3);
    expect(attachedPdf.getPage(0).getSize()).toMatchObject({ width: 400, height: 500 });
    expect(attachedPdf.getPage(1).getSize()).toMatchObject({ width: 600, height: 700 });
  });
});
