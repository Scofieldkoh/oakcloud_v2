import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  documentTemplate: { findFirst: vi.fn() },
  company: { findFirst: vi.fn() },
  contact: { findMany: vi.fn() },
  serviceAgreement: { findUnique: vi.fn(), delete: vi.fn() },
  generatedDocument: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const createAuditLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ createAuditLog: createAuditLogMock }));

import {
  GENERATION_SESSION_VERSION,
  createDocumentFromTemplateSchema,
  saveGenerationSessionSchema,
} from '@/lib/validations/generated-document';
import { readActiveGenerationSession } from '@/lib/document-generation-session';
import {
  createGenerationSession,
  getGenerationSession,
  updateGenerationSession,
} from '@/services/document-generation-session.service';

const tenantParams = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
};

const emptySession = {
  version: GENERATION_SESSION_VERSION,
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

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.documentTemplate.findFirst.mockResolvedValue(null);
  prismaMock.company.findFirst.mockResolvedValue(null);
  prismaMock.contact.findMany.mockResolvedValue([]);
  prismaMock.serviceAgreement.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
});

describe('generation session validation', () => {
  it('normalizes a persisted v1 session to the v2 stage model in memory', () => {
    expect(readActiveGenerationSession({
      generationSession: {
        version: 1,
        currentStep: 4,
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
      },
    })).toMatchObject({
      version: 2,
      currentStep: 2,
      serviceAgreementId: null,
    });
  });

  it('accepts an untouched first-step session', () => {
    const result = saveGenerationSessionSchema.parse({
      version: GENERATION_SESSION_VERSION,
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
    });

    expect(result.currentStep).toBe(0);
    expect(result.templateId).toBeNull();
    expect(result.serviceAgreementId).toBeNull();
  });

  it('rejects an unsupported session version and out-of-range step', () => {
    expect(() => saveGenerationSessionSchema.parse({
      version: 999,
      currentStep: 9,
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
    })).toThrow();
  });

  it('accepts an optional draft id for final generation', () => {
    const result = createDocumentFromTemplateSchema.parse({
      draftId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      templateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: 'Board resolution',
    });

    expect(result.draftId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });
});

describe('generation session persistence', () => {
  it('creates independent draft records for independent saves', async () => {
    prismaMock.generatedDocument.create
      .mockResolvedValueOnce({
        id: 'draft-1',
        updatedAt: new Date('2026-07-18T01:00:00Z'),
        metadata: { generationSession: emptySession },
      })
      .mockResolvedValueOnce({
        id: 'draft-2',
        updatedAt: new Date('2026-07-18T02:00:00Z'),
        metadata: { generationSession: emptySession },
      });

    const first = await createGenerationSession(emptySession, tenantParams);
    const second = await createGenerationSession(emptySession, tenantParams);

    expect(first.id).toBe('draft-1');
    expect(second.id).toBe('draft-2');
    expect(prismaMock.generatedDocument.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.generatedDocument.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        tenantId: tenantParams.tenantId,
        title: 'Untitled Document',
        status: 'DRAFT',
        metadata: { generationSession: emptySession },
      }),
    });
  });

  it('uses a template-aware fallback title', async () => {
    const templateSession = {
      ...emptySession,
      templateId: '33333333-3333-4333-8333-333333333333',
    };
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      id: templateSession.templateId,
      name: 'Resolution',
    });
    prismaMock.generatedDocument.create.mockResolvedValue({
      id: 'draft-1',
      updatedAt: new Date('2026-07-18T01:00:00Z'),
      metadata: { generationSession: templateSession },
    });

    await createGenerationSession(templateSession, tenantParams);

    expect(prismaMock.generatedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'Untitled - Resolution' }),
    });
  });

  it('copies the template layout into the draft session on create', async () => {
    const templateSession = {
      ...emptySession,
      templateId: '33333333-3333-4333-8333-333333333333',
    };
    const templateLayout = {
      version: 1,
      layout: {
        version: 1,
        fontSize: '12pt',
        marginsMm: { top: 15, right: 20, bottom: 15, left: 20 },
      },
    };
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      id: templateSession.templateId,
      name: 'Resolution',
      contentJson: templateLayout,
    });
    prismaMock.generatedDocument.create.mockResolvedValue({
      id: 'draft-1',
      updatedAt: new Date('2026-07-18T01:00:00Z'),
      metadata: { generationSession: templateSession },
    });

    await createGenerationSession(templateSession, tenantParams);

    expect(prismaMock.generatedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contentJson: templateLayout }),
    });
  });

  it('copies the template layout into the draft session on update', async () => {
    const templateId = '33333333-3333-4333-8333-333333333333';
    const templateLayout = {
      version: 1,
      layout: {
        version: 1,
        fontSize: '12pt',
        marginsMm: { top: 15, right: 20, bottom: 15, left: 20 },
      },
    };
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: 'draft-1',
      tenantId: tenantParams.tenantId,
      status: 'DRAFT',
      deletedAt: null,
      metadata: { generationSession: emptySession },
    });
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      id: templateId,
      name: 'Resolution',
      compositionType: 'STANDARD',
      contentJson: templateLayout,
    });
    prismaMock.generatedDocument.update.mockResolvedValue({
      id: 'draft-1',
      updatedAt: new Date('2026-07-18T03:00:00Z'),
      metadata: { generationSession: { ...emptySession, templateId } },
    });

    await updateGenerationSession('draft-1', { ...emptySession, templateId }, tenantParams);

    expect(prismaMock.generatedDocument.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: expect.objectContaining({ contentJson: templateLayout }),
    });
  });

  it('prefers an explicit editedContentJson over the template layout', async () => {
    const templateId = '33333333-3333-4333-8333-333333333333';
    const customJson = { version: 1, layout: { fontSize: '14pt' } };
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      id: templateId,
      name: 'Resolution',
      compositionType: 'STANDARD',
      contentJson: { version: 1, layout: { fontSize: '12pt' } },
    });
    prismaMock.generatedDocument.create.mockResolvedValue({
      id: 'draft-1',
      updatedAt: new Date('2026-07-18T01:00:00Z'),
      metadata: { generationSession: { ...emptySession, templateId } },
    });

    await createGenerationSession(
      { ...emptySession, templateId, editedContentJson: customJson },
      tenantParams,
    );

    expect(prismaMock.generatedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contentJson: customJson }),
    });
  });

  it('updates only an active session in the current workspace', async () => {
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: 'draft-1',
      tenantId: tenantParams.tenantId,
      status: 'DRAFT',
      deletedAt: null,
      metadata: { generationSession: emptySession },
    });
    const changedSession = { ...emptySession, title: 'Changed' };
    prismaMock.generatedDocument.update.mockResolvedValue({
      id: 'draft-1',
      updatedAt: new Date('2026-07-18T03:00:00Z'),
      metadata: { generationSession: changedSession },
    });

    const result = await updateGenerationSession('draft-1', changedSession, tenantParams);

    expect(result.state.title).toBe('Changed');
    expect(prismaMock.generatedDocument.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'draft-1',
        tenantId: tenantParams.tenantId,
        deletedAt: null,
      },
    });
    expect(prismaMock.generatedDocument.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: expect.objectContaining({
        title: 'Changed',
        metadata: { generationSession: changedSession },
      }),
    });
  });

  it('rejects a standard-template save while a Service Agreement remains attached', async () => {
    const standardTemplateId = '33333333-3333-4333-8333-333333333333';
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: 'draft-1',
      tenantId: tenantParams.tenantId,
      status: 'DRAFT',
      deletedAt: null,
      metadata: { generationSession: emptySession },
    });
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      id: standardTemplateId,
      name: 'Resolution',
      compositionType: 'STANDARD',
    });
    prismaMock.serviceAgreement.findUnique.mockResolvedValue({
      id: 'agreement-1',
      status: 'DRAFT',
    });

    await expect(updateGenerationSession('draft-1', {
      ...emptySession,
      templateId: standardTemplateId,
    }, tenantParams)).rejects.toThrow(
      'Discard the attached Service Agreement before switching templates',
    );
  });

  it('discards an attached draft agreement when a standard-template save confirms it', async () => {
    const standardTemplateId = '33333333-3333-4333-8333-333333333333';
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: 'draft-1',
      tenantId: tenantParams.tenantId,
      status: 'DRAFT',
      deletedAt: null,
      metadata: { generationSession: emptySession },
    });
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      id: standardTemplateId,
      name: 'Resolution',
      compositionType: 'STANDARD',
    });
    prismaMock.serviceAgreement.findUnique.mockResolvedValue({
      id: 'agreement-1',
      status: 'DRAFT',
    });
    prismaMock.generatedDocument.update.mockResolvedValue({
      id: 'draft-1',
      updatedAt: new Date('2026-07-18T03:00:00Z'),
    });

    const result = await updateGenerationSession('draft-1', {
      ...emptySession,
      templateId: standardTemplateId,
      serviceAgreementId: 'agreement-1',
      discardServiceAgreement: true,
    }, tenantParams);

    expect(prismaMock.serviceAgreement.delete).toHaveBeenCalledWith({
      where: { id: 'agreement-1' },
    });
    expect(result.state.serviceAgreementId).toBeNull();
  });

  it('rejects hiding an attached agreement from a Service Agreement session', async () => {
    const serviceTemplateId = '44444444-4444-4444-8444-444444444444';
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: 'draft-1',
      tenantId: tenantParams.tenantId,
      status: 'DRAFT',
      deletedAt: null,
      metadata: { generationSession: emptySession },
    });
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      id: serviceTemplateId,
      name: 'Service Agreement',
      compositionType: 'SERVICE_AGREEMENT',
    });
    prismaMock.serviceAgreement.findUnique.mockResolvedValue({
      id: 'agreement-1',
      status: 'DRAFT',
    });

    await expect(updateGenerationSession('draft-1', {
      ...emptySession,
      templateId: serviceTemplateId,
      serviceAgreementId: null,
    }, tenantParams)).rejects.toThrow(
      'Service Agreement session does not match the attached draft',
    );
    expect(prismaMock.generatedDocument.update).not.toHaveBeenCalled();
  });

  it('never discards an attached non-draft agreement', async () => {
    const standardTemplateId = '33333333-3333-4333-8333-333333333333';
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: 'draft-1',
      tenantId: tenantParams.tenantId,
      status: 'DRAFT',
      deletedAt: null,
      metadata: { generationSession: emptySession },
    });
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      id: standardTemplateId,
      name: 'Resolution',
      compositionType: 'STANDARD',
    });
    prismaMock.serviceAgreement.findUnique.mockResolvedValue({
      id: 'agreement-1',
      status: 'EFFECTIVE',
    });

    await expect(updateGenerationSession('draft-1', {
      ...emptySession,
      templateId: standardTemplateId,
      serviceAgreementId: 'agreement-1',
      discardServiceAgreement: true,
    }, tenantParams)).rejects.toThrow(
      'Only draft Service Agreements can be discarded',
    );
    expect(prismaMock.serviceAgreement.delete).not.toHaveBeenCalled();
  });

  it('loads an active session envelope', async () => {
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: 'draft-1',
      tenantId: tenantParams.tenantId,
      status: 'DRAFT',
      deletedAt: null,
      updatedAt: new Date('2026-07-18T04:00:00Z'),
      metadata: { generationSession: emptySession },
    });

    await expect(getGenerationSession('draft-1', tenantParams)).resolves.toEqual({
      id: 'draft-1',
      savedAt: '2026-07-18T04:00:00.000Z',
      state: emptySession,
      agreement: null,
    });
  });

  it('does not reveal a draft from another workspace', async () => {
    prismaMock.generatedDocument.findFirst.mockResolvedValue(null);

    await expect(getGenerationSession('draft-1', tenantParams)).rejects.toThrow(
      'Document draft not found',
    );
  });

  it('rejects a generated draft that has no active session metadata', async () => {
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: 'draft-1',
      tenantId: tenantParams.tenantId,
      status: 'DRAFT',
      deletedAt: null,
      metadata: { missingPlaceholders: [] },
    });

    await expect(getGenerationSession('draft-1', tenantParams)).rejects.toThrow(
      'Document draft not found',
    );
  });
});
