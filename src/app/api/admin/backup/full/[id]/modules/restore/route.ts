/**
 * POST /api/admin/backup/full/[id]/modules/restore - Replace the chosen modules with the backup's records
 *
 * Requires the backup password and the typed confirmation. Runs in the
 * background; poll GET /api/admin/backup/full/[id] for progress.
 * SUPER_ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { moduleRestoreSchema } from '@/lib/validations/backup';
import { startModuleRestore } from '@/services/backup/full/full-backup.service';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../../route-helpers';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireSuperAdmin();
    const { id } = await params;
    const body = moduleRestoreSchema.parse(await request.json());
    await startModuleRestore({ backupId: id, ...body, userId: session.id });
    return NextResponse.json({ started: true }, { status: 202 });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to start the module restore:');
  }
}
