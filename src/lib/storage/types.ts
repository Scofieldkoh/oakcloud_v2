/**
 * Storage Service Types
 *
 * Type definitions for the storage abstraction layer supporting
 * both local filesystem and S3-compatible storage (MinIO, AWS S3).
 */

/**
 * Options for file upload operations
 */
export interface UploadOptions {
  /** MIME type of the file */
  contentType: string;
  /** Optional metadata to store with the file */
  metadata?: Record<string, string>;
  /** Cache control header for CDN/browser caching */
  cacheControl?: string;
}

/**
 * Result of a successful upload operation
 */
export interface StorageResult {
  /** Storage key (path) where the file was stored */
  key: string;
  /** Full URL to access the file (may require signing for private files) */
  url: string;
  /** ETag/hash of the uploaded content */
  etag?: string;
  /** Size of the uploaded file in bytes */
  size: number;
}

/**
 * Metadata about a stored file
 */
export interface FileMetadata {
  /** Storage key (path) */
  key: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  contentType: string;
  /** Last modified timestamp */
  lastModified: Date;
  /** ETag/hash */
  etag?: string;
  /** Custom metadata */
  metadata?: Record<string, string>;
}

/**
 * Information about a file in a listing
 */
export interface FileInfo {
  /** Storage key (path) */
  key: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  lastModified: Date;
  /** ETag/hash */
  etag?: string;
}

/**
 * Storage adapter interface
 *
 * All storage implementations must implement this interface.
 * This enables swapping between local filesystem, MinIO, and AWS S3
 * without changing application code.
 */
export interface StorageAdapter {
  /**
   * Upload a file to storage
   * @param key - Storage key (path) for the file
   * @param content - File content as Buffer
   * @param options - Upload options (contentType, metadata, etc.)
   * @returns Upload result with key, URL, and metadata
   */
  upload(key: string, content: Buffer, options: UploadOptions): Promise<StorageResult>;

  /**
   * Download a file from storage
   * @param key - Storage key (path) of the file
   * @returns File content as Buffer
   * @throws Error if file not found
   */
  download(key: string): Promise<Buffer>;

  /**
   * Delete a single file from storage
   * @param key - Storage key (path) of the file to delete
   */
  delete(key: string): Promise<void>;

  /**
   * Delete all files with a given prefix
   * @param prefix - Key prefix to match (e.g., "tenant-abc/companies/comp-123/")
   * @returns Number of files deleted
   */
  deletePrefix(prefix: string): Promise<number>;

  /**
   * Check if a file exists in storage
   * @param key - Storage key (path) to check
   * @returns true if file exists, false otherwise
   */
  exists(key: string): Promise<boolean>;

  /**
   * Generate a signed URL for temporary access to a file
   * @param key - Storage key (path) of the file
   * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
   * @returns Signed URL for temporary access
   */
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * Get the public URL for a file (for public buckets only)
   * @param key - Storage key (path) of the file
   * @returns Public URL
   */
  getPublicUrl(key: string): string;

  /**
   * Get metadata about a stored file
   * @param key - Storage key (path) of the file
   * @returns File metadata
   * @throws Error if file not found
   */
  getMetadata(key: string): Promise<FileMetadata>;

  /**
   * List files with a given prefix
   * @param prefix - Key prefix to match
   * @param maxKeys - Maximum number of keys to return (default: 1000)
   * @returns Array of file info objects
   */
  list(prefix: string, maxKeys?: number): Promise<FileInfo[]>;

  /**
   * Copy a file to a new location
   * @param sourceKey - Source storage key
   * @param destinationKey - Destination storage key
   */
  copy(sourceKey: string, destinationKey: string): Promise<void>;

  /**
   * Move a file to a new location (copy + delete)
   * @param sourceKey - Source storage key
   * @param destinationKey - Destination storage key
   */
  move(sourceKey: string, destinationKey: string): Promise<void>;
}

/**
 * Storage provider types
 */
export type StorageProvider = 's3' | 'local';

/**
 * Storage configuration
 */
/**
 * Server-side encryption types for S3
 */
export type S3EncryptionType = 'none' | 'AES256' | 'aws:kms';

export interface StorageConfig {
  provider: StorageProvider;

  // Local filesystem config
  localPath?: string;

  // S3/MinIO config
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3ForcePathStyle?: boolean;
  s3UseSsl?: boolean;

  // S3 Encryption config
  s3Encryption?: S3EncryptionType;
  s3KmsKeyId?: string; // Required when s3Encryption is 'aws:kms'

  // MinIO detection (auto-detected from endpoint, or set S3_IS_MINIO=true)
  s3IsMinIO: boolean;
}
