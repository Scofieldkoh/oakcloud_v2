/**
 * Public Holiday Sync Scheduled Task
 *
 * Daily check of MOM's official Singapore public holidays on data.gov.sg.
 * Downloads only when the dataset changed, then synchronizes every active
 * Singapore business calendar from the local copy.
 *
 * Configuration:
 * - SCHEDULER_PUBLIC_HOLIDAY_SYNC_ENABLED=true (enable the daily check)
 * - SCHEDULER_PUBLIC_HOLIDAY_SYNC_CRON="0 4 * * *" (daily at 4 AM SGT)
 * - DATAGOV_PUBLIC_HOLIDAY_DATASET_ID (optional; overrides the MOM dataset id)
 * - DATAGOV_API_KEY (optional; shared with the ACRA sync)
 */

import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('public-holiday-sync-task');

async function executePublicHolidaySyncTask(): Promise<TaskResult> {
  log.info('Checking official public holidays...');

  try {
    // Dynamic import to avoid circular dependencies
    const { syncPublicHolidaysIfUpdated } = await import('@/services/public-holiday-sync.service');
    const { calendarResults: _calendarResults, ...result } = await syncPublicHolidaysIfUpdated();
    const data = { ...result, syncedAt: new Date().toISOString() };

    if (result.error) {
      return { success: false, error: result.error, data };
    }
    if (result.reason === 'lock') {
      return { success: true, message: 'Public holiday sync skipped: another run holds the lock', data };
    }
    return {
      success: true,
      message: `Public holidays ${result.skipped ? 'up to date' : 'refreshed'} (data as of ${result.dataAsOf}); `
        + `${result.calendarsUpdated} of ${result.calendarsChecked} calendar(s) updated`,
      data,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to sync public holidays:', error);
    return { success: false, error: errorMessage };
  }
}

export const publicHolidaySyncTask: TaskRegistration = {
  id: 'public-holiday-sync',
  name: 'Public Holiday Sync',
  description: 'Checks MOM public holidays on data.gov.sg and synchronizes Singapore business calendars (daily)',
  defaultCronPattern: '0 4 * * *', // Daily at 4 AM SGT
  execute: executePublicHolidaySyncTask,
};
