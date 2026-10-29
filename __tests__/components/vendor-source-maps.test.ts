import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('vendored JavaScript source maps', () => {
  it('does not reference source-map files that are missing', async () => {
    const vendorDirectory = path.resolve(process.cwd(), 'src/lib/vendor');
    const vendorFiles = (await readdir(vendorDirectory)).filter((fileName) =>
      fileName.endsWith('.js')
    );
    const unresolvedReferences: string[] = [];

    for (const fileName of vendorFiles) {
      const filePath = path.join(vendorDirectory, fileName);
      const source = await readFile(filePath, 'utf8');
      const sourceMapReferences = source.matchAll(/^\/\/# sourceMappingURL=(.+)$/gm);

      for (const match of sourceMapReferences) {
        const reference = match[1].trim();
        if (reference.startsWith('data:') || URL.canParse(reference)) {
          continue;
        }

        try {
          await access(path.resolve(path.dirname(filePath), reference));
        } catch {
          unresolvedReferences.push(`${fileName} -> ${reference}`);
        }
      }
    }

    expect(unresolvedReferences).toEqual([]);
  });
});
