/**
 * Storage Service
 *
 * Unified storage abstraction supporting both local filesystem
 * and S3-compatible storage (MinIO, AWS S3).
 *
 * Usage:
 * ```typescript
 * import { storage, StorageKeys } from '@/lib/storage';
 *
 * // Upload a file
 * const result = await storage.upload(
 *   StorageKeys.documentOriginal(tenantId, companyId, docId, '.pdf'),
 *   buffer,
 *   { contentType: 'application/pdf' }
 * );
 *
 * // Download a file
 * const content = await storage.download(key);
 *
 * // Delete all files for a document
 * await storage.deletePrefix(StorageKeys.documentPrefix(tenantId, companyId, docId));
 * ```
 */

import type { StorageAdapter } from './types';
import { getStorageConfig, validateStorageConfig } from './config';
import { LocalStorageAdapter } from './local.adapter';
import { S3StorageAdapter } from './s3.adapter';
import { createLogger } from '@/lib/logger';

const log = createLogger('storage');

// Singleton storage adapter
let storageAdapter: StorageAdapter | null = null;
let lastEncryptionConfig: string | undefined = undefined;

/**
 * Reset the storage adapter singleton
 * Forces re-initialization on next getStorage() call
 * Useful when environment variables change during development
 */
export function resetStorage(): void {
  storageAdapter = null;
  log.info('Storage adapter reset - will reinitialize on next access');
}

/**
 * Get the storage adapter instance
 * Creates adapter lazily on first access
 * In development, automatically resets if S3_ENCRYPTION env var changes
 */
export function getStorage(): StorageAdapter {
  // In development, check if encryption config changed and reset if needed
  const currentEncryption = process.env.S3_ENCRYPTION;
  if (storageAdapter && lastEncryptionConfig !== currentEncryption) {
    log.warn(`S3_ENCRYPTION changed from "${lastEncryptionConfig}" to "${currentEncryption}" - resetting adapter`);
    storageAdapter = null;
  }

  if (!storageAdapter) {
    const config = getStorageConfig();
    validateStorageConfig(config);
    lastEncryptionConfig = currentEncryption;

    if (config.provider === 's3') {
      log.info('Initializing S3 storage adapter');
      storageAdapter = new S3StorageAdapter(config);
    } else {
      log.info('Initializing local storage adapter');
      storageAdapter = new LocalStorageAdapter(config.localPath!);
    }
  }

  return storageAdapter;
}

/**
 * Storage singleton
 * Provides direct access to the storage adapter
 */
export const storage = {
  upload: (...args: Parameters<StorageAdapter['upload']>) => getStorage().upload(...args),
  download: (...args: Parameters<StorageAdapter['download']>) => getStorage().download(...args),
  delete: (...args: Parameters<StorageAdapter['delete']>) => getStorage().delete(...args),
  deletePrefix: (...args: Parameters<StorageAdapter['deletePrefix']>) => getStorage().deletePrefix(...args),
  exists: (...args: Parameters<StorageAdapter['exists']>) => getStorage().exists(...args),
  getSignedUrl: (...args: Parameters<StorageAdapter['getSignedUrl']>) => getStorage().getSignedUrl(...args),
  getPublicUrl: (...args: Parameters<StorageAdapter['getPublicUrl']>) => getStorage().getPublicUrl(...args),
  getMetadata: (...args: Parameters<StorageAdapter['getMetadata']>) => getStorage().getMetadata(...args),
  list: (...args: Parameters<StorageAdapter['list']>) => getStorage().list(...args),
  copy: (...args: Parameters<StorageAdapter['copy']>) => getStorage().copy(...args),
  move: (...args: Parameters<StorageAdapter['move']>) => getStorage().move(...args),
};

// Re-export types and utilities
export { StorageKeys } from './config';
export type {
  StorageAdapter,
  StorageResult,
  UploadOptions,
  FileMetadata,
  FileInfo,
  StorageProvider,
  StorageConfig,
} from './types';

// Re-export filename utilities
export {
  generateApprovedDocumentFilename,
  sanitizeForFilename,
  formatAmountForFilename,
  formatDateForFilename,
  shortenCompanyName,
  getFileExtension,
  buildApprovedStorageKey,
} from './filename';
export type { ApprovedDocumentFilenameInput } from './filename';
