import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('legacy workflow application surface', () => {
  it('removes the retired workflow routes, components, hooks, and service', () => {
    for (const legacyPath of [
      'src/app/(dashboard)/workflow',
      'src/app/api/workflow',
      'src/components/workflow',
      'src/hooks/use-workflow-projects.ts',
      'src/hooks/use-workflow-project-detail.ts',
      'src/services/workflow-project.service.ts',
    ]) {
      expect(existsSync(join(root, legacyPath)), legacyPath).toBe(false);
    }
  });

  it('does not retain source or test imports and route targets for the retired workflow application', () => {
    const legacyReference = /@\/components\/workflow|@\/hooks\/use-workflow-project|@\/services\/workflow-project|\/api\/workflow|["'`]\/workflow\/|\bworkflowProjectId\b/;
    const files = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, '__tests__'))]
      .filter((path) => !path.endsWith('legacy-workflow-surface-removed.test.ts'));

    const references = files.flatMap((path) => (
      legacyReference.test(readFileSync(path, 'utf8')) ? [relative(root, path)] : []
    ));

    expect(references).toEqual([]);
  });
});
