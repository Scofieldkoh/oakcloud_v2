import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  createPreviewFingerprint,
  createReviewedFingerprint,
} from '@/lib/document-generation-fingerprint';

describe('document generation fingerprints', () => {
  it('sorts object keys recursively and preserves array order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 1 } })).toBe('{"a":{"c":1,"d":2},"b":1}');
    expect(canonicalJson([{ z: 1, y: 2 }, { x: 3 }])).toBe(
      '[{"y":2,"z":1},{"x":3}]',
    );
    expect(canonicalJson(['b', 'a'])).not.toBe(canonicalJson(['a', 'b']));
  });

  it('creates deterministic preview fingerprints', () => {
    const input = {
      templateId: 'template-a',
      templateVersion: 2,
      partials: [{ name: 'block', version: 1, updatedAt: '2026-01-01T00:00:00.000Z' }],
      primaryCompanyId: 'company-1',
      contactIds: ['contact-1'],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      effectiveCustomData: { reference: 'A' },
      itemValues: {},
      useLetterhead: true,
    };
    const first = createPreviewFingerprint(input);
    const second = createPreviewFingerprint({ ...input, effectiveCustomData: { reference: 'A' } });
    const changed = createPreviewFingerprint({ ...input, useLetterhead: false });

    expect(first).toHaveLength(64);
    expect(first).toBe(second);
    expect(first).not.toBe(changed);
  });

  it('binds review to preview inputs and persisted editor content', () => {
    const fingerprint = createReviewedFingerprint({
      previewFingerprint: 'preview-hash',
      editedContent: '<p>edited</p>',
      editedContentJson: { type: 'doc' },
    });
    expect(fingerprint).toBe(createReviewedFingerprint({
      previewFingerprint: 'preview-hash',
      editedContent: '<p>edited</p>',
      editedContentJson: { type: 'doc' },
    }));
    expect(fingerprint).not.toBe(createReviewedFingerprint({
      previewFingerprint: 'preview-hash',
      editedContent: '<p>different</p>',
      editedContentJson: { type: 'doc' },
    }));
  });
});
