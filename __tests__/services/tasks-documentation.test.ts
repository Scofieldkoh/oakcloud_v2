import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function doc(path: string) {
  return readFileSync(join(process.cwd(), 'docs', path), 'utf8');
}

describe('Tasks and Pipelines documentation', () => {
  const index = doc('INDEX.md');
  const readme = doc('README.md');
  const architecture = doc('ARCHITECTURE.md');
  const gettingStarted = doc('GETTING_STARTED.md');
  const todo = doc('TODO.md');
  const api = doc('reference/API_REFERENCE.md');
  const schema = doc('reference/DATABASE_SCHEMA.md');

  it('advertises Tasks and Pipelines instead of the deleted Workflow Projects module', () => {
    const currentDocs = [index, readme, architecture, gettingStarted, todo, api];
    expect(currentDocs.join('\n')).not.toMatch(/Workflow \(Preview\)|\/api\/workflow|\/workflow\/projects|\bWF-\d{3}\b/);
    expect(readme).toContain('| Tasks |');
    expect(readme).toContain('| Pipelines |');
    expect(index).toContain('Tasks and Pipelines');
    expect(gettingStarted).toContain('/tasks');
    expect(gettingStarted).toContain('/pipelines');
  });

  it('documents the current APIs, immutable snapshots, adapters, statuses, and reset', () => {
    for (const route of [
      '/api/task-pipelines',
      '/api/task-pipelines/[id]/duplicate',
      '/api/tasks',
      '/api/tasks/[taskId]/status',
      '/api/tasks/[taskId]/stages/[stageId]/transition',
    ]) {
      expect(api).toContain(route);
    }

    expect(architecture).toMatch(/immutable pipeline version/i);
    expect(architecture).toMatch(/stage-action registry/i);
    expect(architecture).toMatch(/Company[\s\S]*Document Generation[\s\S]*E-signing/i);
    expect(architecture).toMatch(/complete reset/i);

    for (const table of [
      'task_pipelines',
      'task_pipeline_versions',
      'task_pipeline_stages',
      'tasks',
      'task_stages',
      'task_stage_checklist_items',
      'task_stage_outcomes',
    ]) {
      expect(schema).toContain(table);
    }
    expect(schema).toContain('NOT_STARTED → IN_PROGRESS → COMPLETED');
    expect(schema).toMatch(/PAUSED[\s\S]*CANCELLED/);
  });
});
