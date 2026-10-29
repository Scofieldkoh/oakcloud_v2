/**
 * Cleanup Scheduled Task
 *
 * Removes expired form drafts, orphaned form uploads and orphaned e-signing storage.
 *
 * Configuration:
 * - SCHEDULER_CLEANUP_ENABLED=true (enable cleanup scheduling)
 * - SCHEDULER_CLEANUP_CRON="0 2 * * *" (run daily at 2 AM)
 */

import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('cleanup-task');

let formBuilderServiceInstance: typeof import('@/services/form-builder.service') | null = null;
let esigningEnvelopeServiceInstance: typeof import('@/services/esigning-envelope.service') | null = null;

async function getFormBuilderService(): Promise<typeof import('@/services/form-builder.service')> {
  if (!formBuilderServiceInstance) {
    formBuilderServiceInstance = await import('../../../services/form-builder.service');
  }
  return formBuilderServiceInstance;
}

async function getEsigningEnvelopeService(): Promise<typeof import('@/services/esigning-envelope.service')> {
  if (!esigningEnvelopeServiceInstance) {
    esigningEnvelopeServiceInstance = await import('../../../services/esigning-envelope.service');
  }
  return esigningEnvelopeServiceInstance;
}

/**
 * Execute cleanup task
 *
 * Stale full backups are handled by the backup task.
 */
async function executeCleanupTask(): Promise<TaskResult> {
  log.info('Running platform cleanup...');

  try {
    const [formBuilderService, esigningEnvelopeService] = await Promise.all([
      getFormBuilderService(),
      getEsigningEnvelopeService(),
    ]);
    const [deletedExpiredDrafts, deletedOrphanedUploads, esigningCleanup] = await Promise.all([
      formBuilderService.cleanupExpiredFormDrafts(),
      formBuilderService.cleanupOrphanedUploads(),
      esigningEnvelopeService.cleanupEsigningOrphanedStorage(),
    ]);

    const message = [
      `Form drafts: ${deletedExpiredDrafts} deleted`,
      `Orphan uploads: ${deletedOrphanedUploads} deleted`,
      `E-signing storage: ${esigningCleanup.deletedPrefixes}/${esigningCleanup.orphanedPrefixes} prefixes deleted`,
    ].join('; ');

    const hasErrors = esigningCleanup.failedPrefixes.length > 0;

    return {
      success: !hasErrors,
      message,
      data: {
        forms: {
          deletedExpiredDrafts,
          deletedOrphanedUploads,
        },
        esigning: esigningCleanup,
      },
      error: hasErrors
        ? `${esigningCleanup.failedPrefixes.length} cleanup errors`
        : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to run cleanup:', error);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Cleanup task registration
 *
 * Register this with the scheduler to enable periodic cleanup.
 */
export const cleanupTask: TaskRegistration = {
  id: 'cleanup',
  name: 'Platform Cleanup',
  description: 'Cleans up expired form drafts and orphaned uploads',
  defaultCronPattern: '0 2 * * *', // Daily at 2 AM
  execute: executeCleanupTask,
};
