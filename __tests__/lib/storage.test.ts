/**
 * Storage Service Tests
 *
 * Tests for the storage abstraction layer including:
 * - S3/MinIO adapter
 * - Local filesystem adapter
 * - Storage key generation
 * - File operations (upload, download, delete, etc.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock AWS SDK using class syntax for S3Client
const mockS3Send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => {
  const MockS3Client = vi.fn(function(this: Record<string, unknown>) {
    this.send = mockS3Send;
  });

  // Command classes use simple function constructors
  const createCommand = (type: string) => vi.fn(function(this: Record<string, unknown>, params: Record<string, unknown>) {
    Object.assign(this, params);
    this._type = type;
  });

  return {
    S3Client: MockS3Client,
    PutObjectCommand: createCommand('PutObject'),
    GetObjectCommand: createCommand('GetObject'),
    DeleteObjectCommand: createCommand('DeleteObject'),
    DeleteObjectsCommand: createCommand('DeleteObjects'),
    HeadObjectCommand: createCommand('HeadObject'),
    ListObjectsV2Command: createCommand('ListObjectsV2'),
    CopyObjectCommand: createCommand('CopyObject'),
    CreateBucketCommand: createCommand('CreateBucket'),
    HeadBucketCommand: createCommand('HeadBucket'),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com/file'),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock fs for local adapter tests
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
    copyFile: vi.fn(),
    rename: vi.fn(),
    rm: vi.fn(),
    access: vi.fn(),
  },
}));

import { StorageKeys } from '@/lib/storage/config';
import type { StorageConfig } from '@/lib/storage/types';

describe('StorageKeys', () => {
  const tenantId = 'tenant-123';
  const companyId = 'company-456';
  const documentId = 'doc-789';

  describe('pendingDocument', () => {
    it('should generate correct key for pending documents', () => {
      const key = StorageKeys.pendingDocument(tenantId, documentId, '.pdf');
      expect(key).toBe('tenant-123/pending/doc-789/original.pdf');
    });

    it('should handle different file extensions', () => {
      const pdfKey = StorageKeys.pendingDocument(tenantId, documentId, '.pdf');
      const pngKey = StorageKeys.pendingDocument(tenantId, documentId, '.png');

      expect(pdfKey).toContain('.pdf');
      expect(pngKey).toContain('.png');
    });
  });

  describe('documentOriginal', () => {
    it('should generate correct key for document originals', () => {
      const key = StorageKeys.documentOriginal(tenantId, companyId, documentId, '.pdf');
      expect(key).toBe('tenant-123/companies/company-456/documents/doc-789/original.pdf');
    });
  });

  describe('documentPage', () => {
    it('should generate correct key for document pages', () => {
      const key = StorageKeys.documentPage(tenantId, companyId, documentId, 1);
      expect(key).toBe('tenant-123/companies/company-456/documents/doc-789/pages/1.png');
    });

    it('should handle different page numbers', () => {
      const page1 = StorageKeys.documentPage(tenantId, companyId, documentId, 1);
      const page10 = StorageKeys.documentPage(tenantId, companyId, documentId, 10);
      const page100 = StorageKeys.documentPage(tenantId, companyId, documentId, 100);

      expect(page1).toContain('/pages/1.png');
      expect(page10).toContain('/pages/10.png');
      expect(page100).toContain('/pages/100.png');
    });
  });

  describe('derivedFile', () => {
    it('should generate correct key for derived files', () => {
      const key = StorageKeys.derivedFile(tenantId, companyId, documentId, 'thumbnail', 'thumb.jpg');
      expect(key).toBe('tenant-123/companies/company-456/documents/doc-789/derived/thumbnail/thumb.jpg');
    });
  });

  describe('documentPrefix', () => {
    it('should generate correct prefix for all document files', () => {
      const prefix = StorageKeys.documentPrefix(tenantId, companyId, documentId);
      expect(prefix).toBe('tenant-123/companies/company-456/documents/doc-789/');
    });

    it('should end with trailing slash', () => {
      const prefix = StorageKeys.documentPrefix(tenantId, companyId, documentId);
      expect(prefix.endsWith('/')).toBe(true);
    });
  });

  describe('companyPrefix', () => {
    it('should generate correct prefix for all company files', () => {
      const prefix = StorageKeys.companyPrefix(tenantId, companyId);
      expect(prefix).toBe('tenant-123/companies/company-456/');
    });
  });

  describe('tenantPrefix', () => {
    it('should generate correct prefix for all tenant files', () => {
      const prefix = StorageKeys.tenantPrefix(tenantId);
      expect(prefix).toBe('tenant-123/');
    });
  });

  describe('formBackground', () => {
    it('should generate correct key for form backgrounds', () => {
      expect(StorageKeys.formBackground(tenantId, 'form-1', '.png'))
        .toBe(`${tenantId}/forms/form-1/branding/background.png`);
    });

    it('should handle different extensions', () => {
      expect(StorageKeys.formBackground(tenantId, 'form-1', '.webp'))
        .toBe(`${tenantId}/forms/form-1/branding/background.webp`);
    });
  });

  describe('pendingPrefix', () => {
    it('should generate correct prefix for pending documents', () => {
      const prefix = StorageKeys.pendingPrefix(tenantId);
      expect(prefix).toBe('tenant-123/pending/');
    });
  });

  describe('getExtension', () => {
    it('should extract extension from filename', () => {
      expect(StorageKeys.getExtension('document.pdf')).toBe('.pdf');
      expect(StorageKeys.getExtension('image.PNG')).toBe('.png');
      expect(StorageKeys.getExtension('file.with.dots.jpg')).toBe('.jpg');
    });

    it('should fall back to mime type', () => {
      expect(StorageKeys.getExtension('noext', 'application/pdf')).toBe('.pdf');
      expect(StorageKeys.getExtension('noext', 'image/png')).toBe('.png');
    });

    it('should return empty string when no extension found', () => {
      expect(StorageKeys.getExtension('noext')).toBe('');
    });
  });

  describe('formBackground', () => {
    it('should generate correct key for form backgrounds', () => {
      expect(StorageKeys.formBackground(tenantId, 'form-1', '.png'))
        .toBe(`${tenantId}/forms/form-1/branding/background.png`);
    });

    it('should handle different extensions', () => {
      expect(StorageKeys.formBackground(tenantId, 'form-1', '.webp'))
        .toBe(`${tenantId}/forms/form-1/branding/background.webp`);
    });
  });
});

describe('S3StorageAdapter', () => {
  let adapter: Awaited<ReturnType<typeof createS3Adapter>>;

  const s3Config: StorageConfig = {
    provider: 's3',
    s3Endpoint: 'http://localhost:9000',
    s3Region: 'us-east-1',
    s3Bucket: 'test-bucket',
    s3AccessKey: 'test-access-key',
    s3SecretKey: 'test-secret-key',
    s3ForcePathStyle: true,
    s3UseSsl: false,
    s3IsMinIO: true,
  };

  async function createS3Adapter() {
    const { S3StorageAdapter } = await import('@/lib/storage/s3.adapter');
    return new S3StorageAdapter(s3Config);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    // Mock bucket exists
    mockS3Send.mockImplementation(async (command) => {
      if (command._type === 'HeadBucket') {
        return {};
      }
      return {};
    });
    adapter = await createS3Adapter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw error if config is incomplete', async () => {
      const { S3StorageAdapter } = await import('@/lib/storage/s3.adapter');

      expect(() => new S3StorageAdapter({ provider: 's3', s3IsMinIO: false })).toThrow(
        'S3 configuration is incomplete'
      );
    });

    it('should initialize with valid config', () => {
      expect(adapter).toBeDefined();
    });
  });

  describe('upload', () => {
    it('should upload file to S3', async () => {
      mockS3Send.mockResolvedValueOnce({}); // HeadBucket
      mockS3Send.mockResolvedValueOnce({ ETag: '"abc123"' }); // PutObject

      const content = Buffer.from('test content');
      const result = await adapter.upload('test/file.txt', content, {
        contentType: 'text/plain',
      });

      expect(result).toEqual({
        key: 'test/file.txt',
        url: 'http://localhost:9000/test-bucket/test/file.txt',
        etag: 'abc123',
        size: content.length,
      });
    });

    it('should create bucket if not exists', async () => {
      // First HeadBucket returns 404
      const notFoundError = new Error('Not Found');
      (notFoundError as unknown as { name: string }).name = 'NotFound';
      mockS3Send.mockRejectedValueOnce(notFoundError);
      // CreateBucket succeeds
      mockS3Send.mockResolvedValueOnce({});
      // PutObject succeeds
      mockS3Send.mockResolvedValueOnce({ ETag: '"abc"' });

      // Need to reset adapter to test bucket creation
      const { S3StorageAdapter } = await import('@/lib/storage/s3.adapter');
      const freshAdapter = new S3StorageAdapter(s3Config);

      const result = await freshAdapter.upload('test.txt', Buffer.from('test'), {
        contentType: 'text/plain',
      });

      expect(result.key).toBe('test.txt');
    });

    it('should include metadata in upload', async () => {
      mockS3Send.mockResolvedValueOnce({}); // HeadBucket
      mockS3Send.mockResolvedValueOnce({ ETag: '"abc"' }); // PutObject

      await adapter.upload('test.pdf', Buffer.from('test'), {
        contentType: 'application/pdf',
        metadata: {
          originalFileName: 'document.pdf',
          uploadedBy: 'user-123',
        },
      });

      // Verify PutObject was called with metadata
      const putObjectCall = mockS3Send.mock.calls.find(
        (call) => call[0]._type === 'PutObject'
      );
      expect(putObjectCall?.[0].Metadata).toEqual({
        originalFileName: 'document.pdf',
        uploadedBy: 'user-123',
      });
    });
  });

  describe('download', () => {
    it('should download file from S3', async () => {
      const mockContent = Buffer.from('downloaded content');
      mockS3Send.mockResolvedValueOnce({
        Body: {
          async *[Symbol.asyncIterator]() {
            yield mockContent;
          },
        },
      });

      const result = await adapter.download('test/file.txt');

      expect(result).toEqual(mockContent);
    });

    it('should throw error if file not found', async () => {
      const notFoundError = new Error('NoSuchKey');
      (notFoundError as unknown as { name: string }).name = 'NoSuchKey';
      mockS3Send.mockRejectedValueOnce(notFoundError);

      await expect(adapter.download('nonexistent.txt')).rejects.toThrow(
        'File not found: nonexistent.txt'
      );
    });
  });

  describe('delete', () => {
    it('should delete file from S3', async () => {
      mockS3Send.mockResolvedValueOnce({});

      await adapter.delete('test/file.txt');

      const deleteCall = mockS3Send.mock.calls.find(
        (call) => call[0]._type === 'DeleteObject'
      );
      expect(deleteCall?.[0].Key).toBe('test/file.txt');
    });
  });

  describe('deletePrefix', () => {
    it('should delete all files with prefix', async () => {
      // List returns files
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'prefix/file1.txt' },
          { Key: 'prefix/file2.txt' },
          { Key: 'prefix/subdir/file3.txt' },
        ],
      });
      // DeleteObjects succeeds
      mockS3Send.mockResolvedValueOnce({});

      const count = await adapter.deletePrefix('prefix/');

      expect(count).toBe(3);
    });

    it('should handle empty results', async () => {
      mockS3Send.mockResolvedValueOnce({ Contents: [] });

      const count = await adapter.deletePrefix('nonexistent/');

      expect(count).toBe(0);
    });

    it('should handle pagination', async () => {
      // First page
      mockS3Send.mockResolvedValueOnce({
        Contents: [{ Key: 'prefix/file1.txt' }],
        NextContinuationToken: 'token123',
      });
      // Delete first batch
      mockS3Send.mockResolvedValueOnce({});
      // Second page
      mockS3Send.mockResolvedValueOnce({
        Contents: [{ Key: 'prefix/file2.txt' }],
      });
      // Delete second batch
      mockS3Send.mockResolvedValueOnce({});

      const count = await adapter.deletePrefix('prefix/');

      expect(count).toBe(2);
    });
  });

  describe('exists', () => {
    it('should return true if file exists', async () => {
      mockS3Send.mockResolvedValueOnce({});

      const exists = await adapter.exists('test/file.txt');

      expect(exists).toBe(true);
    });

    it('should return false if file does not exist', async () => {
      const notFoundError = new Error('NotFound');
      (notFoundError as unknown as { name: string }).name = 'NotFound';
      mockS3Send.mockRejectedValueOnce(notFoundError);

      const exists = await adapter.exists('nonexistent.txt');

      expect(exists).toBe(false);
    });
  });

  describe('getSignedUrl', () => {
    it('should generate signed URL', async () => {
      const url = await adapter.getSignedUrl('test/file.txt', 3600);

      expect(url).toBe('https://signed-url.example.com/file');
    });
  });

  describe('getPublicUrl', () => {
    it('should generate public URL', () => {
      const url = adapter.getPublicUrl('test/file.txt');

      expect(url).toBe('http://localhost:9000/test-bucket/test/file.txt');
    });
  });

  describe('getMetadata', () => {
    it('should return file metadata', async () => {
      const lastModified = new Date();
      mockS3Send.mockResolvedValueOnce({
        ContentLength: 1234,
        ContentType: 'application/pdf',
        LastModified: lastModified,
        ETag: '"abc123"',
        Metadata: { custom: 'value' },
      });

      const metadata = await adapter.getMetadata('test/file.pdf');

      expect(metadata).toEqual({
        key: 'test/file.pdf',
        size: 1234,
        contentType: 'application/pdf',
        lastModified,
        etag: 'abc123',
        metadata: { custom: 'value' },
      });
    });

    it('should throw error if file not found', async () => {
      const notFoundError = new Error('NotFound');
      (notFoundError as unknown as { name: string }).name = 'NotFound';
      mockS3Send.mockRejectedValueOnce(notFoundError);

      await expect(adapter.getMetadata('nonexistent.txt')).rejects.toThrow(
        'File not found: nonexistent.txt'
      );
    });
  });

  describe('list', () => {
    it('should list files with prefix', async () => {
      const lastModified = new Date();
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'prefix/file1.txt', Size: 100, LastModified: lastModified, ETag: '"a"' },
          { Key: 'prefix/file2.txt', Size: 200, LastModified: lastModified, ETag: '"b"' },
        ],
      });

      const files = await adapter.list('prefix/');

      expect(files).toHaveLength(2);
      expect(files[0]).toEqual({
        key: 'prefix/file1.txt',
        size: 100,
        lastModified,
        etag: 'a',
      });
    });

    it('should respect maxKeys limit', async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'file1.txt', Size: 100, LastModified: new Date() },
        ],
      });

      await adapter.list('prefix/', 10);

      const listCall = mockS3Send.mock.calls.find(
        (call) => call[0]._type === 'ListObjectsV2'
      );
      expect(listCall?.[0].MaxKeys).toBe(10);
    });
  });

  describe('copy', () => {
    it('should copy file to new location', async () => {
      mockS3Send.mockResolvedValueOnce({});

      await adapter.copy('source/file.txt', 'dest/file.txt');

      const copyCall = mockS3Send.mock.calls.find(
        (call) => call[0]._type === 'CopyObject'
      );
      expect(copyCall?.[0].Key).toBe('dest/file.txt');
      expect(copyCall?.[0].CopySource).toBe('test-bucket/source/file.txt');
    });
  });

  describe('move', () => {
    it('should move file (copy + delete)', async () => {
      mockS3Send.mockResolvedValueOnce({}); // Copy
      mockS3Send.mockResolvedValueOnce({}); // Delete

      await adapter.move('source/file.txt', 'dest/file.txt');

      const copyCall = mockS3Send.mock.calls.find(
        (call) => call[0]._type === 'CopyObject'
      );
      const deleteCall = mockS3Send.mock.calls.find(
        (call) => call[0]._type === 'DeleteObject'
      );

      expect(copyCall).toBeDefined();
      expect(deleteCall).toBeDefined();
    });
  });
});

describe('Storage Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getStorageConfig', () => {
    it('should return S3 config when STORAGE_PROVIDER is s3', async () => {
      process.env.STORAGE_PROVIDER = 's3';
      process.env.S3_ENDPOINT = 'http://localhost:9000';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_BUCKET = 'oakcloud';
      process.env.S3_ACCESS_KEY = 'test';
      process.env.S3_SECRET_KEY = 'secret';

      vi.resetModules();
      const { getStorageConfig } = await import('@/lib/storage/config');
      const config = getStorageConfig();

      expect(config.provider).toBe('s3');
      expect(config.s3Endpoint).toBe('http://localhost:9000');
      expect(config.s3Bucket).toBe('oakcloud');
    });

    it('should return local config when STORAGE_PROVIDER is local', async () => {
      process.env.STORAGE_PROVIDER = 'local';
      process.env.STORAGE_LOCAL_PATH = './uploads';

      vi.resetModules();
      const { getStorageConfig } = await import('@/lib/storage/config');
      const config = getStorageConfig();

      expect(config.provider).toBe('local');
      expect(config.localPath).toBe('./uploads');
    });
  });

  describe('validateStorageConfig', () => {
    it('should throw error for invalid S3 config', async () => {
      vi.resetModules();
      const { validateStorageConfig } = await import('@/lib/storage/config');

      // Manually create an incomplete S3 config (without bucket)
      const incompleteConfig = {
        provider: 's3' as const,
        s3Endpoint: 'http://localhost:9000',
        s3Region: 'us-east-1',
        s3Bucket: '', // Empty bucket should cause validation error
        s3AccessKey: 'key',
        s3SecretKey: 'secret',
        s3ForcePathStyle: true,
        s3UseSsl: false,
        s3IsMinIO: true,
      };

      expect(() => validateStorageConfig(incompleteConfig)).toThrow('S3_BUCKET is required');
    });

    it('should throw error for invalid provider', async () => {
      vi.resetModules();
      const { validateStorageConfig } = await import('@/lib/storage/config');

      const invalidConfig = {
        provider: 'invalid' as 's3',
        s3IsMinIO: false,
      };

      expect(() => validateStorageConfig(invalidConfig)).toThrow('Invalid STORAGE_PROVIDER');
    });

    it('should not throw for valid S3 config', async () => {
      process.env.STORAGE_PROVIDER = 's3';
      process.env.S3_ENDPOINT = 'http://localhost:9000';
      process.env.S3_BUCKET = 'test';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';

      vi.resetModules();
      const { getStorageConfig, validateStorageConfig } = await import(
        '@/lib/storage/config'
      );
      const config = getStorageConfig();

      expect(() => validateStorageConfig(config)).not.toThrow();
    });
  });
});

describe('Storage Integration', () => {
  describe('Document lifecycle', () => {
    it('should support complete document workflow', () => {
      const tenantId = 'tenant-1';
      const companyId = 'company-1';
      const documentId = 'doc-1';

      // 1. Generate upload key
      const uploadKey = StorageKeys.documentOriginal(tenantId, companyId, documentId, '.pdf');
      expect(uploadKey).toContain(tenantId);
      expect(uploadKey).toContain(companyId);
      expect(uploadKey).toContain(documentId);

      // 2. Generate page keys
      const page1Key = StorageKeys.documentPage(tenantId, companyId, documentId, 1);
      const page2Key = StorageKeys.documentPage(tenantId, companyId, documentId, 2);
      expect(page1Key).toContain('/pages/1.png');
      expect(page2Key).toContain('/pages/2.png');

      // 3. Generate derived file key
      const derivedKey = StorageKeys.derivedFile(tenantId, companyId, documentId, 'thumbnail', 'thumb.jpg');
      expect(derivedKey).toContain('/derived/');

      // 4. Get prefix for cleanup
      const prefix = StorageKeys.documentPrefix(tenantId, companyId, documentId);
      expect(prefix.endsWith('/')).toBe(true);

      // All keys should start with same prefix
      expect(uploadKey.startsWith(prefix)).toBe(true);
      expect(page1Key.startsWith(prefix)).toBe(true);
      expect(derivedKey.startsWith(prefix)).toBe(true);
    });
  });

  describe('Multi-tenant isolation', () => {
    it('should generate isolated keys per tenant', () => {
      const tenant1 = 'tenant-aaa';
      const tenant2 = 'tenant-bbb';
      const companyId = 'company-1';
      const docId = 'doc-1';

      const key1 = StorageKeys.documentOriginal(tenant1, companyId, docId, '.pdf');
      const key2 = StorageKeys.documentOriginal(tenant2, companyId, docId, '.pdf');

      expect(key1).not.toBe(key2);
      expect(key1.startsWith(tenant1)).toBe(true);
      expect(key2.startsWith(tenant2)).toBe(true);
    });
  });
});
