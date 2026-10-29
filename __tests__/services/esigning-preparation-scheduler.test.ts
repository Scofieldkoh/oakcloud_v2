import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('e-signing preparation scheduler registration', () => {
  it('registers a durable queue processor with bounded concurrency', () => {
    const task = source('src/lib/scheduler/tasks/esigning-preparation.task.ts');
    const taskIndex = source('src/lib/scheduler/tasks/index.ts');
    const schedulerIndex = source('src/lib/scheduler/index.ts');

    expect(task).toContain("id: 'esigning-preparation'");
    expect(task).toContain('processQueuedTaskEsigningPreparations');
    expect(task).toContain('ESIGNING_PREPARATION_BATCH_SIZE');
    expect(task).toContain('ESIGNING_PREPARATION_CONCURRENCY');
    expect(taskIndex).toContain('esigningPreparationTask');
    expect(schedulerIndex).toContain('scheduler.registerTask(esigningPreparationTask)');
  });
});
