import { constants } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CHROME_EXECUTABLE_PATHS,
  findChromePath,
} from '@/lib/chrome-executable';

const { accessMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
}));

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual, access: accessMock },
    access: accessMock,
  };
});

const mockedAccess = vi.mocked(accessMock);

describe('findChromePath', () => {
  afterEach(() => {
    mockedAccess.mockReset();
    vi.unstubAllEnvs();
  });

  it('uses an executable configured path first', async () => {
    vi.stubEnv('CHROME_PATH', '/custom/chrome');
    mockedAccess.mockResolvedValue(undefined);

    await expect(findChromePath()).resolves.toBe('/custom/chrome');
    expect(mockedAccess).toHaveBeenCalledWith('/custom/chrome', constants.X_OK);
  });

  it('falls back when the configured path is invalid', async () => {
    vi.stubEnv('CHROME_PATH', '/missing/chrome');
    mockedAccess.mockImplementation(async (candidate) => {
      if (String(candidate) === '/usr/bin/chromium') return;
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    });

    await expect(findChromePath()).resolves.toBe('/usr/bin/chromium');
    expect(mockedAccess).toHaveBeenCalledWith('/missing/chrome', constants.X_OK);
  });

  it('ignores an empty or whitespace-only configured path', async () => {
    vi.stubEnv('CHROME_PATH', '   ');
    mockedAccess.mockImplementation(async (candidate) => {
      if (String(candidate) === '/usr/bin/chromium') return;
      throw new Error('not found');
    });

    await expect(findChromePath()).resolves.toBe('/usr/bin/chromium');
    expect(mockedAccess.mock.calls[0]?.[0]).toBe(DEFAULT_CHROME_EXECUTABLE_PATHS[0]);
  });

  it('checks duplicate candidates only once', async () => {
    vi.stubEnv('CHROME_PATH', '/usr/bin/chromium');
    mockedAccess.mockRejectedValue(new Error('not found'));

    await expect(findChromePath()).rejects.toThrow('/usr/bin/chromium');

    const checkedCandidates = mockedAccess.mock.calls.map(([candidate]) => String(candidate));
    expect(checkedCandidates).toHaveLength(new Set(checkedCandidates).size);
    expect(checkedCandidates).toEqual([
      '/usr/bin/chromium',
      ...DEFAULT_CHROME_EXECUTABLE_PATHS.filter((candidate) => candidate !== '/usr/bin/chromium'),
    ]);
  });

  it('lists checked locations when no executable is available', async () => {
    vi.stubEnv('CHROME_PATH', '/missing/chrome');
    mockedAccess.mockRejectedValue(new Error('not found'));

    await expect(findChromePath()).rejects.toThrow(
      `/missing/chrome, ${DEFAULT_CHROME_EXECUTABLE_PATHS.join(', ')}`,
    );
  });

  it('uses the executable access mode for every candidate', async () => {
    vi.stubEnv('CHROME_PATH', '/custom/chrome');
    mockedAccess.mockResolvedValue(undefined);

    await findChromePath();

    expect(mockedAccess.mock.calls.every(([, mode]) => mode === constants.X_OK)).toBe(true);
  });
});
