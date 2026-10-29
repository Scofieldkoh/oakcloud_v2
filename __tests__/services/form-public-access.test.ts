import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicFormBySlug } from '@/services/form-submission.service';

const { mockFormFindFirst, mockIncrementViewCount } = vi.hoisted(() => ({
  mockFormFindFirst: vi.fn(),
  mockIncrementViewCount: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    form: {
      findFirst: mockFormFindFirst,
    },
  },
}));

vi.mock('@/lib/view-count-buffer', () => ({
  incrementViewCount: mockIncrementViewCount,
}));

vi.mock('@/lib/storage', () => ({
  storage: {},
  StorageKeys: {},
}));

describe('public form access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not resolve archived forms by public slug', async () => {
    mockFormFindFirst.mockResolvedValue(null);

    const form = await getPublicFormBySlug('client-intake');

    expect(form).toBeNull();
    expect(mockFormFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        slug: 'client-intake',
        status: 'PUBLISHED',
        deletedAt: null,
      },
    }));
    expect(mockIncrementViewCount).not.toHaveBeenCalled();
  });
});
