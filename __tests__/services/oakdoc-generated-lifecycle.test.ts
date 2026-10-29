// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';

const prismaMock = vi.hoisted(() => ({
  generatedDocument: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  documentGenerationBatchItem: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const objects = vi.hoisted(() => new Map<string, Buffer>());
const storageMock = vi.hoisted(() => ({
  upload: vi.fn(async (key: string, body: Buffer) => { objects.set(key, Buffer.from(body)); }),
  download: vi.fn(async (key: string) => {
    const value = objects.get(key);
    if (!value) throw new Error('missing');
    return value;
  }),
  delete: vi.fn(async (key: string) => { objects.delete(key); }),
}));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  storage: storageMock,
}));

const auditMock = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('@/lib/audit', () => auditMock);

const revisionMock = vi.hoisted(() => ({
  claimGeneratedDocumentRevision: vi.fn(),
  readGeneratedDocumentRevision: vi.fn(),
}));
vi.mock('@/lib/document-editor/generated-document-revision', () => revisionMock);
vi.mock('@/services/company.service', () => ({ getCompanyById: vi.fn() }));
vi.mock('@/services/oakdoc-template.service', () => ({ downloadOakDocTemplate: vi.fn() }));

import {
  assertGeneratedOakDocReadyForFinalization,
  checkGeneratedOakDocFinalization,
  cloneOakDocGeneratedDocument,
  saveGeneratedOakDocDocument,
} from '@/services/oakdoc-generation.service';
import { ConflictError, ValidationError } from '@/lib/errors';

const tenantId = 'tenant-1';
const userId = 'user-1';
const documentId = 'document-1';
const actor = { tenantId, userId };
const prefix = `${tenantId}/generated-documents/${documentId}/oakdoc/`;

const CONTENT_TYPES = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

