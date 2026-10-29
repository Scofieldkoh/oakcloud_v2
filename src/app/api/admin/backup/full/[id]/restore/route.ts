/**
 * POST /api/admin/backup/full/[id]/restore - Replace everything in this install with the backup
 *
 * Requires the backup password and the typed confirmation. Runs in the
 * background; poll GET /api/admin/backup/full/[id] for progress.
 * SUPER_ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fullRestoreSchema } from '@/lib/validations/backup';
import { startFullRestore } from '@/services/backup/full/full-backup.service';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../route-helpers';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireSuperAdmin();
    const { id } = await params;
    const { password, confirmation } = fullRestoreSchema.parse(await request.json());
    await startFullRestore({ backupId: id, password, confirmation, userId: session.id });
    return NextResponse.json({ started: true }, { status: 202 });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to start full restore:');
  }
}
