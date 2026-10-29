/**
 * SharePoint cloud copy of full backups.
 *
 * Every finished full backup is copied into one SharePoint folder (picked on
 * the Backup page) through an existing workspace SharePoint connector. On a new
 * machine the same folder is listed and a backup is copied back down, then
 * restored the usual way.
 */

import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { createLogger } from '@/lib/logger';
import {
  assertSafeGraphContinuationUrl,
  downloadSharePointItemContent,
  getCanonicalSharePointItem,
  getWorkspaceSharePointContext,
  SharePointServiceError,
  sharePointGraphRequest,
  uploadSharePointContent,
  type WorkspaceSharePointContext,
} from '@/services/sharepoint.service';
import { FULL_BACKUP_FILE_EXTENSION } from './types';

const log = createLogger('full-backup-sharepoint');
const SETTINGS_ID = 'default';

/** Only files Oakcloud named are ever pruned from the folder. */
const OAKCLOUD_FILE_PATTERN = /^oakcloud-\d{8}-\d{4}(?:-\d+)?\.oakbackup$/i;

export interface SharePointBackupTarget {
  connectorId: string;
  connectorName: string | null;
  workspaceName: string | null;
  driveId: string;
  folderId: string;
  folderName: string;
  folderUrl: string;
  maxBackups: number;
}

export interface SharePointBackupConnector {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
}

