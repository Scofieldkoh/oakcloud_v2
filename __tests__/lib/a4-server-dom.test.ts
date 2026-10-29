import { afterEach, describe, expect, it } from 'vitest';

import { ensureA4ServerDomGlobals } from '@/lib/document-editor/a4-server-dom';

const originalXmlSerializer = Object.getOwnPropertyDescriptor(globalThis, 'XMLSerializer');

afterEach(() => {
  if (originalXmlSerializer) {
    Object.defineProperty(globalThis, 'XMLSerializer', originalXmlSerializer);
  } else {
    Reflect.deleteProperty(globalThis, 'XMLSerializer');
  }
});

describe('server DOM globals', () => {
  it('installs XMLSerializer when the server runtime does not provide it', () => {
    Object.defineProperty(globalThis, 'XMLSerializer', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    ensureA4ServerDomGlobals();

    expect(typeof XMLSerializer).toBe('function');
    const xml = new DOMParser().parseFromString(
      '<root><child>ok</child></root>',
      'application/xml',
    );
    expect(new XMLSerializer().serializeToString(xml)).toContain('<child>ok</child>');
  });
});
