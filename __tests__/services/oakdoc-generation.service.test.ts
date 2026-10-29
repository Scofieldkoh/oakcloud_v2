// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

const prismaMock = vi.hoisted(() => ({
  documentTemplate: { findFirst: vi.fn() },
  generatedDocument: { findFirst: vi.fn(), update: vi.fn() },
  documentGenerationBatchItem: { findFirst: vi.fn() },
  company: { findFirst: vi.fn() },
  contact: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const storageMock = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  storage: storageMock,
}));

vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));

const serverDomMock = vi.hoisted(() => ({ ensureA4ServerDomGlobals: vi.fn() }));
vi.mock('@/lib/document-editor/a4-server-dom', () => serverDomMock);

const companyMock = vi.hoisted(() => ({ getCompanyById: vi.fn() }));
vi.mock('@/services/company.service', () => companyMock);

const templateMock = vi.hoisted(() => ({ downloadOakDocTemplate: vi.fn() }));
vi.mock('@/services/oakdoc-template.service', () => templateMock);

const revisionMock = vi.hoisted(() => ({
  claimGeneratedDocumentRevision: vi.fn(),
  readGeneratedDocumentRevision: vi.fn(),
}));
vi.mock('@/lib/document-editor/generated-document-revision', () => revisionMock);

const fieldMock = vi.hoisted(() => ({
  inspectOakDocFields: vi.fn(),
  pruneDeletedOakDocFields: vi.fn(),
  resolveOakDocFields: vi.fn(),
}));
vi.mock('@/lib/document-editor/oakdoc-fields', () => fieldMock);

const conditionMock = vi.hoisted(() => ({
  OAKDOC_CONDITION_TAG_PREFIX: 'oakdoc.condition.',
  inspectOakDocConditions: vi.fn(),
  resolveOakDocConditions: vi.fn(),
  readOakDocConditionDefinitions: vi.fn(() => new Map()),
}));
vi.mock('@/lib/document-editor/oakdoc-conditions', () => conditionMock);

const repeaterMock = vi.hoisted(() => ({
  isOakDocRepeaterOuterTag: () => false,
  inspectOakDocRepeaters: vi.fn(),
  resolveOakDocRepeaters: vi.fn(),
}));
vi.mock('@/lib/document-editor/oakdoc-repeaters', () => repeaterMock);

import {
  generateOakDocBytes,
  materializeOakDocGeneratedDocument,
  saveGeneratedOakDocDocument,
} from '@/services/oakdoc-generation.service';

const tenantId = 'tenant-1';
const userId = 'user-1';
const templateId = 'template-1';
const documentId = 'document-1';
const templateSha = 'a'.repeat(64);
const generatedSha = expect.stringMatching(/^[a-f0-9]{64}$/);

const templateMetadata = {
  oakDoc: {
    schemaVersion: 1,
    storageKey: `${tenantId}/templates/oakdoc/assets/master.docx`,
    fileName: 'Master.docx',
    fileSize: 6,
    sha256: templateSha,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fieldTags: ['company.name'],
  },
};

