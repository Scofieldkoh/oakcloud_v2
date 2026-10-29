import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const tasksApiRoot = path.join(process.cwd(), 'src/app/api/tasks');

describe('Tasks API dynamic route segments', () => {
  it('uses one consistent [taskId] segment for task, status, and stage routes', () => {
    const dynamicSegments = fs.readdirSync(tasksApiRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('['))
      .map((entry) => entry.name)
      .sort();

    expect(dynamicSegments).toEqual(['[taskId]']);
    expect(fs.existsSync(path.join(tasksApiRoot, '[taskId]/route.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tasksApiRoot, '[taskId]/status/route.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tasksApiRoot, '[taskId]/stages/[stageId]/route.ts'))).toBe(true);
  });
});
