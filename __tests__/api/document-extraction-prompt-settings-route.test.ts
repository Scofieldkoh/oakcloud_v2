import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireAuth = vi.fn();
const mockCanManageWorkspace = vi.fn();
const mockWorkspaceFindUnique = vi.fn();
const mockWorkspaceUpdate = vi.fn();

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

describe('/api/workspace/document-extraction-prompt', () => {
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
      settings: {
        documentExtractionPrompt: {
          promptTemplate: 'Saved prompt [AdditionalContext]',
          quickContexts: [{ id: 'custom', label: 'Custom', value: 'Use [Details]' }],
        },
      },
    });
    mockWorkspaceUpdate.mockResolvedValue({});
  });

  it('returns saved prompt settings and supported variables', async () => {
    const { GET } = await import('@/app/api/workspace/document-extraction-prompt/route');

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.promptTemplate).toBe('Saved prompt [AdditionalContext]');
    expect(body.data.quickContexts).toEqual([
      { id: 'custom', label: 'Custom', value: 'Use [Details]' },
    ]);
    expect(body.data.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: '[AdditionalContext]' }),
        expect.objectContaining({ key: '[Details]' }),
      ])
    );
  });

  it('updates prompt settings in workspace settings', async () => {
    const { PATCH } = await import('@/app/api/workspace/document-extraction-prompt/route');

    const response = await PATCH(new Request('http://localhost/api/workspace/document-extraction-prompt', {
      method: 'PATCH',
      body: JSON.stringify({
        promptTemplate: 'Next prompt [AdditionalContext]',
        quickContexts: [{ id: 'date', label: 'Date', value: 'Today [CurrentDate]' }],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockWorkspaceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'workspace-1' },
      data: {
        settings: expect.objectContaining({
          documentExtractionPrompt: {
            promptTemplate: 'Next prompt [AdditionalContext]',
            quickContexts: [{ id: 'date', label: 'Date', value: 'Today [CurrentDate]' }],
          },
        }),
      },
    }));
    expect(body.data.promptTemplate).toBe('Next prompt [AdditionalContext]');
  });

  it('requires workspace management permission to update settings', async () => {
    mockCanManageWorkspace.mockReturnValue(false);
    const { PATCH } = await import('@/app/api/workspace/document-extraction-prompt/route');

    const response = await PATCH(new Request('http://localhost/api/workspace/document-extraction-prompt', {
      method: 'PATCH',
      body: JSON.stringify({ promptTemplate: 'Nope' }),
    }));

    expect(response.status).toBe(403);
    expect(mockWorkspaceUpdate).not.toHaveBeenCalled();
  });
});
