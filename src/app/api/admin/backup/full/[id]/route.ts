/**
 * GET    /api/admin/backup/full/[id] - Full backup details (used to poll progress)
 * DELETE /api/admin/backup/full/[id] - Delete a full backup and its file
 *
 * SUPER_ADMIN only
 */

import { NextRequest, NextResponse } from 'next/server';
import { deleteFullBackup, getFullBackup, serializeSystemBackup } from '@/services/backup/full/full-backup.service';
import { fullBackupErrorResponse, requireSuperAdmin } from '../route-helpers';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    return NextResponse.json(serializeSystemBackup(await getFullBackup(id)));
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to get full backup:');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireSuperAdmin();
    const { id } = await params;
    await deleteFullBackup(id, session.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to delete full backup:');
  }
}
