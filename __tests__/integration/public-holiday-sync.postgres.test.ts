// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DateOnly } from '@/services/service-schedule';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

type PrismaClient = Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;

const DATASET_ID = 'd_8ef23381f9417e4d4254ee8b4dcdb176';
const DOWNLOAD_URL = 'https://s3.ap-southeast-1.amazonaws.com/table-downloads-ingest.data.gov.sg/d_8ef23381f9417e4d4254ee8b4dcdb176/file.csv?X-Amz-Signature=test';

const CSV_V1 = [
  'date,day,holiday',
  "2026-12-25,Friday,Christmas Day",
  "2027-01-01,Friday,New Year's Day",
  '2027-05-01,Saturday,Labour Day',
  '2027-05-01,Saturday,Vesak Day',
  '2027-12-25,Saturday,Christmas Day',
].join('\n');

// 2026 is no longer published, New Year is renamed, 1 May is withdrawn and
// 2028 is added.
const CSV_V3 = [
  'date,day,holiday',
  "2027-01-01,Friday,New Year's Day (Observed)",
  '2027-12-25,Saturday,Christmas Day',
  "2028-01-01,Saturday,New Year's Day",
].join('\n');

type FakeSource = { lastUpdatedAt: string; csv: string; downloadStatus?: number; metadataStatus?: number };

