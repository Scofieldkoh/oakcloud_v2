import { describe, expect, it } from 'vitest';
import { preferredSignedDocumentFileName, signedDocumentFilenameCandidate } from '@/services/esigning-sharepoint-filing/filename';

describe('signed SharePoint filenames', () => {
  it('is deterministic and safe', () => {
    const value = preferredSignedDocumentFileName({ documentTitle: 'Agreement: Final.pdf' });
    expect(value).toBe('Agreement Final_signed.pdf');
    expect(value).not.toMatch(/["*:<>?|\\/]/);
  });
  it('preserves the source filename and adds the signed suffix once', () => {
    expect(preferredSignedDocumentFileName({ documentTitle: 'engagement_signed.pdf' })).toBe('engagement_signed.pdf');
  });
  it('uses controlled numbered suffixes', () => expect(signedDocumentFilenameCandidate('document.pdf', 2)).toBe('document (2).pdf'));
});
