/**
 * GET /api/admin/backup/full/[id]/download - Download the password-locked backup file
 *
 * SUPER_ADMIN only
 */

import { NextRequest, NextResponse } from 'next/server';
import { downloadFullBackup } from '@/services/backup/full/full-backup.service';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../route-helpers';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { fileName, content } = await downloadFullBackup(id);
    return new NextResponse(new Uint8Array(content), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(content.length),
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to download full backup:');
  }
}
