import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const templateId = '33333333-3333-4333-8333-333333333333';
const contactId = '44444444-4444-4444-8444-444444444444';
const companyId = '55555555-5555-4555-8555-555555555555';
const directorId = '66666666-6666-4666-8666-666666666666';
const shareholderId = '77777777-7777-4777-8777-777777777777';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(),
}));

vi.mock('@/services/document-generator.service', () => ({
  renderTemplateForGeneration: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { renderTemplateForGeneration } from '@/services/document-generator.service';
import { POST as previewDocument } from '@/app/api/generated-documents/preview/route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/generated-documents/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('generated documents preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      tenantId: workspaceId,
      isSuperAdmin: false,
    } as never);
    vi.mocked(renderTemplateForGeneration).mockResolvedValue({
      template: {
        id: templateId,
        name: 'Resolution',
        category: 'RESOLUTION',
      },
      content: '<h1 id="section-0">Resolved</h1>',
      contentHtml: '<h1 id="section-0">Resolved</h1>',
      sections: [{ id: 'section-0', title: 'Resolved', level: 1, startIndex: 0, endIndex: 26 }],
      missingPlaceholders: ['custom.missing'],
      missingPartials: ['signature-block'],
      contextSummary: {
        hasCompany: true,
        hasContacts: true,
        hasCustomData: true,
      },
      blockingErrors: [
        'Unresolved placeholders: custom.missing',
        'Missing partials: signature-block',
      ],
    } as never);
  });

  it('uses the shared template renderer and returns unresolved placeholders and partials', async () => {
    const response = await previewDocument(
      request({
        templateId,
        companyId,
        contactIds: [contactId],
        selectedDirectorId: directorId,
        selectedShareholderId: shareholderId,
        selectedContactId: contactId,
        customData: { resolutionNumber: '2026-001' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(renderTemplateForGeneration).toHaveBeenCalledWith({
      templateId,
      tenantId: workspaceId,
      companyId,
      contactIds: [contactId],
      selectedDirectorId: directorId,
      selectedShareholderId: shareholderId,
      selectedContactId: contactId,
      customData: { resolutionNumber: '2026-001' },
      generatedBy: 'Test User',
      generatedDocumentId: undefined,
      serviceAgreementId: undefined,
      userId: 'user-1',
      mode: 'preview',
    });
    expect(body.preview.unresolvedPlaceholders).toEqual(['custom.missing']);
    expect(body.preview.missingPartials).toEqual(['signature-block']);
    expect(body.preview.blockingErrors).toHaveLength(2);
    expect(body.context).toEqual({
      hasCompany: true,
      hasContacts: true,
      hasCustomData: true,
    });
  });
});
