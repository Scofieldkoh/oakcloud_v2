import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  taskFindFirst: vi.fn(),
  documentGenerationBatchFindFirst: vi.fn(),
  hasPermission: vi.fn(),
  canAccessCompany: vi.fn(),
  resolveEsigningActorScope: vi.fn(),
  canReadEnvelope: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findFirst: mocks.taskFindFirst },
    documentGenerationBatch: { findFirst: mocks.documentGenerationBatchFindFirst },
  },
}));
vi.mock('@/lib/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, canAccessCompany: mocks.canAccessCompany };
});
vi.mock('@/services/esigning-envelope.lib', () => ({
  resolveEsigningActorScope: mocks.resolveEsigningActorScope,
  canReadEnvelope: mocks.canReadEnvelope,
}));

import { NotFoundError } from '@/lib/errors';
import { getTaskResources } from '@/services/tasks/resources.service';

const session = {
  id: 'user-1',
  email: 'owner@example.com',
  firstName: 'Owner',
  lastName: 'User',
  tenantId: 'tenant-a',
  isSuperAdmin: false,
  isWorkspaceAdmin: false,
  hasAllCompaniesAccess: false,
  companyIds: ['company-1'],
};

function createTask() {
  return {
    id: 'task-1',
    title: 'Client onboarding',
    status: 'IN_PROGRESS',
    dueDate: new Date('2026-09-30T00:00:00.000Z'),
    company: { id: 'company-1', name: 'Oak Pte. Ltd.', uen: '202600001A', deletedAt: null },
    owner: { id: 'user-2', firstName: 'Ava', lastName: 'Tan', email: 'ava@example.com' },
    pipelineVersion: { pipeline: { name: 'Client onboarding' } },
    stages: [
      {
        id: 'stage-company',
        name: 'Company profile',
        position: 0,
        actionType: 'COMPANY_PROFILE',
        actionConfig: {},
        status: 'COMPLETED',
        description: null,
        notes: 'Company verified',
        startedAt: new Date('2026-08-28T01:00:00.000Z'),
        completedAt: new Date('2026-08-28T02:00:00.000Z'),
        assignee: null,
        checklistItems: [],
        outcome: {
          type: 'COMPANY',
          companyId: 'company-1',
          company: {
            id: 'company-1',
            name: 'Oak Pte. Ltd.',
            uen: '202600001A',
            deletedAt: null,
          },
        },
        esigningPreparation: null,
      },
      {
        id: 'stage-document',
        name: 'Generate agreement',
        position: 1,
        actionType: 'DOCUMENT_GENERATION',
        actionConfig: {},
        status: 'COMPLETED',
        description: null,
        notes: null,
        startedAt: null,
        completedAt: new Date('2026-08-29T02:00:00.000Z'),
        assignee: null,
        checklistItems: [],
        outcome: {
          type: 'GENERATED_DOCUMENT',
          generatedDocumentId: 'doc-1',
          generatedDocument: {
            id: 'doc-1',
            title: 'Service Agreement',
            status: 'FINALIZED',
            companyId: 'company-1',
            deletedAt: null,
          },
        },
        esigningPreparation: null,
      },
      {
        id: 'stage-sign',
        name: 'Obtain signatures',
        position: 2,
        actionType: 'ESIGNING',
        actionConfig: {},
        status: 'IN_PROGRESS',
        description: null,
        notes: null,
        startedAt: new Date('2026-08-29T03:00:00.000Z'),
        completedAt: null,
        assignee: null,
        checklistItems: [],
        outcome: {
          type: 'ESIGNING_ENVELOPE',
          esigningEnvelopeId: 'envelope-1',
          esigningEnvelope: {
            id: 'envelope-1',
            title: 'Service Agreement',
            status: 'IN_PROGRESS',
            pdfGenerationStatus: 'COMPLETED',
            expiresAt: new Date('2026-09-15T00:00:00.000Z'),
            companyId: 'company-1',
            createdById: 'user-1',
            deletedAt: null,
            documents: [{
              id: 'esign-doc-1',
              fileName: 'service-agreement.pdf',
              signedStoragePath: null,
              sortOrder: 0,
            }],
            recipients: [{
              id: 'recipient-1',
              type: 'SIGNER',
              name: 'Alex Lim',
              email: 'alex@example.com',
              status: 'NOTIFIED',
              signingOrder: 1,
            }],
          },
        },
        esigningPreparation: { status: 'READY', lastError: null },
      },
    ],
  };
}