function field(tag: string, text: string): string {
  return `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/></w:sdtPr><w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt>`;
}

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${body}</w:p></w:body></w:document>`,
    ),
  });
}

function sha(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assetMetadata(storageKey: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    storageKey,
    fileName: 'Letter.docx',
    fileSize: bytes.byteLength,
    sha256: sha(bytes),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    templateId: 'template-1',
    templateVersion: 3,
    templateSha256: 'a'.repeat(64),
    generatedAt: '2026-09-26T00:00:00.000Z',
    fieldsUpdated: 1,
    unresolvedTags: [],
    conditionsResolved: 0,
    conditionsKept: 0,
    conditionsRemoved: 0,
    repeatersResolved: 0,
    repeaterItemsCreated: 0,
    ...extra,
  };
}

let stored: Record<string, unknown>;

function seedDocument(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  const key = `${prefix}original.docx`;
  objects.set(key, Buffer.from(bytes));
  stored = {
    id: documentId,
    tenantId,
    title: 'Letter',
    status: 'DRAFT',
    companyId: 'company-1',
    templateId: 'template-1',
    templateVersion: 3,
    sharePointRelativeFolderPathSnapshot: null,
    useLetterhead: false,
    placeholderData: { 'company.name': 'Acme Pte. Ltd.' },
    updatedAt: new Date('2026-09-26T01:00:00.000Z'),
    metadata: {
      documentEngine: 'OAKDOC',
      selectedParties: { directorId: 'director-1' },
      oakDocGenerated: assetMetadata(key, bytes),
      oakDocReviewDraft: { schemaVersion: 1 },
      taskIntegrationContext: { taskId: 'task-1', taskStageId: 'stage-1' },
    },
    ...overrides,
  };
  return key;
}

beforeEach(() => {
  vi.clearAllMocks();
  objects.clear();
  prismaMock.$transaction.mockImplementation((fn) => fn(prismaMock));
  prismaMock.generatedDocument.findFirst.mockImplementation(async () => stored);
  prismaMock.generatedDocument.update.mockImplementation(async ({ data }) => {
    stored = { ...stored, ...data, updatedAt: new Date('2026-09-26T02:00:00.000Z') };
    return stored;
  });
  prismaMock.generatedDocument.create.mockImplementation(async ({ data }) => ({ ...data }));
  prismaMock.documentGenerationBatchItem.findFirst.mockResolvedValue(null);
  revisionMock.claimGeneratedDocumentRevision.mockResolvedValue({ revision: 8 });
  revisionMock.readGeneratedDocumentRevision.mockResolvedValue(7);
  auditMock.createAuditLog.mockResolvedValue(undefined);
});

describe('native generated-document lifecycle (L1)', () => {
  it('acknowledges the submitted snapshot identity and asset hash', async () => {
    seedDocument(docx(field('company.name', 'Acme')));
    const edited = docx(field('company.name', 'Acme Holdings'));
    const snapshot = { sessionKey: 's-1', writerInstanceId: 'w-1', localRevision: 12, baseRevision: 7 };

    const receipt = await saveGeneratedOakDocDocument({
      documentId, expectedRevision: 7, bytes: edited, operationId: 'op-000001', snapshot,
    }, actor);

    expect(receipt).toMatchObject({
      ...snapshot,
      operationId: 'op-000001',
      revision: 8,
      assetSha256: sha(edited),
    });
  });

  it('keeps committed bytes readable when post-commit audit and cleanup fail', async () => {
    const originalKey = seedDocument(docx(field('company.name', 'Acme')));
    auditMock.createAuditLog.mockRejectedValue(new Error('audit down'));
    storageMock.delete.mockRejectedValueOnce(new Error('storage flaky'));
    const edited = docx(field('company.name', 'Edited'));

    const receipt = await saveGeneratedOakDocDocument({ documentId, expectedRevision: 7, bytes: edited }, actor);

    const committed = (stored.metadata as { oakDocGenerated: { storageKey: string; sha256: string } }).oakDocGenerated;
    expect(receipt.revision).toBe(8);
    expect(committed.storageKey).not.toBe(originalKey);
    expect(objects.get(committed.storageKey)).toBeDefined();
    expect(sha(objects.get(committed.storageKey)!)).toBe(committed.sha256);
  });

  it('removes only its own unreferenced upload when the revision claim fails', async () => {
    const originalKey = seedDocument(docx(field('company.name', 'Acme')));
    revisionMock.claimGeneratedDocumentRevision.mockRejectedValue(new ConflictError('stale'));

    await expect(saveGeneratedOakDocDocument({
      documentId, expectedRevision: 6, bytes: docx(field('company.name', 'Late')),
    }, actor)).rejects.toThrow(ConflictError);

    expect([...objects.keys()]).toEqual([originalKey]);
  });

  it('treats a retried operation as the same save instead of a new revision', async () => {
    seedDocument(docx(field('company.name', 'Acme')));
    const edited = docx(field('company.name', 'Retried'));
    await saveGeneratedOakDocDocument({ documentId, expectedRevision: 7, bytes: edited, operationId: 'op-retry-1' }, actor);
    revisionMock.readGeneratedDocumentRevision.mockResolvedValue(8);
    revisionMock.claimGeneratedDocumentRevision.mockClear();

    const retry = await saveGeneratedOakDocDocument({
      documentId, expectedRevision: 7, bytes: edited, operationId: 'op-retry-1',
    }, actor);

    expect(retry.revision).toBe(8);
    expect(revisionMock.claimGeneratedDocumentRevision).not.toHaveBeenCalled();
    await expect(saveGeneratedOakDocDocument({
      documentId, expectedRevision: 8, bytes: docx(field('company.name', 'Other')), operationId: 'op-retry-1',
    }, actor)).rejects.toThrow(ConflictError);
  });

  it('refuses standalone saves for a batch item still under review', async () => {
    seedDocument(docx(field('company.name', 'Acme')));
    prismaMock.documentGenerationBatchItem.findFirst.mockResolvedValue({ status: 'PREVIEWED' });

    await expect(saveGeneratedOakDocDocument({
      documentId, expectedRevision: 7, bytes: docx(field('company.name', 'Bypass')),
    }, actor)).rejects.toMatchObject({ statusCode: 409, details: { batchReview: true } });
  });

  it('rejects unsafe packages before touching storage', async () => {
    seedDocument(docx(field('company.name', 'Acme')));
    await expect(saveGeneratedOakDocDocument({
      documentId, expectedRevision: 7, bytes: strToU8('not a docx'),
    }, actor)).rejects.toThrow(ValidationError);
    expect(storageMock.upload).not.toHaveBeenCalled();
  });

  it('clones into an independently owned asset without lifecycle authority', async () => {
    const bytes = docx(field('company.name', 'Acme'));
    seedDocument(bytes);

    const clone = await cloneOakDocGeneratedDocument({ sourceId: documentId, title: 'Copy of Letter' }, actor);

    const metadata = clone.metadata as Record<string, any>;
    expect(clone.status).toBe('DRAFT');
    expect(clone.id).not.toBe(documentId);
    expect(metadata.oakDocGenerated.storageKey.startsWith(`${tenantId}/generated-documents/${clone.id}/oakdoc/`)).toBe(true);
    expect(objects.get(metadata.oakDocGenerated.storageKey)).toEqual(Buffer.from(bytes));
    expect(metadata.oakDocReviewDraft).toBeUndefined();
    expect(metadata.taskIntegrationContext).toBeUndefined();
    expect(metadata.selectedParties).toEqual({ directorId: 'director-1' });
    expect(metadata.oakDocCloneSource).toMatchObject({ documentId, revision: 7, sha256: sha(bytes) });
  });

  it('finalization validates the actual saved bytes, ignoring signature markers', async () => {
    seedDocument(docx(`${field('company.name', 'Acme')}${field('oakdoc.signature.v1.provider', ' ')}`));
    await expect(assertGeneratedOakDocReadyForFinalization(documentId, tenantId)).resolves.toBeUndefined();

    seedDocument(docx(`${field('company.name', 'Acme')}${field('director.name', '[Director]')}`));
    const check = await checkGeneratedOakDocFinalization(documentId, tenantId);
    expect(check).toMatchObject({ ready: false, unresolvedFields: ['director.name'] });
    await expect(assertGeneratedOakDocReadyForFinalization(documentId, tenantId))
      .rejects.toMatchObject({
        message: expect.stringContaining(': director.name'),
        details: { reason: 'OAKDOC_UNRESOLVED_CONTROLS' },
      });
  });

  it('finalization ignores the per-service wrappers a Service Agreement keeps', async () => {
    seedDocument(docx(`${field('company.name', 'Acme')}${field('agreement.service.item:item-1', 'Scope')}`));
    await expect(checkGeneratedOakDocFinalization(documentId, tenantId))
      .resolves.toMatchObject({ ready: true, unresolvedFields: [] });
  });
});
