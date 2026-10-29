/**
 * One-off ACRA entity sync (bootstrap/backfill)
 *
 * Runs the same sync used by the daily scheduled task. Use it to populate the
 * local `acra_entity` table immediately after deploying the migration:
 *
 *   npx tsx scripts/run-acra-sync.ts
 *
 * Optional overrides:
 * - ACRA_SYNC_SLEEP_MS=0      disable request spacing (faster one-off runs)
 * - DATAGOV_API_KEY=...       raise the download rate limit
 *
 * Exits with a non-zero code when the sync fails.
 */

import 'dotenv/config';

import { syncAcraDataIfUpdated } from '@/services/acra-sync.service';

async function main(): Promise<void> {
  console.log('Running ACRA entity sync...');
  const result = await syncAcraDataIfUpdated();

  if (result.synced) {
    console.log(`ACRA sync completed: ${result.entityCount} entities (data as of ${result.dataAsOf})`);
    return;
  }

  if (result.skipped) {
    console.log(
      result.reason === 'lock'
        ? 'ACRA sync skipped: another sync run holds the lock'
        : `ACRA sync skipped: local data is up to date (data as of ${result.dataAsOf})`
    );
    return;
  }

  console.error(`ACRA sync failed: ${result.error || 'unknown error'}`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('ACRA sync crashed:', error);
  process.exitCode = 1;
});
