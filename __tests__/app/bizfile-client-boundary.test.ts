import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CLIENT_BIZFILE_FILES = [
  'src/app/(dashboard)/companies/upload/page.tsx',
  'src/components/companies/bizfile-review/bizfile-review-workspace.tsx',
] as const;

describe('BizFile client boundary', () => {
  it('imports shared BizFile values and types without loading the server barrel', () => {
    for (const file of CLIENT_BIZFILE_FILES) {
      const source = readFileSync(file, 'utf8');

      expect(source).not.toMatch(/from\s+["']@\/services\/bizfile["']/u);
    }
  });
});
