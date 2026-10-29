/**
 * Public Holiday Sync Service
 *
 * Keeps a local copy of MOM's official Singapore public holidays (data.gov.sg)
 * and synchronizes it into every active Singapore business calendar.
 *
 * Flow: read dataset metadata -> download only when the source changed (or
 * when forced) -> validate and normalize -> replace the local snapshot in one
 * transaction -> synchronize calendars from the local snapshot.
 *
 * Deadline evaluation never calls data.gov.sg; it reads business calendars
 * from the database. A failed download or parse leaves the previous snapshot
 * and every calendar untouched.
 */

import {
  downloadDataGovSgDatasetText,
  fetchDataGovSgDatasetMetadata,
} from '@/lib/external/data-gov-sg';
import logger, { safeErrorMessage } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import {
  listPublicHolidaySyncCalendars,
  syncBusinessCalendarWithPublicHolidays,
  type PublicHolidayCalendarSyncResult,
  type PublicHolidaySourceSnapshot,
} from '@/services/business-calendar';
import {
  DEFAULT_PUBLIC_HOLIDAY_DATASET_ID,
  PUBLIC_HOLIDAY_JURISDICTION_SG,
  PUBLIC_HOLIDAY_PROVIDER_MOM,
  type PublicHolidayCalendarSyncSummary,
  type PublicHolidayRefreshResult,
  type PublicHolidaySourceStatus,
} from '@/services/public-holiday/constants';
import {
  hashPublicHolidayRecords,
  normalizeMomPublicHolidayCsv,
  publicHolidayCoverage,
  type PublicHolidayRecord,
} from '@/services/public-holiday/normalize';
import { formatDateOnly, parseDateOnly } from '@/services/service-schedule/date-only';
import type { DateOnly } from '@/services/service-schedule';

const log = logger.child('public-holiday-sync');

const PROVIDER = PUBLIC_HOLIDAY_PROVIDER_MOM;
const JURISDICTION = PUBLIC_HOLIDAY_JURISDICTION_SG;
const SYNC_LOCK_WINDOW_MS = 30 * 60 * 1000;
const stateKey = { provider_jurisdictionCode: { provider: PROVIDER, jurisdictionCode: JURISDICTION } };

export type PublicHolidaySyncOptions = {
  force?: boolean;
  /** Keep only these tenants' calendar results in the returned summary. */
  reportTenantId?: string;
};

export type PublicHolidaySyncResult = PublicHolidayRefreshResult & {
  calendarResults: PublicHolidayCalendarSyncResult[];
};

/** Configured dataset id (DATAGOV_PUBLIC_HOLIDAY_DATASET_ID), else MOM's consolidated dataset. */
export function getPublicHolidayDatasetId(): string {
  return process.env.DATAGOV_PUBLIC_HOLIDAY_DATASET_ID?.trim() || DEFAULT_PUBLIC_HOLIDAY_DATASET_ID;
}

function emptySummary(): PublicHolidayCalendarSyncSummary {
  return { calendarsChecked: 0, calendarsUpdated: 0, calendarsFailed: 0, holidaysAdded: 0, holidaysUpdated: 0, holidaysArchived: 0 };
}

/**
 * Claim the sync lock on the state row so overlapping runs (cron on several
 * app instances, a manual check) cannot refresh at the same time.
 */
async function claimSyncLock(): Promise<boolean> {
  const existing = await prisma.publicHolidaySyncState.findUnique({ where: stateKey });
  if (!existing) {
    try {
      await prisma.publicHolidaySyncState.create({
        data: { provider: PROVIDER, jurisdictionCode: JURISDICTION, lastStartedAt: new Date() },
      });
      return true;
    } catch {
      // Created concurrently by another instance; fall through to the claim.
    }
  }
  const claimed = await prisma.publicHolidaySyncState.updateMany({
    where: {
      provider: PROVIDER,
      jurisdictionCode: JURISDICTION,
      OR: [
        { lastStartedAt: null },
        { lastStartedAt: { lt: new Date(Date.now() - SYNC_LOCK_WINDOW_MS) } },
      ],
    },
    data: { lastStartedAt: new Date() },
  });
  return claimed.count === 1;
}

async function releaseSyncLock(data: { lastError: string | null; lastCompletedAt?: Date }): Promise<void> {
  await prisma.publicHolidaySyncState.updateMany({
    where: { provider: PROVIDER, jurisdictionCode: JURISDICTION },
    data: { lastStartedAt: null, ...data },
  });
}

/**
 * Replace the local snapshot atomically. Records are upserted by date, rows
 * whose date left the source are removed, and the state row is updated, all
 * in one transaction: a failure leaves the previous snapshot as it was.
 */
