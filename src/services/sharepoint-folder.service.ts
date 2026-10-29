import type { SharePointFolderRef } from '@/lib/sharepoint/folder-reference';
import { parseSharePointRelativeFolderPath, SharePointRelativeFolderPathError } from '@/lib/sharepoint/relative-folder-path';
import {
  assertSafeGraphContinuationUrl,
  decodeSharePointCursor,
  encodeSharePointCursor,
  getCanonicalSharePointItem,
  getWorkspaceSharePointContext,
  SharePointServiceError,
  sharePointGraphRequest,
  type CanonicalSharePointItem,
  type WorkspaceSharePointContext,
} from './sharepoint.service';

export interface SharePointFolderOperationContext {
  workspaceId: string;
  connectorId: string;
  driveId?: string;
}

export interface SharePointChildFolder {
  id: string;
  driveId: string;
  name: string;
  webUrl: string;
  childCount: number;
  parentItemId: string;
}

export interface ListChildFoldersOptions {
  workspaceId: string;
  query?: string;
  cursor?: string;
  pageSize?: number;
  refresh?: boolean;
}

interface CachedFolders {
  expiresAt: number;
  folders: SharePointChildFolder[];
}

const FOLDER_CACHE_TTL_MS = 30_000;
const folderCache = new Map<string, CachedFolders>();

function contextKey(context: WorkspaceSharePointContext, parentItemId: string): string {
  return `${context.workspaceId}:${context.connectorId}:${context.driveId}:${parentItemId}`;
}

function ensureDrive(context: WorkspaceSharePointContext, driveId?: string): void {
  if (driveId && driveId !== context.driveId) {
    throw new SharePointServiceError({
      code: 'DRIVE_MISMATCH',
      category: 'VALIDATION',
      statusCode: 400,
      message: 'SharePoint folder must use the connector\'s configured drive',
    });
  }
}

async function getContext(input: SharePointFolderOperationContext): Promise<WorkspaceSharePointContext> {
  const context = await getWorkspaceSharePointContext({ workspaceId: input.workspaceId, connectorId: input.connectorId });
  ensureDrive(context, input.driveId);
  return context;
}

async function fetchImmediateFolders(
  context: WorkspaceSharePointContext,
  parentItemId: string,
  refresh = false,
): Promise<SharePointChildFolder[]> {
  const key = contextKey(context, parentItemId);
  const cached = folderCache.get(key);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.folders;

  const folders: SharePointChildFolder[] = [];
  let next: string | undefined = parentItemId === 'root'
    ? '/root/children?$top=200&$select=id,name,webUrl,folder,parentReference'
    : `/items/${encodeURIComponent(parentItemId)}/children?$top=200&$select=id,name,webUrl,folder,parentReference`;
  while (next) {
    const graphResponse: {
      value: Array<{
        id: string;
        name: string;
        webUrl: string;
        folder?: { childCount?: number };
        parentReference?: { driveId?: string; id?: string };
      }>;
      '@odata.nextLink'?: string;
    } = await sharePointGraphRequest<{
      value: Array<{
        id: string;
        name: string;
        webUrl: string;
        folder?: { childCount?: number };
        parentReference?: { driveId?: string; id?: string };
      }>;
      '@odata.nextLink'?: string;
    }>(context, next);
    for (const item of graphResponse.value ?? []) {
      if (!item.folder) continue;
      const driveId = item.parentReference?.driveId || context.driveId;
      if (driveId !== context.driveId) continue;
      folders.push({
        id: item.id,
        driveId,
        name: item.name,
        webUrl: item.webUrl,
        childCount: item.folder.childCount ?? 0,
        parentItemId: item.parentReference?.id || parentItemId,
      });
    }
    next = graphResponse['@odata.nextLink'];
    if (next) assertSafeGraphContinuationUrl(next);
  }

  folderCache.set(key, { folders, expiresAt: Date.now() + FOLDER_CACHE_TTL_MS });
  return folders;
}

