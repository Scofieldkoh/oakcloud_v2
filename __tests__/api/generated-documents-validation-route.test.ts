import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const templateId = '33333333-3333-4333-8333-333333333333';
const contactId = '44444444-4444-4444-8444-444444444444';
const companyId = '55555555-5555-4555-8555-555555555555';
const directorId = '66666666-6666-4666-8666-666666666666';
const shareholderId = '77777777-7777-4777-8777-777777777777';

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn() }));
vi.mock('@/services/document-validation.service', () => ({
  validateForGeneration: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { validateForGeneration } from '@/services/document-validation.service';
import { POST as validateDocument } from '@/app/api/generated-documents/validate/route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/generated-documents/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('generated documents validation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      tenantId: workspaceId,
      isSuperAdmin: false,
    } as never);
    vi.mocked(validateForGeneration).mockResolvedValue({
      isValid: true,
      errors: [],
      warnings: [],
      resolvedData: {
        company: { id: companyId, name: 'Oakcloud Pte. Ltd.' },
        directors: [],
        shareholders: [],
        selectedDirector: { id: directorId },
        selectedShareholder: { id: shareholderId },
        selectedContact: { id: contactId },
        requiredPlaceholders: [],
        availablePlaceholders: [],
        missingPlaceholders: [],
      },
    } as never);
  });

  it('passes all singular selection UUIDs to validation and reports resolved selections', async () => {
    const response = await validateDocument(request({
      templateId,
      companyId,
      selectedDirectorId: directorId,
      selectedShareholderId: shareholderId,
      selectedContactId: contactId,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(validateForGeneration).toHaveBeenCalledWith(workspaceId, {
      templateId,
      companyId,
      contactIds: undefined,
      draftId: undefined,
      selectedDirectorId: directorId,
      selectedShareholderId: shareholderId,
      selectedContactId: contactId,
      serviceAgreementId: undefined,
      customData: undefined,
    }, 'Test User', 'user-1');
    expect(body.resolvedData).toMatchObject({
      hasSelectedDirector: true,
      hasSelectedShareholder: true,
      hasSelectedContact: true,
    });
  });

  it('passes a blank trusted preparer name without accepting client identity', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'user-1',
      firstName: ' ',
      lastName: '',
      tenantId: workspaceId,
      isSuperAdmin: false,
    } as never);

    await validateDocument(request({
      templateId,
      customData: { preparerName: 'Client Supplied', generatedBy: 'Client Supplied' },
      preparerName: 'Body Supplied',
    }));

    expect(validateForGeneration).toHaveBeenCalledWith(workspaceId, expect.objectContaining({
      customData: { preparerName: 'Client Supplied', generatedBy: 'Client Supplied' },
    }), '', 'user-1');
  });
});
