import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('esigning-preparation-task');

let preparationServiceInstance:
  | typeof import('@/services/tasks/esigning-preparation.service')
  | null = null;

async function getPreparationService() {
  if (!preparationServiceInstance) {
    preparationServiceInstance = await import('../../../services/tasks/esigning-preparation.service');
  }
  return preparationServiceInstance;
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

async function executeEsigningPreparationTask(): Promise<TaskResult> {
  log.info('Processing queued E-signing preparations...');

  try {
    const service = await getPreparationService();
    const result = await service.processQueuedTaskEsigningPreparations({
      limit: positiveInteger(process.env.ESIGNING_PREPARATION_BATCH_SIZE, 10, 100),
      concurrency: positiveInteger(process.env.ESIGNING_PREPARATION_CONCURRENCY, 2, 20),
      leaseMs: positiveInteger(process.env.ESIGNING_PREPARATION_LEASE_MS, 300_000, 3_600_000),
    });

    return {
      success: true,
      message: `Processed ${result.processed} E-signing preparation(s)`,
      data: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to process queued E-signing preparations', error);
    return { success: false, error: errorMessage };
  }
}

export const esigningPreparationTask: TaskRegistration = {
  id: 'esigning-preparation',
  name: 'E-Signing Preparation Queue',
  description: 'Prepares draft task envelopes and managed documents before users open the stage',
  defaultCronPattern: '*/1 * * * *',
  execute: executeEsigningPreparationTask,
};
