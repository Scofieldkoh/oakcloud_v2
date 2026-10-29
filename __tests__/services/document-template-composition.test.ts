import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  documentTemplate: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(() => null),
}));

import {
  createDocumentTemplate,
  duplicateDocumentTemplate,
  updateDocumentTemplate,
} from '@/services/document-template.service';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };
const validAgreementContent = [
  '{{@agreement.serviceSections}}',
  '{{@agreement.feeTable}}',
  '{{@agreement.entityAppendix}}',
].join('\n');

const existingAgreement = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: actor.tenantId,
  name: 'Service Agreement',
  description: null,
  category: 'CONTRACT',
  compositionType: 'SERVICE_AGREEMENT',
  content: validAgreementContent,
  contentJson: null,
  placeholders: [],
  isActive: true,
  version: 1,
  createdById: actor.userId,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe('document-template service agreement composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to create, edit or duplicate A4 templates now that the editor is retired', async () => {
    prismaMock.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(
      createDocumentTemplate(
        {
          name: 'Standard Contract',
          description: null,
          category: 'CONTRACT',
          compositionType: 'STANDARD',
          content: '<p>Standard contract</p>',
          placeholders: [],
          isActive: true,
        },
        actor,
      ),
    ).rejects.toMatchObject({ details: { reason: 'A4_EDITOR_RETIRED', operation: 'template-create' } });

    prismaMock.documentTemplate.findFirst.mockResolvedValue(existingAgreement);
    await expect(
      updateDocumentTemplate({ id: existingAgreement.id, content: validAgreementContent }, actor),
    ).rejects.toMatchObject({ details: { reason: 'A4_EDITOR_RETIRED', operation: 'template-edit' } });

    prismaMock.documentTemplate.findFirst.mockResolvedValue(existingAgreement);
    await expect(
      duplicateDocumentTemplate({ id: existingAgreement.id, name: 'Agreement copy' }, actor),
    ).rejects.toMatchObject({ details: { reason: 'A4_EDITOR_RETIRED', operation: 'template-duplicate' } });

    expect(prismaMock.documentTemplate.create).not.toHaveBeenCalled();
    expect(prismaMock.documentTemplate.update).not.toHaveBeenCalled();
  });

  it('rejects changing a standard template to an agreement until slots exist', async () => {
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      ...existingAgreement,
      compositionType: 'STANDARD',
      content: '<p>Standard contract</p>',
    });

    await expect(
      updateDocumentTemplate(
        {
          id: existingAgreement.id,
          compositionType: 'SERVICE_AGREEMENT',
        },
        actor,
      ),
    ).rejects.toThrow('Service Agreement template must contain exactly one');
  });

});
