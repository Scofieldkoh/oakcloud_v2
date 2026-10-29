import { describe, expect, it, vi } from 'vitest';

const oakDocMock = vi.hoisted(() => ({
  materializeOakDocGeneratedDocument: vi.fn(),
}));
vi.mock('@/services/oakdoc-generation.service', () => oakDocMock);

vi.mock('@/services/document-generator.service', () => ({
  finalizeDocument: vi.fn(),
  materializeDocumentFromTemplate: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    documentGenerationBatchItem: { update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    documentGenerationBatch: { update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  },
}));

import { materializeBatchDocumentByEngine } from '@/services/document-generation-batch/generation.service';

const previewFingerprint = 'c'.repeat(64);
const templateSha = 'b'.repeat(64);

function oakDocMetadata() {
  return {
    documentEngine: 'OAKDOC',
    oakDocGenerated: {
      schemaVersion: 1,
      storageKey: 'tenant-1/generated-documents/doc-1/oakdoc/reviewed.docx',
      fileName: 'Reviewed.docx',
      fileSize: 1234,
      sha256: 'a'.repeat(64),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      templateId: 'template-1',
      templateVersion: 3,
      templateSha256: templateSha,
      generatedAt: '2026-09-26T03:00:00.000Z',
      fieldsUpdated: 2,
      unresolvedTags: [],
      conditionsResolved: 0,
      conditionsKept: 0,
      conditionsRemoved: 0,
      repeatersResolved: 0,
      repeaterItemsCreated: 0,
    },
    oakDocReviewDraft: {
      schemaVersion: 1,
      previewFingerprint,
      savedAt: '2026-09-26T03:00:00.000Z',
      edited: true,
    },
  };
}

describe('OakDoc reviewed asset generation', () => {
  it('returns the exact reviewed GeneratedDocument asset instead of regenerating', async () => {
    const generatedDocument = {
      id: 'doc-1',
      revision: 5,
      metadata: oakDocMetadata(),
      serviceAgreement: null,
    };
    const item = {
      id: 'item-1',
      templateId: 'template-1',
      templateVersion: 3,
      previewFingerprint,
      template: {
        contentJson: {
          oakDoc: {
            schemaVersion: 1,
            storageKey: 'tenant-1/templates/oakdoc/master.docx',
            fileName: 'Master.docx',
            fileSize: 100,
            sha256: templateSha,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            fieldTags: [],
          },
        },
      },
      generatedDocument,
    } as any;
    const batch = {
      primaryCompanyId: 'company-1',
    } as any;

    const result = await materializeBatchDocumentByEngine({
      batch,
      item,
      configuration: {
        version: 1,
        title: 'Reviewed',
        contactIds: [],
        selectedDirectorId: null,
        selectedShareholderId: null,
        selectedContactId: null,
        itemValues: {},
        masterOverrides: {},
        useLetterhead: false,
        serviceAgreement: null,
      },
      evaluated: {
        content: '<p data-oakdoc-generated="true"></p>',
        fingerprint: previewFingerprint,
        blockingErrors: [],
        effectiveCustomData: {},
        resolvedTitle: 'Reviewed',
        templateVersion: 3,
        rendered: null,
        oakDocGeneration: null,
      },
      actor: 'Ava Tan',
      params: { tenantId: 'tenant-1', userId: 'user-1' },
    });

    expect(result).toBe(generatedDocument);
    expect(oakDocMock.materializeOakDocGeneratedDocument).not.toHaveBeenCalled();
  });
});