async function storeSnapshot(
  records: PublicHolidayRecord[],
  meta: { datasetId: string; lastUpdatedAt: string; hash: string },
): Promise<void> {
  const coverage = publicHolidayCoverage(records);
  if (!coverage) throw new Error('Public holiday dataset is empty');
  await runSerializableTransaction(prisma, async (tx) => {
    for (const record of records) {
      const data = {
        name: record.name,
        description: record.description,
        sourceDatasetId: meta.datasetId,
        sourceRecordKey: record.recordKey,
        dataAsOf: meta.lastUpdatedAt,
      };
      await tx.publicHolidaySourceRecord.upsert({
        where: {
          provider_jurisdictionCode_date: { provider: PROVIDER, jurisdictionCode: JURISDICTION, date: parseDateOnly(record.date) },
        },
        create: { provider: PROVIDER, jurisdictionCode: JURISDICTION, date: parseDateOnly(record.date), ...data },
        update: data,
      });
    }
    await tx.publicHolidaySourceRecord.deleteMany({
      where: {
        provider: PROVIDER,
        jurisdictionCode: JURISDICTION,
        date: { notIn: records.map((record) => parseDateOnly(record.date)) },
      },
    });
    await tx.publicHolidaySyncState.update({
      where: stateKey,
      data: {
        datasetId: meta.datasetId,
        sourceLastUpdatedAt: meta.lastUpdatedAt,
        dataAsOf: meta.lastUpdatedAt,
        sourceHash: meta.hash,
        recordCount: records.length,
        coverageStart: parseDateOnly(coverage.start),
        coverageEnd: parseDateOnly(coverage.end),
        lastCheckedAt: new Date(),
      },
    });
  });
}

/** The locally stored snapshot, or null before the first successful import. */
export async function loadPublicHolidaySourceSnapshot(): Promise<PublicHolidaySourceSnapshot | null> {
  const state = await prisma.publicHolidaySyncState.findUnique({ where: stateKey });
  if (!state?.datasetId || !state.dataAsOf || !state.coverageStart || !state.coverageEnd || state.recordCount === 0) return null;
  const records = await prisma.publicHolidaySourceRecord.findMany({
    where: { provider: PROVIDER, jurisdictionCode: JURISDICTION },
    orderBy: { date: 'asc' },
  });
  if (records.length === 0) return null;
  return {
    provider: PROVIDER,
    jurisdictionCode: JURISDICTION,
    datasetId: state.datasetId,
    dataAsOf: state.dataAsOf,
    coverageStart: formatDateOnly(state.coverageStart),
    coverageEnd: formatDateOnly(state.coverageEnd),
    holidays: records.map((record) => ({
      date: formatDateOnly(record.date) as DateOnly,
      name: record.name,
      description: record.description,
      recordKey: record.sourceRecordKey,
    })),
  };
}

/**
 * Synchronize every applicable calendar from the local snapshot. One
 * calendar's failure (for example a revision that keeps moving) does not stop
 * the others; the next run picks it up again.
 */
export async function syncBusinessCalendarsFromPublicHolidaySource(
  snapshot: PublicHolidaySourceSnapshot,
): Promise<{ summary: PublicHolidayCalendarSyncSummary; results: PublicHolidayCalendarSyncResult[] }> {
  const summary = emptySummary();
  const results: PublicHolidayCalendarSyncResult[] = [];
  const calendars = await listPublicHolidaySyncCalendars(snapshot.jurisdictionCode);
  for (const calendar of calendars) {
    summary.calendarsChecked += 1;
    try {
      const result = await syncBusinessCalendarWithPublicHolidays(calendar.id, calendar.tenantId, snapshot);
      results.push(result);
      if (result.changed) summary.calendarsUpdated += 1;
      summary.holidaysAdded += result.added;
      summary.holidaysUpdated += result.updated;
      summary.holidaysArchived += result.archived;
    } catch (error) {
      summary.calendarsFailed += 1;
      log.warn('Public holiday sync could not update a business calendar', {
        calendarId: calendar.id,
        tenantId: calendar.tenantId,
        error: safeErrorMessage(error),
      });
    }
  }
  return { summary, results };
}

function summarize(results: PublicHolidayCalendarSyncResult[], failed: number): PublicHolidayCalendarSyncSummary {
  return results.reduce((summary, result) => ({
    calendarsChecked: summary.calendarsChecked + 1,
    calendarsUpdated: summary.calendarsUpdated + (result.changed ? 1 : 0),
    calendarsFailed: summary.calendarsFailed,
    holidaysAdded: summary.holidaysAdded + result.added,
    holidaysUpdated: summary.holidaysUpdated + result.updated,
    holidaysArchived: summary.holidaysArchived + result.archived,
  }), { ...emptySummary(), calendarsFailed: failed });
}