describePostgres('public holiday sync on PostgreSQL', () => {
  let prisma: PrismaClient;
  let source: FakeSource;
  const calls: string[] = [];
  const suffix = randomUUID().slice(0, 8);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const calendarA = randomUUID();
  const calendarB = randomUUID();
  const inactiveCalendarB = randomUUID();

  async function holidays(calendarId: string) {
    const rows = await prisma.businessHoliday.findMany({ where: { calendarId }, orderBy: { date: 'asc' } });
    return rows.map((row) => ({
      ...row,
      day: row.date.toISOString().slice(0, 10),
    }));
  }

  async function revision(calendarId: string) {
    return (await prisma.businessCalendar.findUniqueOrThrow({ where: { id: calendarId } })).revision;
  }

  async function sync(options: { force?: boolean } = {}) {
    const { syncPublicHolidaysIfUpdated } = await import('@/services/public-holiday-sync.service');
    return syncPublicHolidaysIfUpdated(options);
  }

  async function manualEdit(calendarId: string, tenantId: string, holidaysInput: Array<{ date: string; name: string; description: string | null; sourceType?: 'MANUAL' | 'EXTERNAL' }>) {
    const { previewBusinessCalendarImpact, updateBusinessCalendar } = await import('@/services/business-calendar');
    const calendar = await prisma.businessCalendar.findUniqueOrThrow({ where: { id: calendarId } });
    const input = {
      name: calendar.name,
      jurisdictionCode: 'SG',
      timeZone: 'Asia/Singapore',
      weekendDays: calendar.weekendDays,
      holidays: holidaysInput,
      isActive: true,
    };
    const actor = { tenantId, userId: userA };
    const impact = await previewBusinessCalendarImpact(calendarId, input, actor);
    return updateBusinessCalendar(calendarId, {
      ...input,
      expectedRevision: calendar.revision,
      proposedHash: impact.proposedHash,
      previewFingerprint: impact.previewFingerprint,
    }, actor);
  }

  async function activeHolidayInput(calendarId: string) {
    return (await holidays(calendarId))
      .filter((row) => row.isActive)
      .map((row) => ({ date: row.day, name: row.name, description: row.description }));
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    delete process.env.DATAGOV_PUBLIC_HOLIDAY_DATASET_ID;
    prisma = (await import('@/lib/prisma')).getPrisma();
    await prisma.publicHolidaySourceRecord.deleteMany({});
    await prisma.publicHolidaySyncState.deleteMany({});

    for (const [tenantId, name] of [[tenantA, 'A'], [tenantB, 'B']] as const) {
      await prisma.workspace.create({
        data: { id: tenantId, name: `Holiday sync ${name}`, slug: `holiday-sync-${name.toLowerCase()}-${suffix}`, status: 'ACTIVE' },
      });
    }
    await prisma.user.create({
      data: { id: userA, tenantId: tenantA, email: `holiday-${suffix}@example.test`, passwordHash: 'integration-only', firstName: 'Holiday', lastName: 'Admin' },
    });
    await prisma.businessCalendar.create({
      data: {
        id: calendarA,
        tenantId: tenantA,
        name: 'Singapore',
        jurisdictionCode: 'SG',
        timeZone: 'Asia/Singapore',
        holidays: {
          create: [
            { tenantId: tenantA, date: new Date('2019-01-01T00:00:00.000Z'), name: 'Historic holiday' },
            { tenantId: tenantA, date: new Date('2027-12-25T00:00:00.000Z'), name: 'Office Christmas' },
            { tenantId: tenantA, date: new Date('2027-12-31T00:00:00.000Z'), name: 'Company shutdown' },
          ],
        },
      },
    });
    await prisma.businessCalendar.create({
      data: {
        id: calendarB,
        tenantId: tenantB,
        name: 'Singapore',
        jurisdictionCode: 'SG',
        timeZone: 'Asia/Singapore',
        // An administrator removed this date earlier; the sync must respect it.
        holidays: { create: [{ tenantId: tenantB, date: new Date('2026-12-25T00:00:00.000Z'), name: 'Removed by admin', isActive: false }] },
      },
    });
    await prisma.businessCalendar.create({
      data: { id: inactiveCalendarB, tenantId: tenantB, name: 'Retired', jurisdictionCode: 'SG', timeZone: 'Asia/Singapore', isActive: false, archivedAt: new Date() },
    });

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === `https://api-production.data.gov.sg/v2/public/api/datasets/${DATASET_ID}/metadata`) {
        if (source.metadataStatus) return new Response('unavailable', { status: source.metadataStatus });
        return Response.json({ code: 0, data: { datasetId: DATASET_ID, name: 'Singapore Public Holidays (consolidated)', lastUpdatedAt: source.lastUpdatedAt, format: 'CSV', managedBy: 'Ministry of Manpower' } });
      }
      if (url === `https://api-open.data.gov.sg/v1/public/api/datasets/${DATASET_ID}/initiate-download`) {
        return Response.json({ code: 0, data: { message: 'Download successfully initiated', url: DOWNLOAD_URL } });
      }
      if (url === DOWNLOAD_URL) {
        if (source.downloadStatus) return new Response('error', { status: source.downloadStatus });
        return new Response(source.csv, { status: 200 });
      }
      throw new Error(`Unexpected request ${url}`);
    }));
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (!prisma) return;
    for (const tenantId of [tenantA, tenantB]) {
      await prisma.serviceScheduleReconciliationRequest.deleteMany({ where: { tenantId } });
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.businessHoliday.deleteMany({ where: { tenantId } });
      await prisma.businessCalendar.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.deleteMany({ where: { id: tenantId } });
    }
    await prisma.publicHolidaySourceRecord.deleteMany({});
    await prisma.publicHolidaySyncState.deleteMany({});
    await prisma.$disconnect();
  });

  it('imports the official list and synchronizes each tenant calendar, keeping manual holidays', async () => {
    source = { lastUpdatedAt: '2026-07-03T16:04:00+08:00', csv: CSV_V1 };
    const manualBefore = (await holidays(calendarA)).filter((row) => row.sourceType === 'MANUAL');

    const result = await sync();

    expect(result).toMatchObject({ synced: true, skipped: false, sourceChanged: true, recordCount: 4, dataAsOf: '2026-07-03T16:04:00+08:00' });
    expect(result.error).toBeUndefined();
    const records = await prisma.publicHolidaySourceRecord.findMany({ orderBy: { date: 'asc' } });
    expect(records.map((record) => [record.date.toISOString().slice(0, 10), record.name])).toEqual([
      ['2026-12-25', 'Christmas Day'],
      ['2027-01-01', "New Year's Day"],
      ['2027-05-01', 'Labour Day / Vesak Day'],
      ['2027-12-25', 'Christmas Day'],
    ]);

    // Tenant A: three official holidays added; 25 Dec 2027 is already covered
    // by the manual "Office Christmas" row, which stays manual.
    const rowsA = await holidays(calendarA);
    expect(rowsA.filter((row) => row.isActive).map((row) => [row.day, row.name, row.sourceType])).toEqual([
      ['2019-01-01', 'Historic holiday', 'MANUAL'],
      ['2026-12-25', 'Christmas Day', 'EXTERNAL'],
      ['2027-01-01', "New Year's Day", 'EXTERNAL'],
      ['2027-05-01', 'Labour Day / Vesak Day', 'EXTERNAL'],
      ['2027-12-25', 'Office Christmas', 'MANUAL'],
      ['2027-12-31', 'Company shutdown', 'MANUAL'],
    ]);
    for (const row of manualBefore) {
      const after = rowsA.find((candidate) => candidate.id === row.id)!;
      expect({ ...after, day: undefined }).toEqual({ ...row, day: undefined });
    }
    expect(rowsA.find((row) => row.day === '2027-01-01')).toMatchObject({
      tenantId: tenantA,
      sourceProvider: 'DATA_GOV_SG_MOM',
      sourceDatasetId: DATASET_ID,
      sourceRecordKey: '2027-01-01',
      sourceDataAsOf: '2026-07-03T16:04:00+08:00',
    });
    expect(await revision(calendarA)).toBe(2);

    // Tenant B gets its own rows, its archived manual date stays archived and
    // the archived calendar is left alone.
    const rowsB = await holidays(calendarB);
    expect(rowsB.map((row) => [row.day, row.sourceType, row.isActive])).toEqual([
      ['2026-12-25', 'MANUAL', false],
      ['2027-01-01', 'EXTERNAL', true],
      ['2027-05-01', 'EXTERNAL', true],
      ['2027-12-25', 'EXTERNAL', true],
    ]);
    expect(rowsB[0].name).toBe('Removed by admin');
    expect(rowsB.every((row) => row.tenantId === tenantB)).toBe(true);
    expect(await revision(calendarB)).toBe(2);
    expect(await holidays(inactiveCalendarB)).toEqual([]);
    expect(await revision(inactiveCalendarB)).toBe(1);

    const audit = await prisma.auditLog.findMany({ where: { tenantId: tenantA, entityId: calendarA } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ summary: 'Synchronized Singapore public holidays from MOM', changeSource: 'SYSTEM', userId: null });
    expect(audit[0].metadata).toMatchObject({ provider: 'DATA_GOV_SG_MOM', datasetId: DATASET_ID, holidaysAdded: 3, holidaysUpdated: 0, holidaysArchived: 0, manualHolidaysKept: 1 });
    expect(audit[0].changes).toMatchObject({ revision: { old: 1, new: 2 } });
    const requests = await prisma.serviceScheduleReconciliationRequest.findMany({ where: { tenantId: tenantA } });
    expect(requests).toEqual([expect.objectContaining({ scopeType: 'BUSINESS_CALENDAR', scopeId: calendarA, triggerType: 'BUSINESS_CALENDAR_CHANGED' })]);
  });

  it('skips the download and leaves calendars alone when the source has not changed', async () => {
    const result = await sync();

    expect(result).toMatchObject({ synced: false, skipped: true, reason: 'up-to-date', calendarsUpdated: 0 });
    expect(calls).toEqual([`https://api-production.data.gov.sg/v2/public/api/datasets/${DATASET_ID}/metadata`]);
    expect(await revision(calendarA)).toBe(2);
    expect(await prisma.auditLog.count({ where: { tenantId: tenantA, entityId: calendarA } })).toBe(1);
  });

  it('keeps the previous source and calendars when a refresh fails', async () => {
    const recordsBefore = await prisma.publicHolidaySourceRecord.findMany({ orderBy: { date: 'asc' } });
    const holidaysBefore = await holidays(calendarA);

    source = { lastUpdatedAt: '2026-08-01T09:00:00+08:00', csv: 'date,day,holiday\n2027-02-30,Tuesday,Not a date' };
    const invalid = await sync();
    expect(invalid.error).toContain('invalid date');

    source = { lastUpdatedAt: '2026-08-01T09:00:00+08:00', csv: CSV_V3, downloadStatus: 503 };
    const unavailable = await sync();
    expect(unavailable.error).toContain('503');

    expect(await prisma.publicHolidaySourceRecord.findMany({ orderBy: { date: 'asc' } })).toEqual(recordsBefore);
    expect(await holidays(calendarA)).toEqual(holidaysBefore);
    expect(await revision(calendarA)).toBe(2);
    const state = await prisma.publicHolidaySyncState.findFirstOrThrow();
    expect(state).toMatchObject({ sourceLastUpdatedAt: '2026-07-03T16:04:00+08:00', lastStartedAt: null });
    expect(state.lastError).toContain('503');
  });

  it('renames, adds and archives official holidays only inside the source coverage', async () => {
    source = { lastUpdatedAt: '2026-09-01T09:00:00+08:00', csv: CSV_V3 };
    const result = await sync();

    expect(result).toMatchObject({ synced: true, sourceChanged: true, recordCount: 3 });
    const rows = await holidays(calendarA);
    expect(rows.map((row) => [row.day, row.name, row.sourceType, row.isActive])).toEqual([
      ['2019-01-01', 'Historic holiday', 'MANUAL', true],
      // 2026 is outside the new coverage (2027-2028), so it is kept.
      ['2026-12-25', 'Christmas Day', 'EXTERNAL', true],
      ['2027-01-01', "New Year's Day (Observed)", 'EXTERNAL', true],
      ['2027-05-01', 'Labour Day / Vesak Day', 'EXTERNAL', false],
      ['2027-12-25', 'Office Christmas', 'MANUAL', true],
      ['2027-12-31', 'Company shutdown', 'MANUAL', true],
      ['2028-01-01', "New Year's Day", 'EXTERNAL', true],
    ]);
    expect(await revision(calendarA)).toBe(3);
    expect(await prisma.publicHolidaySourceRecord.count()).toBe(3);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: tenantA, entityId: calendarA }, orderBy: { createdAt: 'desc' } });
    expect(audit.metadata).toMatchObject({ holidaysAdded: 1, holidaysUpdated: 1, holidaysArchived: 1, dataAsOf: '2026-09-01T09:00:00+08:00' });
  });

  it('does not let a manual edit rename or remove an official holiday without converting it', async () => {
    const current = await activeHolidayInput(calendarA);
    const renamed = current.map((row) => (row.date === '2027-01-01' ? { ...row, name: 'Renamed' } : row));
    await expect(manualEdit(calendarA, tenantA, renamed)).rejects.toThrow('Convert it to manual before editing it');
    const removed = current.filter((row) => row.date !== '2027-01-01');
    await expect(manualEdit(calendarA, tenantA, removed)).rejects.toThrow('Convert it to manual before removing it');
    const claimed = [...current, { date: '2028-06-01', name: 'Fake official', description: null, sourceType: 'EXTERNAL' as const }];
    await expect(manualEdit(calendarA, tenantA, claimed)).rejects.toThrow('cannot be marked as official');
    expect(await revision(calendarA)).toBe(3);
  });

  it('keeps an official holiday that was converted to manual, and keeps it removed', async () => {
    const current = await activeHolidayInput(calendarA);
    await manualEdit(calendarA, tenantA, current.map((row) => (row.date === '2028-01-01'
      ? { ...row, name: 'New Year (firm)', sourceType: 'MANUAL' as const }
      : row)));
    const converted = (await holidays(calendarA)).find((row) => row.day === '2028-01-01')!;
    expect(converted).toMatchObject({ name: 'New Year (firm)', sourceType: 'MANUAL', sourceProvider: 'DATA_GOV_SG_MOM', isActive: true });

    const revisionAfterConvert = await revision(calendarA);
    expect((await sync({ force: true })).calendarResults.find((result) => result.calendarId === calendarA)).toMatchObject({ changed: false, coveredByManual: 2 });
    expect(await revision(calendarA)).toBe(revisionAfterConvert);

    await manualEdit(calendarA, tenantA, (await activeHolidayInput(calendarA)).filter((row) => row.date !== '2028-01-01'));
    const revisionAfterRemove = await revision(calendarA);
    await sync({ force: true });
    expect((await holidays(calendarA)).find((row) => row.day === '2028-01-01')).toMatchObject({ isActive: false, sourceType: 'MANUAL' });
    expect(await revision(calendarA)).toBe(revisionAfterRemove);
  });

  it('rebuilds against a concurrent manual edit instead of overwriting it', async () => {
    const { loadPublicHolidaySourceSnapshot } = await import('@/services/public-holiday-sync.service');
    const { syncBusinessCalendarWithPublicHolidays } = await import('@/services/business-calendar');
    const snapshot = (await loadPublicHolidaySourceSnapshot())!;
    const withLabourDay = {
      ...snapshot,
      coverageEnd: '2028-12-31' as DateOnly,
      holidays: [...snapshot.holidays, { date: '2028-05-01' as DateOnly, name: 'Labour Day', description: null, recordKey: '2028-05-01' }],
    };
    let interfered = false;

    const result = await syncBusinessCalendarWithPublicHolidays(calendarA, tenantA, withLabourDay, {
      beforeWrite: async () => {
        if (interfered) return;
        interfered = true;
        // An administrator saves a manual holiday on the same date while the
        // sync is between planning and writing.
        await manualEdit(calendarA, tenantA, [
          ...(await activeHolidayInput(calendarA)),
          { date: '2028-05-01', name: 'Office closure', description: null },
        ]);
      },
    });

    expect(interfered).toBe(true);
    expect(result).toMatchObject({ changed: false, coveredByManual: 2 });
    const rows = (await holidays(calendarA)).filter((row) => row.day === '2028-05-01');
    expect(rows).toEqual([expect.objectContaining({ name: 'Office closure', sourceType: 'MANUAL', isActive: true })]);
  });

  it('makes a manual save based on a pre-sync preview fail instead of overwriting the sync', async () => {
    const { previewBusinessCalendarImpact, updateBusinessCalendar } = await import('@/services/business-calendar');
    const calendar = await prisma.businessCalendar.findUniqueOrThrow({ where: { id: calendarB } });
    const input = {
      name: calendar.name,
      jurisdictionCode: 'SG',
      timeZone: 'Asia/Singapore',
      weekendDays: calendar.weekendDays,
      holidays: [...(await activeHolidayInput(calendarB)), { date: '2029-01-02', name: 'Team day', description: null }],
      isActive: true,
    };
    const impact = await previewBusinessCalendarImpact(calendarB, input, { tenantId: tenantB, userId: userA });

    // The sync lands between the administrator's preview and save.
    const { syncBusinessCalendarWithPublicHolidays } = await import('@/services/business-calendar');
    const { loadPublicHolidaySourceSnapshot } = await import('@/services/public-holiday-sync.service');
    const snapshot = (await loadPublicHolidaySourceSnapshot())!;
    await syncBusinessCalendarWithPublicHolidays(calendarB, tenantB, {
      ...snapshot,
      coverageEnd: '2029-12-31' as DateOnly,
      holidays: [...snapshot.holidays, { date: '2029-01-01' as DateOnly, name: "New Year's Day", description: null, recordKey: '2029-01-01' }],
    });

    await expect(updateBusinessCalendar(calendarB, {
      ...input,
      expectedRevision: calendar.revision,
      proposedHash: impact.proposedHash,
      previewFingerprint: impact.previewFingerprint,
    }, { tenantId: tenantB, userId: userA })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect((await holidays(calendarB)).find((row) => row.day === '2029-01-01')).toMatchObject({ sourceType: 'EXTERNAL', isActive: true });
  });
});
