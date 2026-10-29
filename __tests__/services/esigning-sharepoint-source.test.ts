import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureArtifacts: vi.fn(),
  mergePdfBuffers: vi.fn(),
  storage: {
    exists: vi.fn(),
    download: vi.fn(),
  },
  storageKeys: {
    esigningSignedDocument: vi.fn(),
    esigningEnvelopeCertificate: vi.fn(),
  },
}));

vi.mock('@/lib/storage', () => ({ storage: mocks.storage, StorageKeys: mocks.storageKeys }));
vi.mock('@/services/esigning-pdf.service', () => ({
  ensureEsigningEnvelopeArtifacts: mocks.ensureArtifacts,
  mergePdfBuffers: mocks.mergePdfBuffers,
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

describe('downloadSharePointFilingSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges the signed document and certificate in filing order', async () => {
    const signedBuffer = Buffer.from('signed');
    const certificateBuffer = Buffer.from('certificate');
    const combinedBuffer = Buffer.from('%PDF-combined');
    mocks.ensureArtifacts.mockResolvedValue(undefined);
    mocks.storageKeys.esigningSignedDocument.mockReturnValue('signed-path');
    mocks.storageKeys.esigningEnvelopeCertificate.mockReturnValue('certificate-path');
    mocks.storage.exists.mockResolvedValue(true);
    mocks.storage.download
      .mockResolvedValueOnce(signedBuffer)
      .mockResolvedValueOnce(certificateBuffer);
    mocks.mergePdfBuffers.mockResolvedValue(combinedBuffer);

    await expect(downloadSharePointFilingSource({
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      envelopeDocumentId: 'document-1',
      signedStoragePath: null,
    })).resolves.toBe(combinedBuffer);

    expect(mocks.ensureArtifacts).toHaveBeenCalledWith({ envelopeId: 'envelope-1', requireCertificates: true });
    expect(mocks.storageKeys.esigningEnvelopeCertificate).toHaveBeenCalledWith('tenant-1', 'envelope-1');
    expect(mocks.storage.download).toHaveBeenNthCalledWith(1, 'signed-path');
    expect(mocks.storage.download).toHaveBeenNthCalledWith(2, 'certificate-path');
    expect(mocks.mergePdfBuffers).toHaveBeenCalledWith([signedBuffer, certificateBuffer]);
  });

  it('uses a persisted signed path when one is present', async () => {
    mocks.ensureArtifacts.mockResolvedValue(undefined);
    mocks.storage.exists.mockResolvedValue(true);
    mocks.storage.download
      .mockResolvedValueOnce(Buffer.from('signed'))
      .mockResolvedValueOnce(Buffer.from('certificate'));
    mocks.mergePdfBuffers.mockResolvedValue(Buffer.from('%PDF-combined'));
    mocks.storageKeys.esigningEnvelopeCertificate.mockReturnValue('certificate-path');

    await downloadSharePointFilingSource({
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      envelopeDocumentId: 'document-1',
      signedStoragePath: 'persisted-signed-path',
    });

    expect(mocks.storage.download).toHaveBeenNthCalledWith(1, 'persisted-signed-path');
  });
});
