/**
 * Storage Configuration
 *
 * Reads storage configuration from environment variables
 * and provides a centralized config object.
 */

import type { StorageConfig, StorageProvider, S3EncryptionType } from './types';

/**
 * Get storage configuration from environment variables
 */
export function getStorageConfig(): StorageConfig {
  const provider = (process.env.STORAGE_PROVIDER || 'local') as StorageProvider;

  // Parse encryption type (default to AES256 for SSE-S3)
  const encryptionEnv = process.env.S3_ENCRYPTION?.trim();
  let s3Encryption: S3EncryptionType = 'AES256'; // Default: SSE-S3

  if (encryptionEnv) {
    const lowerEnc = encryptionEnv.toLowerCase();
    if (lowerEnc === 'none' || lowerEnc === 'disabled') {
      s3Encryption = 'none';
    } else if (lowerEnc === 'kms' || lowerEnc === 'aws:kms') {
      s3Encryption = 'aws:kms';
    } else if (lowerEnc === 'aes256' || lowerEnc === 'sse-s3') {
      s3Encryption = 'AES256';
    }
  }

  const s3Endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';

  // Auto-detect MinIO from endpoint or explicit S3_IS_MINIO env var
  const s3IsMinIO =
    process.env.S3_IS_MINIO === 'true' ||
    s3Endpoint.includes('localhost') ||
    s3Endpoint.includes('127.0.0.1') ||
    s3Endpoint.includes('minio') ||
    s3Endpoint.includes('host.docker.internal');

  return {
    provider,

    // Local filesystem config
    localPath: process.env.STORAGE_LOCAL_PATH || './uploads',

    // S3/MinIO config
    s3Endpoint,
    s3Region: process.env.S3_REGION || 'us-east-1',
    s3Bucket: process.env.S3_BUCKET || 'oakcloud',
    s3AccessKey: process.env.S3_ACCESS_KEY || 'oakcloud',
    s3SecretKey: process.env.S3_SECRET_KEY || 'oakcloud_minio_secret',
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false', // Default true for MinIO
    s3UseSsl: process.env.S3_USE_SSL === 'true',

    // S3 Encryption config
    s3Encryption,
    s3KmsKeyId: process.env.S3_KMS_KEY_ID,

    // MinIO detection
    s3IsMinIO,
  };
}

/**
 * Validate storage configuration
 * @throws Error if configuration is invalid
 */
export function validateStorageConfig(config: StorageConfig): void {
  if (config.provider === 's3') {
    if (!config.s3Endpoint) {
      throw new Error('S3_ENDPOINT is required when STORAGE_PROVIDER=s3');
    }
    if (!config.s3Bucket) {
      throw new Error('S3_BUCKET is required when STORAGE_PROVIDER=s3');
    }
    if (!config.s3AccessKey) {
      throw new Error('S3_ACCESS_KEY is required when STORAGE_PROVIDER=s3');
    }
    if (!config.s3SecretKey) {
      throw new Error('S3_SECRET_KEY is required when STORAGE_PROVIDER=s3');
    }
  } else if (config.provider === 'local') {
    if (!config.localPath) {
      throw new Error('STORAGE_LOCAL_PATH is required when STORAGE_PROVIDER=local');
    }
  } else {
    throw new Error(`Invalid STORAGE_PROVIDER: ${config.provider}. Must be 's3' or 'local'.`);
  }
}

/**
 * Storage key utilities
 */
