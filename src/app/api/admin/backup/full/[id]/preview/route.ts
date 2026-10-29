/**
 * POST /api/admin/backup/full/[id]/preview - Unlock and check a backup, and say what a restore would do
 *
 * Changes nothing. SUPER_ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fullRestoreSchema } from '@/lib/validations/backup';
import { previewFullRestore } from '@/services/backup/full/full-backup.service';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../route-helpers';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { password } = fullRestoreSchema.parse(await request.json());
    return NextResponse.json(await previewFullRestore(id, password));
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to check full backup:');
  }
}
