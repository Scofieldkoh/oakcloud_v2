/**
 * GET  /api/admin/backup/sharepoint/folders - Browse folders for the SharePoint backup folder picker
 * POST /api/admin/backup/sharepoint/folders - Create a folder there
 *
 * SUPER_ADMIN only. Same responses as /api/sharepoint/folders, but scoped to
 * the connector's own workspace instead of the signed-in workspace.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sharePointBackupFolderSchema } from '@/lib/validations/backup';
import { createChildFolder, listChildFolders } from '@/services/sharepoint-folder.service';
import { sharePointConnectorWorkspace } from '@/services/backup/full/sharepoint-target';
import { fullBackupErrorResponse, requireSuperAdmin } from '../../full/route-helpers';

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const { searchParams } = new URL(request.url);
    const connectorId = z.string().uuid().parse(searchParams.get('connectorId'));
    const parentItemId = z.string().min(1).max(200).parse(searchParams.get('parentItemId'));
    const result = await listChildFolders({
      workspaceId: await sharePointConnectorWorkspace(connectorId),
      connectorId,
      parentItemId,
      query: searchParams.get('query') || undefined,
      cursor: searchParams.get('cursor') || undefined,
      pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to list SharePoint folders:');
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const body = sharePointBackupFolderSchema.parse(await request.json());
    const folder = await createChildFolder({
      workspaceId: await sharePointConnectorWorkspace(body.connectorId),
      connectorId: body.connectorId,
      parentItemId: body.parentItemId,
      name: body.name,
    });
    return NextResponse.json(folder, { status: 201 });
  } catch (error) {
    return fullBackupErrorResponse(error, 'Failed to create a SharePoint folder:');
  }
}
