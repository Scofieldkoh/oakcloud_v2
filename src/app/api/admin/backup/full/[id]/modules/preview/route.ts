/**
 * POST /api/admin/backup/full/[id]/modules/preview - What restoring the chosen modules would change
 *
 * Changes nothing. SUPER_ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { moduleRestorePreviewSchema } from '@/lib/validations/backup';
import { previewModuleRestore } from '@/services/backup/full/full-backup.service';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../../route-helpers';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { password, modules } = moduleRestorePreviewSchema.parse(await request.json());
    return NextResponse.json(await previewModuleRestore(id, password, modules));
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to check the module restore:');
  }
}
