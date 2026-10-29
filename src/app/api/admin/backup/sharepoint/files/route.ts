/**
 * GET  /api/admin/backup/sharepoint/files - Backup files in the SharePoint backup folder
 * POST /api/admin/backup/sharepoint/files - Copy one of them onto this install to restore it
 *
 * SUPER_ADMIN only
 */

import { NextRequest, NextResponse } from 'next/server';
import { sharePointBackupImportSchema } from '@/lib/validations/backup';
import { importSharePointBackup } from '@/services/backup/full/full-backup.service';
import { listSharePointBackupFiles } from '@/services/backup/full/sharepoint-target';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../full/route-helpers';

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json(await listSharePointBackupFiles());
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to list SharePoint backups:');
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSuperAdmin();
    const { itemId } = sharePointBackupImportSchema.parse(await request.json());
    return NextResponse.json(await importSharePointBackup(itemId, session.id), { status: 202 });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to copy the backup from SharePoint:');
  }
}
