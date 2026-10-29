import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkPublicHttpUrl: vi.fn(),
  fieldFindMany: vi.fn(),
  healthFindMany: vi.fn(),
  healthUpsert: vi.fn(),
  healthDeleteMany: vi.fn(),
  healthGroupBy: vi.fn(),
}));

vi.mock('@/lib/public-url-checker', () => ({ checkPublicHttpUrl: mocks.checkPublicHttpUrl }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    formField: { findMany: mocks.fieldFindMany },
    formUrlHealth: {
      findMany: mocks.healthFindMany,
      upsert: mocks.healthUpsert,
      deleteMany: mocks.healthDeleteMany,
      groupBy: mocks.healthGroupBy,
    },
  },
}));

import {
  classifyUrlCheck,
  getFormUrlHealthDetails,
  listFormUrlWarningSummaries,
  nextHealthState,
  reconcileFormUrlHealth,
} from '@/services/form-url-health.service';

const failedCheck = { status: 404, finalUrl: 'https://example.com/missing', errorCode: null, errorMessage: null };
const healthyCheck = { status: 200, finalUrl: 'https://example.com', errorCode: null, errorMessage: null };

describe('form URL health service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fieldFindMany.mockResolvedValue([]);
    mocks.healthFindMany.mockResolvedValue([]);
    mocks.healthDeleteMany.mockResolvedValue({ count: 0 });
    mocks.healthUpsert.mockResolvedValue({});
    mocks.healthGroupBy.mockResolvedValue([]);
  });

  it('classifies definite and unverifiable results', () => {
    expect(classifyUrlCheck({ status: 204, errorCode: null, errorMessage: null })).toBe('HEALTHY');
    expect(classifyUrlCheck({ status: 403, errorCode: null, errorMessage: null })).toBe('UNVERIFIABLE');
    expect(classifyUrlCheck({ status: 429, errorCode: null, errorMessage: null })).toBe('UNVERIFIABLE');
    expect(classifyUrlCheck({ status: 404, errorCode: null, errorMessage: null })).toBe('FAILED');
    expect(classifyUrlCheck({ status: null, errorCode: 'ETIMEDOUT', errorMessage: 'timeout' })).toBe('FAILED');
  });

  it('activates on the second failure, preserves neutral history, and clears on success', () => {
    const now = new Date('2026-08-01T02:00:00.000Z');
    const previous = {
      urlFingerprint: 'same',
      consecutiveFailures: 1,
      warningActivatedAt: null,
      lastSucceededAt: null,
    };

    expect(nextHealthState(previous, failedCheck, 'same', now)).toMatchObject({
      classification: 'FAILED', consecutiveFailures: 2, warningActivatedAt: now,
    });
    expect(nextHealthState({ ...previous, warningActivatedAt: now }, {
      status: 403, finalUrl: 'https://example.com', errorCode: null, errorMessage: null,
    }, 'same', now)).toMatchObject({ consecutiveFailures: 1, warningActivatedAt: now });
    expect(nextHealthState({ ...previous, consecutiveFailures: 2, warningActivatedAt: now }, healthyCheck, 'same', now)).toMatchObject({
      classification: 'HEALTHY', consecutiveFailures: 0, warningActivatedAt: null, lastSucceededAt: now,
    });
    expect(nextHealthState({ ...previous, consecutiveFailures: 8, warningActivatedAt: now }, failedCheck, 'changed', now)).toMatchObject({
      consecutiveFailures: 1, warningActivatedAt: null,
    });
  });

  it('checks at most 500 fields with concurrency five and isolates failures', async () => {
    const fields = Array.from({ length: 502 }, (_, index) => ({
      tenantId: 'tenant-1',
      formId: `form-${Math.floor(index / 2)}`,
      key: `url-${index}`,
      placeholder: `https://example.com/${index}`,
    }));
    mocks.fieldFindMany.mockResolvedValue(fields);
    mocks.healthFindMany.mockResolvedValue([{ id: 'stale', tenantId: 'tenant-1', formId: 'old', fieldKey: 'removed' }]);

    let active = 0;
    let peak = 0;
    mocks.checkPublicHttpUrl.mockImplementation(async (url: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      if (url.endsWith('/3')) throw new Error('isolated failure');
      return healthyCheck;
    });

    const result = await reconcileFormUrlHealth();

    expect(mocks.fieldFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: 'PARAGRAPH',
        inputType: 'info_url',
        form: { status: { in: ['DRAFT', 'PUBLISHED'] }, deletedAt: null },
      }),
    }));
    expect(mocks.checkPublicHttpUrl).toHaveBeenCalledTimes(500);
    expect(peak).toBeLessThanOrEqual(5);
    expect(result.checked).toBe(500);
    expect(result.failed).toBe(1);
    expect(mocks.healthDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['stale'] } } });
  });

  it('returns tenant-scoped warning summaries and form detail', async () => {
    mocks.healthGroupBy.mockResolvedValue([{ formId: 'form-1', _count: { _all: 2 }, _max: { lastCheckedAt: new Date('2026-08-01T02:00:00Z') } }]);
    mocks.healthFindMany.mockResolvedValue([{ id: 'health-1' }]);

    await expect(listFormUrlWarningSummaries('tenant-1')).resolves.toEqual([
      { formId: 'form-1', warningCount: 2, lastCheckedAt: new Date('2026-08-01T02:00:00Z') },
    ]);
    await expect(getFormUrlHealthDetails('tenant-1', 'form-1')).resolves.toEqual([{ id: 'health-1' }]);
    expect(mocks.healthFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-1', formId: 'form-1' } }));
  });
});
