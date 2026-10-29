import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { storage, StorageKeys } from '@/lib/storage';
import { validateFileContent, ALLOWED_FILE_TYPES } from '@/lib/file-validation';
import { HTTP_STATUS } from '@/lib/constants/application';

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760'); // 10MB

// Supported file types for BizFile extraction (used for client-side MIME check as first pass)
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
] as const;

// Map detected file types to extensions
const EXT_TO_FILE_EXT: Record<string, string> = {
  'pdf': '.pdf',
  'png': '.png',
  'jpg': '.jpg',
  'webp': '.webp',
};

/**
 * POST /api/documents/upload
 *
 * Upload a document without an existing company (for BizFile extraction flow).
 * Creates a pending document that can be processed and linked to a company.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const documentType = (formData.get('documentType') as string) || 'BIZFILE';
    const tenantIdFromForm = formData.get('tenantId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // First pass: Check client-provided MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
      return NextResponse.json(
        { error: 'Only PDF and image files (PNG, JPG, WebP) are allowed' },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    // Read file content for server-side validation
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // SECURITY: Server-side content validation to prevent MIME type spoofing
    const contentValidation = validateFileContent(buffer, ALLOWED_FILE_TYPES.BIZFILE, file.type);
    if (!contentValidation.valid) {
      return NextResponse.json(
        { error: contentValidation.error || 'Invalid file content' },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    // Determine tenant ID
    let tenantId: string;
    if (session.isSuperAdmin) {
      // SUPER_ADMIN must provide tenant ID
      if (!tenantIdFromForm) {
        return NextResponse.json(
          { error: 'Tenant ID is required for Super Admin uploads' },
          { status: 400 }
        );
      }
      // Verify tenant exists
      const tenant = await prisma.workspace.findUnique({
        where: { id: tenantIdFromForm },
      });
      if (!tenant || tenant.deletedAt) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
      }
      tenantId = tenantIdFromForm;
    } else {
      // Regular users use their session tenant
      if (!session.tenantId) {
        return NextResponse.json({ error: 'No tenant association' }, { status: 403 });
      }
      tenantId = session.tenantId;
    }

    // Generate unique document ID and filename
    // Use detected file extension from content validation (more reliable than client MIME)
    const documentId = uuidv4();
    const fileExt = EXT_TO_FILE_EXT[contentValidation.ext || 'pdf'] || '.pdf';
    const fileName = `${documentId}${fileExt}`;

    // Generate storage key for pending document
    const storageKey = StorageKeys.pendingDocument(tenantId, documentId, fileName);

    // Upload file to storage (reuse buffer from content validation)
    // Use detected MIME type (more reliable than client-provided)
    const detectedMimeType = contentValidation.mime || file.type;
    await storage.upload(storageKey, buffer, {
      contentType: detectedMimeType,
      metadata: {
        originalFileName: file.name,
        uploadedBy: session.id,
        tenantId,
      },
    });

    // Create document record without company association
    const document = await prisma.document.create({
      data: {
        id: documentId, // Use the generated ID
        tenantId,
        uploadedById: session.id,
        documentType,
        fileName,
        originalFileName: file.name,
        storageKey,
        fileSize: file.size,
        mimeType: detectedMimeType,
        version: 1,
        extractionStatus: 'PENDING',
      },
    });

    return NextResponse.json(
      {
        documentId: document.id,
        fileName: document.originalFileName,
        fileSize: document.fileSize,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Document upload error:', error);
    return createErrorResponse(error);
  }
}
