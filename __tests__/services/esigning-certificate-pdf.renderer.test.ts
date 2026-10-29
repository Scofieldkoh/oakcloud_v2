import { describe, expect, it } from 'vitest';
import {
  formatCertificatePageNumber,
  getLatestCertificateRecipientActivity,
} from '@/services/esigning-certificate-pdf.renderer';

describe('e-signing certificate renderer helpers', () => {
  it('uses the latest matching recipient activity when an event occurs more than once', () => {
    const earlier = new Date('2026-09-18T01:00:00.000Z');
    const later = new Date('2026-09-18T02:00:00.000Z');
    const latest = getLatestCertificateRecipientActivity(
      [
        { action: 'VIEWED', recipientId: 'recipient-1', createdAt: earlier, metadata: { ipAddress: '1.1.1.1' } },
        { action: 'VIEWED', recipientId: 'recipient-2', createdAt: new Date('2026-09-18T03:00:00.000Z') },
        { action: 'VIEWED', recipientId: 'recipient-1', createdAt: later, metadata: { ipAddress: '2.2.2.2' } },
      ],
      'recipient-1',
      'VIEWED',
    );

    expect(latest?.createdAt).toEqual(later);
    expect(latest?.metadata).toEqual({ ipAddress: '2.2.2.2' });
  });

  it('formats the footer page number using current page over total pages', () => {
    expect(formatCertificatePageNumber(0, 1)).toBe('1 / 1');
    expect(formatCertificatePageNumber(1, 3)).toBe('2 / 3');
  });
});