export const StorageKeys = {
  /**
   * Generate storage key for a document's original file
   */
  documentOriginal(tenantId: string, companyId: string, documentId: string, extension: string): string {
    return `${tenantId}/companies/${companyId}/documents/${documentId}/original${extension}`;
  },

  /**
   * Generate storage key for a pending document (BizFile upload)
   */
  pendingDocument(tenantId: string, documentId: string, extension: string): string {
    return `${tenantId}/pending/${documentId}/original${extension}`;
  },

  /**
   * Generate storage key for a document page image
   */
  documentPage(tenantId: string, companyId: string, documentId: string, pageNumber: number): string {
    return `${tenantId}/companies/${companyId}/documents/${documentId}/pages/${pageNumber}.png`;
  },

  /**
   * Generate storage key for a derived file (thumbnail, child PDF, etc.)
   */
  derivedFile(
    tenantId: string,
    companyId: string,
    documentId: string,
    kind: string,
    filename: string
  ): string {
    return `${tenantId}/companies/${companyId}/documents/${documentId}/derived/${kind}/${filename}`;
  },

  /**
   * Get prefix for all files belonging to a document
   */
  documentPrefix(tenantId: string, companyId: string, documentId: string): string {
    return `${tenantId}/companies/${companyId}/documents/${documentId}/`;
  },

  /**
   * Get prefix for all files belonging to a company
   */
  companyPrefix(tenantId: string, companyId: string): string {
    return `${tenantId}/companies/${companyId}/`;
  },

  /**
   * Get prefix for all files belonging to a tenant
   */
  tenantPrefix(tenantId: string): string {
    return `${tenantId}/`;
  },

  /**
   * Generate an immutable storage key for one OakDoc template asset.
   * Template revisions point at immutable assets so failed/concurrent saves
   * cannot overwrite the currently persisted DOCX.
   */
  oakDocTemplateAsset(tenantId: string, assetId: string): string {
    return `${tenantId}/templates/oakdoc/assets/${assetId}.docx`;
  },

  /**
   * Generate the content-addressed key for one native partial version. Pinned
   * template references keep reading these bytes after the partial changes,
   * so they are never overwritten or deleted by a partial update.
   */
  oakDocPartialAsset(tenantId: string, partialId: string, sha256: string): string {
    return `${tenantId}/template-partials/${partialId}/oakdoc/${sha256}.docx`;
  },

  /**
   * Generate an immutable storage key for one generated OakDoc artefact.
   * Generated assets live outside the template prefix so generation can never
   * overwrite the reusable master DOCX.
   */
  oakDocGeneratedAsset(tenantId: string, documentId: string, assetId: string): string {
    return `${tenantId}/generated-documents/${documentId}/oakdoc/${assetId}.docx`;
  },

  /**
   * Generate storage key for tenant branding logo
   */
  tenantLogo(tenantId: string, extension: string): string {
    return `${tenantId}/branding/logo${extension}`;
  },

  /**
   * Generate storage key for a form background image
   */
  formBackground(tenantId: string, formId: string, extension: string, version?: string): string {
    const suffix = version ? `-${version}` : '';
    return `${tenantId}/forms/${formId}/branding/background${suffix}${extension}`;
  },

  /**
   * Get prefix for all files belonging to a generated document
   */
  generatedDocumentPrefix(tenantId: string, documentId: string): string {
    return `${tenantId}/generated-documents/${documentId}/`;
  },

  /**
   * Get prefix for pending documents of a tenant
   */
  pendingPrefix(tenantId: string): string {
    return `${tenantId}/pending/`;
  },

  /**
   * Get prefix for all files belonging to an e-signing envelope
   */
  esigningEnvelopePrefix(tenantId: string, envelopeId: string): string {
    return `${tenantId}/esigning/${envelopeId}/`;
  },

  /**
   * Generate storage key for an original e-signing document
   */
  esigningOriginalDocument(
    tenantId: string,
    envelopeId: string,
    documentId: string,
    extension: string
  ): string {
    return `${tenantId}/esigning/${envelopeId}/originals/${documentId}${extension}`;
  },

  /**
   * Generate storage key for a signed e-signing document
   */
  esigningSignedDocument(
    tenantId: string,
    envelopeId: string,
    documentId: string
  ): string {
    return `${tenantId}/esigning/${envelopeId}/signed/${documentId}.pdf`;
  },

  /**
   * Generate storage key for a signer signature/initials asset
   */
  esigningSignatureAsset(
    tenantId: string,
    envelopeId: string,
    recipientId: string,
    kind: 'signature' | 'initials'
  ): string {
    return `${tenantId}/esigning/${envelopeId}/signatures/${recipientId}_${kind}.png`;
  },

  /**
   * Generate storage key for the envelope-level completion certificate.
   */
  esigningEnvelopeCertificate(
    tenantId: string,
    envelopeId: string
  ): string {
    return `${tenantId}/esigning/${envelopeId}/certificate.pdf`;
  },

  /**
   * Issued-artifact keys. Every generation writes under its own `v{n}/` folder, and each generation
   * attempt under its own `{attemptId}/` folder inside it, so two workers that pick the same version
   * (an expired lease, a retry) can never write the same object: only the attempt whose rows are
   * committed is ever read, and an attempt that lost deletes only its own folder. Without an
   * `attemptId` the key is the deterministic one used for backfilled files (version 1 of envelopes
   * completed before versioning still lives at the unversioned keys above).
   */
  esigningIssuedSignedDocument(
    tenantId: string,
    envelopeId: string,
    version: number,
    documentId: string,
    attemptId?: string
  ): string {
    return `${StorageKeys.esigningIssuedFolder(tenantId, envelopeId, version, attemptId)}/signed/${documentId}.pdf`;
  },

  esigningIssuedCertificate(
    tenantId: string,
    envelopeId: string,
    version: number,
    attemptId?: string
  ): string {
    return `${StorageKeys.esigningIssuedFolder(tenantId, envelopeId, version, attemptId)}/certificate.pdf`;
  },

  esigningIssuedDocumentWithCertificate(
    tenantId: string,
    envelopeId: string,
    version: number,
    documentId: string,
    attemptId?: string
  ): string {
    return `${StorageKeys.esigningIssuedFolder(tenantId, envelopeId, version, attemptId)}/with-certificate/${documentId}.pdf`;
  },

  /** The combined PDF of every signed document of a multi-document envelope. */
  esigningIssuedPackage(
    tenantId: string,
    envelopeId: string,
    version: number,
    variant: 'documents' | 'documents-with-certificate',
    attemptId?: string
  ): string {
    return `${StorageKeys.esigningIssuedFolder(tenantId, envelopeId, version, attemptId)}/package/${variant}.pdf`;
  },

  esigningIssuedFolder(
    tenantId: string,
    envelopeId: string,
    version: number,
    attemptId?: string
  ): string {
    const base = `${tenantId}/esigning/${envelopeId}/v${version}`;
    return attemptId ? `${base}/${attemptId}` : base;
  },

  /**
   * Legacy per-document certificate key retained for backwards compatibility
   * with historical stored artifacts. New certificate generation is envelope-level.
   */
  esigningCertificateDocument(
    tenantId: string,
    envelopeId: string,
    documentId: string
  ): string {
    return `${tenantId}/esigning/${envelopeId}/certificates/${documentId}.pdf`;
  },

  // ============================================================================
  // BACKUP STORAGE KEYS
  // ============================================================================

  /**
   * Generate storage key prefix for a backup
   */
  backupPrefix(backupId: string): string {
    return `backups/${backupId}/`;
  },

  /**
   * Generate storage key for backup manifest
   */
  backupManifest(backupId: string): string {
    return `backups/${backupId}/manifest.json`;
  },

  /**
   * Generate storage key for backup database data (gzip compressed)
   */
  backupData(backupId: string): string {
    return `backups/${backupId}/data.json.gz`;
  },

  /**
   * Generate storage key for a backed-up file (preserves original path structure)
   */
  backupFile(backupId: string, originalKey: string): string {
    return `backups/${backupId}/files/${originalKey}`;
  },

  /**
   * Get prefix for all backup files
   */
  backupsPrefix(): string {
    return 'backups/';
  },

  /**
   * Extract extension from filename or mime type
   */
  getExtension(filename: string, mimeType?: string): string {
    // Try to get from filename first
    const match = filename.match(/\.([^.]+)$/);
    if (match) {
      return `.${match[1].toLowerCase()}`;
    }

    // Fall back to mime type
    if (mimeType) {
      const mimeExtensions: Record<string, string> = {
        'application/pdf': '.pdf',
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/webp': '.webp',
        'image/tiff': '.tiff',
        'image/svg+xml': '.svg',
      };
      return mimeExtensions[mimeType] || '';
    }

    return '';
  },
};
