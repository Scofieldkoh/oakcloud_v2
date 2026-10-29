// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCorpSecAppointmentOakDocMaster } from '@/lib/document-editor/oakdoc-standard-template-migrations';
import { deriveOakDocTemplateFieldTags } from '@/lib/document-editor/oakdoc-field-manifest';
import { OAKDOC_MIME_TYPE } from '@/lib/document-editor/oakdoc-template';
import { ensureA4ServerDomGlobals } from '@/lib/document-editor/a4-server-dom';

const prismaMock = vi.hoisted(() => ({
  documentTemplate: { findFirst: vi.fn() },
  templatePartial: { findMany: vi.fn(async () => []) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const storageMock = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  storage: storageMock,
}));

const companyMock = vi.hoisted(() => ({ getCompanyById: vi.fn() }));
vi.mock('@/services/company.service', () => companyMock);

const templateMock = vi.hoisted(() => ({ downloadOakDocTemplate: vi.fn() }));
vi.mock('@/services/oakdoc-template.service', () => templateMock);

const { generateOakDocBytes, previewOakDocMaster } = await import('@/services/oakdoc-generation.service');

ensureA4ServerDomGlobals();
const master = buildCorpSecAppointmentOakDocMaster();
const masterSha = createHash('sha256').update(master).digest('hex');
const asset = {
  schemaVersion: 1,
  storageKey: 'tenant-1/templates/oakdoc/assets/master.docx',
  fileName: 'Appointment.docx',
  fileSize: master.byteLength,
  sha256: masterSha,
  mimeType: OAKDOC_MIME_TYPE,
  fieldTags: deriveOakDocTemplateFieldTags(master),
};
const stored = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Appointment',
  version: 4,
  contentJson: { oakDoc: asset },
  compositionType: 'STANDARD',
};
const context = { companyId: 'company-1', generatedBy: 'Test User' };

describe('OakDoc template preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.documentTemplate.findFirst.mockResolvedValue(stored);
    prismaMock.templatePartial.findMany.mockResolvedValue([]);
    companyMock.getCompanyById.mockResolvedValue({
      id: 'company-1',
      name: 'Acme Pte. Ltd.',
      uen: '202600001A',
      addresses: [],
      officers: [],
      shareholders: [],
    });
    templateMock.downloadOakDocTemplate.mockResolvedValue({ buffer: Buffer.from(master), metadata: asset });
  });

  it('renders the same document as generation from the same master and context', async () => {
    const generated = await generateOakDocBytes({ templateId: stored.id, ...context }, { tenantId: 'tenant-1' });
    const preview = await previewOakDocMaster({
      ...context,
      templateId: stored.id,
      bytes: new Uint8Array(master),
      fileName: 'Appointment.docx',
    }, { tenantId: 'tenant-1' });

    expect(Buffer.compare(preview.bytes, generated.bytes)).toBe(0);
    expect(preview.diagnostics).toEqual(generated.diagnostics);
    expect(preview.metadata.unresolvedTags).toEqual(generated.metadata.unresolvedTags);
  });

  it('previews an unsaved master without writing anything', async () => {
    const bytes = new Uint8Array(master);
    const preview = await previewOakDocMaster({ ...context, bytes, fileName: 'New.docx' }, { tenantId: 'tenant-1' });

    expect(preview.metadata.fieldsUpdated).toBeGreaterThan(0);
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(master))).toBe(0);
    expect(storageMock.upload).not.toHaveBeenCalled();
    expect(storageMock.delete).not.toHaveBeenCalled();
    expect(prismaMock.documentTemplate.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a template from another workspace', async () => {
    prismaMock.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(previewOakDocMaster({
      ...context,
      templateId: stored.id,
      bytes: new Uint8Array(master),
      fileName: 'Appointment.docx',
    }, { tenantId: 'tenant-2' })).rejects.toMatchObject({ statusCode: 404 });
  });
});
