import { NextResponse } from 'next/server';
import { canManageWorkspace, requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { storage, StorageKeys } from '@/lib/storage';
import { ALLOWED_FILE_TYPES, validateFileContent } from '@/lib/file-validation';
import { getWorkspaceLogoPublicUrl, normalizeWorkspaceLogoUrl } from '@/lib/workspace-logo-url';

const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
const CLIENT_ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

interface UploadedLogoFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function workspaceResponse(workspace: { id: string; name: string; logoUrl: string | null }) {
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      logoUrl: normalizeWorkspaceLogoUrl(workspace.logoUrl),
    },
  };
}

function isUploadedLogoFile(value: FormDataEntryValue | null): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'type' in value &&
    'size' in value &&
    'arrayBuffer' in value &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.size === 'number' &&
    typeof value.arrayBuffer === 'function'
  );
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    }

    if (!canManageWorkspace(session, workspaceId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const existing = await prisma.workspace.findUnique({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true, name: true, logoUrl: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!isUploadedLogoFile(file)) {
      return NextResponse.json({ error: 'Logo file is required' }, { status: 400 });
    }

    const logoFile = file as unknown as UploadedLogoFile;

    if (logoFile.size > MAX_LOGO_SIZE_BYTES) {
      return NextResponse.json({ error: 'Logo file must be 2MB or smaller' }, { status: 400 });
    }

    if (!CLIENT_ALLOWED_LOGO_MIME_TYPES.includes(logoFile.type)) {
      return NextResponse.json({ error: 'Only image files (PNG, JPG, WebP, GIF) are allowed' }, { status: 400 });
    }

    const buffer = Buffer.from(await logoFile.arrayBuffer());
    const validation = validateFileContent(buffer, ALLOWED_FILE_TYPES.IMAGE, logoFile.type);

    if (!validation.valid || !validation.ext || !validation.mime) {
      return NextResponse.json(
        { error: validation.error || 'Only image files (PNG, JPG, WebP, GIF) are allowed' },
        { status: 400 }
      );
    }

    const extension = validation.ext === 'jpg' ? '.jpg' : `.${validation.ext}`;
    const storageKey = StorageKeys.tenantLogo(workspaceId, extension);
    await storage.upload(storageKey, buffer, {
      contentType: validation.mime,
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: {
        originalFileName: logoFile.name,
        uploadedBy: session.id,
        tenantId: workspaceId,
      },
    });
    const logoUrl = getWorkspaceLogoPublicUrl(storageKey);

    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { logoUrl },
      select: { id: true, name: true, logoUrl: true },
    });

    await createAuditLog({
      tenantId: workspaceId,
      userId: session.id,
      action: 'TENANT_UPDATED',
      entityType: 'Workspace',
      entityId: workspaceId,
      entityName: workspace.name,
      summary: `Updated workspace logo for "${workspace.name}"`,
      changeSource: 'MANUAL',
      changes: {
        logoUrl: { old: existing.logoUrl, new: workspace.logoUrl },
      },
      metadata: {
        originalFileName: logoFile.name,
        sizeBytes: logoFile.size,
        mimeType: validation.mime,
      },
    });

    return NextResponse.json(workspaceResponse(workspace), { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
