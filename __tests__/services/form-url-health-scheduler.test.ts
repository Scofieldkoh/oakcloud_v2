import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reconcileFormUrlHealth: vi.fn() }));
vi.mock('@/services/form-url-health.service', () => mocks);
vi.mock('node-cron', () => ({ default: { validate: vi.fn(() => true), schedule: vi.fn(() => ({ stop: vi.fn() })) } }));

import { formUrlHealthTask } from '@/lib/scheduler/tasks/form-url-health.task';
import { scheduler } from '@/lib/scheduler/scheduler';

describe('form URL health scheduler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs daily by default and reports reconciliation counts', async () => {
    mocks.reconcileFormUrlHealth.mockResolvedValue({ checked: 3, healthy: 1, unverifiable: 1, failed: 1, warnings: 1 });

    expect(formUrlHealthTask).toMatchObject({ id: 'form-url-health', defaultCronPattern: '0 2 * * *' });
    await expect(formUrlHealthTask.execute()).resolves.toMatchObject({
      success: true,
      data: { checked: 3, healthy: 1, unverifiable: 1, failed: 1, warnings: 1 },
    });
  });

  it('uses standard per-task environment overrides and is registered at startup', () => {
    const priorEnabled = process.env.SCHEDULER_FORM_URL_HEALTH_ENABLED;
    const priorCron = process.env.SCHEDULER_FORM_URL_HEALTH_CRON;
    process.env.SCHEDULER_FORM_URL_HEALTH_ENABLED = 'true';
    process.env.SCHEDULER_FORM_URL_HEALTH_CRON = '15 4 * * *';

    scheduler.registerTask(formUrlHealthTask);
    expect(scheduler.getTask('form-url-health')).toMatchObject({ enabled: true, cronPattern: '15 4 * * *' });
    const schedulerIndex = readFileSync(resolve(process.cwd(), 'src/lib/scheduler/index.ts'), 'utf8');
    expect(schedulerIndex).toContain('scheduler.registerTask(formUrlHealthTask)');

    if (priorEnabled === undefined) delete process.env.SCHEDULER_FORM_URL_HEALTH_ENABLED;
    else process.env.SCHEDULER_FORM_URL_HEALTH_ENABLED = priorEnabled;
    if (priorCron === undefined) delete process.env.SCHEDULER_FORM_URL_HEALTH_CRON;
    else process.env.SCHEDULER_FORM_URL_HEALTH_CRON = priorCron;
  });

  it('returns a failed task result when reconciliation throws', async () => {
    mocks.reconcileFormUrlHealth.mockRejectedValue(new Error('database unavailable'));
    await expect(formUrlHealthTask.execute()).resolves.toMatchObject({ success: false, error: 'database unavailable' });
  });
});
