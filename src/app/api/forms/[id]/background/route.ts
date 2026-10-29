import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { storage, StorageKeys } from '@/lib/storage';
import { ALLOWED_FILE_TYPES, validateFileContent } from '@/lib/file-validation';
import { getFormBackgroundPublicUrl } from '@/lib/form-background-url';

const MAX_BACKGROUND_SIZE_BYTES = 5 * 1024 * 1024;
const CLIENT_ALLOWED_BACKGROUND_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

interface UploadedBackgroundFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function isUploadedBackgroundFile(value: FormDataEntryValue | null): boolean {
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

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const { id } = await params;

    const form = await prisma.form.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!isUploadedBackgroundFile(file)) {
      return NextResponse.json({ error: 'Background image file is required' }, { status: 400 });
    }

    const backgroundFile = file as unknown as UploadedBackgroundFile;

    if (backgroundFile.size > MAX_BACKGROUND_SIZE_BYTES) {
      return NextResponse.json({ error: 'Background image must be 5MB or smaller' }, { status: 400 });
    }

    if (!CLIENT_ALLOWED_BACKGROUND_MIME_TYPES.includes(backgroundFile.type)) {
      return NextResponse.json({ error: 'Only image files (PNG, JPG, WebP, GIF) are allowed' }, { status: 400 });
    }

    const buffer = Buffer.from(await backgroundFile.arrayBuffer());
    const validation = validateFileContent(buffer, ALLOWED_FILE_TYPES.IMAGE, backgroundFile.type);

    if (!validation.valid || !validation.ext || !validation.mime) {
      return NextResponse.json(
        { error: validation.error || 'Only image files (PNG, JPG, WebP, GIF) are allowed' },
        { status: 400 }
      );
    }

    const extension = validation.ext === 'jpg' ? '.jpg' : `.${validation.ext}`;
    // A new key per upload: the file is served with an immutable cache header, so
    // reusing one key would keep showing the old image after a replace.
    const storageKey = StorageKeys.formBackground(tenantId, id, extension, Date.now().toString(36));
    await storage.upload(storageKey, buffer, {
      contentType: validation.mime,
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: {
        originalFileName: backgroundFile.name,
        uploadedBy: session.id,
        tenantId,
        formId: id,
      },
    });

    return NextResponse.json({ backgroundImageUrl: getFormBackgroundPublicUrl(storageKey) }, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
