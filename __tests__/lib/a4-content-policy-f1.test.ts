import { describe, expect, it } from 'vitest';

import {
  A4_SEMANTIC_PAGE_BREAK_HTML,
  C06_TRUSTED_RICH_ORIGINS,
  createDeclarativeFieldContentFragment,
  createTrustedRichContentFragment,
  getA4SanitizerPolicy,
  isA4AlwaysRejectedTag,
  isA4CanonicalAttribute,
  isA4CanonicalTag,
  isA4ProjectionOnlyAttribute,
  type TrustedRichOrigin,
} from '@/lib/a4-content-policy';

describe('FIELDS F1 C06 production boundary', () => {
  it('retains authored semantic structures and the exact C03 break', () => {
    for (const tag of ['blockquote', 'caption', 'tfoot', 'sup', 'sub', 'table', 'ol', 'li']) {
      expect(isA4CanonicalTag(tag)).toBe(true);
    }
    for (const attribute of ['start', 'scope', 'colspan', 'rowspan', 'data-a4-break']) {
      expect(isA4CanonicalAttribute(attribute)).toBe(true);
    }
    expect(A4_SEMANTIC_PAGE_BREAK_HTML).toBe('<span data-a4-break="page"></span>');
  });

  it('keeps projection-only flow metadata outside canonical storage', () => {
    expect(isA4ProjectionOnlyAttribute('data-flow-id')).toBe(true);
    expect(isA4ProjectionOnlyAttribute('data-flow-future')).toBe(true);
    expect(isA4CanonicalAttribute('data-flow-id')).toBe(false);
  });

  it('excludes executable and form markup from the shared policy', () => {
    const policy = getA4SanitizerPolicy();
    for (const tag of ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button']) {
      expect(isA4AlwaysRejectedTag(tag)).toBe(true);
      expect(policy.allowedTags).not.toContain(tag);
    }
  });

  it('does not mint trusted-rich authority from stored/client/token metadata', () => {
    expect(createDeclarativeFieldContentFragment({
      value: '<strong>ordinary</strong>',
      renderMode: 'trusted-rich',
      clientMetadata: { trusted: true },
      tokenMetadata: { 'data-render-mode': 'trusted-rich' },
    })).toEqual({ kind: 'text', value: '<strong>ordinary</strong>', multiline: false });

    const spoof = { name: 'canonical-builder' } as unknown as TrustedRichOrigin;
    expect(() => createTrustedRichContentFragment({ html: '<b>x</b>', origin: spoof })).toThrow();
    expect(createTrustedRichContentFragment({
      html: '<strong>canonical</strong>',
      origin: C06_TRUSTED_RICH_ORIGINS.canonicalBuilder,
    }).kind).toBe('trusted-rich');
  });
});
