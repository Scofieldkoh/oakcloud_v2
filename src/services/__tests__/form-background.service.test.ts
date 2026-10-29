import { beforeEach, describe, expect, it, vi } from 'vitest';

const { list, remove, findMany } = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({ storage: { list, delete: remove } }));
vi.mock('@/lib/prisma', () => ({ prisma: { form: { findMany } } }));

import { deleteUnusedFormBackgrounds } from '@/services/form-background.service';
import { getFormBackgroundPublicUrl } from '@/lib/form-background-url';

const now = new Date('2026-09-29T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
const folder = 't1/forms/f1/branding';

describe('deleteUnusedFormBackgrounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remove.mockResolvedValue(undefined);
  });

  it('deletes old and removed backgrounds but keeps the one in use', async () => {
    list.mockResolvedValue([
      { key: `${folder}/background.png`, size: 1, lastModified: hoursAgo(48) },
      { key: `${folder}/background.png.meta.json`, size: 1, lastModified: hoursAgo(48) },
      { key: `${folder}/background-aaa.png`, size: 1, lastModified: hoursAgo(2) },
      { key: `${folder}/background-bbb.jpg`, size: 1, lastModified: hoursAgo(1) },
    ]);
    findMany.mockResolvedValue([
      { settings: { backgroundImageUrl: getFormBackgroundPublicUrl(`${folder}/background-bbb.jpg`) } },
    ]);

    const deleted = await deleteUnusedFormBackgrounds('t1', 'f1', { now });

    expect(deleted).toEqual([`${folder}/background.png`, `${folder}/background-aaa.png`]);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('keeps an image a duplicated form still points at', async () => {
    list.mockResolvedValue([{ key: `${folder}/background-aaa.png`, size: 1, lastModified: hoursAgo(5) }]);
    findMany.mockResolvedValue([
      { settings: { backgroundImageUrl: getFormBackgroundPublicUrl(`${folder}/background-aaa.png`) } },
    ]);

    expect(await deleteUnusedFormBackgrounds('t1', 'f1', { now })).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) }));
  });

  it('leaves a just-uploaded image that has not been saved yet', async () => {
    list.mockResolvedValue([{ key: `${folder}/background-new.png`, size: 1, lastModified: new Date(now.getTime() - 60_000) }]);
    findMany.mockResolvedValue([]);

    expect(await deleteUnusedFormBackgrounds('t1', 'f1', { now })).toEqual([]);
    expect(await deleteUnusedFormBackgrounds('t1', 'f1', { now, graceMs: 0 })).toEqual([`${folder}/background-new.png`]);
  });

  it('does not query forms when the folder is empty', async () => {
    list.mockResolvedValue([]);
    expect(await deleteUnusedFormBackgrounds('t1', 'f1', { now })).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
