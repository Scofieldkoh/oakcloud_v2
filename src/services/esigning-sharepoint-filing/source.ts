import { storage } from '@/lib/storage';
import { ensureEsigningEnvelopeArtifacts } from '@/services/esigning-pdf.service';
import {
  EsigningArtifactError,
  getCurrentIssuedVersion,
  readIssuedArtifact,
} from '@/services/esigning-issued-artifacts';
import { SharePointServiceError } from '@/services/sharepoint.service';

const MAX_SHAREPOINT_SOURCE_BYTES = 250 * 1024 * 1024;

/**
 * The SharePoint filing source is the stored document+certificate artifact of the envelope's current
 * version, byte for byte: the same file that is emailed, so the hash recorded for the filing is the
 * hash the public check recognises. It is never re-merged here.
 *
 * Everything is scoped to `tenantId`: an envelope or document of another tenant is rejected before
 * any generation or storage access.
 */
export async function downloadSharePointFilingSource(input: {
  tenantId: string;
  envelopeId: string;
  envelopeDocumentId: string;
  /** Kept for the callers; the issued-artifact table is the source of truth for the path. */
  signedStoragePath?: string | null;
}): Promise<Buffer> {
  try {
    await ensureEsigningEnvelopeArtifacts({
      tenantId: input.tenantId,
      envelopeId: input.envelopeId,
      requireCertificates: true,
    });
  } catch (error) {
    if (error instanceof EsigningArtifactError && error.code === 'ENVELOPE_NOT_FOUND') {
      throw new SharePointServiceError({
        code: 'SOURCE_INVALID',
        category: 'VALIDATION',
        statusCode: 400,
        message: 'Envelope not found for this workspace',
        retryable: false,
      });
    }
    throw error;
  }

  const issued = await getCurrentIssuedVersion(input.tenantId, input.envelopeId);
  const artifact = issued?.withCertificateByDocumentId.get(input.envelopeDocumentId);
  if (!artifact || !(await storage.exists(artifact.storagePath))) {
    throw new SharePointServiceError({
      code: 'SOURCE_NOT_READY',
      category: 'TRANSIENT',
      retryable: true,
      message: 'Signed document and certificate are not available',
    });
  }

  let content: Buffer;
  try {
    content = await readIssuedArtifact(artifact);
  } catch (error) {
    if (error instanceof EsigningArtifactError && error.code === 'ARTIFACT_HASH_MISMATCH') {
      throw new SharePointServiceError({
        code: 'SOURCE_INVALID',
        category: 'VALIDATION',
        statusCode: 400,
        message: 'Stored signed document no longer matches the hash recorded when it was issued',
        retryable: false,
      });
    }
    throw error;
  }

  if (content.length === 0 || content.length > MAX_SHAREPOINT_SOURCE_BYTES) {
    throw new SharePointServiceError({
      code: 'SOURCE_INVALID',
      category: 'VALIDATION',
      statusCode: 400,
      message: 'Signed document and certificate are not valid PDFs',
      retryable: false,
    });
  }
  return content;
}
