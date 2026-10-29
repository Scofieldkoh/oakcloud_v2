/**
 * Full backups: the whole install (every workspace, table and stored file) in
 * one password-locked file that can be downloaded, uploaded to another install
 * and restored there.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { createAuditLog } from '@/lib/audit';
import { createLogger } from '@/lib/logger';
import { Prisma } from '@/generated/prisma';
import type { SystemBackupSource } from '@/generated/prisma';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';
import { acquireContactMergeBackupBarrier } from '@/lib/contact-merge-backup-barrier';
import { invalidateRestoredAssistantDispatch } from '@/services/business-assistant-backup.service';
import { BackupArchiveWriter, extractArchive } from './archive';
import { exportTable, listAppliedMigrations, listTables, quoteIdent, replaceDatabase } from './database-snapshot';
import { BACKUP_MODULES, isBackupModuleKey, MODULE_RESTORE_SKIPPED_TABLES, moduleForTable, moduleLabel } from './modules';
import { previewModules, restoreModules } from './module-restore';
import { getBackupPassword, getScheduledMaxBackups, claimDueScheduledRun, recordScheduledRun } from './backup-settings';
import { cleanupStaleSharePointCopies, copyBackupToSharePoint, downloadSharePointBackupFile } from './sharepoint-target';
import {
  FULL_BACKUP_FILE_EXTENSION,
  FULL_BACKUP_FORMAT,
  FULL_BACKUP_FORMAT_VERSION,
  FULL_RESTORE_CONFIRMATION,
  type FullBackupFile,
  type FullBackupManifest,
  type FullBackupModuleSummary,
  type FullBackupPreview,
  type ModuleRestorePreview,
} from './types';

const log = createLogger('full-backup');

/** Storage prefixes that hold backups themselves, never backed up again. */
const BACKUP_STORAGE_PREFIXES = ['backups/', 'system-backups/'];
const MAX_STORED_FILES = 1_000_000;
const RESTORE_TIMEOUT_MS = 60 * 60 * 1000;
const MANIFEST_ENTRY = 'manifest.json';

function workRoot(): string {
  return process.env.BACKUP_WORK_DIR || path.join(os.tmpdir(), 'oakcloud-backups');
}

function tableEntry(table: string): string {
  return `db/${table}.jsonl`;
}

function fileEntry(key: string): string {
  return `files/${key}`;
}

function archiveKey(backupId: string, createdAt: Date): string {
  const stamp = createdAt.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `system-backups/${backupId}/oakcloud-${stamp}${FULL_BACKUP_FILE_EXTENSION}`;
}

async function withWorkDir<T>(label: string, run: (dir: string) => Promise<T>): Promise<T> {
  await fs.promises.mkdir(workRoot(), { recursive: true });
  const dir = await fs.promises.mkdtemp(path.join(workRoot(), `${label}-`));
  try {
    return await run(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Thrown inside a running backup once someone has pressed Stop. */
class BackupStoppedError extends Error {
  constructor() {
    super('Stopped');
  }
}

const STOPPED_STEP = 'Stopped';

/** Throws BackupStoppedError when the backup is no longer running (Stop was pressed). */
async function assertStillRunning(backupId: string): Promise<void> {
  const current = await prisma.systemBackup.findUnique({ where: { id: backupId }, select: { status: true } });
  if (current?.status !== 'IN_PROGRESS') throw new BackupStoppedError();
}

async function setProgress(backupId: string, progress: number, currentStep: string): Promise<void> {
  await prisma.systemBackup.update({ where: { id: backupId }, data: { progress, currentStep } });
}

/** Records progress on a backup being made; throws BackupStoppedError once it has been stopped. */
async function setBackupProgress(backupId: string, progress: number, currentStep: string): Promise<void> {
  const { count } = await prisma.systemBackup.updateMany({
    where: { id: backupId, status: 'IN_PROGRESS' },
    data: { progress, currentStep },
  });
  if (count === 0) throw new BackupStoppedError();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** A missing audit entry must never turn a finished backup or restore into a failure. */
async function audit(params: Parameters<typeof createAuditLog>[0]): Promise<void> {
  await createAuditLog(params).catch((error) => log.warn(`Could not write audit entry ${params.action}: ${errorText(error)}`));
}

export function serializeSystemBackup<T extends { sizeBytes: bigint }>(backup: T): Omit<T, 'sizeBytes'> & { sizeBytes: number } {
  return { ...backup, sizeBytes: Number(backup.sizeBytes) };
}

// ============================================================================
// Creating a backup
// ============================================================================

/** One backup or restore at a time; an upload still arriving does not count. */
async function assertNothingRunning(): Promise<void> {
  const running = await prisma.systemBackup.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { status: { in: ['IN_PROGRESS', 'RESTORING'] } },
        { status: 'PENDING', source: { not: 'UPLOADED' } },
      ],
    },
    select: { id: true },
  });
  if (running) throw new Error('A full backup or restore is already running');
}

