import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { storage, StorageKeys } from '@/lib/storage';
import { routeErrorResponse } from '@/lib/api-route-errors';

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760'); // 10MB

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check permission
    await requirePermission(session, 'document', 'read', id);

    if (!(await canAccessCompany(session, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const latestOnly = searchParams.get('latest') !== 'false';

    const documents = await prisma.document.findMany({
      where: {
        companyId: id,
        ...(type && { documentType: type }),
        ...(latestOnly && { isLatest: true }),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        documentType: true,
        originalFileName: true,
        fileSize: true,
        extractionStatus: true,
        extractedAt: true,
        version: true,
        isLatest: true,
        createdAt: true,
        uploadedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return NextResponse.json(documents);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id: companyId } = await params;

    // Check permission
    await requirePermission(session, 'document', 'create', companyId);

    // Check company access
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify company exists
    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company || company.deletedAt) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const documentType = (formData.get('documentType') as string) || 'BIZFILE';

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

    // Validate file type
    const allowedTypes = ['application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Only PDF files are allowed' },
        { status: 400 }
      );
    }

    // Generate unique document ID and filename
    const documentId = uuidv4();
    const fileName = `${documentId}.pdf`;

    // Generate storage key for company document
    const storageKey = StorageKeys.documentOriginal(company.tenantId, companyId, documentId, fileName);

    // Upload file to storage
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await storage.upload(storageKey, buffer, {
      contentType: file.type,
      metadata: {
        originalFileName: file.name,
        uploadedBy: session.id,
        companyId,
        tenantId: company.tenantId,
      },
    });

    // Get previous version count
    const previousVersion = await prisma.document.findFirst({
      where: {
        companyId,
        documentType,
        isLatest: true,
      },
      select: { id: true, version: true },
    });

    // Mark previous version as not latest
    if (previousVersion) {
      await prisma.document.update({
        where: { id: previousVersion.id },
        data: { isLatest: false },
      });
    }

    // Create document record
    const document = await prisma.document.create({
      data: {
        id: documentId, // Use the generated ID
        tenantId: company.tenantId,
        companyId,
        uploadedById: session.id,
        documentType,
        fileName,
        originalFileName: file.name,
        storageKey,
        fileSize: file.size,
        mimeType: file.type,
        version: previousVersion ? previousVersion.version + 1 : 1,
        previousVersionId: previousVersion?.id,
        extractionStatus: 'PENDING',
      },
    });

    // Create audit log
    await createAuditLog({
      tenantId: company.tenantId,
      userId: session.id,
      companyId,
      action: 'UPLOAD',
      entityType: 'Document',
      entityId: document.id,
      entityName: file.name,
      summary: `Uploaded document "${file.name}" (${documentType}, v${document.version})`,
      changeSource: 'MANUAL',
      metadata: {
        documentType,
        fileName: file.name,
        fileSize: file.size,
        version: document.version,
      },
    });

    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    console.error('Document upload error:', error);
    return routeErrorResponse(error, { fallback: 'bad-request' });
  }
}
