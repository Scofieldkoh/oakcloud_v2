/**
 * GET    /api/admin/backup/sharepoint - SharePoint backup folder and the connectors that can reach one
 * PUT    /api/admin/backup/sharepoint - Choose the SharePoint backup folder
 * DELETE /api/admin/backup/sharepoint - Stop copying backups to SharePoint
 *
 * SUPER_ADMIN only
 */

import { NextRequest, NextResponse } from 'next/server';
import { sharePointBackupTargetSchema } from '@/lib/validations/backup';
import {
  clearSharePointBackupTarget,
  getSharePointBackupTarget,
  listSharePointBackupConnectors,
  setSharePointBackupTarget,
} from '@/services/backup/full/sharepoint-target';
import { fullBackupErrorResponse, requireSuperAdmin } from '../full/route-helpers';

export async function GET() {
  try {
    await requireSuperAdmin();
    const [target, connectors] = await Promise.all([getSharePointBackupTarget(), listSharePointBackupConnectors()]);
    return NextResponse.json({ target, connectors });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to load the SharePoint backup folder:');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSuperAdmin();
    const body = sharePointBackupTargetSchema.parse(await request.json());
    return NextResponse.json({ target: await setSharePointBackupTarget(body, session.id) });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to save the SharePoint backup folder:');
  }
}

export async function DELETE() {
  try {
    const session = await requireSuperAdmin();
    await clearSharePointBackupTarget(session.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to clear the SharePoint backup folder:');
  }
}