export async function createFullBackup(input: {
  userId?: string;
  name?: string;
  source?: Extract<SystemBackupSource, 'MANUAL' | 'SCHEDULED'>;
}): Promise<{ backupId: string }> {
  const password = await getBackupPassword();
  if (!password) {
    throw new Error('Set a backup password on the Backup page before making a full backup');
  }
  await assertNothingRunning();

  const now = new Date();
  const source = input.source ?? 'MANUAL';
  const backup = await prisma.systemBackup.create({
    data: {
      name: input.name?.trim() || `${source === 'SCHEDULED' ? 'Scheduled' : 'Manual'} backup ${now.toISOString().slice(0, 16).replace('T', ' ')}`,
      source,
      status: 'PENDING',
      createdById: input.userId,
    },
  });

  await audit({
    userId: input.userId,
    action: 'BACKUP_CREATED',
    entityType: 'SystemBackup',
    entityId: backup.id,
    entityName: backup.name,
    summary: `Started full backup "${backup.name}"`,
    changeSource: input.userId ? 'MANUAL' : 'SYSTEM',
  });

  runFullBackup(backup.id, password).catch((error) => log.error(`Full backup ${backup.id} failed:`, error));
  return { backupId: backup.id };
}

/** Exports every table from one consistent snapshot into `dir/db`. */
async function exportDatabase(
  dir: string,
  onProgress: (done: number, total: number) => Promise<void>,
  checkpoint: () => Promise<void>,
) {
  return prisma.$transaction(async (tx) => {
    // Hold every workspace's barriers so no business operation is half-recorded in the snapshot.
    const workspaces = await tx.workspace.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } });
    for (const workspace of workspaces) {
      await acquireBusinessOperationBarrier(tx, workspace.id, 'exclusive');
      await acquireContactMergeBackupBarrier(tx, workspace.id);
    }
    const migrations = await listAppliedMigrations(tx);
    const tables = await listTables(tx);
    const exported: FullBackupManifest['tables'] = [];
    let lockedSecrets = 0;
    let done = 0;
    await fs.promises.mkdir(path.join(dir, 'db'), { recursive: true });
    for (const [name, columns] of tables) {
      const result = await exportTable(tx, name, path.join(dir, tableEntry(name)), checkpoint);
      exported.push({ name, columns, rows: result.rows });
      lockedSecrets += result.lockedSecrets;
      done += 1;
      await onProgress(done, tables.size);
    }
    return { migrations, tables: exported, lockedSecrets, workspaces };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: RESTORE_TIMEOUT_MS, maxWait: 60_000 });
}

/** Copies every stored file (except backups) into `dir/files`. */
async function exportFiles(dir: string, onProgress: (done: number, total: number) => Promise<void>) {
  const listed = (await storage.list('', MAX_STORED_FILES))
    .filter((file) => !BACKUP_STORAGE_PREFIXES.some((prefix) => file.key.startsWith(prefix)));
  const files: FullBackupFile[] = [];
  const skippedFiles: FullBackupManifest['skippedFiles'] = [];
  for (let index = 0; index < listed.length; index++) {
    const { key } = listed[index];
    try {
      const content = await storage.download(key);
      const contentType = await storage.getMetadata(key).then((meta) => meta.contentType).catch(() => 'application/octet-stream');
      const target = path.join(dir, fileEntry(key));
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, content);
      files.push({
        key,
        size: content.length,
        contentType: contentType || 'application/octet-stream',
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
      });
    } catch (error) {
      skippedFiles.push({ key, reason: errorText(error) });
    }
    if (index % 25 === 0 || index === listed.length - 1) await onProgress(index + 1, listed.length);
  }
  return { files, skippedFiles };
}

