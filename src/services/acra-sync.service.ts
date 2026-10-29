/**
 * ACRA Local Entity Sync Service
 *
 * Downloads the data.gov.sg "ACRA Information on Corporate Entities"
 * collection (27 CSV datasets) into the local `acra_entity` table. The daily
 * scheduled task compares the stored collection last-updated time against the
 * API's and only re-imports when they differ.
 *
 * The import is crash-safe: rows are stamped with the new `dataAsOf` value
 * and stale rows are deleted only after all datasets imported successfully.
 */

import { Readable } from 'node:stream';
import { updateCompaniesFromAcraRecords } from '@/lib/external/acra-records';
import { parseStream } from 'fast-csv';
import { Prisma } from '@/generated/prisma';
import logger, { safeErrorMessage } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { mapCsvRow } from './acra-sync.helpers';

const log = logger.child('acra-sync');

const API_HOST = 'https://api-open.data.gov.sg';
const METADATA_URL =
  process.env.DATAGOV_METADATA_URL
  || 'https://api-production.data.gov.sg/v2/public/api/collections/2/metadata';

const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const IMPORT_BATCH_SIZE = 2000;
const POLL_MAX_ATTEMPTS = 5;
const SYNC_LOCK_WINDOW_MS = 6 * 60 * 60 * 1000;

// A browser-like User-Agent keeps the request from being blocked by the
// WAF/CloudFront layers in front of the government endpoints.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Dataset ids of the "ACRA Information on Corporate Entities" collection
// (https://data.gov.sg/collections/2/view), one per first letter plus "Others".
const DATASET_BY_LETTER: Record<string, string> = {
  A: 'd_8575e84912df3c28995b8e6e0e05205a',
  B: 'd_3a3807c023c61ddfba947dc069eb53f2',
  C: 'd_c0650f23e94c42e7a20921f4c5b75c24',
  D: 'd_acbc938ec77af18f94cecc4a7c9ec720',
  E: 'd_124a9bd407c7a25f8335b93b86e50fdd',
  F: 'd_4526d47d6714d3b052eed4a30b8b1ed6',
  G: 'd_b58303c68e9cf0d2ae93b73ffdbfbfa1',
  H: 'd_fa2ed456cf2b8597bb7e064b08fc3c7c',
  I: 'd_85518d970b8178975850457f60f1e738',
  J: 'd_478f45a9c541cbe679ca55d1cd2b970b',
  K: 'd_5573b0db0575db32190a2ad27919a7aa',
  L: 'd_a2141adf93ec2a3c2ec2837b78d6d46e',
  M: 'd_9af9317c646a1c881bb5591c91817cc6',
  N: 'd_67e99e6eabc4aad9b5d48663b579746a',
  O: 'd_5c4ef48b025fdfbc80056401f06e3df9',
  P: 'd_181005ca270b45408b4cdfc954980ca2',
  Q: 'd_4130f1d9d365d9f1633536e959f62bb7',
  R: 'd_2b8c54b2a490d2fa36b925289e5d9572',
  S: 'd_df7d2d661c0c11a7c367c9ee4bf896c1',
  T: 'd_72f37e5c5d192951ddc5513c2b134482',
  U: 'd_0cc5f52a1f298b916f317800251057f3',
  V: 'd_e97e8e7fc55b85a38babf66b0fa46b73',
  W: 'd_af2042c77ffaf0db5d75561ce9ef5688',
  X: 'd_1cd970d8351b42be4a308d628a6dd9d3',
  Y: 'd_31af23fdb79119ed185c256f03cb5773',
  Z: 'd_4e3db8955fdcda6f9944097bef3d2724',
  Others: 'd_300ddc8da4e8f7bdc1bfc62d0d99e2e7',
};

export interface AcraSyncResult {
  synced: boolean;
  skipped: boolean;
  entityCount: number;
  dataAsOf: string | null;
  /** Number of companies whose compliance dates were updated from the synced records. */
  companiesUpdated: number;
  error?: string;
  reason?: 'lock' | 'up-to-date';
}

export interface AcraSyncStateSnapshot {
  collectionLastUpdatedAt: string | null;
  entityCount: number;
}

interface DownloadApiResponse {
  data?: {
    status?: string;
    url?: string;
    message?: string;
  } | null;
}

function getApiKey(): string {
  return process.env.DATAGOV_API_KEY || '';
}

function getApiHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  return {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
}

