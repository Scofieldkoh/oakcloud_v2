import { createLogger } from '@/lib/logger';
import { processQueuedServiceAgreementActivations } from '@/services/service-agreement';
import type { TaskRegistration } from '../types';

const log = createLogger('service-agreement-activation-task');

export const serviceAgreementActivationTask: TaskRegistration = {
  id: 'service-agreement-activation',
  name: 'Service agreement activation',
  description: 'Activates signed Service Agreements as operational company Services',
  enabledEnvVar: 'SCHEDULER_ENABLED',
  defaultCronPattern: '* * * * *',
  execute: async () => {
    try {
      const result = await processQueuedServiceAgreementActivations({ limit: 10, concurrency: 2 });
      return { success: true, message: JSON.stringify(result), data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown activation error';
      log.error('Failed to process Service Agreement activations', error);
      return { success: false, error: message };
    }
  },
};
