import { StorageKeys, storage } from '@/lib/storage';
import { mergePdfBuffers, ensureEsigningEnvelopeArtifacts } from '@/services/esigning-pdf.service';
import { SharePointServiceError } from '@/services/sharepoint.service';

const MAX_SHAREPOINT_SOURCE_BYTES = 250 * 1024 * 1024;

export async function downloadSharePointFilingSource(input: {
  tenantId: string;
  envelopeId: string;
  envelopeDocumentId: string;
  signedStoragePath: string | null;
}): Promise<Buffer> {
  await ensureEsigningEnvelopeArtifacts({
    envelopeId: input.envelopeId,
    requireCertificates: true,
  });

  const signedStoragePath =
    input.signedStoragePath ??
    StorageKeys.esigningSignedDocument(input.tenantId, input.envelopeId, input.envelopeDocumentId);
  const certificateStoragePath = StorageKeys.esigningEnvelopeCertificate(
    input.tenantId,
    input.envelopeId,
  );

  const [signedExists, certificateExists] = await Promise.all([
    storage.exists(signedStoragePath),
    storage.exists(certificateStoragePath),
  ]);

  if (!signedExists || !certificateExists) {
    throw new SharePointServiceError({
      code: 'SOURCE_NOT_READY',
      category: 'TRANSIENT',
      retryable: true,
      message: 'Signed document and certificate are not available',
    });
  }

  const [signedBuffer, certificateBuffer] = await Promise.all([
    storage.download(signedStoragePath),
    storage.download(certificateStoragePath),
  ]);

  try {
    const content = await mergePdfBuffers([signedBuffer, certificateBuffer]);
    if (content.length === 0 || content.length > MAX_SHAREPOINT_SOURCE_BYTES) {
      throw new Error('Combined source PDF exceeds the SharePoint filing size limit');
    }
    return content;
  } catch {
    throw new SharePointServiceError({
      code: 'SOURCE_INVALID',
      category: 'VALIDATION',
      statusCode: 400,
      message: 'Signed document and certificate are not valid PDFs',
      retryable: false,
    });
  }
}
