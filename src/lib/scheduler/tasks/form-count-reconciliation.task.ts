import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('form-count-reconciliation-task');

let formBuilderServiceInstance: typeof import('@/services/form-builder.service') | null = null;

async function getFormBuilderService(): Promise<typeof import('@/services/form-builder.service')> {
  if (!formBuilderServiceInstance) {
    formBuilderServiceInstance = await import('../../../services/form-builder.service');
  }
  return formBuilderServiceInstance;
}

async function executeFormCountReconciliationTask(): Promise<TaskResult> {
  log.info('Reconciling form submission counts...');

  try {
    const formBuilderService = await getFormBuilderService();
    const result = await formBuilderService.reconcileFormSubmissionCounts();

    return {
      success: true,
      message: `Reconciled submissions_count for ${result.reconciled} form(s)`,
      data: { reconciled: result.reconciled },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to reconcile form submission counts', error);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export const formCountReconciliationTask: TaskRegistration = {
  id: 'form-count-reconciliation',
  name: 'Form Submission Count Reconciliation',
  description: 'Recalculates and corrects the submissions_count denormalized counter on all active forms',
  defaultCronPattern: '0 3 * * 0', // Weekly on Sunday at 3am
  execute: executeFormCountReconciliationTask,
};
