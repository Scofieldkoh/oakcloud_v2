/**
 * PUT  /api/admin/backup/full/uploads/[id] - Append one chunk (raw body, `X-Upload-Offset` header)
 * POST /api/admin/backup/full/uploads/[id] - Finish the upload
 *
 * Chunks stay under the 10 MB request limit of the API middleware and
 * Cloudflare's upload limit. SUPER_ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { appendBackupUploadChunk, completeBackupUpload } from '@/services/backup/full/full-backup.service';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../route-helpers';

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const offset = Number(request.headers.get('x-upload-offset'));
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Missing upload offset');
    const chunk = Buffer.from(await request.arrayBuffer());
    return NextResponse.json(await appendBackupUploadChunk(id, offset, chunk));
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to receive backup chunk:');
  }
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireSuperAdmin();
    const { id } = await params;
    await completeBackupUpload(id, session.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to finish backup upload:');
  }
}