export function invalidateSharePointFolderCache(input?: {
  workspaceId?: string;
  connectorId?: string;
  driveId?: string;
  parentItemId?: string;
}): void {
  if (!input) {
    folderCache.clear();
    return;
  }
  for (const key of folderCache.keys()) {
    if (
      (!input.workspaceId || key.startsWith(`${input.workspaceId}:`))
      && (!input.connectorId || key.includes(`:${input.connectorId}:`))
      && (!input.driveId || key.includes(`:${input.driveId}:`))
      && (!input.parentItemId || key.endsWith(`:${input.parentItemId}`))
    ) folderCache.delete(key);
  }
}

async function listChildFoldersObject(
  input: SharePointFolderOperationContext & { parentItemId: string } & Omit<ListChildFoldersOptions, 'workspaceId'>,
): Promise<{ folders: SharePointChildFolder[]; nextCursor?: string; total: number }> {
  const context = await getContext(input);
  let offset = 0;
  if (input.cursor) {
    const cursor = decodeSharePointCursor(input.cursor);
    if (
      cursor.workspaceId !== input.workspaceId
      || cursor.connectorId !== input.connectorId
      || cursor.driveId !== context.driveId
      || cursor.parentItemId !== input.parentItemId
      || cursor.query !== (input.query || '').trim().toLocaleLowerCase()
    ) {
      throw new SharePointServiceError({ code: 'INVALID_CURSOR', category: 'VALIDATION', statusCode: 400, message: 'The SharePoint folder cursor is invalid or expired' });
    }
    offset = cursor.offset;
  }
  const all = await fetchImmediateFolders(context, input.parentItemId, input.refresh);
  const query = (input.query || '').trim().toLocaleLowerCase();
  const filtered = query ? all.filter((folder) => folder.name.toLocaleLowerCase().includes(query)) : all;
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 100, 200));
  const folders = filtered.slice(offset, offset + pageSize);
  const nextOffset = offset + folders.length;
  const nextCursor = nextOffset < filtered.length
    ? encodeSharePointCursor({
      version: 1,
      workspaceId: input.workspaceId,
      connectorId: input.connectorId,
      driveId: context.driveId,
      parentItemId: input.parentItemId,
      query,
      offset: nextOffset,
    })
    : undefined;
  return { folders, nextCursor, total: filtered.length };
}

export async function listChildFolders(input: SharePointFolderOperationContext & { parentItemId: string } & Omit<ListChildFoldersOptions, 'workspaceId'>): Promise<{ folders: SharePointChildFolder[]; nextCursor?: string; total: number }>;
export async function listChildFolders(connectorId: string, driveId: string, parentItemId: string, options: ListChildFoldersOptions): Promise<{ folders: SharePointChildFolder[]; nextCursor?: string; total: number }>;
export async function listChildFolders(
  first: SharePointFolderOperationContext | string,
  second?: string,
  third?: string,
  fourth?: ListChildFoldersOptions,
): Promise<{ folders: SharePointChildFolder[]; nextCursor?: string; total: number }> {
  if (typeof first === 'string') {
    const options = fourth ?? { workspaceId: '' };
    return listChildFoldersObject({
      connectorId: first,
      driveId: second,
      parentItemId: third as string,
      ...options,
    });
  }
  return listChildFoldersObject(first as SharePointFolderOperationContext & { parentItemId: string } & Omit<ListChildFoldersOptions, 'workspaceId'>);
}

export async function verifyFolder(
  input: SharePointFolderOperationContext & { itemId: string },
): Promise<SharePointFolderRef>;
export async function verifyFolder(
  connectorId: string,
  driveId: string,
  itemId: string,
  options: { workspaceId: string },
): Promise<SharePointFolderRef>;
export async function verifyFolder(
  first: (SharePointFolderOperationContext & { itemId: string }) | string,
  second?: string,
  third?: string,
  fourth?: { workspaceId: string },
): Promise<SharePointFolderRef> {
  const input = typeof first === 'string'
    ? { connectorId: first, driveId: second, itemId: third as string, workspaceId: fourth?.workspaceId || '' }
    : first;
  const context = await getContext(input);
  const item = await getCanonicalSharePointItem(context, input.itemId);
  if (!item.isFolder) {
    throw new SharePointServiceError({ code: 'FOLDER_REQUIRED', category: 'VALIDATION', statusCode: 400, message: 'The selected SharePoint item is not a folder' });
  }
  return { driveId: item.driveId, itemId: item.id, name: item.name, webUrl: item.webUrl };
}

