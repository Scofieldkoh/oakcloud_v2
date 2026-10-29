import { describe, expect, it } from 'vitest';

import {
  detectOfficeDocumentType,
  getPdfFileNameForUpload,
} from '@/lib/office-conversion';

function makeDocxBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('fake zip content [Content_Types].xml word/document.xml'),
  ]);
}

function makeDocBuffer(): Buffer {
  return Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
}

describe('office-conversion', () => {
  it('detects OOXML Word documents by content', () => {
    expect(
      detectOfficeDocumentType(
        makeDocxBuffer(),
        'spoofed.pdf',
        'application/pdf'
      )
    ).toBe('docx');
  });

  it('detects legacy Word documents by content', () => {
    expect(
      detectOfficeDocumentType(
        makeDocBuffer(),
        'document.doc',
        'application/msword'
      )
    ).toBe('doc');
  });

  it('returns pdf for real PDF content', () => {
    expect(
      detectOfficeDocumentType(
        Buffer.from('%PDF-1.7\n'),
        'document.pdf',
        'application/pdf'
      )
    ).toBe('pdf');
  });

  it('normalizes converted Word upload names to PDF filenames', () => {
    expect(getPdfFileNameForUpload('Engagement Letter.docx')).toBe('Engagement Letter.pdf');
    expect(getPdfFileNameForUpload('resolution')).toBe('resolution.pdf');
  });
});