export interface SharePointBackupFile {
  itemId: string;
  name: string;
  size: number;
  webUrl: string;
  createdAt: string | null;
  /** The local backup already holding this file, if any. */
  backupId: string | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** SharePoint connectors that belong to a workspace; the folder APIs require one. */
export async function listSharePointBackupConnectors(): Promise<SharePointBackupConnector[]> {
  const connectors = await prisma.connector.findMany({
    where: { provider: 'SHAREPOINT', deletedAt: null, isEnabled: true, workspaceId: { not: null } },
    select: { id: true, name: true, workspaceId: true, workspace: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  return connectors.map((connector) => ({
    id: connector.id,
    name: connector.name,
    workspaceId: connector.workspaceId!,
    workspaceName: connector.workspace?.name ?? '',
  }));
}

/** The workspace that owns a SharePoint connector, which every SharePoint call is scoped to. */
export async function sharePointConnectorWorkspace(connectorId: string): Promise<string> {
  const connector = await prisma.connector.findUnique({
    where: { id: connectorId },
    select: { provider: true, workspaceId: true, deletedAt: true },
  });
  if (!connector || connector.deletedAt || connector.provider !== 'SHAREPOINT') {
    throw new Error('SharePoint connector not found');
  }
  if (!connector.workspaceId) {
    throw new Error('Use a SharePoint connector that belongs to a workspace');
  }
  return connector.workspaceId;
}

async function contextFor(connectorId: string): Promise<WorkspaceSharePointContext> {
  return getWorkspaceSharePointContext({ workspaceId: await sharePointConnectorWorkspace(connectorId), connectorId });
}

export async function getSharePointBackupTarget(): Promise<SharePointBackupTarget | null> {
  const settings = await prisma.backupSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!settings?.sharePointConnectorId || !settings.sharePointFolderId || !settings.sharePointDriveId) return null;
  const connector = await prisma.connector.findUnique({
    where: { id: settings.sharePointConnectorId },
    select: { name: true, deletedAt: true, workspace: { select: { name: true } } },
  });
  return {
    connectorId: settings.sharePointConnectorId,
    connectorName: connector && !connector.deletedAt ? connector.name : null,
    workspaceName: connector?.workspace?.name ?? null,
    driveId: settings.sharePointDriveId,
    folderId: settings.sharePointFolderId,
    folderName: settings.sharePointFolderName ?? 'SharePoint folder',
    folderUrl: settings.sharePointFolderUrl ?? '',
    maxBackups: settings.sharePointMaxBackups,
  };
}

export async function setSharePointBackupTarget(
  input: { connectorId: string; folderId: string; maxBackups: number },
  userId: string,
): Promise<SharePointBackupTarget> {
  const context = await contextFor(input.connectorId);
  const folder = await getCanonicalSharePointItem(context, input.folderId);
  if (!folder.isFolder) throw new Error('Choose a SharePoint folder, not a file');
  const data = {
    sharePointConnectorId: input.connectorId,
    sharePointDriveId: folder.driveId,
    sharePointFolderId: folder.id,
    sharePointFolderName: folder.name,
    sharePointFolderUrl: folder.webUrl,
    sharePointMaxBackups: input.maxBackups,
    updatedById: userId,
  };
  await prisma.backupSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
  return (await getSharePointBackupTarget())!;
}

export async function clearSharePointBackupTarget(userId: string): Promise<void> {
  await prisma.backupSettings.updateMany({
    where: { id: SETTINGS_ID },
    data: {
      sharePointConnectorId: null,
      sharePointDriveId: null,
      sharePointFolderId: null,
      sharePointFolderName: null,
      sharePointFolderUrl: null,
      updatedById: userId,
    },
  });
}

async function requireTarget(): Promise<{ target: SharePointBackupTarget; context: WorkspaceSharePointContext }> {
  const target = await getSharePointBackupTarget();
  if (!target) throw new Error('Choose a SharePoint backup folder first');
  const context = await contextFor(target.connectorId);
  if (context.driveId !== target.driveId) {
    throw new Error('The SharePoint connector now points at a different document library. Choose the backup folder again.');
  }
  return { target, context };
}

interface GraphChild {
  id: string;
  name: string;
  size?: number;
  webUrl: string;
  file?: object;
  createdDateTime?: string;
}

async function listFolderFiles(context: WorkspaceSharePointContext, folderId: string): Promise<GraphChild[]> {
  const files: GraphChild[] = [];
  let next: string | undefined = `/items/${encodeURIComponent(folderId)}/children?$top=200&$select=id,name,size,webUrl,file,createdDateTime`;
  while (next) {
    const page: { value?: GraphChild[]; '@odata.nextLink'?: string } = await sharePointGraphRequest(context, next);
    for (const item of page.value ?? []) {
      if (item.file && item.name.toLowerCase().endsWith(FULL_BACKUP_FILE_EXTENSION)) files.push(item);
    }
    next = page['@odata.nextLink'];
    if (next) assertSafeGraphContinuationUrl(next);
  }
  return files;
}

/** Backup files in the SharePoint folder, newest first. */
export async function listSharePointBackupFiles(): Promise<{ target: SharePointBackupTarget; files: SharePointBackupFile[] }> {
  const { target, context } = await requireTarget();
  const items = await listFolderFiles(context, target.folderId);
  const local = await prisma.systemBackup.findMany({
    where: { deletedAt: null, sharePointItemId: { in: items.map((item) => item.id) } },
    select: { id: true, sharePointItemId: true },
  });
  const byItem = new Map(local.map((backup) => [backup.sharePointItemId, backup.id]));
  const files = items
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      size: item.size ?? 0,
      webUrl: item.webUrl,
      createdAt: item.createdDateTime ?? null,
      backupId: byItem.get(item.id) ?? null,
    }))
    .sort((a, b) => (b.createdAt ?? b.name).localeCompare(a.createdAt ?? a.name));
  return { target, files };
}

/** A file of the same name already in the folder counts as this backup's copy when the size matches. */
async function existingCopy(context: WorkspaceSharePointContext, folderId: string, fileName: string, size: number) {
  try {
    const item = await sharePointGraphRequest<GraphChild>(
      context,
      `/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}?$select=id,name,size,webUrl,file`,
    );
    return item.file && item.size === size ? item : null;
  } catch {
    return null;
  }
}

/**
 * Copies one full backup into the SharePoint folder. Never throws: the result
 * is recorded on the backup so the page can show it and offer a retry.
 */
