import { describe, expect, it } from 'vitest';
import { generatedDocumentPdfFileName } from '@/lib/generated-document-filename';

describe('generatedDocumentPdfFileName', () => {
  it('uses the same safe title and UTC date format as generated-document PDF exports', () => {
    expect(generatedDocumentPdfFileName(
      'Board Resolution / FY 2026',
      new Date('2026-08-29T01:00:00.000Z'),
    )).toBe('board-resolution-fy-2026-2026-08-29.pdf');
  });
});
