import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  documentTemplate: {
    findFirst: vi.fn(),
  },
}));

const ensureAllMock = vi.hoisted(() => vi.fn());
const createOakDocTemplateMock = vi.hoisted(() => vi.fn());
const linkOakDocMigrationMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/services/oakdoc-template-migration.service', () => ({
  ensureAllOakDocTemplateMigrations: ensureAllMock,
}));
vi.mock('@/services/oakdoc-template.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/oakdoc-template.service')>();
  return {
    ...original,
    createOakDocTemplate: createOakDocTemplateMock,
  };
});
vi.mock('@/services/oakdoc-migration.service', () => ({
  linkOakDocMigration: linkOakDocMigrationMock,
}));

import { mergeOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';
import { migrateCanonicalOakDocTemplates } from '@/services/oakdoc-consolidated-migration.service';

const params = { tenantId: 'tenant-1', userId: 'user-1' };

describe('consolidated OakDoc template migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureAllMock.mockResolvedValue([
      {
        migrationId: 'standard-template:dr-appointment-of-corp-sec',
        migrationVersion: 1,
        status: 'created',
        templateId: 'oakdoc-resolution',
        reason: 'created',
      },
    ]);
    createOakDocTemplateMock.mockResolvedValue({
      id: 'oakdoc-service-agreement',
      name: 'Oaktree Master Services Agreement (OakDoc)',
      version: 1,
      isActive: false,
    });
    linkOakDocMigrationMock.mockResolvedValue({});
  });

  it('creates missing canonical OakDoc templates and links both legacy sources', async () => {
    prismaMock.documentTemplate.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.name === 'Oaktree Master Services Agreement (OakDoc)') return null;
      if (where.id === 'oakdoc-resolution') {
        return { id: 'oakdoc-resolution', version: 1 };
      }
      if (where.id === 'oakdoc-service-agreement') {
        return {
          id: 'oakdoc-service-agreement',
          name: 'Oaktree Master Services Agreement (OakDoc)',
          version: 1,
          isActive: false,
        };
      }
      if (where.name === 'DR_Appointment of Corp Sec') {
        return { id: 'legacy-resolution', version: 4, isActive: true };
      }
      if (where.name === 'Oaktree Master Services Agreement') {
        return { id: 'legacy-service-agreement', version: 7, isActive: true };
      }
      return null;
    });

    const result = await migrateCanonicalOakDocTemplates(params);

    expect(createOakDocTemplateMock).toHaveBeenCalledOnce();
    expect(createOakDocTemplateMock.mock.calls[0][0]).toMatchObject({
      name: 'Oaktree Master Services Agreement (OakDoc)',
      compositionType: 'SERVICE_AGREEMENT',
      isActive: false,
    });
    expect(linkOakDocMigrationMock).toHaveBeenCalledTimes(2);
    expect(linkOakDocMigrationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oakDocTemplateId: 'oakdoc-resolution',
        legacyTemplateId: 'legacy-resolution',
        expectedRevision: 1,
      }),
      params,
    );
    expect(linkOakDocMigrationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oakDocTemplateId: 'oakdoc-service-agreement',
        legacyTemplateId: 'legacy-service-agreement',
        expectedRevision: 1,
      }),
      params,
    );
    expect(result.serviceAgreement).toMatchObject({
      templateId: 'oakdoc-service-agreement',
      status: 'created',
      legacyTemplateId: 'legacy-service-agreement',
      linked: true,
      active: false,
    });
  });

  it('preserves an existing OakDoc Service Agreement asset rather than overwriting it', async () => {
    const existingContentJson = mergeOakDocTemplateMetadata(null, {
      schemaVersion: 1,
      storageKey: 'tenant-1/templates/oakdoc/assets/customized',
      fileName: 'Customized Service Agreement.docx',
      fileSize: 1234,
      sha256: 'a'.repeat(64),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fieldTags: ['company.name'],
    });

    prismaMock.documentTemplate.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.name === 'Oaktree Master Services Agreement (OakDoc)') {
        return {
          id: 'oakdoc-service-agreement',
          name: 'Oaktree Master Services Agreement (OakDoc)',
          version: 9,
          isActive: false,
          contentJson: existingContentJson,
        };
      }
      if (where.id === 'oakdoc-resolution') return { id: 'oakdoc-resolution', version: 3 };
      if (where.id === 'oakdoc-service-agreement') {
        return {
          id: 'oakdoc-service-agreement',
          name: 'Oaktree Master Services Agreement (OakDoc)',
          version: 9,
          isActive: false,
        };
      }
      if (where.name === 'DR_Appointment of Corp Sec') {
        return { id: 'legacy-resolution', version: 4, isActive: true };
      }
      if (where.name === 'Oaktree Master Services Agreement') {
        return { id: 'legacy-service-agreement', version: 7, isActive: true };
      }
      return null;
    });

    const result = await migrateCanonicalOakDocTemplates(params);

    expect(createOakDocTemplateMock).not.toHaveBeenCalled();
    expect(result.serviceAgreement.status).toBe('preserved');
    expect(linkOakDocMigrationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oakDocTemplateId: 'oakdoc-service-agreement',
        expectedRevision: 9,
      }),
      params,
    );
  });
});
