/**
 * ACRA Entity Sync Scheduled Task
 *
 * Daily task that compares the locally stored ACRA collection last-updated
 * time against the data.gov.sg API's and re-imports the full dataset when
 * they differ.
 *
 * Configuration:
 * - SCHEDULER_ACRA_SYNC_ENABLED=true (enable sync scheduling)
 * - SCHEDULER_ACRA_SYNC_CRON="0 3 * * *" (run daily at 3 AM SGT)
 * - DATAGOV_API_KEY (optional; raises the download rate limit)
 * - ACRA_SYNC_SLEEP_MS (optional; fixed request spacing override, useful for one-off backfills)
 */

import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('acra-sync-task');

/**
 * Execute the ACRA sync task
 *
 * Downloads and imports all 27 datasets when the collection has been updated
 * since the last import; skips otherwise.
 */
async function executeAcraSyncTask(): Promise<TaskResult> {
  log.info('Running ACRA entity sync...');

  try {
    // Dynamic import to avoid circular dependencies
    const { syncAcraDataIfUpdated } = await import('@/services/acra-sync.service');
    const result = await syncAcraDataIfUpdated();

    if (result.synced) {
      return {
        success: true,
        message: `ACRA sync completed: ${result.entityCount} entities, ${result.companiesUpdated} companies updated (data as of ${result.dataAsOf})`,
        data: { ...result, syncedAt: new Date().toISOString() },
      };
    }

    if (result.skipped) {
      return {
        success: true,
        message: result.reason === 'lock'
          ? 'ACRA sync skipped: another sync run holds the lock'
          : `ACRA sync skipped: local data is up to date (data as of ${result.dataAsOf})`,
        data: { ...result, syncedAt: new Date().toISOString() },
      };
    }

    return {
      success: false,
      error: result.error || 'ACRA sync failed',
      data: { ...result, syncedAt: new Date().toISOString() },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to sync ACRA entities:', error);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * ACRA entity sync task registration
 */
export const acraSyncTask: TaskRegistration = {
  id: 'acra-sync',
  name: 'ACRA Entity Sync',
  description: 'Keeps the local ACRA corporate entities table in sync with data.gov.sg (daily)',
  defaultCronPattern: '0 3 * * *', // Daily at 3 AM SGT
  execute: executeAcraSyncTask,
};
