import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { isWorkspaceLogoStorageKey } from '@/lib/workspace-logo-url';
import { isFormBackgroundStorageKey } from '@/lib/form-background-url';

interface RouteParams {
  params: Promise<{ key: string[] }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { key } = await params;
  let storageKey: string;

  try {
    storageKey = decodeURIComponent(key.join('/'));
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!isWorkspaceLogoStorageKey(storageKey) && !isFormBackgroundStorageKey(storageKey)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const [content, metadata] = await Promise.all([
      storage.download(storageKey),
      storage.getMetadata(storageKey),
    ]);

    const body = new ArrayBuffer(content.byteLength);
    new Uint8Array(body).set(content);

    return new Response(body, {
      headers: {
        'Content-Type': metadata.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('File not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to load file' }, { status: 500 });
  }
}
