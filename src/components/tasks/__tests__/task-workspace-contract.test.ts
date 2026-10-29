import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

describe('Tasks workspace scaffold', () => {
  it('provides the reusable Task 6A component surfaces', () => {
    const expectedFiles = [
      'src/components/tasks/task-stage-pipeline.tsx',
      'src/components/tasks/task-list.tsx',
      'src/components/tasks/task-form-modal.tsx',
      'src/components/tasks/task-stage-modal.tsx',
      'src/components/tasks/task-workspace.tsx',
    ];

    expect(expectedFiles.filter((file) => !fs.existsSync(path.join(projectRoot, file)))).toEqual([]);
  });

  it('provides a thin /tasks page route', () => {
    const route = path.join(projectRoot, 'src/app/(dashboard)/tasks/page.tsx');

    expect(fs.existsSync(route)).toBe(true);
  });
});
