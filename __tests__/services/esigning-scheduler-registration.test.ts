import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-cron', () => ({
  default: { validate: vi.fn(() => true), schedule: vi.fn(() => ({ stop: vi.fn(), start: vi.fn() })) },
}));
vi.mock('@/lib/view-count-buffer', () => ({
  startViewCountFlush: vi.fn(),
  stopViewCountFlush: vi.fn(async () => undefined),
}));

const ESIGNING_TASK_IDS = [
  'esigning-expiry-check',
  'esigning-pdf-generation',
  'esigning-preparation',
  'esigning-reminders',
  'esigning-sharepoint-filing',
];

const originalEnv = { ...process.env };

function clearSchedulerEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SCHEDULER_')) delete process.env[key];
  }
}

async function registerAllTasks() {
  vi.resetModules();
  const { initializeScheduler } = await import('@/lib/scheduler');
  const { scheduler } = await import('@/lib/scheduler/scheduler');
  await initializeScheduler();
  return scheduler;
}

describe('e-signing scheduler task gating (OAK-002)', () => {
  beforeEach(() => {
    clearSchedulerEnv();
  });

  afterEach(() => {
    clearSchedulerEnv();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (key.startsWith('SCHEDULER_') && value !== undefined) process.env[key] = value;
    }
  });

  it('enables every e-signing task from the master SCHEDULER_ENABLED switch alone', async () => {
    process.env.SCHEDULER_ENABLED = 'true';
    const scheduler = await registerAllTasks();

    for (const id of ESIGNING_TASK_IDS) {
      expect(scheduler.getTask(id), id).toMatchObject({ id, enabled: true });
    }
    // Each e-signing task also has a started cron job, not just an "enabled" flag.
    for (const id of ESIGNING_TASK_IDS) {
      expect(scheduler.isTaskRunning(id), id).toBe(true);
    }
  });

  it('keeps e-signing tasks off when the master switch is off', async () => {
    const scheduler = await registerAllTasks();

    for (const id of ESIGNING_TASK_IDS) {
      expect(scheduler.getTask(id), id).toMatchObject({ id, enabled: false });
      expect(scheduler.isTaskRunning(id), id).toBe(false);
    }
  });

  it('still honours the SCHEDULER_<TASK>_CRON overrides', async () => {
    process.env.SCHEDULER_ENABLED = 'true';
    process.env.SCHEDULER_ESIGNING_REMINDERS_CRON = '30 1 * * *';
    const scheduler = await registerAllTasks();

    expect(scheduler.getTask('esigning-reminders')).toMatchObject({ enabled: true, cronPattern: '30 1 * * *' });
    expect(scheduler.getTask('esigning-expiry-check')).toMatchObject({ enabled: true, cronPattern: '0 * * * *' });
  });
});