async function runFullBackup(backupId: string, password: string): Promise<void> {
  try {
    const started = await prisma.systemBackup.updateMany({
      where: { id: backupId, status: 'PENDING' },
      data: { status: 'IN_PROGRESS', progress: 1, currentStep: 'Exporting database' },
    });
    if (started.count === 0) throw new BackupStoppedError();
    const backup = await prisma.systemBackup.findUniqueOrThrow({ where: { id: backupId } });
    const checkpoint = () => assertStillRunning(backupId);

    await withWorkDir(`backup-${backupId}`, async (dir) => {
      const database = await exportDatabase(dir, (done, total) =>
        setBackupProgress(backupId, 1 + Math.floor((done / total) * 29), `Exporting database (${done} of ${total} tables)`), checkpoint);
      const { files, skippedFiles } = await exportFiles(dir, (done, total) =>
        setBackupProgress(backupId, 30 + Math.floor((done / Math.max(total, 1)) * 40), `Copying files (${done} of ${total})`));

      const manifest: FullBackupManifest = {
        format: FULL_BACKUP_FORMAT,
        formatVersion: FULL_BACKUP_FORMAT_VERSION,
        backupId,
        name: backup.name,
        createdAt: backup.createdAt.toISOString(),
        migrations: database.migrations,
        workspaces: database.workspaces,
        tables: database.tables,
        files,
        skippedFiles,
        lockedSecrets: database.lockedSecrets,
        totals: {
          rows: database.tables.reduce((sum, table) => sum + table.rows, 0),
          files: files.length,
          fileBytes: files.reduce((sum, file) => sum + file.size, 0),
        },
      };

      await setBackupProgress(backupId, 72, 'Locking the backup file');
      const archivePath = path.join(dir, 'backup.oakbackup');
      const writer = BackupArchiveWriter.create(archivePath, password);
      for (const table of manifest.tables) await writer.addFile(tableEntry(table.name), path.join(dir, tableEntry(table.name)));
      for (const [index, file] of manifest.files.entries()) {
        if (index % 100 === 99) await checkpoint();
        await writer.addFile(fileEntry(file.key), path.join(dir, fileEntry(file.key)));
      }
      await writer.addBuffer(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest), 'utf-8'));
      await writer.finish();

      await setBackupProgress(backupId, 90, 'Saving the backup file');
      const key = archiveKey(backupId, backup.createdAt);
      const archive = await fs.promises.readFile(archivePath);
      await storage.upload(key, archive, { contentType: 'application/octet-stream' });

      const finished = await prisma.systemBackup.updateMany({
        where: { id: backupId, status: 'IN_PROGRESS' },
        data: {
          status: 'COMPLETED',
          progress: 100,
          currentStep: skippedFiles.length > 0 ? `Completed; ${skippedFiles.length} file(s) could not be read` : 'Completed',
          archiveKey: key,
          sizeBytes: BigInt(archive.length),
          rowsCount: manifest.totals.rows,
          filesCount: manifest.totals.files,
          manifestJson: summarizeManifest(manifest),
          completedAt: new Date(),
        },
      });
      if (finished.count === 0) {
        await storage.delete(key).catch(() => undefined);
        throw new BackupStoppedError();
      }
      await audit({
        userId: backup.createdById ?? undefined,
        action: 'BACKUP_COMPLETED',
        entityType: 'SystemBackup',
        entityId: backupId,
        entityName: backup.name,
        summary: `Full backup completed: ${manifest.totals.rows} records, ${manifest.totals.files} files`,
        changeSource: backup.createdById ? 'MANUAL' : 'SYSTEM',
        metadata: { skippedFiles: skippedFiles.length, lockedSecrets: manifest.lockedSecrets },
      });
      log.info(`Full backup ${backupId} completed (${archive.length} bytes)`);
      await copyBackupToSharePoint(backupId, archive);
    });
  } catch (error) {
    // Stop already recorded the outcome; the rolled-back export and removed work folder are all that was left.
    if (error instanceof BackupStoppedError) {
      log.info(`Full backup ${backupId} stopped`);
      return;
    }
    await prisma.systemBackup.update({
      where: { id: backupId },
      data: { status: 'FAILED', currentStep: 'Failed', errorMessage: errorText(error) },
    }).catch(() => undefined);
    await audit({
      action: 'BACKUP_FAILED',
      entityType: 'SystemBackup',
      entityId: backupId,
      summary: `Full backup failed: ${errorText(error)}`,
      changeSource: 'SYSTEM',
    });
    throw error;
  }
}

/** The manifest kept on the record: everything except the per-file list, which can be large. */
function summarizeManifest(manifest: FullBackupManifest): Prisma.InputJsonObject {
  const { files: _files, ...rest } = manifest;
  return {
    ...rest,
    skippedFiles: rest.skippedFiles.slice(0, 50),
    tables: rest.tables.map((table) => ({ name: table.name, rows: table.rows, columns: [] as string[] })),
  } as unknown as Prisma.InputJsonObject;
}

// ============================================================================
// Listing, downloading, uploading and deleting
// ============================================================================

export async function listFullBackups(params: { page?: number; limit?: number } = {}) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const where: Prisma.SystemBackupWhereInput = { deletedAt: null };
  const [backups, totalCount] = await Promise.all([
    prisma.systemBackup.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.systemBackup.count({ where }),
  ]);
  return { backups, totalCount };
}

export async function getFullBackup(backupId: string) {
  const backup = await prisma.systemBackup.findFirst({ where: { id: backupId, deletedAt: null } });
  if (!backup) throw new Error('Backup not found');
  return backup;
}

export async function downloadFullBackup(backupId: string): Promise<{ fileName: string; content: Buffer }> {
  const backup = await getFullBackup(backupId);
  if (!backup.archiveKey || !['COMPLETED', 'RESTORED'].includes(backup.status)) {
    throw new Error('This backup is not ready to download');
  }
  return { fileName: path.posix.basename(backup.archiveKey), content: await storage.download(backup.archiveKey) };
}

/**
 * Stops a backup that is being made. The running job notices at its next
 * checkpoint, abandons its snapshot and removes its work files; nothing in
 * the live data changes. Also clears a backup left running by a restart.
 */
