import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('form-ai-review-task');

let formBuilderServiceInstance: typeof import('@/services/form-builder.service') | null = null;

async function getFormBuilderService(): Promise<typeof import('@/services/form-builder.service')> {
  if (!formBuilderServiceInstance) {
    formBuilderServiceInstance = await import('../../../services/form-builder.service');
  }
  return formBuilderServiceInstance;
}

async function executeFormAiReviewTask(): Promise<TaskResult> {
  log.info('Processing queued form AI reviews...');

  try {
    const formBuilderService = await getFormBuilderService();
    const result = await formBuilderService.processQueuedFormSubmissionAiReviews({
      limit: 10,
    });

    return {
      success: true,
      message: `Processed ${result.processed} queued form AI review(s)`,
      data: {
        processed: result.processed,
        completed: result.completed,
        failed: result.failed,
        skipped: result.skipped,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to process queued form AI reviews', error);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export const formAiReviewTask: TaskRegistration = {
  id: 'form-ai-review',
  name: 'Form AI Review Queue',
  description: 'Processes queued form submission AI reviews and dispatches internal notifications',
  defaultCronPattern: '*/2 * * * *',
  execute: executeFormAiReviewTask,
};