/**
 * Optional fixed sleep override (ms). Used by tests and one-off backfills to
 * avoid the request-spacing delays. `ACRA_SYNC_SLEEP_MS=0` disables sleeps.
 */
function getSleepOverrideMs(): number | null {
  const raw = process.env.ACRA_SYNC_SLEEP_MS;
  if (!raw || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getSleepBetweenDatasetsMs(): number {
  const override = getSleepOverrideMs();
  if (override !== null) return override;
  return getApiKey() ? 3_000 : 13_000;
}

export function getPollBackoffMs(): number {
  const override = getSleepOverrideMs();
  if (override !== null) return override;
  return 10_000;
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the collection's last-updated time, or null when unavailable.
 */
export async function getAcraCollectionLastUpdatedAt(): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(
      METADATA_URL,
      { method: 'GET', headers: getApiHeaders(), cache: 'no-store' },
      REQUEST_TIMEOUT_MS
    );
    if (!response.ok) {
      throw new Error(`collection metadata returned ${response.status}`);
    }

    const data = (await response.json()) as {
      data?: { collectionMetadata?: { lastUpdatedAt?: unknown } };
    };
    const lastUpdatedAt = data?.data?.collectionMetadata?.lastUpdatedAt;
    return typeof lastUpdatedAt === 'string' && lastUpdatedAt.trim() ? lastUpdatedAt : null;
  } catch (error) {
    log.warn('ACRA collection metadata lookup failed', { error: safeErrorMessage(error) });
    return null;
  }
}

/**
 * Read the sync state singleton row (used by the name check for the
 * "data as of" value and empty-table detection).
 */
export async function getAcraSyncState(): Promise<AcraSyncStateSnapshot | null> {
  const row = await prisma.acraSyncState.findUnique({ where: { id: 'main' } });
  if (!row) return null;
  return {
    collectionLastUpdatedAt: row.collectionLastUpdatedAt,
    entityCount: row.entityCount,
  };
}

/**
 * Claim the sync lock via the singleton state row. Prevents overlapping runs
 * within one process, between cron/manual triggers, and across app instances
 * (every instance initializes the scheduler).
 */
async function claimSyncLock(): Promise<boolean> {
  const existing = await prisma.acraSyncState.findUnique({ where: { id: 'main' } });
  if (!existing) {
    try {
      await prisma.acraSyncState.create({ data: { id: 'main', lastStartedAt: new Date() } });
      return true;
    } catch {
      // Row created concurrently by another instance; fall through to the
      // update-based claim below.
    }
  }

  const claimed = await prisma.acraSyncState.updateMany({
    where: {
      OR: [
        { lastStartedAt: null },
        { lastStartedAt: { lt: new Date(Date.now() - SYNC_LOCK_WINDOW_MS) } },
      ],
    },
    data: { lastStartedAt: new Date() },
  });
  return claimed.count === 1;
}

async function releaseSyncLock(data: {
  lastError?: string | null;
  lastCompletedAt?: Date | null;
} = {}): Promise<void> {
  await prisma.acraSyncState.updateMany({
    where: { id: 'main' },
    data: { lastStartedAt: null, ...data },
  });
}

/**
 * Obtain a download URL for one dataset via the initiate/poll endpoints.
 */
async function requestDownloadUrl(datasetId: string): Promise<string> {
  const initiate = await fetchWithTimeout(
    `${API_HOST}/v1/public/api/datasets/${datasetId}/initiate-download`,
    { method: 'GET', headers: getApiHeaders(), cache: 'no-store' },
    REQUEST_TIMEOUT_MS
  );

  if (initiate.ok) {
    const body = (await initiate.json()) as DownloadApiResponse;
    if (body?.data?.url) return body.data.url;
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const poll = await fetchWithTimeout(
      `${API_HOST}/v1/public/api/datasets/${datasetId}/poll-download`,
      { method: 'GET', headers: getApiHeaders(), cache: 'no-store' },
      REQUEST_TIMEOUT_MS
    );

    if (!poll.ok) {
      throw new Error(`dataset ${datasetId} download poll returned ${poll.status}`);
    }

    const body = (await poll.json()) as DownloadApiResponse;
    if (body?.data?.url) return body.data.url;
    if (body?.data?.status !== 'DOWNLOAD_PROCESSING') {
      throw new Error(
        `dataset ${datasetId} download returned unexpected status: ${body?.data?.status ?? 'unknown'}`
      );
    }

    await sleep(getPollBackoffMs());
  }

  throw new Error(`dataset ${datasetId} download did not become ready`);
}

/**
 * Stream one dataset CSV into the acra_entity table.
 * Returns the number of rows imported.
 */
async function importDataset(datasetId: string, dataAsOf: string): Promise<number> {
  const url = await requestDownloadUrl(datasetId);

  const response = await fetchWithTimeout(
    url,
    { method: 'GET', headers: { 'User-Agent': USER_AGENT } },
    DOWNLOAD_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new Error(`dataset ${datasetId} CSV download returned ${response.status}`);
  }
  if (!response.body) {
    throw new Error(`dataset ${datasetId} CSV download returned an empty body`);
  }

  const stream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  const parser = parseStream(stream, { headers: true });

  let batch: Prisma.AcraEntityCreateManyInput[] = [];
  let imported = 0;

  for await (const rawRow of parser) {
    const mapped = mapCsvRow(rawRow as Record<string, string>);
    if (!mapped) continue;

    batch.push({
      uen: mapped.uen,
      entityName: mapped.entityName,
      entityStatus: mapped.entityStatus,
      entityType: mapped.entityType,
      companyTypeDescription: mapped.companyTypeDescription,
      registrationIncorporateDate: mapped.registrationIncorporateDate,
      block: mapped.block,
      streetName: mapped.streetName,
      levelNo: mapped.levelNo,
      unitNo: mapped.unitNo,
      buildingName: mapped.buildingName,
      postalCode: mapped.postalCode,
      address: mapped.address,
      accountDueDate: mapped.accountDueDate,
      annualReturnDate: mapped.annualReturnDate,
      primarySsicCode: mapped.primarySsicCode,
      primarySsicDescription: mapped.primarySsicDescription,
      secondarySsicCode: mapped.secondarySsicCode,
      secondarySsicDescription: mapped.secondarySsicDescription,
      noOfOfficers: mapped.noOfOfficers,
      formerEntityName1: mapped.formerEntityName1,
      uenOfAuditFirm1: mapped.uenOfAuditFirm1,
      dataAsOf,
    });

    if (batch.length >= IMPORT_BATCH_SIZE) {
      await insertBatch(batch);
      imported += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await insertBatch(batch);
    imported += batch.length;
  }

  return imported;
}

// (camelCase input field, snake_case column) pairs, in column order.
const ACRA_FIELD_COLUMN_PAIRS = [
  ['uen', 'uen'],
  ['entityName', 'entity_name'],
  ['entityStatus', 'entity_status'],
  ['entityType', 'entity_type'],
  ['companyTypeDescription', 'company_type_description'],
  ['registrationIncorporateDate', 'registration_incorporate_date'],
  ['block', 'block'],
  ['streetName', 'street_name'],
  ['levelNo', 'level_no'],
  ['unitNo', 'unit_no'],
  ['buildingName', 'building_name'],
  ['postalCode', 'postal_code'],
  ['address', 'address'],
  ['accountDueDate', 'account_due_date'],
  ['annualReturnDate', 'annual_return_date'],
  ['primarySsicCode', 'primary_ssic_code'],
  ['primarySsicDescription', 'primary_ssic_description'],
  ['secondarySsicCode', 'secondary_ssic_code'],
  ['secondarySsicDescription', 'secondary_ssic_description'],
  ['noOfOfficers', 'no_of_officers'],
  ['formerEntityName1', 'former_entity_name1'],
  ['uenOfAuditFirm1', 'uen_of_audit_firm1'],
  ['dataAsOf', 'data_as_of'],
] as const;

const ACRA_FIELD_NAMES = ACRA_FIELD_COLUMN_PAIRS.map(([field]) => field);
const ACRA_COLUMN_NAMES = ACRA_FIELD_COLUMN_PAIRS.map(([, column]) => column);

/**
 * Bulk upsert a batch of mapped rows with `INSERT ... ON CONFLICT (uen) DO
 * UPDATE`. Unlike `createMany({ skipDuplicates })`, existing rows are updated
 * with the new snapshot values (e.g. when new columns were added or entity
 * statuses changed between monthly refreshes).
 *
 * Values are passed as text[] parameters via unnest (one parameter per
 * column, regardless of batch size).
 */
async function insertBatch(batch: Prisma.AcraEntityCreateManyInput[]): Promise<void> {
  if (batch.length === 0) return;

  const arrays = ACRA_FIELD_NAMES.map((field) =>
    batch.map((row) => (row[field] as string | undefined) ?? '')
  );

  const columns = [
    ...ACRA_COLUMN_NAMES.map((column) => `"${column}"`),
    '"created_at"',
    '"updated_at"',
  ].join(', ');

  const placeholders = arrays.map((_array, index) => `$${index + 1}::text[]`).join(', ');

  const setClause = [
    ...ACRA_COLUMN_NAMES.map((column) => `"${column}" = EXCLUDED."${column}"`),
    '"updated_at" = NOW()',
  ].join(',\n      ');

  await prisma.$queryRawUnsafe(
    `
    INSERT INTO "acra_entity" (${columns})
    SELECT *, NOW(), NOW() FROM unnest(${placeholders})
    ON CONFLICT ("uen") DO UPDATE SET
      ${setClause}
  `,
    ...arrays
  );
}

/**
 * Compare the stored collection last-updated time against the API's and
 * re-import the full dataset only when they differ.
 *
 * Pass `{ force: true }` (used by the manual "Sync now" trigger) to skip the
 * up-to-date check and always re-import.
 */
export async function syncAcraDataIfUpdated(
  options: { force?: boolean } = {}
): Promise<AcraSyncResult> {
  const force = options.force === true;

  if (!(await claimSyncLock())) {
    log.info('ACRA sync skipped: another sync run holds the lock');
    return { synced: false, skipped: true, reason: 'lock', entityCount: 0, dataAsOf: null, companiesUpdated: 0 };
  }

  try {
    const lastUpdatedAt = await getAcraCollectionLastUpdatedAt();
    if (!lastUpdatedAt) {
      throw new Error('Could not determine the ACRA collection last-updated time');
    }

    const state = await prisma.acraSyncState.findUnique({ where: { id: 'main' } });
    if (!force && state?.collectionLastUpdatedAt === lastUpdatedAt && state.entityCount > 0) {
      log.info('ACRA sync skipped: local data is up to date', { dataAsOf: lastUpdatedAt });
      await releaseSyncLock({ lastError: null, lastCompletedAt: new Date() });
      return {
        synced: false,
        skipped: true,
        reason: 'up-to-date',
        entityCount: state.entityCount,
        dataAsOf: lastUpdatedAt,
        companiesUpdated: 0,
      };
    }

    const datasetIds = Object.values(DATASET_BY_LETTER);
    let importedTotal = 0;

    for (let index = 0; index < datasetIds.length; index += 1) {
      const datasetId = datasetIds[index];
      log.info(`Importing ACRA dataset ${index + 1}/${datasetIds.length} (${datasetId})`);
      importedTotal += await importDataset(datasetId, lastUpdatedAt);

      if (index < datasetIds.length - 1) {
        await sleep(getSleepBetweenDatasetsMs());
      }
    }

    // Remove rows belonging to previous snapshots only after every dataset
    // imported successfully.
    await prisma.acraEntity.deleteMany({ where: { dataAsOf: { not: lastUpdatedAt } } });
    const entityCount = await prisma.acraEntity.count();

    await prisma.acraSyncState.upsert({
      where: { id: 'main' },
      create: {
        id: 'main',
        collectionLastUpdatedAt: lastUpdatedAt,
        entityCount,
        lastCompletedAt: new Date(),
      },
      update: {
        collectionLastUpdatedAt: lastUpdatedAt,
        entityCount,
        lastCompletedAt: new Date(),
        lastError: null,
        lastStartedAt: null,
      },
    });

    // Propagate the freshly synced ACRA compliance dates to companies.
    // Best-effort: an enrichment failure must not fail the sync itself.
    let companiesUpdated = 0;
    try {
      companiesUpdated = await updateCompaniesFromAcraRecords();
    } catch (error) {
      log.warn('ACRA sync completed, but company compliance enrichment failed', {
        error: safeErrorMessage(error),
      });
    }

    log.info('ACRA sync completed', {
      importedRows: importedTotal,
      entityCount,
      dataAsOf: lastUpdatedAt,
      companiesUpdated,
    });

    return {
      synced: true,
      skipped: false,
      entityCount,
      dataAsOf: lastUpdatedAt,
      companiesUpdated,
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    log.error('ACRA sync failed', { error: message });

    await prisma.acraSyncState.upsert({
      where: { id: 'main' },
      create: { id: 'main', lastError: message },
      update: { lastError: message, lastStartedAt: null },
    });

    return { synced: false, skipped: false, entityCount: 0, dataAsOf: null, companiesUpdated: 0, error: message };
  }
}
