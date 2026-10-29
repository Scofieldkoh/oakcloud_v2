import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { GenerationSessionState } from '@/lib/validations/generated-document';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const attackerWorkspaceId = '22222222-2222-4222-8222-222222222222';
const draftId = '33333333-3333-4333-8333-333333333333';

const session = {
  id: 'user-1',
  tenantId: workspaceId,
  isWorkspaceAdmin: true,
};

const validState: GenerationSessionState = {
  version: 2,
  currentStep: 0,
  templateId: null,
  companyId: null,
  contactIds: [],
  selectedDirectorId: null,
  selectedShareholderId: null,
  selectedContactId: null,
  title: '',
  customData: {},
  useLetterhead: true,
  previewContent: null,
  editedContent: null,
  editedContentJson: null,
  serviceAgreementId: null,
};

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn() }));
vi.mock('@/services/document-generation-session.service', () => ({
  createGenerationSession: vi.fn(),
  getGenerationSession: vi.fn(),
  updateGenerationSession: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import {
  createGenerationSession,
  getGenerationSession,
  updateGenerationSession,
} from '@/services/document-generation-session.service';
import { POST } from '@/app/api/generated-documents/generation-sessions/route';
import {
  GET,
  PUT,
} from '@/app/api/generated-documents/generation-sessions/[id]/route';

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

describe('generated document generation session routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(session as never);
    vi.mocked(createGenerationSession).mockResolvedValue({
      id: draftId,
      savedAt: '2026-07-18T01:00:00.000Z',
      state: validState,
      agreement: null,
    });
    vi.mocked(getGenerationSession).mockResolvedValue({
      id: draftId,
      savedAt: '2026-07-18T01:00:00.000Z',
      state: validState,
      agreement: null,
    });
    vi.mocked(updateGenerationSession).mockResolvedValue({
      id: draftId,
      savedAt: '2026-07-18T02:00:00.000Z',
      state: validState,
      agreement: null,
    });
  });

  it('creates a session using only the authenticated workspace', async () => {
    const response = await POST(request('http://localhost/api/generated-documents/generation-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validState, tenantId: attackerWorkspaceId }),
    }));

    expect(response.status).toBe(201);
    expect(requirePermission).toHaveBeenCalledWith(session, 'document', 'create');
    expect(createGenerationSession).toHaveBeenCalledWith(validState, {
      tenantId: workspaceId,
      userId: session.id,
    });
  });

  it('loads a session with read permission', async () => {
    const response = await GET(
      request(`http://localhost/api/generated-documents/generation-sessions/${draftId}`),
      { params: Promise.resolve({ id: draftId }) },
    );

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(session, 'document', 'read');
    expect(getGenerationSession).toHaveBeenCalledWith(draftId, {
      tenantId: workspaceId,
      userId: session.id,
    });
  });

  it('updates a session with update permission', async () => {
    const response = await PUT(
      request(`http://localhost/api/generated-documents/generation-sessions/${draftId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validState, title: 'Updated' }),
      }),
      { params: Promise.resolve({ id: draftId }) },
    );

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(session, 'document', 'update');
    expect(updateGenerationSession).toHaveBeenCalledWith(
      draftId,
      { ...validState, title: 'Updated' },
      { tenantId: workspaceId, userId: session.id },
    );
  });

  it('rejects an unsupported session version', async () => {
    const response = await POST(request('http://localhost/api/generated-documents/generation-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validState, version: 99 }),
    }));

    expect(response.status).toBe(400);
    expect(createGenerationSession).not.toHaveBeenCalled();
  });
});
