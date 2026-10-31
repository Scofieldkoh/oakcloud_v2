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

async function sweepStuckEnvelopes(): Promise<{ found: number; completed: number; failed: number } | null> {
  // Recovery for envelopes where every signer signed but the envelope never
  // reached COMPLETED (the OAK-001 race). A sweep failure must not block the
  // completion queue below.
  try {
    const signingService = await import('../../../services/esigning-signing.service');
    const swept = await signingService.sweepStuckEsigningEnvelopes({ limit: 50 });
    if (swept.completed > 0 || swept.failed > 0) {
      log.warn('Stuck e-signing envelope sweep finished', swept);
    }
    return swept;
  } catch (error) {
    log.error('Failed to sweep stuck e-signing envelopes', error);
    return null;
  }
}

async function executeEsigningPdfGenerationTask(): Promise<TaskResult> {
  log.info('Processing queued e-signing completion jobs...');

  try {
    const sweep = await sweepStuckEnvelopes();
    const service = await getEsigningCompletionService();
    const result = await service.processQueuedEsigningCompletionWork({ limit: 5 });

    return {
      success: true,
      message: `Processed ${result.processed} e-signing completion stage(s)`,
      data: sweep ? { ...result, stuckEnvelopeSweep: sweep } : result,
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
  description: 'Completes envelopes stuck with every signer signed, then processes signed PDF artifacts, company auto-filing, and completion email delivery',
  enabledEnvVar: 'SCHEDULER_ENABLED',
  defaultCronPattern: '* * * * *',
  execute: executeEsigningPdfGenerationTask,
};
