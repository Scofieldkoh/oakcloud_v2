// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { extractPdfPageTexts } from '../helpers/pdf-text';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import { renderEsigningCertificatePdf } from '@/services/esigning-certificate-pdf.renderer';

const at = (iso: string) => new Date(iso);

function signer(id: string, name: string) {
  return {
    id,
    name,
    email: `${id}@example.com`,
    type: 'SIGNER',
    status: 'SIGNED',
    viewedAt: at('2026-08-02T02:00:00Z'),
    consentedAt: at('2026-08-02T02:01:00Z'),
    signedAt: at('2026-08-02T02:05:00Z'),
    consentIp: '198.51.100.7',
    consentUserAgent: 'Mozilla/5.0 (Macintosh) Chrome/126',
    signedIp: '198.51.100.7',
    signedUserAgent: 'Mozilla/5.0 (Macintosh) Chrome/126',
  };
}

function buildInput(recipients: ReturnType<typeof signer>[], documentName = '服务协议 2026.pdf') {
  return {
    envelope: {
      title: 'Services Agreement',
      status: 'COMPLETED',
      certificateId: 'OAK-ES-20260802-4F9A2C',
      completedAt: at('2026-08-02T03:05:00Z'),
      company: { name: 'Oaktree Pte Ltd' },
      tenant: { name: 'Oaktree' },
      recipients,
      events: recipients.map((recipient, index) => ({
        id: `e${index}`,
        action: 'SIGNED',
        recipientId: recipient.id,
        createdAt: at('2026-08-02T02:05:00Z'),
      })),
      documents: [{ fileName: documentName, originalFileName: documentName }],
    },
  };
}

describe('certificate of completion with non-Latin text', () => {
  it('prints Latin, Vietnamese and CJK recipient names instead of "?"', async () => {
    const buffer = await renderEsigningCertificatePdf(
      buildInput([
        signer('r1', 'John Tan'),
        signer('r2', 'Tan Wei Ming 陈伟明'),
        signer('r3', 'Nguyễn Văn A'),
      ])
    );

    expect((await PDFDocument.load(new Uint8Array(buffer))).getPageCount()).toBeGreaterThanOrEqual(1);
    const text = (await extractPdfPageTexts(new Uint8Array(buffer))).join('\n');
    expect(text).toContain('John Tan');
    expect(text).toContain('Tan Wei Ming 陈伟明');
    expect(text).toContain('Nguyễn Văn A');
    expect(text).toContain('服务协议 2026.pdf');
  });

  it('still renders (as "?") a character none of the bundled fonts has', async () => {
    const buffer = await renderEsigningCertificatePdf(buildInput([signer('r1', 'Wei 😀 Chen')]));
    const text = (await extractPdfPageTexts(new Uint8Array(buffer))).join('\n');
    expect(text).toContain('Wei ? Chen');
  });

  it('keeps pure Latin certificates on Helvetica without embedding the CJK glyphs', async () => {
    const buffer = await renderEsigningCertificatePdf(buildInput([signer('r1', 'John Tan')], 'agreement.pdf'));
    // The subset fonts are embedded but empty when no non-Latin text is drawn.
    expect(buffer.byteLength).toBeLessThan(60 * 1024);
    expect((await extractPdfPageTexts(new Uint8Array(buffer))).join('\n')).toContain('John Tan');
  });
});