export async function stopFullBackup(backupId: string, userId?: string): Promise<void> {
  const backup = await getFullBackup(backupId);
  if (backup.source === 'UPLOADED' || !['PENDING', 'IN_PROGRESS'].includes(backup.status)) {
    throw new Error('Only a backup that is being made can be stopped');
  }
  const { count } = await prisma.systemBackup.updateMany({
    where: { id: backupId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    data: { status: 'FAILED', currentStep: STOPPED_STEP, errorMessage: 'Stopped before it finished; no backup file was kept' },
  });
  if (count === 0) throw new Error('The backup has already finished');
  await audit({
    userId,
    action: 'BACKUP_FAILED',
    entityType: 'SystemBackup',
    entityId: backupId,
    entityName: backup.name,
    summary: `Stopped full backup "${backup.name}"`,
    changeSource: userId ? 'MANUAL' : 'SYSTEM',
  });
}

export async function deleteFullBackup(backupId: string, userId?: string): Promise<void> {
  const backup = await getFullBackup(backupId);
  if (['PENDING', 'IN_PROGRESS', 'RESTORING'].includes(backup.status) && backup.source !== 'UPLOADED') {
    throw new Error('Cannot delete a backup that is running');
  }
  await storage.deletePrefix(`system-backups/${backupId}/`).catch((error) =>
    log.warn(`Failed to delete stored files for backup ${backupId}:`, error));
  await removeUploadFile(backupId);
  await prisma.systemBackup.update({ where: { id: backupId }, data: { status: 'DELETED', deletedAt: new Date() } });
  await audit({
    userId,
    action: 'BACKUP_DELETED',
    entityType: 'SystemBackup',
    entityId: backupId,
    entityName: backup.name,
    summary: `Deleted full backup "${backup.name}"`,
    changeSource: userId ? 'MANUAL' : 'SYSTEM',
  });
}

function uploadPath(backupId: string): string {
  return path.join(workRoot(), 'uploads', `${backupId}.part`);
}

async function removeUploadFile(backupId: string): Promise<void> {
  await fs.promises.rm(uploadPath(backupId), { force: true });
}

/**
 * Uploads arrive in chunks so a large backup file fits under request size
 * limits (and Cloudflare's). Each chunk says where it starts; a repeated chunk
 * is ignored, so the browser can retry safely.
 */
export async function startBackupUpload(input: { fileName: string; size: number; userId: string }): Promise<{ backupId: string }> {
  if (!input.fileName.toLowerCase().endsWith(FULL_BACKUP_FILE_EXTENSION)) {
    throw new Error(`Choose an Oakcloud backup file (${FULL_BACKUP_FILE_EXTENSION})`);
  }
  const backup = await prisma.systemBackup.create({
    data: {
      name: input.fileName.replace(/\.oakbackup$/i, ''),
      source: 'UPLOADED',
      status: 'PENDING',
      currentStep: 'Uploading',
      sizeBytes: BigInt(input.size),
      createdById: input.userId,
    },
  });
  await fs.promises.mkdir(path.dirname(uploadPath(backup.id)), { recursive: true });
  await fs.promises.writeFile(uploadPath(backup.id), Buffer.alloc(0));
  return { backupId: backup.id };
}

export async function appendBackupUploadChunk(backupId: string, offset: number, chunk: Buffer): Promise<{ received: number }> {
  const backup = await getFullBackup(backupId);
  if (backup.source !== 'UPLOADED' || backup.status !== 'PENDING') throw new Error('This upload is no longer open');
  const filePath = uploadPath(backupId);
  const received = (await fs.promises.stat(filePath)).size;
  if (offset + chunk.length <= received) return { received };
  if (offset !== received) throw new Error(`Upload out of order: expected byte ${received}, got ${offset}`);
  if (received + chunk.length > Number(backup.sizeBytes)) throw new Error('Upload is larger than announced');
  await fs.promises.appendFile(filePath, chunk);
  const progress = Math.floor(((received + chunk.length) / Math.max(Number(backup.sizeBytes), 1)) * 100);
  await setProgress(backupId, progress, 'Uploading');
  return { received: received + chunk.length };
}

export async function completeBackupUpload(backupId: string, userId: string): Promise<void> {
  const backup = await getFullBackup(backupId);
  const filePath = uploadPath(backupId);
  const content = await fs.promises.readFile(filePath);
  if (content.length !== Number(backup.sizeBytes)) {
    throw new Error(`Upload incomplete: received ${content.length} of ${backup.sizeBytes} bytes`);
  }
  const key = archiveKey(backupId, backup.createdAt);
  await storage.upload(key, content, { contentType: 'application/octet-stream' });
  await removeUploadFile(backupId);
  await prisma.systemBackup.update({
    where: { id: backupId },
    data: { status: 'COMPLETED', progress: 100, currentStep: 'Uploaded; enter the backup password to check it', archiveKey: key, completedAt: new Date() },
  });
  await audit({
    userId,
    action: 'BACKUP_CREATED',
    entityType: 'SystemBackup',
    entityId: backupId,
    entityName: backup.name,
    summary: `Uploaded full backup "${backup.name}"`,
    changeSource: 'MANUAL',
  });
}

/**
 * Copies a backup file from the SharePoint backup folder onto this install so
 * it can be checked and restored, for example on a new machine.
 */
export async function importSharePointBackup(itemId: string, userId: string): Promise<{ backupId: string }> {
  const existing = await prisma.systemBackup.findFirst({
    where: { sharePointItemId: itemId, deletedAt: null, archiveKey: { not: null }, status: { in: ['COMPLETED', 'RESTORED'] } },
    select: { id: true },
  });
  if (existing) return { backupId: existing.id };

  const backup = await prisma.systemBackup.create({
    data: {
      name: 'Copy from SharePoint',
      source: 'UPLOADED',
      status: 'PENDING',
      currentStep: 'Downloading from SharePoint',
      createdById: userId,
      sharePointStatus: 'UPLOADED',
      sharePointItemId: itemId,
    },
  });
  void (async () => {
    try {
      const file = await downloadSharePointBackupFile(itemId);
      const key = `system-backups/${backup.id}/${file.name}`;
      await storage.upload(key, file.content, { contentType: 'application/octet-stream' });
      await prisma.systemBackup.update({
        where: { id: backup.id },
        data: {
          name: file.name.replace(/\.oakbackup$/i, ''),
          status: 'COMPLETED',
          progress: 100,
          currentStep: 'Copied from SharePoint; enter the backup password to check it',
          archiveKey: key,
          sizeBytes: BigInt(file.content.length),
          completedAt: new Date(),
          sharePointWebUrl: file.webUrl,
        },
      });
      await audit({
        userId,
        action: 'BACKUP_CREATED',
        entityType: 'SystemBackup',
        entityId: backup.id,
        entityName: file.name,
        summary: `Copied full backup "${file.name}" from SharePoint`,
        changeSource: 'MANUAL',
      });
    } catch (error) {
      log.error(`Copying backup ${itemId} from SharePoint failed: ${errorText(error)}`);
      await prisma.systemBackup.update({
        where: { id: backup.id },
        data: { status: 'FAILED', currentStep: 'Failed', errorMessage: `Could not copy from SharePoint: ${errorText(error)}` },
      }).catch(() => undefined);
    }
  })();
  return { backupId: backup.id };
}

// ============================================================================
// Checking and restoring
// ============================================================================

/**
 * Unlocks the backup into `dir/staging`. The whole file is always read (that
 * is what checks the password and integrity); `include` limits what is written.
 */
async function extractBackup(
  backupId: string,
  password: string,
  dir: string,
  include?: (entry: string) => boolean,
): Promise<FullBackupManifest> {
  const backup = await getFullBackup(backupId);
  if (!backup.archiveKey) throw new Error('This backup has no file to restore from');
  const archivePath = path.join(dir, 'backup.oakbackup');
  await fs.promises.writeFile(archivePath, await storage.download(backup.archiveKey));
  const stagingDir = path.join(dir, 'staging');
  await extractArchive(archivePath, password, stagingDir, include && ((entry) => entry === MANIFEST_ENTRY || include(entry)));
  await fs.promises.rm(archivePath, { force: true });

  const manifestPath = path.join(stagingDir, MANIFEST_ENTRY);
  if (!fs.existsSync(manifestPath)) throw new Error('The backup file has no manifest');
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8')) as FullBackupManifest;
  if (manifest.format !== FULL_BACKUP_FORMAT) throw new Error('This is not an Oakcloud full backup');

  // Keep what we learned about uploaded files on their record.
  if (backup.source === 'UPLOADED' && !backup.manifestJson) {
    await prisma.systemBackup.update({
      where: { id: backupId },
      data: {
        manifestJson: summarizeManifest(manifest),
        rowsCount: manifest.totals.rows,
        filesCount: manifest.totals.files,
        currentStep: 'Checked',
      },
    });
  }
  return manifest;
}

function countRows(manifest: FullBackupManifest, table: string): number {
  return manifest.tables.find((entry) => entry.name === table)?.rows ?? 0;
}

async function buildPreview(backupId: string, manifest: FullBackupManifest): Promise<FullBackupPreview> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const applied = new Set(await listAppliedMigrations(prisma));
  const missing = manifest.migrations.filter((migration) => !applied.has(migration));
  if (missing.length > 0) {
    blockers.push(
      `This backup comes from a newer version of Oakcloud (${missing.length} database update(s) this install does not have). ` +
      'Update this install first: git pull, rebuild the app, run prisma migrate deploy, then try again.',
    );
  }
  if (manifest.formatVersion > FULL_BACKUP_FORMAT_VERSION) {
    blockers.push('This backup was made by a newer version of Oakcloud. Update this install first.');
  }
  const backupMigrations = new Set(manifest.migrations);
  if ([...applied].some((migration) => !backupMigrations.has(migration))) {
    warnings.push('This install is newer than the backup. The data will be brought across and new fields will take their default values.');
  }

  const [users, companies] = await Promise.all([prisma.user.count(), prisma.company.count()]);
  if (users + companies > 0) {
    warnings.push(`Everything now in this Oakcloud (${companies} companies, ${users} users) will be replaced by the backup.`);
  }
  if (manifest.skippedFiles.length > 0) {
    warnings.push(`${manifest.skippedFiles.length} stored file(s) could not be read when this backup was made, so they are not in it.`);
  }
  if (manifest.lockedSecrets > 0) {
    warnings.push(`${manifest.lockedSecrets} connector secret(s) could not be unlocked when this backup was made. Re-enter those connectors' keys after restoring.`);
  }
  warnings.push('Everyone is signed out. Sign in with an account from the backup, then restart Oakcloud (docker compose restart app).');

  return {
    backupId,
    name: manifest.name,
    createdAt: manifest.createdAt,
    workspaces: manifest.workspaces,
    totals: manifest.totals,
    counts: {
      users: countRows(manifest, 'users'),
      companies: countRows(manifest, 'companies'),
      contacts: countRows(manifest, 'contacts'),
      documents: countRows(manifest, 'documents') + countRows(manifest, 'generated_documents'),
      templates: countRows(manifest, 'document_templates') + countRows(manifest, 'template_partials'),
      connectors: countRows(manifest, 'connectors'),
    },
    skippedFiles: manifest.skippedFiles.length,
    lockedSecrets: manifest.lockedSecrets,
    blockers,
    warnings,
    modules: await summarizeModules(manifest),
  };
}

