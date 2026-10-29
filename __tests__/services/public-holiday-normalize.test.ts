import { describe, expect, it } from 'vitest';
import {
  hashPublicHolidayRecords,
  normalizeMomPublicHolidayCsv,
  publicHolidayCoverage,
} from '@/services/public-holiday/normalize';
import { isAllowedDataGovSgDownloadUrl } from '@/lib/external/data-gov-sg';

describe('MOM public holiday normalization', () => {
  it('keeps published observed holidays and civil dates exactly as MOM lists them', async () => {
    const records = await normalizeMomPublicHolidayCsv([
      '﻿Date,Day,Holiday',
      '2026-05-31,Sunday,Vesak Day',
      '2026-06-01,Monday,Vesak Day (Observed)',
      '2026-01-01,Thursday,"New Year\'s Day"',
    ].join('\r\n'));

    expect(records).toEqual([
      { date: '2026-01-01', name: "New Year's Day", description: null, recordKey: '2026-01-01' },
      { date: '2026-05-31', name: 'Vesak Day', description: null, recordKey: '2026-05-31' },
      { date: '2026-06-01', name: 'Vesak Day (Observed)', description: null, recordKey: '2026-06-01' },
    ]);
  });

  it('merges two holidays on one date into one deterministic entry', async () => {
    const forward = await normalizeMomPublicHolidayCsv('date,day,holiday\n2027-05-01,Saturday,Labour Day\n2027-05-01,Saturday,Holiday A');
    const reversed = await normalizeMomPublicHolidayCsv('date,day,holiday\n2027-05-01,Saturday,Holiday A\n2027-05-01,Saturday,Labour Day');

    expect(forward).toEqual([{ date: '2027-05-01', name: 'Holiday A / Labour Day', description: null, recordKey: '2027-05-01' }]);
    expect(reversed).toEqual(forward);
    expect(hashPublicHolidayRecords(reversed)).toBe(hashPublicHolidayRecords(forward));
  });

  it.each([
    ['an impossible date', 'date,day,holiday\n2027-02-30,Tuesday,Nope', 'invalid date'],
    ['a timestamp instead of a date', 'date,day,holiday\n2027-01-01T00:00:00Z,Friday,New Year', 'invalid date'],
    ['a blank name', 'date,day,holiday\n2027-01-01,Friday,', 'no holiday name'],
    ['missing columns', 'when,what\n2027-01-01,New Year', 'missing the date or holiday column'],
    ['no rows', 'date,day,holiday\n', 'empty'],
  ])('rejects the whole dataset for %s', async (_label, csv, message) => {
    await expect(normalizeMomPublicHolidayCsv(csv)).rejects.toThrow(message);
  });

  it('derives whole-year coverage from whatever years the source contains', () => {
    expect(publicHolidayCoverage([{ date: '2027-12-25' as never }, { date: '2020-01-01' as never }])).toEqual({ start: '2020-01-01', end: '2027-12-31' });
    expect(publicHolidayCoverage([])).toBeNull();
  });
});

describe('data.gov.sg download host allowlist', () => {
  it.each([
    ['https://s3.ap-southeast-1.amazonaws.com/table-downloads-ingest.data.gov.sg/d_x/file.csv?sig=1', true],
    ['https://api-open.data.gov.sg/v1/file.csv', true],
    ['http://s3.ap-southeast-1.amazonaws.com/table-downloads-ingest.data.gov.sg/d_x/file.csv', false],
    ['https://s3.ap-southeast-1.amazonaws.com/some-other-bucket/file.csv', false],
    ['https://data.gov.sg.example.com/file.csv', false],
    ['https://user:pass@api-open.data.gov.sg/file.csv', false],
    ['not a url', false],
  ])('%s -> %s', (url, allowed) => {
    expect(isAllowedDataGovSgDownloadUrl(url)).toBe(allowed);
  });
});
