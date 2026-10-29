import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireAuth = vi.fn();
const mockCanManageWorkspace = vi.fn();
const mockWorkspaceFindUnique = vi.fn();
const mockWorkspaceUpdate = vi.fn();
const mockStorageUpload = vi.fn();
const mockStorageDelete = vi.fn();
const mockCreateAuditLog = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: mockRequireAuth,
  canManageWorkspace: mockCanManageWorkspace,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workspace: {
      findUnique: mockWorkspaceFindUnique,
      update: mockWorkspaceUpdate,
    },
  },
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    upload: mockStorageUpload,
    delete: mockStorageDelete,
  },
  StorageKeys: {
    tenantLogo: (workspaceId: string, extension: string) => `${workspaceId}/branding/logo${extension}`,
  },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: mockCreateAuditLog,
}));

const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

describe('/api/workspace/settings', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: 'user-1',
      tenantId: 'workspace-1',
      isSuperAdmin: false,
      isWorkspaceAdmin: true,
    });
    mockCanManageWorkspace.mockReturnValue(true);
    mockWorkspaceFindUnique.mockResolvedValue({
      id: 'workspace-1',
      name: 'Oak Workspace',
      logoUrl: null,
    });
    mockWorkspaceUpdate.mockResolvedValue({
      id: 'workspace-1',
      name: 'Oak Workspace',
      logoUrl: '/api/storage/workspace-1%2Fbranding%2Flogo.png',
    });
    mockStorageUpload.mockResolvedValue({
      key: 'workspace-1/branding/logo.png',
      url: '/api/storage/workspace-1%2Fbranding%2Flogo.png',
      size: pngBytes.length,
    });
    mockCreateAuditLog.mockResolvedValue({});
  });

  it('uploads a workspace logo and stores its URL on the workspace', async () => {
    const { POST } = await import('@/app/api/workspace/settings/logo/route');
    const formData = new FormData();
    formData.set('file', new Blob([pngBytes], { type: 'image/png' }), 'logo.png');

    const response = await POST(new Request('http://localhost/api/workspace/settings/logo', {
      method: 'POST',
      body: formData,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    const uploadCall = mockStorageUpload.mock.calls[0];
    expect(uploadCall[1]).toEqual(Buffer.from(pngBytes));
    expect(mockStorageUpload).toHaveBeenCalledWith(
      'workspace-1/branding/logo.png',
      uploadCall[1],
      expect.objectContaining({
        contentType: 'image/png',
        metadata: expect.objectContaining({
          originalFileName: expect.any(String),
          uploadedBy: 'user-1',
          tenantId: 'workspace-1',
        }),
      })
    );
    expect(mockWorkspaceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'workspace-1' },
      data: { logoUrl: '/api/storage/workspace-1%2Fbranding%2Flogo.png' },
    }));
    expect(body.workspace.logoUrl).toBe('/api/storage/workspace-1%2Fbranding%2Flogo.png');
  });

  it('rejects non-image uploads', async () => {
    const { POST } = await import('@/app/api/workspace/settings/logo/route');
    const formData = new FormData();
    formData.set('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'file.pdf', { type: 'application/pdf' }));

    const response = await POST(new Request('http://localhost/api/workspace/settings/logo', {
      method: 'POST',
      body: formData,
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Only image files');
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockWorkspaceUpdate).not.toHaveBeenCalled();
  });
});
