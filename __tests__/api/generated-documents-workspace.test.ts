import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const attackerWorkspaceId = '22222222-2222-4222-8222-222222222222';
const templateId = '33333333-3333-4333-8333-333333333333';

const mockSession = {
  id: 'user-1',
  email: 'user@example.com',
  firstName: 'Test',
  lastName: 'User',
  tenantId: workspaceId,
  isSuperAdmin: true,
  isWorkspaceAdmin: true,
  hasAllCompaniesAccess: true,
  companyIds: [],
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(),
}));

vi.mock('@/services/document-generator.service', () => ({
  searchGeneratedDocuments: vi.fn(),
  createDocumentFromTemplate: vi.fn(),
  createBlankDocument: vi.fn(),
  getGeneratedDocumentById: vi.fn(),
  updateGeneratedDocument: vi.fn(),
  deleteGeneratedDocument: vi.fn(),
  archiveDocument: vi.fn(),
}));

vi.mock('@/lib/document-editor/document-engine', () => ({
  readGeneratedDocumentEngine: vi.fn(() => 'OAKDOC'),
}));

vi.mock('@/services/oakdoc-generation.service', () => ({
  downloadGeneratedOakDoc: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import {
  searchGeneratedDocuments,
  createDocumentFromTemplate,
  getGeneratedDocumentById,
} from '@/services/document-generator.service';
import { GET as listGeneratedDocuments, POST as createGeneratedDocument } from '@/app/api/generated-documents/route';
import { GET as getGeneratedDocument } from '@/app/api/generated-documents/[id]/route';
import { downloadGeneratedOakDoc } from '@/services/oakdoc-generation.service';

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

describe('Generated documents workspace scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(searchGeneratedDocuments).mockResolvedValue({
      documents: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
    vi.mocked(createDocumentFromTemplate).mockResolvedValue({
      id: 'doc-1',
      title: 'Generated document',
    } as never);
    vi.mocked(getGeneratedDocumentById).mockResolvedValue({
      id: 'doc-1',
      title: 'Generated document',
      metadata: {},
    } as never);
    vi.mocked(downloadGeneratedOakDoc).mockResolvedValue({
      buffer: Buffer.from('docx-bytes'),
      metadata: {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: 'Preview.docx',
      },
    } as never);
  });

  it('ignores tenantId query params and lists with the session workspace', async () => {
    const response = await listGeneratedDocuments(
      request(`http://localhost/api/generated-documents?tenantId=${attackerWorkspaceId}&page=1`)
    );

    expect(response.status).toBe(200);
    expect(searchGeneratedDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
      workspaceId
    );
  });

  it('forwards the signed date range when listing documents', async () => {
    const response = await listGeneratedDocuments(
      request(
        'http://localhost/api/generated-documents?signedFrom=2026-08-01&signedTo=2026-08-31',
      ),
    );

    expect(response.status).toBe(200);
    expect(searchGeneratedDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        signedFrom: '2026-08-01',
        signedTo: '2026-08-31',
      }),
      workspaceId,
    );
  });

  it('ignores tenantId in create bodies and uses the session workspace', async () => {
    const response = await createGeneratedDocument(
      request('http://localhost/api/generated-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: attackerWorkspaceId,
          templateId,
          title: 'Generated document',
          customData: {},
          useLetterhead: true,
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(createDocumentFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateId, title: 'Generated document' }),
      { tenantId: workspaceId, userId: mockSession.id }
    );
  });

  it('forwards contact ids and edited preview content when creating from a template', async () => {
    const draftId = '55555555-5555-4555-8555-555555555555';
    const response = await createGeneratedDocument(
      request('http://localhost/api/generated-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId,
          templateId,
          title: 'Generated document',
          customData: { resolutionNumber: '2026-001' },
          useLetterhead: true,
          contactIds: ['44444444-4444-4444-8444-444444444444'],
          selectedDirectorId: '66666666-6666-4666-8666-666666666666',
          selectedShareholderId: '77777777-7777-4777-8777-777777777777',
          selectedContactId: '44444444-4444-4444-8444-444444444444',
          editedContent: '<p>User edited preview</p>',
          editedContentJson: { type: 'doc', content: [] },
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(createDocumentFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId,
        templateId,
        contactIds: ['44444444-4444-4444-8444-444444444444'],
        selectedDirectorId: '66666666-6666-4666-8666-666666666666',
        selectedShareholderId: '77777777-7777-4777-8777-777777777777',
        selectedContactId: '44444444-4444-4444-8444-444444444444',
        editedContent: '<p>User edited preview</p>',
        editedContentJson: { type: 'doc', content: [] },
      }),
      { tenantId: workspaceId, userId: mockSession.id }
    );
  });

  it('ignores tenantId query params on document detail routes', async () => {
    const response = await getGeneratedDocument(
      request(`http://localhost/api/generated-documents/doc-1?tenantId=${attackerWorkspaceId}`),
      { params: Promise.resolve({ id: 'doc-1' }) }
    );

    expect(response.status).toBe(200);
    expect(getGeneratedDocumentById).toHaveBeenCalledWith(
      'doc-1',
      workspaceId,
      expect.objectContaining({ includeDeleted: false })
    );
  });

  it('allows DOCX review downloads to load unfinished batch draft documents', async () => {
    const response = await getGeneratedDocument(
      request('http://localhost/api/generated-documents/doc-1?format=docx'),
      { params: Promise.resolve({ id: 'doc-1' }) },
    );

    expect(response.status).toBe(200);
    expect(getGeneratedDocumentById).toHaveBeenCalledWith(
      'doc-1',
      workspaceId,
      expect.objectContaining({
        includeDeleted: false,
        includeBatchDrafts: true,
      }),
    );
    expect(downloadGeneratedOakDoc).toHaveBeenCalledWith('doc-1', workspaceId);
    expect(await response.arrayBuffer()).toEqual(
      Uint8Array.from(Buffer.from('docx-bytes')).buffer,
    );
  });

  it('returns 400 when the session has no workspace context', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...mockSession, tenantId: null });

    const response = await listGeneratedDocuments(
      request('http://localhost/api/generated-documents')
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Workspace context required');
    expect(searchGeneratedDocuments).not.toHaveBeenCalled();
  });
});
