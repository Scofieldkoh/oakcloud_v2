import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Shared Documents module removal', () => {
  it('does not expose shared document routes or navigation', () => {
    const removedPaths = [
      'src/app/(dashboard)/shared-documents',
      'src/app/(dashboard)/generated-documents/[id]/share',
      'src/app/(public)/share',
      'src/app/api/document-shares',
      'src/app/api/generated-documents/[id]/share',
      'src/app/api/share',
      'src/app/api/public-bootstrap/share',
    ];

    for (const removedPath of removedPaths) {
      expect(fs.existsSync(path.join(root, removedPath)), removedPath).toBe(false);
    }

    const sidebar = fs.readFileSync(path.join(root, 'src/components/ui/sidebar.tsx'), 'utf8');
    expect(sidebar).not.toContain('Shared Documents');
    expect(sidebar).not.toContain('/shared-documents');
  });
});
