import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const templateId = '33333333-3333-4333-8333-333333333333';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    documentTemplate: {
      findFirst: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/services/template-partial.service', () => ({
  resolvePartials: vi.fn(),
}));

vi.mock('@/services/document-generator.service', () => ({
  renderTemplateForGeneration: vi.fn(),
}));

vi.mock('@/lib/placeholder-resolver', () => ({
  extractPlaceholders: vi.fn(() => ['company.name']),
  resolvePlaceholders: vi.fn(() => ({
    resolved: '<p>Resolved from partial</p>',
    missing: [],
    missingPartials: [],
  })),
}));

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { extractPlaceholders, resolvePlaceholders } from '@/lib/placeholder-resolver';
import { renderTemplateForGeneration } from '@/services/document-generator.service';
import { resolvePartials } from '@/services/template-partial.service';
import { POST as testTemplate } from '@/app/api/document-templates/[id]/test/route';

function request(body: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/document-templates/${templateId}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('document template test route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      tenantId: workspaceId,
      isSuperAdmin: false,
    } as never);
    vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
      id: templateId,
      name: 'Template with partial',
      content: '<p>{{> signing-block}}</p>',
      contentJson: null,
      category: 'RESOLUTION',
      placeholders: [],
    } as never);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ name: 'Workspace' } as never);
    vi.mocked(resolvePartials).mockResolvedValue('<p>{{company.name}}</p>');
    vi.mocked(renderTemplateForGeneration).mockResolvedValue({
      template: {
        id: templateId,
        name: 'Template with partial',
        category: 'RESOLUTION',
        version: 1,
      },
      content: '<p id="section-0">Resolved from partial</p>',
      contentHtml: '<p id="section-0">Resolved from partial</p>',
      rawResolvedContent: '<p>Resolved from partial</p>',
      sections: [],
      missingPlaceholders: [],
      missingPartials: [],
      contextSummary: {
        hasCompany: false,
        hasContacts: false,
        hasCustomData: true,
      },
      blockingErrors: [],
      context: {},
    } as never);
  });

  it('uses the shared renderer after resolving partials for placeholder extraction', async () => {
    const response = await testTemplate(request(), {
      params: Promise.resolve({ id: templateId }),
    });

    expect(response.status).toBe(200);
    expect(resolvePartials).toHaveBeenCalledWith('<p>{{> signing-block}}</p>', workspaceId);
    expect(extractPlaceholders).toHaveBeenCalledWith('<p>{{company.name}}</p>');
    expect(renderTemplateForGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId,
        tenantId: workspaceId,
        mode: 'test',
        contextOverride: expect.any(Object),
      })
    );
    expect(resolvePlaceholders).not.toHaveBeenCalled();
  });
});
