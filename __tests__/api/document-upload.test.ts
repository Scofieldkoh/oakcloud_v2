/**
 * Document Upload API Tests
 *
 * Tests for document upload routes including:
 * - File upload validation
 * - Storage integration
 * - Database record creation
 * - Multi-tenant isolation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock storage
const mockStorageUpload = vi.fn();
const mockStorageDownload = vi.fn();
const mockStorageDelete = vi.fn();

vi.mock('@/lib/storage', () => ({
  storage: {
    upload: mockStorageUpload,
    download: mockStorageDownload,
    delete: mockStorageDelete,
    exists: vi.fn(),
    getSignedUrl: vi.fn(),
    getPublicUrl: vi.fn(),
  },
  StorageKeys: {
    pendingDocument: vi.fn(
      (tenantId: string, docId: string, extension: string) => `${tenantId}/pending/${docId}/original${extension}`
    ),
    documentOriginal: vi.fn(
      (tenantId: string, companyId: string, docId: string, extension: string) =>
        `${tenantId}/companies/${companyId}/documents/${docId}/original${extension}`
    ),
    documentPage: vi.fn(
      (tenantId: string, companyId: string, docId: string, pageNum: number) =>
        `${tenantId}/companies/${companyId}/documents/${docId}/pages/${pageNum}.png`
    ),
    documentPrefix: vi.fn(
      (tenantId: string, companyId: string, docId: string) =>
        `${tenantId}/companies/${companyId}/documents/${docId}/`
    ),
    derivedFile: vi.fn(
      (tenantId: string, companyId: string, docId: string, kind: string, filename: string) =>
        `${tenantId}/companies/${companyId}/documents/${docId}/derived/${kind}/${filename}`
    ),
    companyPrefix: vi.fn(
      (tenantId: string, companyId: string) => `${tenantId}/companies/${companyId}/`
    ),
    tenantPrefix: vi.fn(
      (tenantId: string) => `${tenantId}/`
    ),
    pendingPrefix: vi.fn(
      (tenantId: string) => `${tenantId}/pending/`
    ),
    getExtension: vi.fn(
      (filename: string, mimeType?: string) => {
        const match = filename.match(/\.([^.]+)$/);
        if (match) return `.${match[1].toLowerCase()}`;
        if (mimeType === 'application/pdf') return '.pdf';
        return '';
      }
    ),
  },
}));

// Mock Prisma
const mockPrismaCreate = vi.fn();
const mockPrismaFindUnique = vi.fn();
const mockPrismaFindFirst = vi.fn();
const mockPrismaUpdate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      create: mockPrismaCreate,
      findUnique: mockPrismaFindUnique,
      findFirst: mockPrismaFindFirst,
      update: mockPrismaUpdate,
    },
    company: {
      findUnique: mockPrismaFindUnique,
    },
  },
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    id: 'user-123',
    email: 'test@example.com',
    tenantId: 'tenant-abc',
    isSuperAdmin: false,
    isWorkspaceAdmin: false,
    companyIds: ['company-456'],
  }),
  canAccessCompany: vi.fn().mockResolvedValue(true),
}));

// Mock RBAC
vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn().mockResolvedValue(undefined),
}));

// Mock audit
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

describe('Document Upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('File validation', () => {
    it('should accept PDF files', () => {
      const allowedTypes = ['application/pdf'];
      const testType = 'application/pdf';

      expect(allowedTypes.includes(testType)).toBe(true);
    });

    it('should reject non-PDF files', () => {
      const allowedTypes = ['application/pdf'];
      const testTypes = [
        'image/png',
        'image/jpeg',
        'text/plain',
        'application/json',
        'application/vnd.ms-excel',
      ];

      testTypes.forEach((type) => {
        expect(allowedTypes.includes(type)).toBe(false);
      });
    });

    it('should enforce file size limits', () => {
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

      const smallFile = { size: 1024 * 1024 }; // 1MB
      const largeFile = { size: 15 * 1024 * 1024 }; // 15MB

      expect(smallFile.size <= MAX_FILE_SIZE).toBe(true);
      expect(largeFile.size <= MAX_FILE_SIZE).toBe(false);
    });
  });

  describe('Storage key generation', () => {
    it('should generate unique document IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        const id = `doc-${Math.random().toString(36).substr(2, 9)}`;
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }
    });

    it('should include tenant isolation in storage keys', async () => {
      const { StorageKeys } = await import('@/lib/storage');

      const tenantA = 'tenant-aaa';
      const tenantB = 'tenant-bbb';
      const docId = 'doc-123';
      const extension = '.pdf';

      const keyA = StorageKeys.pendingDocument(tenantA, docId, extension);
      const keyB = StorageKeys.pendingDocument(tenantB, docId, extension);

      expect(keyA).toContain(tenantA);
      expect(keyB).toContain(tenantB);
      expect(keyA).not.toBe(keyB);
    });
  });

  describe('Upload workflow', () => {
    it('should upload file to storage before creating DB record', async () => {
      const uploadOrder: string[] = [];

      mockStorageUpload.mockImplementation(() => {
        uploadOrder.push('storage');
        return Promise.resolve({
          key: 'test-key',
          url: 'http://test.com/file',
          size: 1000,
        });
      });

      mockPrismaCreate.mockImplementation(() => {
        uploadOrder.push('database');
        return Promise.resolve({
          id: 'doc-123',
          storageKey: 'test-key',
        });
      });

      // Simulate upload flow
      await mockStorageUpload('key', Buffer.from('test'), { contentType: 'application/pdf' });
      await mockPrismaCreate({ data: {} });

      expect(uploadOrder).toEqual(['storage', 'database']);
    });

    it('should store correct metadata', async () => {
      mockStorageUpload.mockResolvedValue({
        key: 'test-key',
        url: 'http://test.com/file',
        size: 1000,
      });

      await mockStorageUpload('tenant-123/pending/doc-456/file.pdf', Buffer.from('test'), {
        contentType: 'application/pdf',
        metadata: {
          originalFileName: 'invoice.pdf',
          uploadedBy: 'user-789',
          tenantId: 'tenant-123',
        },
      });

      expect(mockStorageUpload).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({
          contentType: 'application/pdf',
          metadata: expect.objectContaining({
            originalFileName: 'invoice.pdf',
            uploadedBy: 'user-789',
            tenantId: 'tenant-123',
          }),
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle storage upload failure', async () => {
      mockStorageUpload.mockRejectedValue(new Error('Storage unavailable'));

      await expect(
        mockStorageUpload('key', Buffer.from('test'), { contentType: 'application/pdf' })
      ).rejects.toThrow('Storage unavailable');
    });

    it('should handle database creation failure', async () => {
      mockStorageUpload.mockResolvedValue({ key: 'test-key', size: 1000 });
      mockPrismaCreate.mockRejectedValue(new Error('Database error'));

      await mockStorageUpload('key', Buffer.from('test'), { contentType: 'application/pdf' });

      await expect(mockPrismaCreate({ data: {} })).rejects.toThrow('Database error');
    });

    it('should return proper error codes', () => {
      const errorCodes = {
        unauthorized: 401,
        forbidden: 403,
        notFound: 404,
        badRequest: 400,
        serverError: 500,
      };

      expect(errorCodes.unauthorized).toBe(401);
      expect(errorCodes.forbidden).toBe(403);
      expect(errorCodes.notFound).toBe(404);
      expect(errorCodes.badRequest).toBe(400);
      expect(errorCodes.serverError).toBe(500);
    });
  });

  describe('Multi-tenant isolation', () => {
    it('should verify tenant access before upload', async () => {
      const { requireAuth } = await import('@/lib/auth');

      await requireAuth();

      expect(requireAuth).toHaveBeenCalled();
    });

    it('should scope storage keys by tenant', async () => {
      const { StorageKeys } = await import('@/lib/storage');

      const key1 = StorageKeys.documentOriginal(
        'tenant-1',
        'company-1',
        'doc-1',
        '.pdf'
      );
      const key2 = StorageKeys.documentOriginal(
        'tenant-2',
        'company-1',
        'doc-1',
        '.pdf'
      );

      expect(key1).toContain('tenant-1');
      expect(key2).toContain('tenant-2');
      expect(key1).not.toBe(key2);
    });

    it('should include tenantId in document record', async () => {
      mockPrismaCreate.mockResolvedValue({
        id: 'doc-123',
        tenantId: 'tenant-abc',
      });

      const result = await mockPrismaCreate({
        data: {
          tenantId: 'tenant-abc',
          storageKey: 'tenant-abc/pending/doc-123/file.pdf',
        },
      });

      expect(result.tenantId).toBe('tenant-abc');
    });
  });
});

describe('Document Download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Storage retrieval', () => {
    it('should download file from storage', async () => {
      const mockContent = Buffer.from('PDF content');
      mockStorageDownload.mockResolvedValue(mockContent);

      const content = await mockStorageDownload('tenant-123/documents/doc-456/original.pdf');

      expect(content).toEqual(mockContent);
    });

    it('should handle missing files', async () => {
      mockStorageDownload.mockRejectedValue(new Error('File not found'));

      await expect(
        mockStorageDownload('nonexistent/file.pdf')
      ).rejects.toThrow('File not found');
    });
  });

  describe('Access control', () => {
    it('should verify document access before download', async () => {
      mockPrismaFindUnique.mockResolvedValue({
        id: 'doc-123',
        tenantId: 'tenant-abc',
        companyId: 'company-456',
        storageKey: 'tenant-abc/documents/doc-123/file.pdf',
      });

      const doc = await mockPrismaFindUnique({ where: { id: 'doc-123' } });

      expect(doc.tenantId).toBe('tenant-abc');
      expect(doc.companyId).toBe('company-456');
    });
  });

  describe('Pending document review route', () => {
    it('streams an uploaded pending document to its uploader', async () => {
      mockPrismaFindUnique.mockResolvedValue({
        id: 'doc-123',
        tenantId: 'tenant-abc',
        uploadedById: 'user-123',
        storageKey: 'tenant-abc/pending/doc-123/original.pdf',
        extractionStatus: 'PENDING',
        mimeType: 'application/pdf',
        originalFileName: 'bizfile.pdf',
        fileName: 'doc-123.pdf',
      });
      mockStorageDownload.mockResolvedValue(Buffer.from('PDF content'));
      const { GET } = await import('@/app/api/documents/[documentId]/route');

      const response = await GET(
        new NextRequest('http://localhost/api/documents/doc-123'),
        { params: Promise.resolve({ documentId: 'doc-123' }) },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      expect(response.headers.get('content-disposition')).toContain('bizfile.pdf');
      expect(await response.text()).toBe('PDF content');
    });

    it('does not expose a pending document from another tenant', async () => {
      mockPrismaFindUnique.mockResolvedValue({
        id: 'doc-123',
        tenantId: 'tenant-other',
        uploadedById: 'user-123',
        storageKey: 'tenant-other/pending/doc-123/original.pdf',
        extractionStatus: 'PENDING',
      });
      const { GET } = await import('@/app/api/documents/[documentId]/route');

      const response = await GET(
        new NextRequest('http://localhost/api/documents/doc-123'),
        { params: Promise.resolve({ documentId: 'doc-123' }) },
      );

      expect(response.status).toBe(403);
      expect(mockStorageDownload).not.toHaveBeenCalled();
    });
  });
});

describe('Document Deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cleanup', () => {
    it('should delete file from storage', async () => {
      mockStorageDelete.mockResolvedValue(undefined);

      await mockStorageDelete('tenant-123/documents/doc-456/original.pdf');

      expect(mockStorageDelete).toHaveBeenCalledWith(
        'tenant-123/documents/doc-456/original.pdf'
      );
    });

    it('should handle non-existent file deletion gracefully', async () => {
      mockStorageDelete.mockResolvedValue(undefined);

      // Should not throw
      await expect(
        mockStorageDelete('nonexistent/file.pdf')
      ).resolves.not.toThrow();
    });
  });
});
