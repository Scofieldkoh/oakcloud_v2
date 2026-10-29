/**
 * Exchange Rate Sync Scheduled Task
 *
 * Syncs exchange rates from MAS (Monetary Authority of Singapore) API:
 * 1. Daily end-of-day rates
 * 2. Monthly end-of-period rates (on 1st-5th of each month)
 *
 * Configuration:
 * - SCHEDULER_EXCHANGE_RATE_SYNC_ENABLED=true (enable sync scheduling)
 * - SCHEDULER_EXCHANGE_RATE_SYNC_CRON="0 6 * * *" (run daily at 6 AM SGT)
 * - SCHEDULER_EXCHANGE_RATE_MAS_DAILY_ENABLED=true (enable MAS daily sync, default: true)
 * - SCHEDULER_EXCHANGE_RATE_MAS_MONTHLY_ENABLED=true (enable MAS monthly sync, default: true)
 *
 * Note: MAS typically updates rates around 6 PM SGT the previous day,
 * so 6 AM is a safe time to fetch the latest rates.
 *
 * MAS monthly rates are synced on the first 5 days of each month to ensure
 * the previous month's rates are available after MAS updates.
 */

import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('exchange-rate-sync-task');

/**
 * Check if MAS daily sync is enabled
 */
function isMasDailyEnabled(): boolean {
  const value = process.env.SCHEDULER_EXCHANGE_RATE_MAS_DAILY_ENABLED;
  // Default to true if not set
  if (value === undefined || value === '') return true;
  return value.toLowerCase() === 'true';
}

/**
 * Check if MAS monthly sync is enabled
 */
function isMasMonthlyEnabled(): boolean {
  const value = process.env.SCHEDULER_EXCHANGE_RATE_MAS_MONTHLY_ENABLED;
  // Default to true if not set
  if (value === undefined || value === '') return true;
  return value.toLowerCase() === 'true';
}

/**
 * Execute exchange rate sync task
 *
 * Syncs MAS daily rates and/or MAS monthly rates based on configuration.
 */
async function executeExchangeRateSyncTask(): Promise<TaskResult> {
  log.info('Running exchange rate sync...');

  const masDailyEnabled = isMasDailyEnabled();
  const masMonthlyEnabled = isMasMonthlyEnabled();

  log.info(`Sync configuration: MAS Daily=${masDailyEnabled}, MAS Monthly=${masMonthlyEnabled}`);

  if (!masDailyEnabled && !masMonthlyEnabled) {
    log.warn('Both MAS Daily and MAS Monthly sync are disabled');
    return {
      success: true,
      message: 'No sync performed - both MAS Daily and MAS Monthly are disabled',
    };
  }

  const results: {
    masDaily?: { success: boolean; created: number; updated: number; errors: string[] };
    masMonthly?: { success: boolean; created: number; updated: number; errors: string[] };
  } = {};

  try {
    // Dynamic import to avoid circular dependencies
    const { syncFromMAS, syncMASMonthly } = await import('@/services/exchange-rate.service');

    // 1. Sync MAS daily rates if enabled
    if (masDailyEnabled) {
      log.info('Syncing MAS daily rates...');
      const masResult = await syncFromMAS();
      results.masDaily = {
        success: masResult.success,
        created: masResult.ratesCreated,
        updated: masResult.ratesUpdated,
        errors: masResult.errors,
      };
    }

    // 2. Sync MAS monthly rates on 1st-5th of month (if enabled)
    if (masMonthlyEnabled) {
      const today = new Date();
      const dayOfMonth = today.getDate();

      if (dayOfMonth <= 5) {
        log.info('Syncing MAS monthly rates (day of month: ' + dayOfMonth + ')...');

        // Calculate previous month in YYYY-MM format
        const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const targetMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;

        const monthlyResult = await syncMASMonthly(targetMonth);
        results.masMonthly = {
          success: monthlyResult.success,
          created: monthlyResult.ratesCreated,
          updated: monthlyResult.ratesUpdated,
          errors: monthlyResult.errors,
        };
      } else {
        log.debug('Skipping MAS monthly sync (day of month > 5)');
      }
    }

    // Build summary message
    const messages: string[] = [];

    if (results.masDaily) {
      const masTotalRates = results.masDaily.created + results.masDaily.updated;
      messages.push(`MAS Daily: ${masTotalRates} rates (${results.masDaily.created} new, ${results.masDaily.updated} updated)`);
    } else if (masDailyEnabled) {
      messages.push('MAS Daily: skipped');
    }

    if (results.masMonthly) {
      const monthlyTotalRates = results.masMonthly.created + results.masMonthly.updated;
      messages.push(`MAS Monthly: ${monthlyTotalRates} rates (${results.masMonthly.created} new, ${results.masMonthly.updated} updated)`);
    }

    // Determine overall success
    const overallSuccess =
      (results.masDaily?.success ?? true) && (results.masMonthly?.success ?? true);

    // Collect all errors
    const allErrors: string[] = [
      ...(results.masDaily?.errors || []),
      ...(results.masMonthly?.errors || []),
    ];

    if (overallSuccess) {
      return {
        success: true,
        message: messages.join('; ') || 'No sync performed',
        data: {
          masDaily: results.masDaily,
          masMonthly: results.masMonthly,
          syncedAt: new Date().toISOString(),
        },
      };
    } else {
      return {
        success: false,
        error: allErrors.join('; '),
        data: {
          masDaily: results.masDaily,
          masMonthly: results.masMonthly,
          errors: allErrors,
          syncedAt: new Date().toISOString(),
        },
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to sync exchange rates:', error);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Exchange rate sync task registration
 *
 * Register this with the scheduler to enable periodic rate syncing.
 */
export const exchangeRateSyncTask: TaskRegistration = {
  id: 'exchange-rate-sync',
  name: 'Exchange Rate Sync',
  description: 'Syncs exchange rates from MAS (daily and monthly)',
  defaultCronPattern: '0 6 * * *', // Daily at 6 AM SGT
  execute: executeExchangeRateSyncTask,
};
