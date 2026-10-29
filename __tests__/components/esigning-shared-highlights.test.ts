import { describe, expect, it } from 'vitest';
import { buildFieldHighlights } from '@/components/esigning/esigning-shared';

const recipients = [
  { id: 'r1', colorTag: '#1d4ed8' },
  { id: 'r2', colorTag: '#9333ea' },
] as never;

const fields = [
  { id: 'f1', recipientId: 'r1', documentId: 'd1', pageNumber: 2, xPercent: 0.1, yPercent: 0.1, widthPercent: 0.2, heightPercent: 0.05, type: 'SIGNATURE' },
  { id: 'f2', recipientId: 'r2', documentId: 'd1', pageNumber: 2, xPercent: 0.1, yPercent: 0.5, widthPercent: 0.2, heightPercent: 0.05, type: 'SIGNATURE' },
] as never;

describe('buildFieldHighlights', () => {
  it('keeps each field in its signer colour, including the active field', () => {
    const result = buildFieldHighlights(fields, recipients, 'd1', 'f1');
    expect(result.map((h) => h.color)).toEqual(['#1d4ed8', '#9333ea']);
  });

  it('marks only the active field as active', () => {
    const result = buildFieldHighlights(fields, recipients, 'd1', 'f1');
    expect(result.map((h) => h.active)).toEqual([true, false]);
  });
});
