import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  documentTemplate: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findFirstOrThrow: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  copy: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/storage', () => ({
  storage: storageMock,
  StorageKeys: {
    oakDocTemplateAsset: (tenantId: string, assetId: string) =>
      `${tenantId}/templates/oakdoc/assets/${assetId}.docx`,
  },
}));
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(() => null),
}));

import {
  deleteDocumentTemplate,
  duplicateDocumentTemplate,
} from '@/services/document-template.service';
import { readOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };
const sourceStorageKey = 'tenant-1/templates/oakdoc/assets/source.docx';

function oakDocContentJson(storageKey = sourceStorageKey) {
  return {
    oakDoc: {
      schemaVersion: 1,
      storageKey,
      fileName: 'source.docx',
      fileSize: 1234,
      sha256: 'a'.repeat(64),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fieldTags: ['company.name', 'director.name'],
    },
    otherMetadata: { preserved: true },
  };
}

function sourceTemplate() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: actor.tenantId,
    name: 'OakDoc Source',
    description: 'Source description',
    category: 'CONTRACT',
    compositionType: 'STANDARD',
    content: '<p data-oakdoc-template="true">DOCX-native template. Open this template in OakDoc.</p>',
    contentJson: oakDocContentJson(),
    placeholders: [],
    sharePointRelativeFolderPath: null,
    isActive: true,
    version: 7,
    createdById: actor.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

describe('OakDoc-native template duplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.copy.mockResolvedValue(undefined);
    storageMock.delete.mockResolvedValue(undefined);
  });

  it('copies the DOCX asset to an independent storage key and preserves OakDoc field metadata', async () => {
    const source = sourceTemplate();
    prismaMock.documentTemplate.findFirst
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(null);
    prismaMock.documentTemplate.create.mockImplementation(async ({ data }) => ({
      ...source,
      ...data,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const duplicate = await duplicateDocumentTemplate(
      { id: source.id, name: 'OakDoc Copy' },
      actor,
    );

    expect(storageMock.copy).toHaveBeenCalledOnce();
    const [copiedFrom, copiedTo] = storageMock.copy.mock.calls[0];
    expect(copiedFrom).toBe(sourceStorageKey);
    expect(copiedTo).toMatch(/^tenant-1\/templates\/oakdoc\/assets\/.+\.docx$/);
    expect(copiedTo).not.toBe(sourceStorageKey);

    const duplicateMetadata = readOakDocTemplateMetadata(duplicate.contentJson);
    expect(duplicateMetadata).not.toBeNull();
    expect(duplicateMetadata?.storageKey).toBe(copiedTo);
    expect(duplicateMetadata?.fieldTags).toEqual(['company.name', 'director.name']);
    expect((duplicate.contentJson as Record<string, unknown>).otherMetadata).toEqual({
      preserved: true,
    });
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.version).toBe(1);
  });

  it('removes the copied asset if the duplicate database record cannot be created', async () => {
    const source = sourceTemplate();
    prismaMock.documentTemplate.findFirst
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(null);
    prismaMock.documentTemplate.create.mockRejectedValue(new Error('database failed'));

    await expect(
      duplicateDocumentTemplate({ id: source.id, name: 'OakDoc Copy' }, actor),
    ).rejects.toThrow('database failed');

    const copiedTo = storageMock.copy.mock.calls[0]?.[1];
    expect(copiedTo).toBeTruthy();
    expect(storageMock.delete).toHaveBeenCalledWith(copiedTo);
    expect(storageMock.delete).not.toHaveBeenCalledWith(sourceStorageKey);
  });

  it('soft-deleting one duplicate does not delete either DOCX asset', async () => {
    const duplicateStorageKey = 'tenant-1/templates/oakdoc/assets/duplicate.docx';
    const duplicate = {
      ...sourceTemplate(),
      id: '22222222-2222-4222-8222-222222222222',
      name: 'OakDoc Copy',
      contentJson: oakDocContentJson(duplicateStorageKey),
      _count: { generatedDocuments: 0 },
    };
    prismaMock.documentTemplate.findFirst.mockResolvedValueOnce(duplicate);
    prismaMock.$transaction.mockImplementation(async (callback) => callback({
      documentTemplate: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({
          ...duplicate,
          deletedAt: new Date(),
          isActive: false,
          version: duplicate.version + 1,
        }),
      },
    }));

    await deleteDocumentTemplate(
      duplicate.id,
      actor,
      'No longer required',
      duplicate.version,
    );

    expect(storageMock.delete).not.toHaveBeenCalledWith(duplicateStorageKey);
    expect(storageMock.delete).not.toHaveBeenCalledWith(sourceStorageKey);
  });
});
