import { describe, expect, it, vi } from 'vitest';

const activationMock = vi.hoisted(() => ({ processQueuedServiceAgreementActivations: vi.fn() }));
vi.mock('@/services/service-agreement', () => activationMock);
vi.mock('node-cron', () => ({ default: { validate: vi.fn(() => true), schedule: vi.fn(() => ({ stop: vi.fn() })) } }));

import { serviceAgreementActivationTask } from '@/lib/scheduler/tasks/service-agreement-activation.task';
import { scheduler } from '@/lib/scheduler/scheduler';

describe('service agreement activation scheduler', () => {
  it('processes a bounded activation batch every minute', async () => {
    expect(serviceAgreementActivationTask.enabledEnvVar).toBe('SCHEDULER_ENABLED');
    activationMock.processQueuedServiceAgreementActivations.mockResolvedValue({ claimed: 2, completed: 2, failed: 0 });
    expect(serviceAgreementActivationTask.defaultCronPattern).toBe('* * * * *');
    await expect(serviceAgreementActivationTask.execute()).resolves.toMatchObject({ success: true, data: { claimed: 2, completed: 2, failed: 0 } });
    expect(activationMock.processQueuedServiceAgreementActivations).toHaveBeenCalledWith({ limit: 10, concurrency: 2 });
  });

  it('registers as enabled whenever the documented master scheduler switch is enabled', () => {
    const previous = process.env.SCHEDULER_ENABLED;
    process.env.SCHEDULER_ENABLED = 'true';
    scheduler.registerTask(serviceAgreementActivationTask);
    expect(scheduler.getTask('service-agreement-activation')).toMatchObject({ enabled: true, cronPattern: '* * * * *' });
    if (previous === undefined) delete process.env.SCHEDULER_ENABLED;
    else process.env.SCHEDULER_ENABLED = previous;
  });
});
