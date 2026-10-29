import { describe, expect, it } from 'vitest';

import { normalizeGeneratedText } from '../../scripts/normalize-generated-prisma.mjs';

describe('generated Prisma normalization', () => {
  it('removes trailing whitespace and leaves exactly one final newline', () => {
    expect(
      normalizeGeneratedText('export const value = 1;   \r\n\r\n'),
    ).toBe('export const value = 1;\n');
  });
});
