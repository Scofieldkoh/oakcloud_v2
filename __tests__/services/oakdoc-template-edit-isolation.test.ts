// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';

const storageMock = vi.hoisted(() => ({
  upload: vi.fn(),
  delete: vi.fn(),
  download: vi.fn(),
}));

const templateServiceMock = vi.hoisted(() => ({
  createDocumentTemplate: vi.fn(),
  getDocumentTemplateById: vi.fn(),
  updateDocumentTemplate: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  storage: storageMock,
  StorageKeys: {
    oakDocTemplateAsset: (tenantId: string, assetId: string) =>
      `${tenantId}/templates/oakdoc/assets/${assetId}.docx`,
  },
}));
vi.mock('@/services/document-template.service', () => templateServiceMock);

import { updateOakDocTemplate } from '@/services/oakdoc-template.service';
import { readOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };
const duplicateId = '22222222-2222-4222-8222-222222222222';
const duplicateStorageKey = 'tenant-1/templates/oakdoc/assets/duplicate.docx';
const sourceStorageKey = 'tenant-1/templates/oakdoc/assets/source.docx';

function docxFixture(text: string): Buffer {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Override PartName="/word/document.xml" '
      + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>',
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    ),
  }));
}

function oakDocContentJson(storageKey: string) {
  return {
    oakDoc: {
      schemaVersion: 1,
      storageKey,
      fileName: 'copy.docx',
      fileSize: 100,
      sha256: 'b'.repeat(64),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fieldTags: ['company.name'],
    },
  };
}

describe('OakDoc template edit storage isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.upload.mockResolvedValue({
      key: 'unused',
      url: 'unused',
      size: 100,
    });
    storageMock.delete.mockResolvedValue(undefined);

    templateServiceMock.getDocumentTemplateById.mockResolvedValue({
      id: duplicateId,
      tenantId: actor.tenantId,
      name: 'OakDoc Copy',
      description: null,
      category: 'CONTRACT',
      compositionType: 'STANDARD',
      content: '<p data-oakdoc-template="true">DOCX-native template. Open this template in OakDoc.</p>',
      contentJson: oakDocContentJson(duplicateStorageKey),
      placeholders: [],
      isActive: true,
      version: 1,
      createdById: actor.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });
    templateServiceMock.updateDocumentTemplate.mockImplementation(async (data) => ({
      id: data.id,
      tenantId: actor.tenantId,
      name: data.name ?? 'OakDoc Copy',
      description: data.description ?? null,
      category: data.category ?? 'CONTRACT',
      compositionType: 'STANDARD',
      content: data.content,
      contentJson: data.contentJson,
      placeholders: [],
      isActive: data.isActive ?? true,
      version: 2,
      createdById: actor.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }));
  });

  it('editing the duplicate writes a fresh asset and updates only the duplicate record', async () => {
    const result = await updateOakDocTemplate({
      id: duplicateId,
      expectedRevision: 1,
      name: 'OakDoc Copy edited',
      fileName: 'copy.docx',
      buffer: docxFixture('edited copy'),
    }, actor);

    expect(storageMock.upload).toHaveBeenCalledOnce();
    const [newStorageKey] = storageMock.upload.mock.calls[0];
    expect(newStorageKey).toMatch(/^tenant-1\/templates\/oakdoc\/assets\/.+\.docx$/);
    expect(newStorageKey).not.toBe(duplicateStorageKey);
    expect(newStorageKey).not.toBe(sourceStorageKey);

    expect(templateServiceMock.updateDocumentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: duplicateId,
        expectedRevision: 1,
      }),
      actor,
      'Saved from OakDoc',
      { writer: 'oakdoc-service' },
    );

    const metadata = readOakDocTemplateMetadata(result.contentJson);
    expect(metadata?.storageKey).toBe(newStorageKey);
    // The fixture has no content controls; the manifest comes from the bytes.
    expect(metadata?.fieldTags).toEqual([]);
    expect(storageMock.delete).not.toHaveBeenCalledWith(duplicateStorageKey);
    expect(storageMock.delete).not.toHaveBeenCalledWith(sourceStorageKey);
  });
});
