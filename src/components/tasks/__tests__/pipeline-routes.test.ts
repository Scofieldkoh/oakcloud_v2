import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routePath = (...segments: string[]) =>
  resolve(process.cwd(), 'src', 'app', '(dashboard)', 'pipelines', ...segments, 'page.tsx');

describe('pipeline workspace routes', () => {
  it('provides list, create, and edit routes backed by the shared workspaces', () => {
    const listRoute = routePath();
    const createRoute = routePath('new');
    const editRoute = routePath('[id]');

    expect(existsSync(listRoute)).toBe(true);
    expect(existsSync(createRoute)).toBe(true);
    expect(existsSync(editRoute)).toBe(true);

    expect(readFileSync(listRoute, 'utf8')).toContain('PipelinesListWorkspace');
    expect(readFileSync(createRoute, 'utf8')).toContain('NewPipelineWorkspace');
    const editSource = readFileSync(editRoute, 'utf8');
    expect(editSource).toContain('EditPipelineWorkspace');
    expect(editSource).toContain('params: Promise<{ id: string }>');
    expect(editSource).toContain('use(params)');
  });
});