export async function findExactChildFolder(
  input: SharePointFolderOperationContext & { parentItemId: string; name: string },
): Promise<SharePointChildFolder | null>;
export async function findExactChildFolder(
  connectorId: string,
  driveId: string,
  parentItemId: string,
  name: string,
  options: { workspaceId: string },
): Promise<SharePointChildFolder | null>;
export async function findExactChildFolder(
  first: (SharePointFolderOperationContext & { parentItemId: string; name: string }) | string,
  second?: string,
  third?: string,
  fourth?: string | { workspaceId: string },
  fifth?: { workspaceId: string },
): Promise<SharePointChildFolder | null> {
  const input = typeof first === 'string'
    ? { connectorId: first, driveId: second, parentItemId: third as string, name: fourth as string, workspaceId: fifth?.workspaceId || (typeof fourth === 'object' ? fourth.workspaceId : '') }
    : first;
  const context = await getContext(input);
  const folders = await fetchImmediateFolders(context, input.parentItemId);
  const wanted = input.name.trim().toLocaleLowerCase();
  return folders.find((folder) => folder.name.toLocaleLowerCase() === wanted) ?? null;
}

function validateChildName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new SharePointServiceError({ code: 'INVALID_FOLDER_NAME', category: 'VALIDATION', statusCode: 400, message: 'Folder name is required' });
  let parsed: ReturnType<typeof parseSharePointRelativeFolderPath>;
  try {
    parsed = parseSharePointRelativeFolderPath(trimmed);
  } catch (error) {
    if (error instanceof SharePointRelativeFolderPathError) {
      throw new SharePointServiceError({ code: 'INVALID_FOLDER_NAME', category: 'VALIDATION', statusCode: 400, message: error.message });
    }
    throw error;
  }
  if (parsed.segments.length !== 1 || parsed.normalized !== trimmed) {
    throw new SharePointServiceError({ code: 'INVALID_FOLDER_NAME', category: 'VALIDATION', statusCode: 400, message: 'Folder name must be a single SharePoint folder name' });
  }
  return parsed.normalized;
}

