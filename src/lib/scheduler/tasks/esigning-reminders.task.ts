import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('esigning-reminders-task');

let esigningEnvelopeServiceInstance: typeof import('@/services/esigning-envelope.service') | null = null;

async function getEsigningEnvelopeService(): Promise<typeof import('@/services/esigning-envelope.service')> {
  if (!esigningEnvelopeServiceInstance) {
    esigningEnvelopeServiceInstance = await import('../../../services/esigning-envelope.service');
  }

  return esigningEnvelopeServiceInstance;
}

async function executeEsigningReminderTask(): Promise<TaskResult> {
  log.info('Processing e-signing reminder notifications...');

  try {
    const service = await getEsigningEnvelopeService();
    const result = await service.processEsigningReminderNotifications({ limit: 200 });

    return {
      success: true,
      message: `Sent ${result.remindersSent} reminder(s) and ${result.expiryWarningsSent} expiry warning(s)`,
      data: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to process e-signing reminders', error);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export const esigningRemindersTask: TaskRegistration = {
  id: 'esigning-reminders',
  name: 'E-Signing Reminders',
  description: 'Sends configured reminder emails and expiry warnings for active envelopes',
  defaultCronPattern: '0 0 * * *',
  execute: executeEsigningReminderTask,
};
