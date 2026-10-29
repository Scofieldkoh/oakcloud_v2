import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('esigning-expiry-check-task');

let esigningEnvelopeServiceInstance: typeof import('@/services/esigning-envelope.service') | null = null;

async function getEsigningEnvelopeService(): Promise<typeof import('@/services/esigning-envelope.service')> {
  if (!esigningEnvelopeServiceInstance) {
    esigningEnvelopeServiceInstance = await import('../../../services/esigning-envelope.service');
  }

  return esigningEnvelopeServiceInstance;
}

async function executeEsigningExpiryCheckTask(): Promise<TaskResult> {
  log.info('Processing expired e-signing envelopes...');

  try {
    const service = await getEsigningEnvelopeService();
    const result = await service.processExpiredEsigningEnvelopes({ limit: 100 });

    return {
      success: true,
      message: `Expired ${result.expired} envelope(s)`,
      data: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to process expired e-signing envelopes', error);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export const esigningExpiryCheckTask: TaskRegistration = {
  id: 'esigning-expiry-check',
  name: 'E-Signing Expiry Check',
  description: 'Expires sent and in-progress envelopes that have passed their deadline',
  defaultCronPattern: '0 * * * *',
  execute: executeEsigningExpiryCheckTask,
};
