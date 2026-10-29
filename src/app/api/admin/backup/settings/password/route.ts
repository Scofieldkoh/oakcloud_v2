/**
 * PUT /api/admin/backup/settings/password - Set or change the backup password
 *
 * New backups use the new password; existing backup files keep the password
 * they were made with. SUPER_ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuditLog } from '@/lib/audit';
import { backupPasswordSchema } from '@/lib/validations/backup';
import { setBackupPassword } from '@/services/backup/full/backup-settings';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../full/route-helpers';

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSuperAdmin();
    const { password } = backupPasswordSchema.parse(await request.json());
    await setBackupPassword(password, session.id);
    await createAuditLog({
      userId: session.id,
      action: 'BACKUP_SCHEDULE_UPDATED',
      entityType: 'BackupSettings',
      entityId: 'default',
      summary: 'Changed the backup password',
      changeSource: 'MANUAL',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to set backup password:');
  }
}
