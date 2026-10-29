import { createLogger } from '@/lib/logger';
import {
  enqueueDailyRollingHorizonRequests,
  processScheduleReconciliationBatch,
} from '@/services/schedule-reconciliation/worker';
import type { TaskRegistration } from '../types';

const log = createLogger('service-schedule-reconciliation-task');

function isSingaporeMidnight(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  return hour === '00' && minute === '00';
}

export async function runServiceScheduleReconciliationTask(): Promise<{
  claimed: number;
  completed: number;
  failed: number;
  leaseLost: number;
  rollingHorizonQueued?: number;
}> {
  const rollingHorizonQueued = isSingaporeMidnight(new Date())
    && typeof enqueueDailyRollingHorizonRequests === 'function'
    ? await enqueueDailyRollingHorizonRequests()
    : undefined;
  const result = await processScheduleReconciliationBatch({
    limit: 20,
    concurrency: 4,
  });
  return {
    claimed: result.claimed,
    completed: result.completed,
    failed: result.failed,
    leaseLost: result.leaseLost ?? 0,
    ...(rollingHorizonQueued === undefined ? {} : { rollingHorizonQueued }),
  };
}

export const serviceScheduleReconciliationTask: TaskRegistration = {
  id: 'service-schedule-reconciliation',
  name: 'Service schedule reconciliation',
  description: 'Reconciles service cycles and deadline occurrences across tenant schedules',
  enabledEnvVar: 'SCHEDULER_ENABLED',
  defaultCronPattern: '* * * * *',
  execute: async () => {
    try {
      const result = await runServiceScheduleReconciliationTask();
      return { success: true, message: JSON.stringify(result), data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown reconciliation error';
      log.error('Failed to process service schedule reconciliation', error);
      return { success: false, error: message };
    }
  },
};
