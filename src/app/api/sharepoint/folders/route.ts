import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { ApiError } from '@/lib/errors';
import { authErrorResponse } from '@/lib/api-route-errors';
import { createAuditLog } from '@/lib/audit';
import { createLogger, sanitizeError } from '@/lib/logger';
import { z } from 'zod';
import { SharePointServiceError } from '@/services/sharepoint.service';
import { getSharePointFilingSettings } from '@/services/sharepoint-filing-settings.service';
import { createChildFolder, isDescendantOfRoot, listChildFolders } from '@/services/sharepoint-folder.service';

const modeSchema = z.enum(['browse', 'client-folder', 'destination']).default('browse');
const log = createLogger('api:sharepoint-folders');

function errorResponse(error: unknown) {
  if (error instanceof SharePointServiceError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode ?? 400 });
  if (error instanceof ApiError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode });
  if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid request', details: error.flatten() }, { status: 400 });
  const authResponse = authErrorResponse(error);
  if (authResponse) return authResponse;
  log.error('SharePoint folder operation failed', sanitizeError(error));
  return NextResponse.json({
    errorCode: 'SHAREPOINT_FOLDER_OPERATION_FAILED',
    error: 'SharePoint folder operation failed. Check the connector permissions and try again.',
  }, { status: 500 });
}

async function auth(input: NextRequest, action: 'read' | 'update') {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  await requirePermission(session, 'connector', action);
  if (!session.tenantId) return { response: NextResponse.json({ error: 'Workspace context required' }, { status: 400 }) } as const;
  return { session } as const;
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await auth(request, 'read');
    if ('response' in authResult) return authResult.response;
    const { searchParams } = new URL(request.url);
    const connectorId = z.string().uuid().parse(searchParams.get('connectorId'));
    const parentItemId = z.string().min(1).parse(searchParams.get('parentItemId'));
    const mode = modeSchema.parse(searchParams.get('mode') || undefined);
    const settings = await getSharePointFilingSettings({ workspaceId: authResult.session.tenantId!, connectorId });
    if (mode === 'client-folder') {
      if (!settings.clientDocumentsRoot) throw new SharePointServiceError({ code: 'ROOT_NOT_CONFIGURED', category: 'CONFIGURATION', statusCode: 400, message: 'Configure the Client Documents root first' });
      if (parentItemId !== settings.clientDocumentsRoot.itemId) throw new SharePointServiceError({ code: 'OUTSIDE_ALLOWED_ROOT', category: 'VALIDATION', statusCode: 400, message: 'Company folders must be immediate children of the Client Documents root' });
    }
    const fixedRootItemId = searchParams.get('rootItemId') || undefined;
    if (fixedRootItemId && parentItemId !== fixedRootItemId && !(await isDescendantOfRoot({ workspaceId: authResult.session.tenantId!, connectorId, rootItemId: fixedRootItemId, itemId: parentItemId }))) {
      throw new SharePointServiceError({ code: 'OUTSIDE_ALLOWED_ROOT', category: 'VALIDATION', statusCode: 400, message: 'Folder is outside the allowed SharePoint root' });
    }
    const result = await listChildFolders({
      workspaceId: authResult.session.tenantId!,
      connectorId,
      parentItemId,
      query: searchParams.get('query') || undefined,
      cursor: searchParams.get('cursor') || undefined,
      pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await auth(request, 'update');
    if ('response' in authResult) return authResult.response;
    const body = await request.json();
    const parsed = z.object({
      connectorId: z.string().uuid(),
      parentItemId: z.string().min(1),
      name: z.string().min(1).max(255),
      mode: modeSchema.optional(),
      rootItemId: z.string().min(1).optional(),
    }).parse(body);
    const settings = await getSharePointFilingSettings({ workspaceId: authResult.session.tenantId!, connectorId: parsed.connectorId });
    const rootItemId = parsed.mode === 'client-folder' ? settings.clientDocumentsRoot?.itemId : parsed.rootItemId;
    if (parsed.mode === 'client-folder' && (!rootItemId || parsed.parentItemId !== rootItemId)) {
      throw new SharePointServiceError({ code: 'OUTSIDE_ALLOWED_ROOT', category: 'VALIDATION', statusCode: 400, message: 'Company folders must be created directly below the Client Documents root' });
    }
    if (rootItemId && parsed.parentItemId !== rootItemId && !(await isDescendantOfRoot({ workspaceId: authResult.session.tenantId!, connectorId: parsed.connectorId, rootItemId, itemId: parsed.parentItemId }))) {
      throw new SharePointServiceError({ code: 'OUTSIDE_ALLOWED_ROOT', category: 'VALIDATION', statusCode: 400, message: 'Folder is outside the allowed SharePoint root' });
    }
    const folder = await createChildFolder({ workspaceId: authResult.session.tenantId!, connectorId: parsed.connectorId, parentItemId: parsed.parentItemId, name: parsed.name });
    try {
      await createAuditLog({
        tenantId: authResult.session.tenantId!,
        userId: authResult.session.id,
        action: 'CREATE',
        entityType: 'SharePointFolder',
        entityId: folder.id,
        entityName: folder.name,
        summary: 'Created SharePoint client folder',
        changeSource: 'MANUAL',
        metadata: { connectorId: parsed.connectorId, driveId: folder.driveId, parentItemId: folder.parentItemId },
      });
    } catch (error) {
      // The remote folder cannot be rolled back. Tell the caller not to create
      // another copy, while retaining the original failure in server logs.
      log.error('SharePoint folder created but audit logging failed', sanitizeError(error));
      return NextResponse.json({
        errorCode: 'SHAREPOINT_FOLDER_AUDIT_FAILED',
        error: 'The folder was created in SharePoint, but Oakcloud could not record the audit entry. Refresh the folder list before retrying.',
      }, { status: 500 });
    }
    return NextResponse.json(folder, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