export async function copyBackupToSharePoint(backupId: string, archive?: Buffer): Promise<boolean> {
  const backup = await prisma.systemBackup.findUnique({ where: { id: backupId } });
  if (!backup?.archiveKey || backup.deletedAt) return false;
  const target = await getSharePointBackupTarget();
  if (!target) return false;

  await prisma.systemBackup.update({ where: { id: backupId }, data: { sharePointStatus: 'UPLOADING', sharePointError: null } });
  try {
    const { context } = await requireTarget();
    const content = archive ?? await storage.download(backup.archiveKey);
    const fileName = backup.archiveKey.split('/').pop()!;
    let item: { id: string; webUrl: string };
    try {
      item = await uploadSharePointContent(context, target.folderId, fileName, content, 'application/octet-stream');
    } catch (error) {
      const conflict = error instanceof SharePointServiceError && error.category === 'CONFLICT';
      const existing = conflict ? await existingCopy(context, target.folderId, fileName, content.length) : null;
      if (!existing) throw error;
      item = existing;
    }
    await prisma.systemBackup.update({
      where: { id: backupId },
      data: { sharePointStatus: 'UPLOADED', sharePointItemId: item.id, sharePointWebUrl: item.webUrl, sharePointUploadedAt: new Date() },
    });
    await pruneSharePointBackups(context, target).catch((error) => log.warn(`Could not prune SharePoint backups: ${errorText(error)}`));
    log.info(`Full backup ${backupId} copied to SharePoint`);
    return true;
  } catch (error) {
    log.error(`Copying full backup ${backupId} to SharePoint failed: ${errorText(error)}`);
    await prisma.systemBackup.update({
      where: { id: backupId },
      data: { sharePointStatus: 'FAILED', sharePointError: `SharePoint copy failed: ${errorText(error)}` },
    }).catch(() => undefined);
    return false;
  }
}

/** Starts (or retries) the SharePoint copy of one backup from the Backup page. */
export async function startSharePointCopy(backupId: string): Promise<void> {
  const backup = await prisma.systemBackup.findFirst({ where: { id: backupId, deletedAt: null } });
  if (!backup) throw new Error('Backup not found');
  if (!backup.archiveKey || !['COMPLETED', 'RESTORED'].includes(backup.status)) throw new Error('This backup is not ready to copy');
  if (backup.sharePointStatus === 'UPLOADING') throw new Error('This backup is already being copied to SharePoint');
  if (!(await getSharePointBackupTarget())) throw new Error('Choose a SharePoint backup folder first');
  await prisma.systemBackup.update({ where: { id: backupId }, data: { sharePointStatus: 'UPLOADING', sharePointError: null } });
  void copyBackupToSharePoint(backupId);
}

/** Keeps the newest Oakcloud backup files in the folder; files named by people are never touched. */
async function pruneSharePointBackups(context: WorkspaceSharePointContext, target: SharePointBackupTarget): Promise<void> {
  const ours = (await listFolderFiles(context, target.folderId))
    .filter((item) => OAKCLOUD_FILE_PATTERN.test(item.name))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const item of ours.slice(target.maxBackups)) {
    await sharePointGraphRequest(context, `/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    await prisma.systemBackup.updateMany({
      where: { sharePointItemId: item.id },
      data: { sharePointStatus: null, sharePointItemId: null, sharePointWebUrl: null, sharePointUploadedAt: null },
    });
  }
}

/** Downloads one backup file from the SharePoint folder. */
export async function downloadSharePointBackupFile(itemId: string): Promise<{ name: string; content: Buffer; webUrl: string }> {
  const { target, context } = await requireTarget();
  const item = await getCanonicalSharePointItem(context, itemId);
  if (item.isFolder || !item.name.toLowerCase().endsWith(FULL_BACKUP_FILE_EXTENSION)) {
    throw new Error('Choose an Oakcloud backup file');
  }
  if (item.parentItemId !== target.folderId) throw new Error('That file is not in the SharePoint backup folder');
  const content = await downloadSharePointItemContent(context, item.id, Math.max(item.size ?? 0, 1));
  return { name: item.name, content, webUrl: item.webUrl };
}

/** Marks SharePoint copies left running by a restart as failed. */
export async function cleanupStaleSharePointCopies(threshold: Date): Promise<void> {
  await prisma.systemBackup.updateMany({
    where: { sharePointStatus: 'UPLOADING', updatedAt: { lte: threshold } },
    data: { sharePointStatus: 'FAILED', sharePointError: 'SharePoint copy stopped before finishing (the app restarted)' },
  });
}
