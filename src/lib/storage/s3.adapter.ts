/**
 * S3/MinIO Storage Adapter
 *
 * Implements the StorageAdapter interface using AWS S3 SDK.
 * Compatible with MinIO, AWS S3, and other S3-compatible storage services.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as s3GetSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  StorageAdapter,
  UploadOptions,
  StorageResult,
  FileMetadata,
  FileInfo,
  StorageConfig,
  S3EncryptionType,
} from './types';
import { createLogger } from '@/lib/logger';

const log = createLogger('storage:s3');

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;
  private endpoint: string;
  private bucketEnsured: boolean = false;
  private encryption: S3EncryptionType;
  private kmsKeyId?: string;
  private isMinIO: boolean;

  constructor(config: StorageConfig) {
    if (!config.s3Endpoint || !config.s3Bucket || !config.s3AccessKey || !config.s3SecretKey) {
      throw new Error('S3 configuration is incomplete');
    }

    this.bucket = config.s3Bucket;
    this.endpoint = config.s3Endpoint;
    this.encryption = config.s3Encryption || 'AES256'; // Default to SSE-S3
    this.kmsKeyId = config.s3KmsKeyId;
    this.isMinIO = config.s3IsMinIO;

    // Validate KMS configuration
    if (this.encryption === 'aws:kms' && !this.kmsKeyId) {
      log.warn('S3 KMS encryption enabled but no KMS key ID provided');
    }

    // Create S3 client
    this.client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region || 'us-east-1',
      credentials: {
        accessKeyId: config.s3AccessKey,
        secretAccessKey: config.s3SecretKey,
      },
      forcePathStyle: config.s3ForcePathStyle !== false, // Default true for MinIO
    });

    const encryptionInfo = this.encryption === 'none' ? 'disabled' : this.encryption;
    log.info(`S3 storage adapter initialized with endpoint: ${config.s3Endpoint}, bucket: ${config.s3Bucket}, encryption: ${encryptionInfo} (env: ${process.env.S3_ENCRYPTION || 'not set'})`);
  }

  /**
   * Ensure the bucket exists, creating it if necessary
   */
  private async ensureBucket(): Promise<void> {
    if (this.bucketEnsured) return;

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketEnsured = true;
      log.debug(`Bucket ${this.bucket} exists`);
    } catch (error) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        log.info(`Bucket ${this.bucket} not found, creating...`);
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.bucketEnsured = true;
        log.info(`Bucket ${this.bucket} created`);
      } else {
        throw error;
      }
    }
  }

  async upload(key: string, content: Buffer, options: UploadOptions): Promise<StorageResult> {
    await this.ensureBucket();

    // Build command with encryption parameters
    const commandInput: ConstructorParameters<typeof PutObjectCommand>[0] = {
      Bucket: this.bucket,
      Key: key,
      Body: content,
      ContentType: options.contentType,
      Metadata: options.metadata,
      CacheControl: options.cacheControl,
    };

    // Add server-side encryption
    // Note: MinIO may not support all encryption types. For local dev, consider S3_ENCRYPTION=none
    if (this.encryption !== 'none') {
      // Only add encryption header if not using MinIO (localhost)
      const isMinIO = this.isMinIO;
      if (!isMinIO) {
        commandInput.ServerSideEncryption = this.encryption;
        if (this.encryption === 'aws:kms' && this.kmsKeyId) {
          commandInput.SSEKMSKeyId = this.kmsKeyId;
        }
      }
    }

    const command = new PutObjectCommand(commandInput);
    const response = await this.client.send(command);

    log.debug(`Uploaded file to ${key} (${content.length} bytes, encryption: ${this.encryption})`);

    return {
      key,
      url: this.getPublicUrl(key),
      etag: response.ETag?.replace(/"/g, ''),
      size: content.length,
    };
  }

  async download(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      const response = await this.client.send(command);

      if (!response.Body) {
        throw new Error(`Empty response body for key: ${key}`);
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      const stream = response.Body as AsyncIterable<Uint8Array>;

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      log.debug(`Downloaded file from ${key} (${buffer.length} bytes)`);
      return buffer;
    } catch (error) {
      const err = error as { name?: string };
      if (err.name === 'NoSuchKey') {
        throw new Error(`File not found: ${key}`);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
    log.debug(`Deleted file: ${key}`);
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deletedCount = 0;
    let continuationToken: string | undefined;

    do {
      // List objects with prefix
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const listResponse = await this.client.send(listCommand);
      const objects = listResponse.Contents || [];

      if (objects.length === 0) break;

      // Delete objects in batches of 1000 (S3 limit)
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: objects.map((obj) => ({ Key: obj.Key })),
          Quiet: true,
        },
      });

      await this.client.send(deleteCommand);
      deletedCount += objects.length;

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    log.info(`Deleted ${deletedCount} files with prefix: ${prefix}`);
    return deletedCount;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      const err = error as { name?: string };
      if (err.name === 'NotFound' || err.name === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const url = await s3GetSignedUrl(this.client, command, { expiresIn });
    log.debug(`Generated signed URL for ${key} (expires in ${expiresIn}s)`);
    return url;
  }

  getPublicUrl(key: string): string {
    // For MinIO/S3, construct URL based on endpoint
    const cleanEndpoint = this.endpoint.replace(/\/$/, '');
    return `${cleanEndpoint}/${this.bucket}/${key}`;
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      const response = await this.client.send(command);

      return {
        key,
        size: response.ContentLength || 0,
        contentType: response.ContentType || 'application/octet-stream',
        lastModified: response.LastModified || new Date(),
        etag: response.ETag?.replace(/"/g, ''),
        metadata: response.Metadata as Record<string, string>,
      };
    } catch (error) {
      const err = error as { name?: string };
      if (err.name === 'NotFound' || err.name === 'NoSuchKey') {
        throw new Error(`File not found: ${key}`);
      }
      throw error;
    }
  }

  async list(prefix: string, maxKeys: number = 1000): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: Math.min(maxKeys - files.length, 1000),
        ContinuationToken: continuationToken,
      });

      const response = await this.client.send(command);

      for (const obj of response.Contents || []) {
        if (obj.Key) {
          files.push({
            key: obj.Key,
            size: obj.Size || 0,
            lastModified: obj.LastModified || new Date(),
            etag: obj.ETag?.replace(/"/g, ''),
          });
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken && files.length < maxKeys);

    return files;
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const encodedCopySource = `${this.bucket}/${sourceKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;

    // Build command with encryption parameters for the destination
    const commandInput: ConstructorParameters<typeof CopyObjectCommand>[0] = {
      Bucket: this.bucket,
      Key: destinationKey,
      CopySource: encodedCopySource,
    };

    // Apply encryption to the copied object
    // Note: MinIO may not support all encryption types
    if (this.encryption !== 'none') {
      const isMinIO = this.isMinIO;
      if (!isMinIO) {
        commandInput.ServerSideEncryption = this.encryption;
        if (this.encryption === 'aws:kms' && this.kmsKeyId) {
          commandInput.SSEKMSKeyId = this.kmsKeyId;
        }
      }
    }

    const command = new CopyObjectCommand(commandInput);
    await this.client.send(command);
    log.debug(`Copied file from ${sourceKey} to ${destinationKey}`);
  }

  async move(sourceKey: string, destinationKey: string): Promise<void> {
    await this.copy(sourceKey, destinationKey);
    await this.delete(sourceKey);
    log.debug(`Moved file from ${sourceKey} to ${destinationKey}`);
  }
}
