/**
 * GET /api/admin/backup/settings - Backup password status and full-backup schedule
 * PUT /api/admin/backup/settings - Update the full-backup schedule
 *
 * SUPER_ADMIN only
 */

import { NextRequest, NextResponse } from 'next/server';
import { fullBackupScheduleSchema } from '@/lib/validations/backup';
import { getBackupSettings, updateBackupSchedule } from '@/services/backup/full/backup-settings';
import { fullBackupErrorResponse, requireSuperAdmin } from '../full/route-helpers';

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json(await getBackupSettings());
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to load backup settings:');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSuperAdmin();
    const body = fullBackupScheduleSchema.parse(await request.json());
    return NextResponse.json(await updateBackupSchedule(body, session.id));
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to update backup schedule:');
  }
}