/**
 * Check the official source and refresh the local snapshot when it changed
 * (always when `force`), then synchronize business calendars from the local
 * snapshot. Calendars are synchronized on every successful run, so a calendar
 * created since the last source change, or one that failed last time, is
 * brought up to date without another download.
 */
export async function syncPublicHolidaysIfUpdated(options: PublicHolidaySyncOptions = {}): Promise<PublicHolidaySyncResult> {
  const force = options.force === true;
  const idle = {
    synced: false, skipped: false, sourceChanged: false, recordCount: 0, dataAsOf: null, ...emptySummary(), calendarResults: [],
  };

  if (!(await claimSyncLock())) {
    log.info('Public holiday sync skipped: another run holds the lock');
    return { ...idle, skipped: true, reason: 'lock' };
  }

  try {
    const datasetId = getPublicHolidayDatasetId();
    const metadata = await fetchDataGovSgDatasetMetadata(datasetId);
    const state = await prisma.publicHolidaySyncState.findUnique({ where: stateKey });
    const upToDate = !force
      && state?.datasetId === datasetId
      && state.sourceLastUpdatedAt === metadata.lastUpdatedAt
      && state.recordCount > 0;

    let sourceChanged = false;
    if (upToDate) {
      await prisma.publicHolidaySyncState.update({ where: stateKey, data: { lastCheckedAt: new Date() } });
    } else {
      const csv = await downloadDataGovSgDatasetText(datasetId);
      const records = await normalizeMomPublicHolidayCsv(csv);
      const hash = hashPublicHolidayRecords(records);
      sourceChanged = hash !== state?.sourceHash || datasetId !== state?.datasetId;
      await storeSnapshot(records, { datasetId, lastUpdatedAt: metadata.lastUpdatedAt, hash });
      log.info('Public holiday source refreshed', { datasetId, records: records.length, dataAsOf: metadata.lastUpdatedAt, sourceChanged });
    }

    const snapshot = await loadPublicHolidaySourceSnapshot();
    if (!snapshot) throw new Error('No local public holiday data is available');
    const { summary, results } = await syncBusinessCalendarsFromPublicHolidaySource(snapshot);
    const reported = options.reportTenantId
      ? results.filter((result) => result.tenantId === options.reportTenantId)
      : results;

    await releaseSyncLock({
      lastError: summary.calendarsFailed > 0
        ? `${summary.calendarsFailed} business calendar(s) could not be synchronized; they will be retried on the next run`
        : null,
      lastCompletedAt: new Date(),
    });
    log.info('Public holiday sync completed', { ...summary, dataAsOf: snapshot.dataAsOf, upToDate });

    return {
      synced: !upToDate,
      skipped: upToDate,
      ...(upToDate ? { reason: 'up-to-date' as const } : {}),
      sourceChanged,
      recordCount: snapshot.holidays.length,
      dataAsOf: snapshot.dataAsOf,
      ...(options.reportTenantId ? summarize(reported, 0) : summary),
      calendarResults: reported,
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    log.error('Public holiday sync failed', { error: message });
    await releaseSyncLock({ lastError: message }).catch(() => undefined);
    return { ...idle, error: message };
  }
}

/** Source status for the Business Calendar page. */
export async function getPublicHolidaySourceStatus(): Promise<PublicHolidaySourceStatus> {
  const state = await prisma.publicHolidaySyncState.findUnique({ where: stateKey });
  const bounds = await prisma.publicHolidaySourceRecord.aggregate({
    where: { provider: PROVIDER, jurisdictionCode: JURISDICTION },
    _min: { date: true },
    _max: { date: true },
    _count: { _all: true },
  });
  const inProgress = Boolean(state?.lastStartedAt && state.lastStartedAt.getTime() > Date.now() - SYNC_LOCK_WINDOW_MS);
  return {
    provider: PROVIDER,
    jurisdictionCode: JURISDICTION,
    datasetId: state?.datasetId ?? getPublicHolidayDatasetId(),
    sourceLastUpdatedAt: state?.sourceLastUpdatedAt ?? null,
    dataAsOf: state?.dataAsOf ?? null,
    lastCheckedAt: state?.lastCheckedAt?.toISOString() ?? null,
    lastCompletedAt: state?.lastCompletedAt?.toISOString() ?? null,
    inProgress,
    recordCount: bounds._count._all,
    minYear: bounds._min.date ? bounds._min.date.getUTCFullYear() : null,
    maxYear: bounds._max.date ? bounds._max.date.getUTCFullYear() : null,
    lastError: state?.lastError ?? null,
  };
}