describe('OakDoc generation service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((fn) => fn(prismaMock));
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      id: templateId,
      name: 'Board Resolution',
      version: 7,
      contentJson: templateMetadata,
    });
    companyMock.getCompanyById.mockResolvedValue({
      id: 'company-1',
      name: 'Acme Pte. Ltd.',
      uen: '202600001A',
      addresses: [],
      officers: [],
      shareholders: [],
    });
    templateMock.downloadOakDocTemplate.mockResolvedValue({
      buffer: Buffer.from('master'),
      metadata: templateMetadata.oakDoc,
    });
    fieldMock.inspectOakDocFields.mockReturnValue({
      count: 1,
      tags: ['company.name'],
    });
    conditionMock.inspectOakDocConditions.mockReturnValue({
      count: 0,
      fieldTags: [],
    });
    repeaterMock.inspectOakDocRepeaters.mockReturnValue({
      count: 0,
      tags: [],
    });
    fieldMock.pruneDeletedOakDocFields.mockImplementation((bytes) => ({
      bytes: new Uint8Array(bytes),
      removed: 0,
    }));
    conditionMock.resolveOakDocConditions.mockImplementation(({ docxBytes }) => ({
      bytes: new Uint8Array(docxBytes),
      resolved: 0,
      kept: 0,
      removed: 0,
      unresolvedFields: [],
    }));
    repeaterMock.resolveOakDocRepeaters.mockImplementation(({ docxBytes }) => ({
      bytes: new Uint8Array(docxBytes),
      repeatersResolved: 0,
      itemsCreated: 0,
      fieldsResolved: 0,
    }));
    fieldMock.resolveOakDocFields.mockReturnValue({
      bytes: new Uint8Array(Buffer.from('generated')),
      updated: 1,
      unresolvedTags: [],
    });
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: documentId,
      tenantId,
      status: 'DRAFT',
      metadata: {},
    });
    prismaMock.documentGenerationBatchItem.findFirst.mockResolvedValue({ id: 'item-1' });
    revisionMock.claimGeneratedDocumentRevision.mockResolvedValue({ revision: 4 });
    prismaMock.generatedDocument.update.mockResolvedValue({
      id: documentId,
      title: 'Generated Resolution',
      status: 'DRAFT',
      updatedAt: new Date('2026-09-26T05:00:00.000Z'),
    });
    storageMock.upload.mockResolvedValue({ key: 'generated-key' });
    storageMock.delete.mockResolvedValue(undefined);
  });

  it('resolves a copied master without mutating the downloaded template bytes', async () => {
    const master = Buffer.from('master');
    templateMock.downloadOakDocTemplate.mockResolvedValue({
      buffer: master,
      metadata: templateMetadata.oakDoc,
    });

    const result = await generateOakDocBytes({
      templateId,
      companyId: 'company-1',
      generatedBy: 'Ava Tan',
    }, { tenantId });

    expect(serverDomMock.ensureA4ServerDomGlobals).toHaveBeenCalledOnce();
    expect(master.toString()).toBe('master');
    expect(result.bytes.toString()).toBe('generated');
    expect(result.template).toMatchObject({
      id: templateId,
      version: 7,
      sha256: templateSha,
    });
    expect(result.values['company.name']).toBe('Acme Pte. Ltd.');
  });

  it('fills custom fields from Configure and lists any picked contacts', async () => {
    prismaMock.documentTemplate.findFirst.mockResolvedValue({
      id: templateId,
      name: 'Engagement Letter',
      version: 7,
      contentJson: templateMetadata,
      placeholders: [
        { key: 'custom.fee', label: 'Fee', type: 'currency', source: 'custom' },
        { key: 'custom.meeting_date', label: 'Meeting date', type: 'date', source: 'custom' },
      ],
    });
    fieldMock.inspectOakDocFields.mockReturnValue({
      count: 4,
      tags: ['custom.fee', 'custom.meeting_date', 'selectedContact.name', 'custom.unknown'],
    });
    prismaMock.company.findFirst.mockResolvedValue({
      id: 'company-1', officers: [], shareholders: [], contacts: [],
    });
    prismaMock.contact.findMany.mockImplementation(async ({ where }) => (where.id.in as string[]).map((id) => ({
      id,
      fullName: id === 'contact-9' ? 'Outside Adviser' : 'Listed Person',
      contactType: 'INDIVIDUAL',
      fullAddress: '1 Example Road, Singapore 123456',
      identificationNumber: 'S1234567A',
      nationality: 'Singaporean',
      contactDetails: [{ detailType: 'EMAIL', value: `${id}@example.com`, companyId: null, isPrimary: true, displayOrder: 0, createdAt: new Date() }],
      companyRelations: [],
      officerPositions: [],
    })));

    const result = await generateOakDocBytes({
      templateId,
      companyId: 'company-1',
      selectedContactId: 'contact-9',
      contactIds: ['contact-2'],
      selectedOfficerIds: ['officer-9'],
      customData: { fee: '1500', meeting_date: '2026-11-03' },
    }, { tenantId });

    expect(result.values).toMatchObject({
      'custom.fee': '1,500.00',
      'custom.meeting_date': '3 Nov 2026',
      'selectedContact.name': 'Outside Adviser',
    });
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'OAKDOC_CUSTOM_FIELD_UNDEFINED',
      severity: 'warning',
      controlTag: 'custom.unknown',
    })]);
    expect(fieldMock.resolveOakDocFields).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { dates: expect.objectContaining({ 'custom.meeting_date': '2026-11-03' }) },
    );
    expect(repeaterMock.resolveOakDocRepeaters).toHaveBeenCalledWith(expect.objectContaining({
      selectedOfficerIds: ['officer-9'],
      contacts: [expect.objectContaining({
        id: 'contact-2',
        name: 'Listed Person',
        email: 'contact-2@example.com',
        identificationNumber: 'S1234567A',
      })],
    }));
  });

  it('leaves custom fields as placeholders when no values are supplied', async () => {
    fieldMock.inspectOakDocFields.mockReturnValue({ count: 1, tags: ['custom.fee'] });
    const result = await generateOakDocBytes({ templateId, companyId: 'company-1' }, { tenantId });
    expect(result.values).not.toHaveProperty('custom.fee');
    expect(result.diagnostics).toEqual([]);
  });

  it('saves edits to the generated DOCX without mutating the template asset', async () => {
    const originalKey = `${tenantId}/generated-documents/${documentId}/oakdoc/original.docx`;
    prismaMock.generatedDocument.findFirst.mockResolvedValue({
      id: documentId,
      tenantId,
      title: 'Generated Resolution',
      companyId: 'company-1',
      status: 'DRAFT',
      metadata: {
        documentEngine: 'OAKDOC',
        selectedParties: { directorId: 'director-1' },
        oakDocGenerated: {
          schemaVersion: 1,
          storageKey: originalKey,
          fileName: 'Generated Resolution.docx',
          fileSize: 123,
          sha256: 'b'.repeat(64),
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          templateId,
          templateVersion: 7,
          templateSha256: templateSha,
          generatedAt: '2026-09-26T04:00:00.000Z',
          fieldsUpdated: 1,
          unresolvedTags: [],
          conditionsResolved: 0,
          conditionsKept: 0,
          conditionsRemoved: 0,
          repeatersResolved: 0,
          repeaterItemsCreated: 0,
        },
      },
    });
    revisionMock.claimGeneratedDocumentRevision.mockResolvedValue({ revision: 5 });
    prismaMock.documentGenerationBatchItem.findFirst.mockResolvedValue(null);

    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      'word/document.xml': strToU8('<w:document xmlns:w="urn:test"><w:body/></w:document>'),
    });

    const result = await saveGeneratedOakDocDocument({
      documentId,
      expectedRevision: 4,
      bytes,
    }, { tenantId, userId });

    expect(result.revision).toBe(5);
    expect(storageMock.upload).toHaveBeenCalledOnce();
    const [newKey, uploadedBytes] = storageMock.upload.mock.calls[0];
    expect(newKey).toMatch(
      new RegExp(`^${tenantId}/generated-documents/${documentId}/oakdoc/.+\\.docx$`),
    );
    expect(newKey).not.toBe(originalKey);
    expect(Buffer.from(uploadedBytes)).toEqual(Buffer.from(bytes));
    expect(revisionMock.claimGeneratedDocumentRevision).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        id: documentId,
        tenantId,
        expectedRevision: 4,
        allowedStatuses: ['DRAFT'],
      }),
    );
    expect(prismaMock.generatedDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: documentId },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            documentEngine: 'OAKDOC',
            selectedParties: { directorId: 'director-1' },
            oakDocGenerated: expect.objectContaining({
              storageKey: newKey,
              templateId,
              templateVersion: 7,
              templateSha256: templateSha,
            }),
          }),
        }),
      }),
    );
    expect(storageMock.delete).toHaveBeenCalledWith(originalKey);
  });

  it('stores generated DOCX separately and persists template/version metadata', async () => {
    await materializeOakDocGeneratedDocument({
      templateId,
      generatedDocumentId: documentId,
      expectedRevision: 3,
      expectedBatchItemId: 'item-1',
      companyId: 'company-1',
      title: 'Generated Resolution',
      generatedBy: 'Ava Tan',
    }, { tenantId, userId });

    expect(storageMock.upload).toHaveBeenCalledTimes(1);
    const [storageKey, uploadedBytes] = storageMock.upload.mock.calls[0];
    expect(storageKey).toMatch(
      new RegExp(`^${tenantId}/generated-documents/${documentId}/oakdoc/.+\\.docx$`),
    );
    expect(storageKey).not.toContain('/templates/oakdoc/');
    expect(Buffer.from(uploadedBytes).toString()).toBe('generated');

    expect(prismaMock.generatedDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: documentId },
        data: expect.objectContaining({
          templateVersion: 7,
          status: 'DRAFT',
          metadata: expect.objectContaining({
            documentEngine: 'OAKDOC',
            oakDocGenerated: expect.objectContaining({
              templateId,
              templateVersion: 7,
              templateSha256: templateSha,
              sha256: generatedSha,
              storageKey,
            }),
          }),
        }),
      }),
    );
    expect(revisionMock.claimGeneratedDocumentRevision).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        id: documentId,
        tenantId,
        expectedRevision: 3,
        allowedStatuses: ['DRAFT'],
      }),
    );
  });
});
