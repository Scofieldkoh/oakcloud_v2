import { describe, expect, it } from 'vitest';
import { getNextCronOccurrence } from '@/lib/cron-utils';

describe('getNextCronOccurrence', () => {
  it('advances a daily timezone schedule past the current execution minute', () => {
    const nextRun = getNextCronOccurrence(
      '0 0 * * *',
      'Asia/Singapore',
      new Date('2026-03-11T16:00:00.118Z')
    );

    expect(nextRun.toISOString()).toBe('2026-03-12T16:00:00.000Z');
  });

  it('respects weekly schedules', () => {
    const nextRun = getNextCronOccurrence(
      '0 0 * * 0',
      'Asia/Singapore',
      new Date('2026-03-11T12:00:00.000Z')
    );

    expect(nextRun.toISOString()).toBe('2026-03-14T16:00:00.000Z');
  });

  it('respects monthly schedules', () => {
    const nextRun = getNextCronOccurrence(
      '0 0 1 * *',
      'Asia/Singapore',
      new Date('2026-03-11T12:00:00.000Z')
    );

    expect(nextRun.toISOString()).toBe('2026-03-31T16:00:00.000Z');
  });

  it('supports stepped minute expressions', () => {
    const nextRun = getNextCronOccurrence('*/15 * * * *', 'UTC', new Date('2026-03-11T16:05:23.000Z'));

    expect(nextRun.toISOString()).toBe('2026-03-11T16:15:00.000Z');
  });
});
