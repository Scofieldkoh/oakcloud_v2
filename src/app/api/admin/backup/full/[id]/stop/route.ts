/**
 * POST /api/admin/backup/full/[id]/stop - Stop a full backup that is being made
 *
 * The backup is marked stopped at once; the running job abandons its snapshot
 * at its next checkpoint. Live data is never changed. SUPER_ADMIN only.
 */

import { NextResponse } from 'next/server';
import { stopFullBackup } from '@/services/backup/full/full-backup.service';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../route-helpers';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const session = await requireSuperAdmin();
    const { id } = await params;
    await stopFullBackup(id, session.id);
    return NextResponse.json({ stopped: true });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to stop the backup:');
  }
}
