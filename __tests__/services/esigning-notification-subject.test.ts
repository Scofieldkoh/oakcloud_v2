import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.hoisted(() => vi.fn());

vi.mock('@/lib/email', () => ({
  getAppBaseUrl: () => 'https://app.example.com',
  sendEmail,
}));
vi.mock('@/lib/esigning-session', () => ({
  buildEsigningVerificationUrl: (certificateId: string) => `https://app.example.com/verify/${certificateId}`,
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import {
  sendEsigningCompletionEmail,
  sendEsigningRequestEmail,
} from '@/services/esigning-notification.service';

describe('e-signing email subject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockResolvedValue({ success: true, messageId: 'message-1' });
  });

  it('uses the independent email subject for request and reminder messages', async () => {
    const input = {
      to: 'client@example.com',
      recipientName: 'Client',
      senderName: 'Sender',
      envelopeTitle: 'Internal envelope name',
      emailSubject: 'Please sign the client agreement',
      message: 'Please review this document.',
      signingUrl: 'https://app.example.com/sign/token-1',
      accessMode: 'EMAIL_LINK' as const,
      kind: 'request' as const,
    };

    await sendEsigningRequestEmail(input);

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: '[Oakcloud] "Please sign the client agreement" — signature requested by Sender',
    }));

    await sendEsigningRequestEmail({ ...input, kind: 'reminder' });

    expect(sendEmail).toHaveBeenLastCalledWith(expect.objectContaining({
      subject: '[Oakcloud] Reminder: "Please sign the client agreement" awaits your signature',
    }));
  });

  it('passes completion BCC recipients to the email transport without a visible To recipient', async () => {
    await sendEsigningCompletionEmail({
      bcc: 'ops@example.com',
      recipientName: 'there',
      envelopeTitle: 'NDA',
      certificateId: 'certificate-1',
      documentLinks: [],
    });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: undefined,
      bcc: 'ops@example.com',
    }));
  });

  it('provides Outlook-safe table fallbacks and a plain-text completion alternative', async () => {
    await sendEsigningCompletionEmail({
      to: 'signer@example.com',
      recipientName: 'Signer',
      envelopeTitle: 'NDA',
      certificateId: 'certificate-1',
      documentLinks: [{
        label: 'nda.pdf',
        signedUrl: 'https://app.example.com/signed?token=abc&documentId=doc-1',
        certificateUrl: 'https://app.example.com/certificate?token=abc&documentId=doc-1',
      }],
    });

    const message = sendEmail.mock.calls[0][0] as { html: string; text: string };
    expect(message.html).toContain('<!--[if mso]>');
    expect(message.html).toContain('border-collapse:collapse');
    expect(message.html).toContain('nda.pdf');
    expect(message.html).toContain('Oaktree Accounting &amp; Corporate Solutions');
    expect(message.html).not.toContain('View Verification Record');
    expect(message.html).not.toContain('Document Certificate ID');
    expect(message.html).not.toContain('https://app.example.com/signed');
    expect(message.html).not.toContain('https://app.example.com/certificate');
    expect(message.html).not.toContain('/verify/');
    expect(message.text).toContain('NDA');
    expect(message.text).toContain('Oaktree Accounting & Corporate Solutions');
    expect(message.text).not.toContain('certificate-1');
    expect(message.text).not.toContain('https://');
    expect(message.text).not.toContain('<table');
  });
});
