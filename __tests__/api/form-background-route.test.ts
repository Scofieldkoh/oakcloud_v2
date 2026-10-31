// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  resolveWorkspaceId: vi.fn(),
  findFirst: vi.fn(),
  upload: vi.fn(),
  validateFileContent: vi.fn(),
  formBackground: vi.fn(),
  getFormBackgroundPublicUrl: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/api-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-helpers')>()),
  resolveWorkspaceId: mocks.resolveWorkspaceId,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { form: { findFirst: mocks.findFirst } },
}));
vi.mock('@/lib/storage', () => ({
  storage: { upload: mocks.upload },
  StorageKeys: { formBackground: mocks.formBackground },
}));
vi.mock('@/lib/file-validation', () => ({
  ALLOWED_FILE_TYPES: { IMAGE: 'image' },
  validateFileContent: mocks.validateFileContent,
}));
vi.mock('@/lib/form-background-url', () => ({
  getFormBackgroundPublicUrl: mocks.getFormBackgroundPublicUrl,
}));

import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/forms/[id]/background/route';

const storageKey = 'tenant-1/forms/form-1/branding/background.png';
const publicUrl = `/api/storage/${encodeURIComponent(storageKey)}`;

function pngFile(size = 8): File {
  return new File([new Uint8Array(size)], 'bg.png', { type: 'image/png' });
}

function makeRequest(file: File | null, tenantId = 'tenant-1') {
  const formData = new FormData();
  if (file) formData.set('file', file);
  const query = tenantId ? `?tenantId=${tenantId}` : '';
  return new Request(`http://localhost/api/forms/form-1/background${query}`, {
    method: 'POST',
    body: formData,
  });
}

describe('POST /api/forms/[id]/background', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' });
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.resolveWorkspaceId.mockReturnValue('tenant-1');
    mocks.findFirst.mockResolvedValue({ id: 'form-1', tenantId: 'tenant-1' });
    mocks.validateFileContent.mockReturnValue({ valid: true, ext: 'png', mime: 'image/png' });
    mocks.formBackground.mockReturnValue(storageKey);
    mocks.getFormBackgroundPublicUrl.mockReturnValue(publicUrl);
    mocks.upload.mockResolvedValue(undefined);
  });

  it('uploads a valid image and returns the public URL', async () => {
    const response = await POST(makeRequest(pngFile()) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ backgroundImageUrl: publicUrl });
    expect(mocks.formBackground).toHaveBeenCalledWith('tenant-1', 'form-1', '.png', expect.any(String));
    expect(mocks.upload).toHaveBeenCalledWith(
      storageKey,
      expect.any(Buffer),
      expect.objectContaining({
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: expect.objectContaining({ formId: 'form-1', uploadedBy: 'user-1', tenantId: 'tenant-1' }),
      })
    );
  });

  it('returns 400 when the file is missing', async () => {
    const response = await POST(makeRequest(null) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 400 for a disallowed MIME type', async () => {
    const textFile = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const response = await POST(makeRequest(textFile) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 400 for a file larger than 5MB', async () => {
    const bigFile = pngFile(5 * 1024 * 1024 + 1);
    const response = await POST(makeRequest(bigFile) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 400 when content validation fails', async () => {
    mocks.validateFileContent.mockReturnValue({ valid: false, error: 'Not an image' });
    const response = await POST(makeRequest(pngFile()) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Not an image' });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 404 when the form does not belong to the workspace', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await POST(makeRequest(pngFile()) as NextRequest, {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 401 when authentication fails', async () => {
    mocks.requireAuth.mockRejectedValue(new Error('Unauthorized'));
    const response = await POST(makeRequest(pngFile()) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
