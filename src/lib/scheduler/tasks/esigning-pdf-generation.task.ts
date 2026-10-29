import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('esigning-pdf-generation-task');

let esigningCompletionServiceInstance: typeof import('@/services/esigning-completion.service') | null = null;

async function getEsigningCompletionService(): Promise<typeof import('@/services/esigning-completion.service')> {
  if (!esigningCompletionServiceInstance) {
    esigningCompletionServiceInstance = await import('../../../services/esigning-completion.service');
  }

  return esigningCompletionServiceInstance;
}

async function executeEsigningPdfGenerationTask(): Promise<TaskResult> {
  log.info('Processing queued e-signing completion jobs...');

  try {
    const service = await getEsigningCompletionService();
    const result = await service.processQueuedEsigningCompletionWork({ limit: 5 });

    return {
      success: true,
      message: `Processed ${result.processed} e-signing completion stage(s)`,
      data: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to process queued e-signing completion jobs', error);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export const esigningPdfGenerationTask: TaskRegistration = {
  id: 'esigning-pdf-generation',
  name: 'E-Signing Completion Processing Queue',
  description: 'Processes signed PDF artifacts, company auto-filing, and completion email delivery',
  enabledEnvVar: 'SCHEDULER_ENABLED',
  defaultCronPattern: '* * * * *',
  execute: executeEsigningPdfGenerationTask,
};
