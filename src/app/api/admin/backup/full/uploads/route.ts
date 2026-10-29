/**
 * POST /api/admin/backup/full/uploads - Start uploading a backup file from another install
 *
 * SUPER_ADMIN only
 */

import { NextRequest, NextResponse } from 'next/server';
import { startBackupUploadSchema } from '@/lib/validations/backup';
import { startBackupUpload } from '@/services/backup/full/full-backup.service';
import { fullBackupErrorResponse, requireSuperAdmin } from '../route-helpers';

export async function POST(request: NextRequest) {
  try {
    const session = await requireSuperAdmin();
    const body = startBackupUploadSchema.parse(await request.json());
    return NextResponse.json(await startBackupUpload({ ...body, userId: session.id }), { status: 201 });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to start backup upload:');
  }
}
