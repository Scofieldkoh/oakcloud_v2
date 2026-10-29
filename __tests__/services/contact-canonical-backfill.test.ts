import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  contact: { update: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contact: { findMany: vi.fn() },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  },
}));

import { prisma } from '@/lib/prisma';
import {
  backfillContactCanonicalNames,
  parseBackfillArgs,
} from '../../scripts/backfill-contact-canonical-names';

const mockedPrisma = vi.mocked(prisma);
const findManyMock = vi.mocked(prisma.contact.findMany);

function contact(id: string, fullName: string, canonicalName: string | null = null, alias: string | null = null, canonicalAlias: string | null = null) {
  return { id, fullName, canonicalName, alias, canonicalAlias };
}

describe('contact canonical-name backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('backfills in stable batches and resumes after the last ID', async () => {
    findManyMock
      .mockResolvedValueOnce([
        contact('a', '王小明'),
        contact('b', 'Acme Pte Ltd'),
      ] as never)
      .mockResolvedValueOnce([]);

    const result = await backfillContactCanonicalNames({
      batchSize: 2,
      resumeAfter: null,
    });

    expect(mockedPrisma.contact.findMany).toHaveBeenNthCalledWith(1, {
      where: { deletedAt: null, isActive: true, id: { gt: undefined } },
      orderBy: { id: 'asc' },
      take: 2,
      select: { id: true, fullName: true, canonicalName: true, alias: true, canonicalAlias: true },
    });
    expect(mockedPrisma.contact.findMany).toHaveBeenNthCalledWith(2, {
      where: { deletedAt: null, isActive: true, id: { gt: 'b' } },
      orderBy: { id: 'asc' },
      take: 2,
      select: { id: true, fullName: true, canonicalName: true, alias: true, canonicalAlias: true },
    });
    expect(tx.contact.update).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      processed: 2,
      updated: 2,
      skipped: 0,
      failed: 0,
      lastId: 'b',
    });
  });

  it('backfills canonical aliases with the shared Unicode canonicalizer', async () => {
    findManyMock.mockResolvedValueOnce([
      contact('a', 'A Tan', 'atan', 'Ａ．Ｔａｎ', null),
    ] as never).mockResolvedValueOnce([]);

    await backfillContactCanonicalNames({ batchSize: 1 });

    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { canonicalName: 'atan', canonicalAlias: 'atan' },
    });
  });

  it('marks a present alias that folds empty as backfilled', async () => {
    findManyMock.mockResolvedValueOnce([
      contact('a', 'A Tan', 'atan', ' . ', null),
    ] as never).mockResolvedValueOnce([]);

    await backfillContactCanonicalNames({ batchSize: 1 });

    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { canonicalName: 'atan', canonicalAlias: '' },
    });
  });

  it('updates only null or changed canonical names and counts skipped rows', async () => {
    findManyMock
      .mockResolvedValueOnce([
        contact('a', ' ACME Pte Ltd ', 'acmepteltd'),
        contact('b', 'Ａｃｍｅ Pte. Ltd.', null),
        contact('c', '王 小明', 'stale'),
      ] as never)
      .mockResolvedValueOnce([]);

    const result = await backfillContactCanonicalNames({ batchSize: 3 });

    expect(tx.contact.update).toHaveBeenCalledTimes(2);
    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'b' },
      data: { canonicalName: 'acmepteltd', canonicalAlias: null },
    });
    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'c' },
      data: { canonicalName: '王小明', canonicalAlias: null },
    });
    expect(result).toEqual({
      processed: 3,
      updated: 2,
      skipped: 1,
      failed: 0,
      lastId: 'c',
    });
  });

  it('records a failed batch without advancing its resumable last ID', async () => {
    findManyMock.mockResolvedValueOnce([
      contact('b', 'Broken Batch'),
      contact('c', 'Retry Me'),
    ] as never);
    mockedPrisma.$transaction.mockRejectedValueOnce(new Error('write failed'));

    const result = await backfillContactCanonicalNames({
      batchSize: 2,
      resumeAfter: 'a',
    });

    expect(result).toEqual({
      processed: 2,
      updated: 0,
      skipped: 0,
      failed: 2,
      lastId: 'a',
    });
    expect(mockedPrisma.contact.findMany).toHaveBeenCalledTimes(1);
  });

  it('parses CLI defaults and validates explicit arguments', () => {
    expect(parseBackfillArgs([])).toEqual({ batchSize: 500, resumeAfter: null });
    expect(parseBackfillArgs(['--batch-size=25', '--resume-after=contact-9'])).toEqual({
      batchSize: 25,
      resumeAfter: 'contact-9',
    });
    expect(() => parseBackfillArgs(['--batch-size=0'])).toThrow(
      '--batch-size must be a positive integer',
    );
    expect(() => parseBackfillArgs(['--unknown=value'])).toThrow('Unknown argument');
  });

  it('accepts npm 11 config environment variables used by the documented command', () => {
    expect(parseBackfillArgs([], {
      npm_config_batch_size: '25',
      npm_config_resume_after: 'contact-9',
    })).toEqual({ batchSize: 25, resumeAfter: 'contact-9' });
  });
});