export async function createChildFolder(
  input: SharePointFolderOperationContext & { parentItemId: string; name: string },
): Promise<SharePointChildFolder>;
export async function createChildFolder(
  connectorId: string,
  driveId: string,
  parentItemId: string,
  name: string,
  options: { workspaceId: string },
): Promise<SharePointChildFolder>;
export async function createChildFolder(
  first: (SharePointFolderOperationContext & { parentItemId: string; name: string }) | string,
  second?: string,
  third?: string,
  fourth?: string | { workspaceId: string },
  fifth?: { workspaceId: string },
): Promise<SharePointChildFolder> {
  const input = typeof first === 'string'
    ? { connectorId: first, driveId: second, parentItemId: third as string, name: fourth as string, workspaceId: fifth?.workspaceId || (typeof fourth === 'object' ? fourth.workspaceId : '') }
    : first;
  const name = validateChildName(input.name);
  const context = await getContext(input);
  const existing = await findExactChildFolder({ ...input, name });
  if (existing) return existing;
  try {
    const created = await sharePointGraphRequest<{
      id: string;
      name: string;
      webUrl: string;
      folder?: { childCount?: number };
      parentReference?: { driveId?: string; id?: string };
    }>(context, `/items/${encodeURIComponent(input.parentItemId)}/children`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
    if (!created.id || !created.name || !created.webUrl) {
      throw new SharePointServiceError({
        code: 'SHAREPOINT_INVALID_RESPONSE',
        category: 'TRANSIENT',
        statusCode: 502,
        retryable: true,
        message: 'SharePoint did not return the created folder details',
      });
    }
    const driveId = created.parentReference?.driveId || context.driveId;
    if (driveId !== context.driveId) {
      throw new SharePointServiceError({
        code: 'DRIVE_MISMATCH',
        category: 'VALIDATION',
        statusCode: 400,
        message: 'SharePoint created the folder in a different drive',
      });
    }
    invalidateSharePointFolderCache({ workspaceId: context.workspaceId, connectorId: context.connectorId, driveId: context.driveId, parentItemId: input.parentItemId });
    return {
      id: created.id,
      driveId,
      name: created.name,
      webUrl: created.webUrl,
      childCount: created.folder?.childCount ?? 0,
      parentItemId: created.parentReference?.id || input.parentItemId,
    };
  } catch (error) {
    if (error instanceof SharePointServiceError && error.category === 'CONFLICT') {
      const winner = await findExactChildFolder({ ...input, name });
      if (winner) return winner;
    }
    throw error;
  }
}

export async function isImmediateChildOfRoot(input: SharePointFolderOperationContext & { rootItemId: string; itemId: string }): Promise<boolean> {
  const context = await getContext(input);
  const item = await getCanonicalSharePointItem(context, input.itemId);
  return item.isFolder && item.driveId === context.driveId && item.parentItemId === input.rootItemId;
}

export async function isDescendantOfRoot(input: SharePointFolderOperationContext & { rootItemId: string; itemId: string }): Promise<boolean> {
  const context = await getContext(input);
  let currentId = input.itemId;
  for (let depth = 0; depth <= 100; depth += 1) {
    const item = await getCanonicalSharePointItem(context, currentId);
    if (!item.isFolder) return false;
    if (item.id === input.rootItemId) return true;
    if (!item.parentItemId) return false;
    currentId = item.parentItemId;
  }
  return false;
}

export async function resolveOrCreateRelativePath(input: SharePointFolderOperationContext & { rootFolder: SharePointFolderRef; segments: string[] | string }): Promise<SharePointChildFolder> {
  const context = await getContext(input);
  ensureDrive(context, input.rootFolder.driveId);
  const parsed = typeof input.segments === 'string'
    ? parseSharePointRelativeFolderPath(input.segments)
    : parseSharePointRelativeFolderPath(input.segments.join('/'));
  let current: SharePointChildFolder = {
    id: input.rootFolder.itemId,
    driveId: input.rootFolder.driveId,
    name: input.rootFolder.name,
    webUrl: input.rootFolder.webUrl,
    childCount: 0,
    parentItemId: '',
  };
  for (const segment of parsed.segments) {
    current = await createChildFolder({
      workspaceId: input.workspaceId,
      connectorId: input.connectorId,
      driveId: context.driveId,
      parentItemId: current.id,
      name: segment,
    });
  }
  return current;
}

export async function moveItemToFolder(input: SharePointFolderOperationContext & { itemId: string; destinationFolderId: string; newName?: string }): Promise<CanonicalSharePointItem> {
  const context = await getContext(input);
  const source = await getCanonicalSharePointItem(context, input.itemId);
  const destination = await getCanonicalSharePointItem(context, input.destinationFolderId);
  if (!destination.isFolder || source.driveId !== destination.driveId || destination.driveId !== context.driveId) {
    throw new SharePointServiceError({ code: 'DRIVE_MISMATCH', category: 'VALIDATION', statusCode: 400, message: 'SharePoint move must stay within the configured drive' });
  }
  await sharePointGraphRequest(context, `/items/${encodeURIComponent(source.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentReference: { driveId: context.driveId, id: destination.id }, ...(input.newName ? { name: input.newName } : {}) }),
  });
  invalidateSharePointFolderCache({ workspaceId: context.workspaceId, connectorId: context.connectorId, driveId: context.driveId, parentItemId: source.parentItemId });
  invalidateSharePointFolderCache({ workspaceId: context.workspaceId, connectorId: context.connectorId, driveId: context.driveId, parentItemId: destination.id });
  return getCanonicalSharePointItem(context, source.id);
}

export type { CanonicalSharePointItem, WorkspaceSharePointContext };
