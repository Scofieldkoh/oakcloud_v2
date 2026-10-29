import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    documentGenerationBatch: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    documentGenerationBatchItem: { updateMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/services/tasks/integration.service', () => ({
  linkFirstGeneratedDocumentTaskOutcomeForBatch: vi.fn(),
}));
vi.mock('@/services/document-generation-batch/preview.service', async (importOriginal) => ({
  oakDocBatchContext: (await importOriginal<typeof import('@/services/document-generation-batch/preview.service')>()).oakDocBatchContext,
  buildBatchItemRenderInput: vi.fn(),
}));

const a4Mock = vi.hoisted(() => ({
  materializeDocumentFromTemplate: vi.fn(),
  finalizeDocument: vi.fn(),
}));
vi.mock('@/services/document-generator.service', () => a4Mock);

const oakMock = vi.hoisted(() => ({
  materializeOakDocGeneratedDocument: vi.fn(),
}));
vi.mock('@/services/oakdoc-generation.service', () => oakMock);

import { materializeBatchDocumentByEngine } from '@/services/document-generation-batch/generation.service';

const actorParams = { tenantId: 'tenant-1', userId: 'user-1' };
const configuration = {
  version: 1 as const,
  title: 'Generated',
  contactIds: [],
  selectedDirectorId: null,
  selectedShareholderId: null,
  selectedContactId: null,
  itemValues: {},
  masterOverrides: {},
  useLetterhead: true,
  serviceAgreement: null,
};
const evaluated = {
  content: '<p>A4</p>',
  fingerprint: 'fingerprint',
  blockingErrors: [],
  effectiveCustomData: {},
  resolvedTitle: 'Generated',
  templateVersion: 3,
  rendered: null,
  oakDocGeneration: null,
};

function item(contentJson: unknown) {
  return {
    id: 'item-1',
    templateId: 'template-1',
    generatedDocumentId: 'document-1',
    editedContent: null,
    editedContentJson: null,
    template: {
      id: 'template-1',
      name: 'Template',
      content: '<p>A4</p>',
      contentJson,
    },
    generatedDocument: {
      id: 'document-1',
      revision: 5,
      serviceAgreement: null,
    },
  } as any;
}

const batch = {
  id: 'batch-1',
  primaryCompanyId: 'company-1',
} as any;

describe('batch document engine routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes OakDoc templates to the DOCX-native materializer', async () => {
    oakMock.materializeOakDocGeneratedDocument.mockResolvedValue({
      id: 'document-1',
      title: 'Generated',
      revision: 6,
    });

    await materializeBatchDocumentByEngine({
      batch,
      item: item({
        oakDoc: {
          schemaVersion: 1,
          storageKey: 'tenant-1/templates/oakdoc/assets/master.docx',
          fileName: 'master.docx',
          fileSize: 100,
          sha256: 'a'.repeat(64),
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          fieldTags: [],
        },
      }),
      configuration,
      evaluated,
      actor: 'Ava Tan',
      params: actorParams,
    });

    expect(oakMock.materializeOakDocGeneratedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 'template-1',
        generatedDocumentId: 'document-1',
        expectedRevision: 5,
        companyId: 'company-1',
        title: 'Generated',
      }),
      actorParams,
      undefined,
    );
    expect(a4Mock.materializeDocumentFromTemplate).not.toHaveBeenCalled();
  });

  it('passes company values set for the document only to OakDoc generation', async () => {
    oakMock.materializeOakDocGeneratedDocument.mockResolvedValue({ id: 'document-1', title: 'Generated', revision: 6 });

    await materializeBatchDocumentByEngine({
      batch,
      item: item({
        oakDoc: {
          schemaVersion: 1,
          storageKey: 'tenant-1/templates/oakdoc/assets/master.docx',
          fileName: 'master.docx',
          fileSize: 100,
          sha256: 'a'.repeat(64),
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          fieldTags: [],
        },
      }),
      configuration: { ...configuration, companyFieldValues: { firstFinancialYearEnd: '2026-12-31' } },
      evaluated,
      actor: 'Ava Tan',
      params: actorParams,
    });

    expect(oakMock.materializeOakDocGeneratedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ companyFieldValues: { firstFinancialYearEnd: '2026-12-31' } }),
      actorParams,
      undefined,
    );
  });

  it('keeps legacy A4 templates on the existing materializer', async () => {
    a4Mock.materializeDocumentFromTemplate.mockResolvedValue({
      id: 'document-1',
      title: 'Generated',
      revision: 6,
    });

    await materializeBatchDocumentByEngine({
      batch,
      item: item(null),
      configuration,
      evaluated,
      actor: 'Ava Tan',
      params: actorParams,
    });

    expect(a4Mock.materializeDocumentFromTemplate).toHaveBeenCalledTimes(1);
    expect(oakMock.materializeOakDocGeneratedDocument).not.toHaveBeenCalled();
  });
});
