import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureArtifacts: vi.fn(),
  getCurrentIssuedVersion: vi.fn(),
  readIssuedArtifact: vi.fn(),
  exists: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({ storage: { exists: mocks.exists } }));
vi.mock('@/services/esigning-pdf.service', () => ({
  ensureEsigningEnvelopeArtifacts: mocks.ensureArtifacts,
}));
vi.mock('@/services/esigning-issued-artifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/esigning-issued-artifacts')>()),
  getCurrentIssuedVersion: mocks.getCurrentIssuedVersion,
  readIssuedArtifact: mocks.readIssuedArtifact,
}));
vi.mock('@/services/sharepoint.service', () => ({
  SharePointServiceError: class SharePointServiceError extends Error {
    code: string;
    category: string;
    retryable: boolean;

    constructor(input: { code: string; category: string; retryable?: boolean; message: string }) {
      super(input.message);
      this.code = input.code;
      this.category = input.category;
      this.retryable = input.retryable ?? false;
    }
  },
}));

const { downloadSharePointFilingSource } = await import('@/services/esigning-sharepoint-filing/source');
const { EsigningArtifactError } = await import('@/services/esigning-issued-artifacts');

const input = {
  tenantId: 'tenant-1',
  envelopeId: 'envelope-1',
  envelopeDocumentId: 'document-1',
  signedStoragePath: null,
};

function currentVersion(withCertificate: Record<string, unknown>) {
  return {
    version: 2,
    certificate: null,
    signedByDocumentId: new Map(),
    withCertificateByDocumentId: new Map(Object.entries(withCertificate)),
    packageDocuments: null,
    packageWithCertificate: null,
  };
}

describe('downloadSharePointFilingSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureArtifacts.mockResolvedValue(undefined);
    mocks.exists.mockResolvedValue(true);
  });

  it('files the stored document+certificate artifact as is, without merging', async () => {
    const stored = Buffer.from('%PDF-stored');
    const artifact = { id: 'artifact-1', storagePath: 'tenant-1/esigning/envelope-1/v2/with-certificate/document-1.pdf' };
    mocks.getCurrentIssuedVersion.mockResolvedValue(currentVersion({ 'document-1': artifact }));
    mocks.readIssuedArtifact.mockResolvedValue(stored);

    await expect(downloadSharePointFilingSource(input)).resolves.toBe(stored);

    expect(mocks.ensureArtifacts).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      requireCertificates: true,
    });
    expect(mocks.getCurrentIssuedVersion).toHaveBeenCalledWith('tenant-1', 'envelope-1');
    expect(mocks.exists).toHaveBeenCalledWith(artifact.storagePath);
    expect(mocks.readIssuedArtifact).toHaveBeenCalledWith(artifact);
  });

  it('rejects an envelope of another workspace permanently, before reading anything', async () => {
    mocks.ensureArtifacts.mockRejectedValue(new EsigningArtifactError('ENVELOPE_NOT_FOUND', 'Envelope not found'));

    await expect(downloadSharePointFilingSource({ ...input, tenantId: 'tenant-2' })).rejects.toMatchObject({
      code: 'SOURCE_INVALID',
      retryable: false,
    });

    expect(mocks.ensureArtifacts).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-2' }));
    expect(mocks.getCurrentIssuedVersion).not.toHaveBeenCalled();
    expect(mocks.readIssuedArtifact).not.toHaveBeenCalled();
    expect(mocks.exists).not.toHaveBeenCalled();
  });

  it('is retryable when the document has no stored artifact yet', async () => {
    mocks.getCurrentIssuedVersion.mockResolvedValue(currentVersion({}));

    await expect(downloadSharePointFilingSource(input)).rejects.toMatchObject({
      code: 'SOURCE_NOT_READY',
      retryable: true,
    });
  });

  it('is retryable when the stored file is missing from storage', async () => {
    mocks.getCurrentIssuedVersion.mockResolvedValue(currentVersion({ 'document-1': { id: 'a', storagePath: 'gone' } }));
    mocks.exists.mockResolvedValue(false);

    await expect(downloadSharePointFilingSource(input)).rejects.toMatchObject({ code: 'SOURCE_NOT_READY' });
  });

  it('fails permanently when the stored file no longer matches its recorded hash', async () => {
    mocks.getCurrentIssuedVersion.mockResolvedValue(currentVersion({ 'document-1': { id: 'a', storagePath: 'p' } }));
    mocks.readIssuedArtifact.mockRejectedValue(new EsigningArtifactError('ARTIFACT_HASH_MISMATCH', 'changed'));

    await expect(downloadSharePointFilingSource(input)).rejects.toMatchObject({
      code: 'SOURCE_INVALID',
      retryable: false,
    });
  });
});
