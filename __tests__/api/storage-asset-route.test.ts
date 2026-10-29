import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  getMetadata: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    download: mocks.download,
    getMetadata: mocks.getMetadata,
  },
}));

import { GET } from '@/app/api/storage/[...key]/route';

describe('GET /api/storage/[...key]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.download.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.getMetadata.mockResolvedValue({ contentType: 'image/png' });
  });

  it('serves a form background image', async () => {
    const response = await GET(new Request('http://localhost/api/storage/tenant-1/forms/form-1/branding/background.png'), {
      params: Promise.resolve({ key: ['tenant-1', 'forms', 'form-1', 'branding', 'background.png'] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(mocks.download).toHaveBeenCalledWith('tenant-1/forms/form-1/branding/background.png');
  });

  it('still serves workspace logos', async () => {
    const response = await GET(new Request('http://localhost/api/storage/tenant-1/branding/logo.png'), {
      params: Promise.resolve({ key: ['tenant-1', 'branding', 'logo.png'] }),
    });

    expect(response.status).toBe(200);
  });

  it('rejects unknown storage keys without downloading', async () => {
    const response = await GET(new Request('http://localhost/api/storage/tenant-1/other/file.png'), {
      params: Promise.resolve({ key: ['tenant-1', 'other', 'file.png'] }),
    });

    expect(response.status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