describe('getTaskResources', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T08:00:00.000Z'));
    vi.clearAllMocks();
    mocks.documentGenerationBatchFindFirst.mockResolvedValue(null);
    mocks.hasPermission.mockResolvedValue(true);
    mocks.canAccessCompany.mockResolvedValue(true);
    mocks.resolveEsigningActorScope.mockResolvedValue({
      tenantId: 'tenant-a',
      canCreate: true,
      canReadAll: true,
      canUpdateAny: true,
      canDeleteAny: true,
      canManage: true,
    });
    mocks.canReadEnvelope.mockReturnValue(true);
    mocks.taskFindFirst.mockResolvedValue(createTask());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes complete linked company, document, and e-sign resources', async () => {
    const result = await getTaskResources(session, 'tenant-a', 'task-1');

    expect(mocks.taskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-1', tenantId: 'tenant-a', deletedAt: null },
    }));
    expect(result.task.company).toEqual({
      id: 'company-1',
      name: 'Oak Pte. Ltd.',
      uen: '202600001A',
      href: '/companies/company-1',
    });
    expect(result.stages.map((stage) => stage.id)).toEqual([
      'stage-company',
      'stage-document',
      'stage-sign',
    ]);
    expect(result.stages[1].resources[0]).toMatchObject({
      kind: 'generatedDocument',
      state: 'available',
      href: expect.stringContaining('/generated-documents/doc-1?taskId=task-1'),
    });
    expect(result.stages[1].resources[0]).not.toHaveProperty('pdfHref');
    expect(result.stages[1].resources[0]).not.toHaveProperty('downloadFileName');
    expect(result.stages[2].resources[0]).toMatchObject({
      kind: 'esigningEnvelope',
      state: 'available',
      pdfGenerationStatus: 'COMPLETED',
      canGenerateSignerLink: true,
      documents: [{
        id: 'esign-doc-1',
        fileName: 'service-agreement.pdf',
        originalPdfHref: '/api/esigning/envelopes/envelope-1/documents/esign-doc-1/pdf',
        signedPdfHref: null,
      }],
      signers: [{ linkState: 'available' }],
    });
    expect(result.hasPendingResources).toBe(true);
    expect(JSON.stringify(result)).not.toContain('storagePath');
    expect(JSON.stringify(result)).not.toContain('lastError');
  });

  it('serializes every document in the latest task-linked generation batch', async () => {
    mocks.documentGenerationBatchFindFirst.mockResolvedValue({
      items: [
        {
          generatedDocument: {
            id: 'doc-1',
            title: 'Service Agreement',
            status: 'FINALIZED',
            companyId: 'company-1',
            deletedAt: null,
          },
        },
        {
          generatedDocument: {
            id: 'doc-2',
            title: 'Privacy Notice',
            status: 'DRAFT',
            companyId: 'company-1',
            deletedAt: null,
          },
        },
      ],
    });

    const result = await getTaskResources(session, 'tenant-a', 'task-1');
    const documents = result.stages[1].resources;

    expect(documents).toHaveLength(2);
    expect(documents.map((resource) => resource.id)).toEqual(['doc-1', 'doc-2']);
    expect(documents.map((resource) => resource.href)).toEqual([
      expect.stringContaining('/generated-documents/doc-1?taskId=task-1'),
      expect.stringContaining('/generated-documents/doc-2?taskId=task-1'),
    ]);
    expect(JSON.stringify(documents)).not.toContain('pdfHref');
  });

  it('returns pending resources while a stage has not created its linked record', async () => {
    const task = createTask();
    task.stages = [
      {
        ...task.stages[1],
        status: 'IN_PROGRESS',
        outcome: null,
      },
    ] as never;
    mocks.taskFindFirst.mockResolvedValue(task);

    const result = await getTaskResources(session, 'tenant-a', 'task-1');

    expect(result.hasPendingResources).toBe(true);
    expect(result.stages[0].resources[0]).toMatchObject({
      state: 'pending',
      reason: 'This resource will appear when the stage creates or links it.',
    });
  });

  it('redacts forbidden document resources without failing the aggregate', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    const result = await getTaskResources(session, 'tenant-a', 'task-1');

    expect(result.stages[1].resources[0]).toMatchObject({
      kind: 'generatedDocument',
      state: 'unavailable',
      id: null,
      href: null,
      reason: 'You do not have permission to view this resource.',
    });
  });

  it('redacts a linked company resource outside the user company scope', async () => {
    const task = createTask();
    task.stages[0] = {
      ...task.stages[0],
      outcome: {
        ...task.stages[0].outcome!,
        companyId: 'company-2',
        company: {
          id: 'company-2',
          name: 'Restricted Pte. Ltd.',
          uen: '202600002B',
          deletedAt: null,
        },
      },
    } as never;
    mocks.canAccessCompany.mockImplementation(async (companyId: string) => companyId === 'company-1');
    mocks.taskFindFirst.mockResolvedValue(task);

    const result = await getTaskResources(session, 'tenant-a', 'task-1');

    expect(result.stages[0].resources[0]).toMatchObject({
      kind: 'company',
      state: 'unavailable',
      id: null,
      href: null,
      reason: 'You do not have permission to view this resource.',
    });
  });

  it('returns unavailable for a terminal stage whose linked resource is gone', async () => {
    const task = createTask();
    task.stages[1] = {
      ...task.stages[1],
      status: 'COMPLETED',
        outcome: {
          type: 'GENERATED_DOCUMENT',
          generatedDocumentId: 'doc-gone',
          generatedDocument: null,
        },
      } as never;
    mocks.taskFindFirst.mockResolvedValue(task);

    const result = await getTaskResources(session, 'tenant-a', 'task-1');

    expect(result.stages[1].resources[0]).toMatchObject({
      kind: 'generatedDocument',
      state: 'unavailable',
      reason: 'The linked resource is no longer available.',
    });
  });

  it('stops polling when all linked resources are terminal', async () => {
    const task = createTask();
    task.stages[2] = {
      ...task.stages[2],
      status: 'COMPLETED',
      outcome: {
        ...task.stages[2].outcome!,
        esigningEnvelope: {
          ...task.stages[2].outcome!.esigningEnvelope!,
          status: 'COMPLETED',
        },
      },
      } as never;
    mocks.taskFindFirst.mockResolvedValue(task);

    const result = await getTaskResources(session, 'tenant-a', 'task-1');

    expect(result.hasPendingResources).toBe(false);
  });

  it('does not enable signer links from envelope ownership when update permission is absent', async () => {
    mocks.resolveEsigningActorScope.mockResolvedValue({
      tenantId: 'tenant-a',
      canCreate: false,
      canReadAll: true,
      canUpdateAny: false,
      canDeleteAny: false,
      canManage: false,
    });

    const result = await getTaskResources(session, 'tenant-a', 'task-1');

    expect(result.stages[2].resources[0]).toMatchObject({
      kind: 'esigningEnvelope',
      state: 'available',
      canGenerateSignerLink: false,
    });
  });

  it('requires the tenant-scoped task and throws when it is not found', async () => {
    mocks.taskFindFirst.mockResolvedValue(null);

    await expect(getTaskResources(session, 'tenant-b', 'task-1')).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.taskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-1', tenantId: 'tenant-b', deletedAt: null },
    }));
  });
});
