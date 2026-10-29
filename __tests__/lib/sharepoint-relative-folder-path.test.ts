import { describe, expect, it } from 'vitest';
import { parseSharePointRelativeFolderPath } from '@/lib/sharepoint/relative-folder-path';

describe('SharePoint relative folder paths', () => {
  it('normalizes nested whitespace and separators', () => expect(parseSharePointRelativeFolderPath('  Agreements\\ 2026 / Signed  ').normalized).toBe('Agreements/2026/Signed'));
  it.each(['', '/root', 'root/', 'C:/root', '\\\\server\\share', 'https://example.test/folder', 'a//b', '../b', 'a/./b', 'bad:name', 'trailing.', 'a\u0000b'])('rejects unsafe path %s', (value) => expect(() => parseSharePointRelativeFolderPath(value)).toThrow());
  it('enforces both segment and full-path limits', () => {
    expect(() => parseSharePointRelativeFolderPath('x'.repeat(256))).toThrow();
    expect(() => parseSharePointRelativeFolderPath(Array.from({ length: 10 }, () => 'x'.repeat(40)).join('/'))).toThrow();
  });
});
