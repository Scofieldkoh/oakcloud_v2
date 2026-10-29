import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createDocumentTemplate, updateDocumentTemplate } = vi.hoisted(() => ({
  createDocumentTemplate: vi.fn(),
  updateDocumentTemplate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    id: 'user-1',
    tenantId: 'tenant-1',
    isSuperAdmin: false,
  }),
}));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/services/document-template.service', () => ({
  createDocumentTemplate,
  updateDocumentTemplate,
  searchDocumentTemplates: vi.fn(),
  getDocumentTemplateById: vi.fn(),
  deleteDocumentTemplate: vi.fn(),
  restoreDocumentTemplate: vi.fn(),
}));

import { POST } from '@/app/api/document-templates/route';
import { PUT } from '@/app/api/document-templates/[id]/route';

const layoutContentJson = {
  version: 1,
  unrelated: { retained: true },
  layout: {
    version: 1,
    fontFamily: 'Georgia, serif',
    fontSize: '14pt',
    lineHeight: 1.8,
    paragraphSpacing: '8px',
    marginsMm: { top: 10, right: 15, bottom: 20, left: 25 },
  },
};
const templateId = '00000000-0000-4000-8000-000000000001';

function request(method: 'POST' | 'PUT', body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/document-templates/${templateId}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('document template layout API persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDocumentTemplate.mockResolvedValue({ id: 'template-1' });
    updateDocumentTemplate.mockResolvedValue({ id: 'template-1' });
  });

  it('preserves layout and unrelated contentJson keys on POST and PUT', async () => {
    const base = {
      name: 'Layout template',
      category: 'OTHER',
      content: '<p>Hello</p>',
      contentJson: layoutContentJson,
      placeholders: [],
      isActive: true,
    };

    expect((await POST(request('POST', base))).status).toBe(201);
    expect(createDocumentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentJson: layoutContentJson }),
      expect.any(Object),
    );

    expect(
      (await PUT(request('PUT', base), { params: Promise.resolve({ id: templateId }) })).status,
    ).toBe(200);
    expect(updateDocumentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentJson: layoutContentJson }),
      expect.any(Object),
      undefined,
    );
  });

  it('rejects malformed saved layout while retaining a permissive JSON object', async () => {
    const response = await POST(
      request('POST', {
        name: 'Invalid layout',
        category: 'OTHER',
        content: '<p>Hello</p>',
        contentJson: {
          unrelated: true,
          layout: { version: 1, marginsMm: 'invalid' },
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(createDocumentTemplate).not.toHaveBeenCalled();
  });

  it('rejects unsafe layout margins on POST and PUT', async () => {
    const base = {
      name: 'Unsafe margins',
      category: 'OTHER',
      content: '<p>Hello</p>',
      contentJson: {
        layout: {
          version: 1,
          lineHeight: 1.5,
          paragraphSpacing: '0.5em',
          marginsMm: { top: 4, right: 15, bottom: 20, left: 61 },
        },
      },
    };

    expect((await POST(request('POST', base))).status).toBe(400);
    expect(createDocumentTemplate).not.toHaveBeenCalled();

    expect(
      (await PUT(request('PUT', base), { params: Promise.resolve({ id: templateId }) })).status,
    ).toBe(400);
    expect(updateDocumentTemplate).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', '<p>{{>service-summary}}</p><p>{{>terms-and-conditions}}</p>'],
    [
      'duplicated',
      '<p>{{>service-summary}}</p><p>{{>service-summary}}</p><p>{{>pricing-summary}}</p><p>{{>terms-and-conditions}}</p>',
    ],
  ])('returns 400 when agreement slots are %s', async (_, content) => {
    createDocumentTemplate.mockRejectedValueOnce(
      new Error('Service agreement template composition is invalid'),
    );

    const response = await POST(
      request('POST', {
        name: 'Invalid service agreement',
        category: 'OTHER',
        compositionType: 'SERVICE_AGREEMENT',
        content,
        placeholders: [],
      }),
    );

    expect(response.status).toBe(400);
  });
});
