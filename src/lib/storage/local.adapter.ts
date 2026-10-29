/**
 * Local Filesystem Storage Adapter
 *
 * Implements the StorageAdapter interface using the local filesystem.
 * Useful for development and self-hosted deployments without MinIO/S3.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type {
  StorageAdapter,
  UploadOptions,
  StorageResult,
  FileMetadata,
  FileInfo,
} from './types';
import { createLogger } from '@/lib/logger';

const log = createLogger('storage:local');

export class LocalStorageAdapter implements StorageAdapter {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
    log.info(`Local storage adapter initialized with base path: ${this.basePath}`);
  }

  /**
   * Get full filesystem path for a storage key
   */
  private getFullPath(key: string): string {
    // Normalize key to use forward slashes and resolve to absolute path
    const normalizedKey = key.replace(/\\/g, '/');
    return path.join(this.basePath, normalizedKey);
  }

  /**
   * Ensure directory exists for a file path
   */
  private async ensureDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async upload(key: string, content: Buffer, options: UploadOptions): Promise<StorageResult> {
    const fullPath = this.getFullPath(key);
    await this.ensureDir(fullPath);

    // Write file
    await fs.writeFile(fullPath, content);

    // Calculate ETag (MD5 hash)
    const etag = createHash('md5').update(content).digest('hex');

    // Store metadata in a sidecar file
    const metadataPath = `${fullPath}.meta.json`;
    const metadata = {
      contentType: options.contentType,
      size: content.length,
      etag,
      uploadedAt: new Date().toISOString(),
      customMetadata: options.metadata || {},
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    log.debug(`Uploaded file to ${key} (${content.length} bytes)`);

    return {
      key,
      url: this.getPublicUrl(key),
      etag,
      size: content.length,
    };
  }

  async download(key: string): Promise<Buffer> {
    const fullPath = this.getFullPath(key);

    try {
      const content = await fs.readFile(fullPath);
      log.debug(`Downloaded file from ${key} (${content.length} bytes)`);
      return content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${key}`);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    const metadataPath = `${fullPath}.meta.json`;

    try {
      await fs.unlink(fullPath);
      log.debug(`Deleted file: ${key}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // File already doesn't exist, that's fine
    }

    // Also delete metadata file if exists
    try {
      await fs.unlink(metadataPath);
    } catch {
      // Ignore if metadata file doesn't exist
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    const fullPath = this.getFullPath(prefix);
    let deletedCount = 0;

    try {
      // Check if the path exists
      await fs.access(fullPath);

      // Get all files recursively
      const files = await this.listFilesRecursive(fullPath);

      // Delete each file
      for (const file of files) {
        try {
          await fs.unlink(file);
          deletedCount++;

          // Also delete metadata file
          try {
            await fs.unlink(`${file}.meta.json`);
          } catch {
            // Ignore
          }
        } catch (error) {
          log.warn(`Failed to delete file ${file}:`, error);
        }
      }

      // Clean up empty directories
      await this.removeEmptyDirs(fullPath);

      log.info(`Deleted ${deletedCount} files with prefix: ${prefix}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // Directory doesn't exist, nothing to delete
    }

    return deletedCount;
  }

  /**
   * Recursively list all files in a directory
   */
  private async listFilesRecursive(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const subFiles = await this.listFilesRecursive(fullPath);
          files.push(...subFiles);
        } else if (!entry.name.endsWith('.meta.json')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return files;
  }

  /**
   * Remove empty directories recursively
   */
  private async removeEmptyDirs(dir: string): Promise<void> {
    // Don't remove the base path
    if (dir === this.basePath) return;

    try {
      const entries = await fs.readdir(dir);
      if (entries.length === 0) {
        await fs.rmdir(dir);
        // Try to remove parent if it's now empty
        const parentDir = path.dirname(dir);
        if (parentDir !== this.basePath) {
          await this.removeEmptyDirs(parentDir);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.getFullPath(key);

    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, _expiresIn?: number): Promise<string> {
    // Local storage doesn't support signed URLs
    // Return a path that can be used by the API to serve the file
    return this.getPublicUrl(key);
  }

  getPublicUrl(key: string): string {
    // Return a relative path that can be handled by the API
    // The actual serving is done by API routes
    return `/api/storage/${encodeURIComponent(key)}`;
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    const fullPath = this.getFullPath(key);
    const metadataPath = `${fullPath}.meta.json`;

    // Get file stats
    const stats = await fs.stat(fullPath);

    // Try to read metadata file
    let customMetadata: Record<string, string> = {};
    let contentType = 'application/octet-stream';
    let etag: string | undefined;

    try {
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataContent);
      contentType = metadata.contentType || contentType;
      etag = metadata.etag;
      customMetadata = metadata.customMetadata || {};
    } catch {
      // Metadata file doesn't exist, try to infer content type
      const ext = path.extname(key).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.tiff': 'image/tiff',
      };
      contentType = mimeTypes[ext] || contentType;
    }

    return {
      key,
      size: stats.size,
      contentType,
      lastModified: stats.mtime,
      etag,
      metadata: customMetadata,
    };
  }

  async list(prefix: string, maxKeys: number = 1000): Promise<FileInfo[]> {
    const fullPath = this.getFullPath(prefix);
    const files: FileInfo[] = [];

    try {
      const allFiles = await this.listFilesRecursive(fullPath);

      for (const file of allFiles.slice(0, maxKeys)) {
        try {
          const stats = await fs.stat(file);
          const key = file.substring(this.basePath.length + 1).replace(/\\/g, '/');

          files.push({
            key,
            size: stats.size,
            lastModified: stats.mtime,
          });
        } catch {
          // Skip files that can't be stat'd
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // Directory doesn't exist, return empty list
    }

    return files;
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const sourcePath = this.getFullPath(sourceKey);
    const destPath = this.getFullPath(destinationKey);

    await this.ensureDir(destPath);
    await fs.copyFile(sourcePath, destPath);

    // Also copy metadata file if exists
    try {
      await fs.copyFile(`${sourcePath}.meta.json`, `${destPath}.meta.json`);
    } catch {
      // Ignore if metadata doesn't exist
    }

    log.debug(`Copied file from ${sourceKey} to ${destinationKey}`);
  }

  async move(sourceKey: string, destinationKey: string): Promise<void> {
    await this.copy(sourceKey, destinationKey);
    await this.delete(sourceKey);
    log.debug(`Moved file from ${sourceKey} to ${destinationKey}`);
  }
}
