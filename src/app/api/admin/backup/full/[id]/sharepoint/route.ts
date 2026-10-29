/**
 * POST /api/admin/backup/full/[id]/sharepoint - Copy a full backup to the SharePoint backup folder (or retry)
 *
 * SUPER_ADMIN only
 */

import { NextRequest, NextResponse } from 'next/server';
import { startSharePointCopy } from '@/services/backup/full/sharepoint-target';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../route-helpers';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    await startSharePointCopy(id);
    return NextResponse.json({ success: true }, { status: 202 });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to copy the backup to SharePoint:');
  }
}