/** Rows per module in the backup and on this machine. */
async function summarizeModules(manifest: FullBackupManifest): Promise<FullBackupModuleSummary[]> {
  const summaries = new Map<string, FullBackupModuleSummary>(BACKUP_MODULES.map((module) => [
    module.key,
    { ...module, backupRows: 0, liveRows: 0 },
  ]));
  for (const table of manifest.tables) {
    if (MODULE_RESTORE_SKIPPED_TABLES.has(table.name)) continue;
    summaries.get(moduleForTable(table.name))!.backupRows += table.rows;
  }
  for (const table of (await listTables(prisma)).keys()) {
    if (MODULE_RESTORE_SKIPPED_TABLES.has(table)) continue;
    const [row] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${quoteIdent(table)}`);
    summaries.get(moduleForTable(table))!.liveRows += Number(row.n);
  }
  return [...summaries.values()].filter((module) => module.backupRows > 0 || module.liveRows > 0);
}

/** Unlocks and checks the backup file, then says what a restore would do. Changes nothing. */
export async function previewFullRestore(backupId: string, password: string): Promise<FullBackupPreview> {
  return withWorkDir(`check-${backupId}`, async (dir) =>
    buildPreview(backupId, await extractBackup(backupId, password, dir, () => false)));
}

/** Starts a full restore in the background. The caller must pass the typed confirmation. */
export async function startFullRestore(input: {
  backupId: string;
  password: string;
  confirmation: string;
  userId: string;
}): Promise<void> {
  if (input.confirmation !== FULL_RESTORE_CONFIRMATION) {
    throw new Error(`Type ${FULL_RESTORE_CONFIRMATION} to confirm the restore`);
  }
  const backup = await getFullBackup(input.backupId);
  if (!['COMPLETED', 'RESTORED'].includes(backup.status)) throw new Error('This backup is not ready to restore');
  await assertNothingRunning();

  await prisma.systemBackup.update({
    where: { id: input.backupId },
    data: { status: 'RESTORING', progress: 0, currentStep: 'Unlocking the backup file', errorMessage: null },
  });
  runFullRestore(input.backupId, input.password, input.userId, backup.status).catch((error) =>
    log.error(`Full restore of ${input.backupId} failed:`, error));
}

async function runFullRestore(
  backupId: string,
  password: string,
  userId: string,
  previousStatus: 'COMPLETED' | 'RESTORED' | string,
): Promise<void> {
  let databaseReplaced = false;
  try {
    await withWorkDir(`restore-${backupId}`, async (dir) => {
      const manifest = await extractBackup(backupId, password, dir);
      const preview = await buildPreview(backupId, manifest);
      if (preview.blockers.length > 0) throw new Error(preview.blockers.join(' '));
      const staging = path.join(dir, 'staging');

      await setProgress(backupId, 10, 'Replacing the database');
      await prisma.$transaction(async (tx) => {
        const current = await tx.workspace.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
        for (const workspace of current) {
          await acquireBusinessOperationBarrier(tx, workspace.id, 'exclusive');
          await acquireContactMergeBackupBarrier(tx, workspace.id);
        }
        await replaceDatabase(tx, {
          tables: manifest.tables,
          tableFile: (table) => path.join(staging, tableEntry(table)),
        });
        // Assistant work that was in flight when the backup was made must not resume on its own.
        for (const workspace of manifest.workspaces) await invalidateRestoredAssistantDispatch(tx, workspace.id);
      }, { timeout: RESTORE_TIMEOUT_MS, maxWait: 60_000 });
      databaseReplaced = true;

      let failures = 0;
      for (let index = 0; index < manifest.files.length; index++) {
        const file = manifest.files[index];
        try {
          const filePath = path.join(staging, fileEntry(file.key));
          if ((await sha256File(filePath)) !== file.sha256) throw new Error('checksum mismatch');
          await storage.upload(file.key, await fs.promises.readFile(filePath), { contentType: file.contentType });
        } catch (error) {
          failures += 1;
          log.warn(`Could not restore stored file ${file.key}: ${errorText(error)}`);
        }
        if (index % 25 === 0 || index === manifest.files.length - 1) {
          await setProgress(backupId, 50 + Math.floor(((index + 1) / manifest.files.length) * 48), `Restoring files (${index + 1} of ${manifest.files.length})`);
        }
      }
      if (failures > 0) throw new Error(`The database was restored, but ${failures} file(s) could not be written. Run the restore again to retry.`);

      await prisma.systemBackup.update({
        where: { id: backupId },
        data: { status: 'RESTORED', progress: 100, currentStep: 'Restored', restoredAt: new Date(), restoredById: userId, errorMessage: null },
      });
      await audit({
        userId: await existingUserId(userId),
        action: 'BACKUP_RESTORE_COMPLETED',
        entityType: 'SystemBackup',
        entityId: backupId,
        entityName: manifest.name,
        summary: `Restored full backup "${manifest.name}" (${manifest.totals.rows} records, ${manifest.totals.files} files)`,
        changeSource: 'MANUAL',
      });
    });
  } catch (error) {
    await prisma.systemBackup.update({
      where: { id: backupId },
      data: {
        status: previousStatus === 'RESTORED' ? 'RESTORED' : 'COMPLETED',
        currentStep: databaseReplaced ? 'Restore incomplete' : 'Restore failed; nothing was changed',
        errorMessage: errorText(error),
      },
    }).catch(() => undefined);
    await audit({
      userId: await existingUserId(userId),
      action: 'BACKUP_RESTORE_FAILED',
      entityType: 'SystemBackup',
      entityId: backupId,
      summary: `Full restore failed: ${errorText(error)}`,
      changeSource: 'SYSTEM',
    });
    throw error;
  }
}

// ============================================================================
// Restoring chosen modules
// ============================================================================

function assertModules(modules: string[]): string[] {
  const unique = [...new Set(modules)];
  if (unique.length === 0) throw new Error('Choose at least one module to restore');
  const unknown = unique.filter((module) => !isBackupModuleKey(module));
  if (unknown.length > 0) throw new Error(`Unknown module: ${unknown.join(', ')}`);
  return unique;
}

/** Only the chosen modules' table files (and the manifest) are written out. */
function moduleEntryFilter(modules: string[], extraFiles: Set<string> = new Set()): (entry: string) => boolean {
  const wanted = new Set(modules);
  return (entry) => {
    const table = entry.match(/^db\/(.+)\.jsonl$/)?.[1];
    if (table) return wanted.has(moduleForTable(table));
    return extraFiles.has(entry);
  };
}

async function missingStoredFiles(manifest: FullBackupManifest): Promise<FullBackupFile[]> {
  const present = new Set((await storage.list('', MAX_STORED_FILES)).map((file) => file.key));
  return manifest.files.filter((file) => !present.has(file.key));
}

async function buildModulePreview(
  backupId: string,
  manifest: FullBackupManifest,
  modules: string[],
  staging: string,
  db: Prisma.TransactionClient,
): Promise<ModuleRestorePreview> {
  const full = await buildPreview(backupId, manifest);
  const blockers = [...full.blockers];
  const { changes, links } = await previewModules(db, {
    tables: manifest.tables,
    modules,
    tableFile: (table) => path.join(staging, tableEntry(table)),
  });
  const suggestedModules = [...new Set(links.map((link) => link.addModule))].filter((module) => !modules.includes(module));
  if (links.length > 0) {
    blockers.push(`Restoring only these modules would break links between records. Also restore: ${suggestedModules.map(moduleLabel).join(', ')}.`);
  }
  const warnings: string[] = [];
  if (modules.includes('users')) {
    warnings.push('Accounts, passwords and roles go back to the backup. Your own sign-in may change.');
  }
  if (modules.includes('connectors')) {
    warnings.push('Connector keys go back to the ones in the backup.');
  }
  if (full.lockedSecrets > 0 && modules.includes('connectors')) {
    warnings.push(`${full.lockedSecrets} connector secret(s) could not be unlocked when this backup was made. Re-enter those keys after restoring.`);
  }
  warnings.push('Records in other modules are not changed. This machine\'s backup password, schedule and SharePoint folder are kept.');
  return {
    backupId,
    modules,
    changes,
    links,
    suggestedModules,
    missingFiles: (await missingStoredFiles(manifest)).length,
    blockers,
    warnings,
  };
}

/** Says what restoring the chosen modules would change. Changes nothing. */
export async function previewModuleRestore(backupId: string, password: string, modules: string[]): Promise<ModuleRestorePreview> {
  const selected = assertModules(modules);
  return withWorkDir(`check-${backupId}`, async (dir) => {
    const manifest = await extractBackup(backupId, password, dir, moduleEntryFilter(selected));
    const staging = path.join(dir, 'staging');
    // Temporary tables only; they are dropped when this transaction ends.
    return prisma.$transaction(
      (tx) => buildModulePreview(backupId, manifest, selected, staging, tx),
      { timeout: RESTORE_TIMEOUT_MS, maxWait: 60_000 },
    );
  });
}

/** Starts restoring the chosen modules in the background. The caller must pass the typed confirmation. */
export async function startModuleRestore(input: {
  backupId: string;
  password: string;
  modules: string[];
  restoreMissingFiles: boolean;
  confirmation: string;
  userId: string;
}): Promise<void> {
  if (input.confirmation !== FULL_RESTORE_CONFIRMATION) {
    throw new Error(`Type ${FULL_RESTORE_CONFIRMATION} to confirm the restore`);
  }
  const modules = assertModules(input.modules);
  const backup = await getFullBackup(input.backupId);
  if (!['COMPLETED', 'RESTORED'].includes(backup.status)) throw new Error('This backup is not ready to restore');
  await assertNothingRunning();

  await prisma.systemBackup.update({
    where: { id: input.backupId },
    data: { status: 'RESTORING', progress: 0, currentStep: 'Unlocking the backup file', errorMessage: null },
  });
  runModuleRestore({ ...input, modules }, backup.status).catch((error) =>
    log.error(`Module restore of ${input.backupId} failed:`, error));
}

async function runModuleRestore(
  input: { backupId: string; password: string; modules: string[]; restoreMissingFiles: boolean; userId: string },
  previousStatus: string,
): Promise<void> {
  const { backupId, modules, userId } = input;
  const labels = modules.map(moduleLabel).join(', ');
  let databaseReplaced = false;
  try {
    await withWorkDir(`restore-${backupId}`, async (dir) => {
      // The manifest says which files exist; read it first so only missing files are written out.
      const manifest = await extractBackup(backupId, input.password, dir, () => false);
      const missing = input.restoreMissingFiles ? await missingStoredFiles(manifest) : [];
      await fs.promises.rm(path.join(dir, 'staging'), { recursive: true, force: true });
      await setProgress(backupId, 5, 'Unlocking the chosen modules');
      await extractBackup(backupId, input.password, dir, moduleEntryFilter(modules, new Set(missing.map((file) => fileEntry(file.key)))));
      const staging = path.join(dir, 'staging');

      await setProgress(backupId, 20, `Restoring ${labels}`);
      await prisma.$transaction(async (tx) => {
        const current = await tx.workspace.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
        for (const workspace of current) {
          await acquireBusinessOperationBarrier(tx, workspace.id, 'exclusive');
          await acquireContactMergeBackupBarrier(tx, workspace.id);
        }
        // Checked again inside the same transaction, so nothing can change in between.
        const preview = await buildModulePreview(backupId, manifest, modules, staging, tx);
        if (preview.blockers.length > 0) throw new Error(preview.blockers.join(' '));
        await restoreModules(tx, { tables: manifest.tables, modules, tableFile: (table) => path.join(staging, tableEntry(table)) });
        if (modules.includes('assistant')) {
          for (const workspace of manifest.workspaces) await invalidateRestoredAssistantDispatch(tx, workspace.id);
        }
      }, { timeout: RESTORE_TIMEOUT_MS, maxWait: 60_000 });
      databaseReplaced = true;

      let failures = 0;
      for (let index = 0; index < missing.length; index++) {
        const file = missing[index];
        try {
          const filePath = path.join(staging, fileEntry(file.key));
          if ((await sha256File(filePath)) !== file.sha256) throw new Error('checksum mismatch');
          await storage.upload(file.key, await fs.promises.readFile(filePath), { contentType: file.contentType });
        } catch (error) {
          failures += 1;
          log.warn(`Could not restore stored file ${file.key}: ${errorText(error)}`);
        }
        if (index % 25 === 0 || index === missing.length - 1) {
          await setProgress(backupId, 60 + Math.floor(((index + 1) / missing.length) * 38), `Putting back missing files (${index + 1} of ${missing.length})`);
        }
      }
      if (failures > 0) throw new Error(`${labels} were restored, but ${failures} file(s) could not be written. Run the restore again to retry.`);

      await prisma.systemBackup.update({
        where: { id: backupId },
        data: {
          status: 'RESTORED',
          progress: 100,
          currentStep: `Restored ${labels}`,
          restoredAt: new Date(),
          restoredById: userId,
          errorMessage: null,
        },
      });
      await audit({
        userId: await existingUserId(userId),
        action: 'BACKUP_RESTORE_COMPLETED',
        entityType: 'SystemBackup',
        entityId: backupId,
        entityName: manifest.name,
        summary: `Restored ${labels} from full backup "${manifest.name}"${missing.length ? ` and ${missing.length} missing file(s)` : ''}`,
        changeSource: 'MANUAL',
        metadata: { modules },
      });
    });
  } catch (error) {
    await prisma.systemBackup.update({
      where: { id: backupId },
      data: {
        status: previousStatus === 'RESTORED' ? 'RESTORED' : 'COMPLETED',
        currentStep: databaseReplaced ? 'Restore incomplete' : 'Restore failed; nothing was changed',
        errorMessage: errorText(error),
      },
    }).catch(() => undefined);
    await audit({
      userId: await existingUserId(userId),
      action: 'BACKUP_RESTORE_FAILED',
      entityType: 'SystemBackup',
      entityId: backupId,
      summary: `Restoring ${labels} failed: ${errorText(error)}`,
      changeSource: 'SYSTEM',
    });
    throw error;
  }
}

/** The person who started a restore may not exist in the restored data. */
async function existingUserId(userId: string): Promise<string | undefined> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user?.id;
}

// ============================================================================
// Schedule and housekeeping
// ============================================================================

/** Runs the full-backup schedule when it is due, then keeps only the newest scheduled backups. */
export async function processScheduledFullBackup(): Promise<{ backupId?: string; error?: string } | null> {
  if (!(await claimDueScheduledRun())) return null;
  try {
    const { backupId } = await createFullBackup({ source: 'SCHEDULED' });
    await recordScheduledRun({ backupId });
    await pruneScheduledBackups(await getScheduledMaxBackups());
    return { backupId };
  } catch (error) {
    await recordScheduledRun({ error: errorText(error) });
    return { error: errorText(error) };
  }
}

async function pruneScheduledBackups(maxBackups: number): Promise<void> {
  const completed = await prisma.systemBackup.findMany({
    where: { source: 'SCHEDULED', status: { in: ['COMPLETED', 'RESTORED'] }, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  for (const backup of completed.slice(maxBackups)) {
    await deleteFullBackup(backup.id).catch((error) => log.error(`Failed to prune backup ${backup.id}:`, error));
  }
}

/** Marks backups and restores left running by a restart as failed. */
export async function cleanupStaleFullBackups(staleMinutes = 120): Promise<number> {
  const threshold = new Date(Date.now() - staleMinutes * 60 * 1000);
  await cleanupStaleSharePointCopies(threshold);
  const stale = await prisma.systemBackup.findMany({
    where: { status: { in: ['PENDING', 'IN_PROGRESS', 'RESTORING'] }, updatedAt: { lte: threshold }, deletedAt: null },
    select: { id: true, status: true, source: true },
  });
  for (const backup of stale) {
    const wasRestore = backup.status === 'RESTORING';
    await prisma.systemBackup.update({
      where: { id: backup.id },
      data: wasRestore
        ? { status: 'COMPLETED', currentStep: 'Restore interrupted', errorMessage: 'The restore stopped before finishing (the app restarted). Run it again.' }
        : { status: 'FAILED', currentStep: 'Failed', errorMessage: backup.source === 'UPLOADED' ? 'Upload was not finished' : 'The backup stopped before finishing (the app restarted)' },
    });
    if (backup.source === 'UPLOADED') await removeUploadFile(backup.id);
  }
  return stale.length;
}
