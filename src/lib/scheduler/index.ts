/**
 * General-Purpose Task Scheduler
 *
 * A modular, reusable scheduler for running periodic tasks.
 *
 * ## Quick Start
 *
 * 1. Enable the scheduler in your .env:
 *    ```
 *    SCHEDULER_ENABLED=true
 *    SCHEDULER_BACKUP_ENABLED=true
 *    SCHEDULER_CLEANUP_ENABLED=true
 *    ```
 *
 * 2. The scheduler auto-initializes via instrumentation.ts when the app starts.
 *
 * ## Adding New Tasks
 *
 * 1. Create a new task file in `src/lib/scheduler/tasks/`:
 *    ```typescript
 *    import type { TaskRegistration } from '../types';
 *
 *    export const myTask: TaskRegistration = {
 *      id: 'my-task',
 *      name: 'My Task',
 *      description: 'Does something useful',
 *      defaultCronPattern: '0 * * * *', // Every hour
 *      execute: async () => {
 *        // Your task logic here
 *        return { success: true, message: 'Done!' };
 *      },
 *    };
 *    ```
 *
 * 2. Export it from `src/lib/scheduler/tasks/index.ts`
 *
 * 3. Register it in `initializeScheduler()` below
 *
 * 4. Add environment variables:
 *    - SCHEDULER_MY_TASK_ENABLED=true
 *    - SCHEDULER_MY_TASK_CRON="0 * * * *" (optional, uses default if not set)
 *
 * ## Environment Variables
 *
 * Master switch:
 * - SCHEDULER_ENABLED=true
 *
 * Per-task configuration (replace {TASK_ID} with uppercase task ID):
 * - SCHEDULER_{TASK_ID}_ENABLED=true
 * - SCHEDULER_{TASK_ID}_CRON="cron pattern"
 *
 * @module scheduler
 */

import { scheduler } from './scheduler';
import {
  acraSyncTask,
  backupTask,
  cleanupTask,
  esigningExpiryCheckTask,
  esigningPdfGenerationTask,
  esigningPreparationTask,
  esigningRemindersTask,
  esigningSharePointFilingTask,
  exchangeRateSyncTask,
  formAiReviewTask,
  formCountReconciliationTask,
  formUrlHealthTask,
  processingRevisionBackfillTask,
  publicHolidaySyncTask,
  summaryCountRefreshTask,
  serviceAgreementActivationTask,
  serviceScheduleReconciliationTask,
} from './tasks';
import { startViewCountFlush, stopViewCountFlush } from '@/lib/view-count-buffer';

/**
 * Initialize the scheduler with all registered tasks
 *
 * Called once when the application starts via instrumentation.ts
 */
export async function initializeScheduler(): Promise<void> {
  // Register all tasks
  scheduler.registerTask(acraSyncTask);
  scheduler.registerTask(backupTask);
  scheduler.registerTask(cleanupTask);
  scheduler.registerTask(esigningExpiryCheckTask);
  scheduler.registerTask(esigningPdfGenerationTask);
  scheduler.registerTask(esigningPreparationTask);
  scheduler.registerTask(esigningRemindersTask);
  scheduler.registerTask(esigningSharePointFilingTask);
  scheduler.registerTask(exchangeRateSyncTask);
  scheduler.registerTask(formAiReviewTask);
  scheduler.registerTask(formCountReconciliationTask);
  scheduler.registerTask(formUrlHealthTask);
  scheduler.registerTask(processingRevisionBackfillTask);
  scheduler.registerTask(publicHolidaySyncTask);
  scheduler.registerTask(summaryCountRefreshTask);
  scheduler.registerTask(serviceAgreementActivationTask);
  scheduler.registerTask(serviceScheduleReconciliationTask);

  // Initialize and start the scheduler
  await scheduler.initialize();

  // Start buffered view count flushing
  startViewCountFlush();
}

/**
 * Stop the scheduler
 *
 * Call this for graceful shutdown
 */
export async function stopScheduler(): Promise<void> {
  scheduler.stop();
  await stopViewCountFlush();
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return scheduler.isRunning();
}

/**
 * Get scheduler status for admin UI
 */
export function getSchedulerStatus() {
  return scheduler.getStatus();
}

/**
 * Get execution history for admin UI
 */
export function getSchedulerHistory(taskId?: string, limit?: number) {
  return scheduler.getExecutionHistory(taskId, limit);
}

/**
 * Manually trigger a task (for admin UI or testing)
 */
export async function triggerTask(taskId: string) {
  return scheduler.executeTask(taskId);
}

// Re-export the scheduler instance and types for advanced usage
export { scheduler };
export type {
  TaskResult,
  ScheduledTask,
  TaskRegistration,
  SchedulerStatus,
  TaskExecutionLog,
} from './types';
