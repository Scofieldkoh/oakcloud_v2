/**
 * SharePoint File Operations API
 *
 * Provides REST endpoints for SharePoint file operations through a connector.
 *
 * GET /api/connectors/:id/sharepoint?action=list&path=/
 * GET /api/connectors/:id/sharepoint?action=info
 * GET /api/connectors/:id/sharepoint?action=delta&deltaLink=...
 * GET /api/connectors/:id/sharepoint?action=search&query=...
 * POST /api/connectors/:id/sharepoint?action=upload (multipart/form-data)
 * POST /api/connectors/:id/sharepoint?action=createFolder
 * POST /api/connectors/:id/sharepoint?action=copy
 * POST /api/connectors/:id/sharepoint?action=move
 * POST /api/connectors/:id/sharepoint?action=rename
 * DELETE /api/connectors/:id/sharepoint?fileId=...
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import * as sharepointService from '@/services/sharepoint.service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await requirePermission(session, 'connector', 'read');

    const { id: connectorId } = await params;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    switch (action) {
      case 'list': {
        const path = searchParams.get('path') || '/';
        const pageSize = parseInt(searchParams.get('pageSize') || '100', 10);
        const nextLink = searchParams.get('nextLink') || undefined;
        const result = await sharepointService.listFiles(connectorId, path, pageSize, nextLink);
        return NextResponse.json(result);
      }

      case 'info': {
        const info = await sharepointService.getSiteInfo(connectorId);
        return NextResponse.json(info);
      }

      case 'delta': {
        const deltaLink = searchParams.get('deltaLink') || undefined;
        const changes = await sharepointService.getDeltaChanges(connectorId, deltaLink);
        return NextResponse.json(changes);
      }

      case 'search': {
        const query = searchParams.get('query');
        if (!query) {
          return NextResponse.json({ error: 'Query parameter required' }, { status: 400 });
        }
        const pageSize = parseInt(searchParams.get('pageSize') || '25', 10);
        const result = await sharepointService.searchItems(connectorId, query, pageSize);
        return NextResponse.json(result);
      }

      case 'download': {
        const fileId = searchParams.get('fileId');
        if (!fileId) {
          return NextResponse.json({ error: 'File ID required' }, { status: 400 });
        }
        const { buffer, metadata } = await sharepointService.downloadFile(connectorId, fileId);
        // Convert Buffer to Uint8Array for NextResponse compatibility
        const uint8Array = new Uint8Array(buffer);
        return new NextResponse(uint8Array, {
          headers: {
            'Content-Type': metadata.mimeType,
            'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.name)}"`,
            'Content-Length': buffer.length.toString(),
          },
        });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('SharePoint GET error:', error);
    return createErrorResponse(error, 'Operation failed');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await requirePermission(session, 'connector', 'update');

    const { id: connectorId } = await params;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    switch (action) {
      case 'upload': {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const path = (formData.get('path') as string) || '/';
        const conflictBehavior =
          (formData.get('conflictBehavior') as 'rename' | 'replace' | 'fail') || 'rename';

        if (!file) {
          return NextResponse.json({ error: 'File required' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await sharepointService.uploadFile(
          connectorId,
          path,
          file.name,
          buffer,
          file.type || 'application/octet-stream',
          conflictBehavior
        );
        return NextResponse.json(result);
      }

      case 'createFolder': {
        const body = await request.json();
        if (!body.folderName) {
          return NextResponse.json({ error: 'Folder name required' }, { status: 400 });
        }
        const folder = await sharepointService.createFolder(
          connectorId,
          body.parentPath || '/',
          body.folderName
        );
        return NextResponse.json(folder);
      }

      case 'copy': {
        const body = await request.json();
        if (!body.itemId || !body.destinationPath) {
          return NextResponse.json(
            { error: 'Item ID and destination path required' },
            { status: 400 }
          );
        }
        const result = await sharepointService.copyItem(
          connectorId,
          body.itemId,
          body.destinationPath,
          body.newName
        );
        return NextResponse.json(result);
      }

      case 'move': {
        const body = await request.json();
        if (!body.itemId || !body.destinationPath) {
          return NextResponse.json(
            { error: 'Item ID and destination path required' },
            { status: 400 }
          );
        }
        const result = await sharepointService.moveItem(
          connectorId,
          body.itemId,
          body.destinationPath,
          body.newName
        );
        return NextResponse.json(result);
      }

      case 'rename': {
        const body = await request.json();
        if (!body.itemId || !body.newName) {
          return NextResponse.json({ error: 'Item ID and new name required' }, { status: 400 });
        }
        const result = await sharepointService.renameItem(connectorId, body.itemId, body.newName);
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('SharePoint POST error:', error);
    return createErrorResponse(error, 'Operation failed');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await requirePermission(session, 'connector', 'delete');

    const { id: connectorId } = await params;
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');

    if (!fileId) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 });
    }

    await sharepointService.deleteFile(connectorId, fileId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('SharePoint DELETE error:', error);
    return createErrorResponse(error, 'Delete failed');
  }
}
