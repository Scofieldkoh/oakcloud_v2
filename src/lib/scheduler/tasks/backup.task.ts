/**
 * Backup Scheduled Task
 *
 * Runs the full-backup schedule (Backup page) and marks backups left running
 * by a restart as failed.
 *
 * Configuration:
 * - SCHEDULER_BACKUP_ENABLED=true (enable backup scheduling)
 * - SCHEDULER_BACKUP_CRON="0,15,30,45 * * * *" (check every 15 minutes)
 */

import { createLogger } from '@/lib/logger';
import { cleanupStaleFullBackups, processScheduledFullBackup } from '@/services/backup/full/full-backup.service';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('backup-task');

/**
 * Execute backup task
 *
 * Checks for due scheduled backups and processes them.
 */
async function executeBackupTask(): Promise<TaskResult> {
  log.info('Checking for due scheduled backups...');

  try {
    await cleanupStaleFullBackups();
    const full = await processScheduledFullBackup();
    if (!full) {
      return { success: true, message: 'No scheduled backups due at this time', data: { processed: 0 } };
    }
    return {
      success: !full.error,
      message: full.error ? `Full backup failed: ${full.error}` : 'Full backup started',
      data: { fullBackup: full },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to process scheduled backups:', error);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Backup task registration
 *
 * Register this with the scheduler to enable scheduled backups.
 */
export const backupTask: TaskRegistration = {
  id: 'backup',
  name: 'Scheduled Backups',
  description: 'Starts the scheduled full backup when it is due',
  defaultCronPattern: '0,15,30,45 * * * *', // Every 15 minutes
  execute: executeBackupTask,
};
