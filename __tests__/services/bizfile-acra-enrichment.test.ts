/**
 * BizFile ACRA compliance enrichment tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    acraEntity: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  safeErrorMessage: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  ),
}));

import { prisma } from '@/lib/prisma';
import { enrichBizFileComplianceFromAcra } from '@/services/bizfile/acra-enrichment';
import type { ExtractedBizFileData } from '@/services/bizfile';

function baseData(compliance?: ExtractedBizFileData['compliance']): ExtractedBizFileData {
  return {
    entityDetails: { uen: '202312345A', name: 'Example Pte. Ltd.', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
    ...(compliance ? { compliance } : {}),
  };
}

describe('enrichBizFileComplianceFromAcra', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the data unchanged when there is no UEN', async () => {
    const data: ExtractedBizFileData = {
      entityDetails: { uen: '', name: 'Example Pte. Ltd.', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
      compliance: { lastArFiledDate: '2024-01-01' },
    };

    const result = await enrichBizFileComplianceFromAcra(data);

    expect(result.data).toBe(data);
    expect(prisma.acraEntity.findFirst).not.toHaveBeenCalled();
  });

  it('returns the data unchanged when no ACRA record exists', async () => {
    vi.mocked(prisma.acraEntity.findFirst).mockResolvedValue(null);
    const data = baseData({ lastArFiledDate: '2024-01-01', accountsDueDate: '2024-12-31' });

    const result = await enrichBizFileComplianceFromAcra(data);

    expect(result.data).toEqual(data);
    expect(result.acra).toBeUndefined();
  });

  it('replaces compliance dates with later ACRA values and reports dataAsOf', async () => {
    vi.mocked(prisma.acraEntity.findFirst).mockResolvedValue({
      dataAsOf: '2026-08-14T00:00:00+08:00',
      accountDueDate: '2026-12-31',
      annualReturnDate: '2026-07-31',
    } as never);
    const data = baseData({ lastArFiledDate: '2025-07-31', accountsDueDate: '2025-12-31' });

    const result = await enrichBizFileComplianceFromAcra(data);

    expect(result.data.compliance?.lastArFiledDate).toBe('2026-07-31');
    expect(result.data.compliance?.accountsDueDate).toBe('2026-12-31');
    expect(result.acra).toEqual({
      dataAsOf: '2026-08-14T00:00:00+08:00',
      overriddenFields: ['lastArFiledDate', 'accountsDueDate'],
    });
  });

  it('fills missing extracted dates from ACRA records', async () => {
    vi.mocked(prisma.acraEntity.findFirst).mockResolvedValue({
      dataAsOf: '2026-08-14',
      accountDueDate: '2026-12-31',
      annualReturnDate: null,
    } as never);
    const data = baseData({ lastArFiledDate: '2025-07-31' });

    const result = await enrichBizFileComplianceFromAcra(data);

    expect(result.data.compliance?.accountsDueDate).toBe('2026-12-31');
    expect(result.data.compliance?.lastArFiledDate).toBe('2025-07-31');
    expect(result.acra?.overriddenFields).toEqual(['accountsDueDate']);
  });

  it('keeps later extracted dates when the ACRA values are older', async () => {
    vi.mocked(prisma.acraEntity.findFirst).mockResolvedValue({
      dataAsOf: '2025-01-01',
      accountDueDate: '2024-12-31',
      annualReturnDate: '2024-07-31',
    } as never);
    const data = baseData({ lastArFiledDate: '2026-07-31', accountsDueDate: '2026-12-31' });

    const result = await enrichBizFileComplianceFromAcra(data);

    expect(result.data).toEqual(data);
    expect(result.acra).toBeUndefined();
  });

  it('never fails extraction when the ACRA lookup errors', async () => {
    vi.mocked(prisma.acraEntity.findFirst).mockRejectedValue(new Error('table missing'));
    const data = baseData({ lastArFiledDate: '2024-01-01' });

    const result = await enrichBizFileComplianceFromAcra(data);

    expect(result.data).toBe(data);
  });
});
