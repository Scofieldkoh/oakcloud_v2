/**
 * GET  /api/admin/backup/full - List full backups
 * POST /api/admin/backup/full - Start a full backup
 *
 * SUPER_ADMIN only
 */

import { NextRequest, NextResponse } from 'next/server';
import { createFullBackupSchema } from '@/lib/validations/backup';
import { createFullBackup, listFullBackups, serializeSystemBackup } from '@/services/backup/full/full-backup.service';
import { fullBackupErrorResponse, requireSuperAdmin } from './route-helpers';

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 20));
    const { backups, totalCount } = await listFullBackups({ page, limit });
    return NextResponse.json({
      backups: backups.map(serializeSystemBackup),
      totalCount,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to list full backups:');
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSuperAdmin();
    const body = createFullBackupSchema.parse(await request.json().catch(() => ({})));
    const result = await createFullBackup({ userId: session.id, name: body.name });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to start full backup:');
  }
}
