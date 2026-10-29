import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const agreementId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const templateId = '44444444-4444-4444-8444-444444444444';
const draftId = '55555555-5555-4555-8555-555555555555';
const session = {
  id: 'user-1',
  tenantId: workspaceId,
  isWorkspaceAdmin: true,
  firstName: 'Test',
  lastName: 'User',
};

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn() }));
vi.mock('@/services/service-agreement', () => ({
  getServiceAgreementDraftById: vi.fn(),
  refreshServiceAgreementItemWording: vi.fn(),
}));
vi.mock('@/services/document-generator.service', () => ({
  renderTemplateForGeneration: vi.fn(),
}));
vi.mock('@/services/document-validation.service', () => ({
  validateForGeneration: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import {
  getServiceAgreementDraftById,
  refreshServiceAgreementItemWording,
} from '@/services/service-agreement';
import { renderTemplateForGeneration } from '@/services/document-generator.service';
import { validateForGeneration } from '@/services/document-validation.service';
import { POST as refreshWording } from '@/app/api/service-agreements/[id]/items/[itemId]/refresh-wording/route';
import { POST as preview } from '@/app/api/generated-documents/preview/route';
import { POST as validate } from '@/app/api/generated-documents/validate/route';

describe('Service Agreement generation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(session as never);
    vi.mocked(getServiceAgreementDraftById).mockResolvedValue({
      id: agreementId,
      items: [{ id: itemId }],
    } as never);
    vi.mocked(refreshServiceAgreementItemWording).mockResolvedValue({
      id: itemId,
      variantVersion: 2,
      partialVersion: 3,
    } as never);
  });

  it('refreshes a tenant-owned draft item with document update permission', async () => {
    const response = await refreshWording(
      new NextRequest(
        `http://localhost/api/service-agreements/${agreementId}/items/${itemId}/refresh-wording`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedVariantVersion: 1,
            expectedPartialVersion: 2,
          }),
        },
      ),
      { params: Promise.resolve({ id: agreementId, itemId }) },
    );

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(session, 'document', 'update');
    expect(refreshServiceAgreementItemWording).toHaveBeenCalledWith(
      itemId,
      { expectedVariantVersion: 1, expectedPartialVersion: 2 },
      { tenantId: workspaceId, userId: session.id },
    );
  });

  it('does not refresh an item outside the requested agreement', async () => {
    vi.mocked(getServiceAgreementDraftById).mockResolvedValue({
      id: agreementId,
      items: [],
    } as never);

    const response = await refreshWording(
      new NextRequest(
        `http://localhost/api/service-agreements/${agreementId}/items/${itemId}/refresh-wording`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedVariantVersion: 1,
            expectedPartialVersion: 2,
          }),
        },
      ),
      { params: Promise.resolve({ id: agreementId, itemId }) },
    );

    expect(response.status).toBe(404);
    expect(refreshServiceAgreementItemWording).not.toHaveBeenCalled();
  });

  it('previews pinned Service Agreement wording with the current actor', async () => {
    vi.mocked(renderTemplateForGeneration).mockResolvedValue({
      content: '<p>Pinned wording</p>',
      contentHtml: '<p>Pinned wording</p>',
      sections: [],
      missingPlaceholders: [],
      missingPartials: [],
      blockingErrors: [],
      template: { id: templateId },
      contextSummary: {},
    } as never);

    const response = await preview(new NextRequest(
      'http://localhost/api/generated-documents/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          draftId,
          templateId,
          serviceAgreementId: agreementId,
        }),
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      preview: { content: '<p>Pinned wording</p>', blockingErrors: [] },
    });
    expect(renderTemplateForGeneration).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: workspaceId,
      userId: session.id,
      generatedDocumentId: draftId,
      serviceAgreementId: agreementId,
      mode: 'preview',
    }));
  });

  it('returns Service Agreement item diagnostics from validation', async () => {
    vi.mocked(validateForGeneration).mockResolvedValue({
      isValid: false,
      errors: [{
        type: 'missing_required',
        field: 'service.fields.reference',
        message: 'Reference is required',
      }],
      warnings: [],
      resolvedData: {
        requiredPlaceholders: ['service.fields.reference'],
        availablePlaceholders: [],
        missingPlaceholders: ['service.fields.reference'],
      },
    } as never);

    const response = await validate(new NextRequest(
      'http://localhost/api/generated-documents/validate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          draftId,
          templateId,
          serviceAgreementId: agreementId,
        }),
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      isValid: false,
      summary: { errorCount: 1 },
      errors: [{ field: 'service.fields.reference' }],
    });
    expect(validateForGeneration).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        draftId,
        templateId,
        serviceAgreementId: agreementId,
      }),
      'Test User',
      session.id,
    );
  });
});
