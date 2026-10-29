/**
 * SharePoint cloud copy of full backups on real PostgreSQL, against an
 * in-memory stand-in for the SharePoint folder: each backup is copied up,
 * retries and pruning behave, and a backup listed in SharePoint can be copied
 * back down and checked for restore.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';
const FOLDER_ID = 'backup-folder';
const DRIVE_ID = 'drive-1';
const dbName = `oak_fullbackup_sp_${randomUUID().slice(0, 8)}`;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oak-full-backup-sp-test-'));

interface FakeItem { id: string; name: string; parentId: string; content?: Buffer; folder?: boolean; createdDateTime: string }
const remote = vi.hoisted(() => ({ items: new Map<string, FakeItem>(), uploads: 0 }));

vi.mock('@/services/sharepoint.service', () => {
  class SharePointServiceError extends Error {
    category: string;
    statusCode?: number;
    code: string;
    constructor(input: { code: string; category: string; message: string; statusCode?: number }) {
      super(input.message);
      this.code = input.code;
      this.category = input.category;
      this.statusCode = input.statusCode;
    }
  }
  const view = (item: FakeItem) => ({
    id: item.id,
    name: item.name,
    webUrl: `https://sharepoint.test/${item.name}`,
    size: item.content?.length ?? 0,
    createdDateTime: item.createdDateTime,
    ...(item.folder ? { folder: {} } : { file: {} }),
  });
  return {
    SharePointServiceError,
    assertSafeGraphContinuationUrl: (value: string) => new URL(value),
    getWorkspaceSharePointContext: async (input: { workspaceId: string; connectorId: string }) => ({
      ...input,
      connectorName: 'SharePoint',
      credentials: {},
      settings: {},
      driveId: DRIVE_ID,
    }),
    getCanonicalSharePointItem: async (_context: unknown, itemId: string) => {
      const item = remote.items.get(itemId);
      if (!item) throw new SharePointServiceError({ code: 'NOT_FOUND', category: 'NOT_FOUND', statusCode: 404, message: 'SharePoint item not found' });
      return { ...view(item), driveId: DRIVE_ID, parentItemId: item.parentId, isFolder: Boolean(item.folder) };
    },
    uploadSharePointContent: async (_context: unknown, folderId: string, fileName: string, content: Buffer) => {
      if ([...remote.items.values()].some((item) => item.parentId === folderId && item.name === fileName)) {
        throw new SharePointServiceError({ code: 'CONFLICT', category: 'CONFLICT', statusCode: 409, message: 'Name already exists' });
      }
      remote.uploads += 1;
      const item = { id: randomUUID(), name: fileName, parentId: folderId, content: Buffer.from(content), createdDateTime: new Date().toISOString() };
      remote.items.set(item.id, item);
      return { ...view(item), eTag: '', driveId: DRIVE_ID };
    },
    downloadSharePointItemContent: async (_context: unknown, itemId: string) => remote.items.get(itemId)!.content!,
    sharePointGraphRequest: async (_context: unknown, requestPath: string, options: RequestInit = {}) => {
      const children = requestPath.match(/^\/items\/([^/]+)\/children/);
      if (children) {
        const parentId = decodeURIComponent(children[1]);
        return { value: [...remote.items.values()].filter((item) => item.parentId === parentId).map(view) };
      }
      const byPath = requestPath.match(/^\/items\/([^/:]+):\/([^:?]+)/);
      if (byPath) {
        const item = [...remote.items.values()].find((entry) => entry.parentId === decodeURIComponent(byPath[1]) && entry.name === decodeURIComponent(byPath[2]));
        if (!item) throw new SharePointServiceError({ code: 'NOT_FOUND', category: 'NOT_FOUND', statusCode: 404, message: 'Not found' });
        return view(item);
      }
      const single = requestPath.match(/^\/items\/([^/?]+)$/);
      if (single && options.method === 'DELETE') {
        remote.items.delete(decodeURIComponent(single[1]));
        return {};
      }
      throw new Error(`Unexpected SharePoint request ${requestPath}`);
    },
  };
});

function databaseUrl(name: string): string {
  const url = new URL(testDatabaseUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function admin(sql: string): Promise<void> {
  const client = new Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 600; attempt++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out');
}

function addRemoteFile(name: string, parentId = FOLDER_ID, content = Buffer.from('x')): string {
  const id = randomUUID();
  remote.items.set(id, { id, name, parentId, content, createdDateTime: '2020-01-01T00:00:00Z' });
  return id;
}

describePostgres('full backups copied to SharePoint', () => {
  let connectorId: string;
  let userId: string;

  beforeAll(async () => {
    await admin(`CREATE DATABASE "${dbName}"`);
    const env = { ...process.env, DATABASE_URL: databaseUrl(dbName) };
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'ignore' });
    execFileSync('npx', ['tsx', 'prisma/seed.ts'], { env, stdio: 'ignore' });

    const globals = global as unknown as { __prisma?: { $disconnect(): Promise<void> }; __prismaPool?: { end(): Promise<void> } };
    await globals.__prisma?.$disconnect();
    await globals.__prismaPool?.end();
    globals.__prisma = undefined;
    globals.__prismaPool = undefined;
    process.env.DATABASE_URL = databaseUrl(dbName);
    process.env.ENCRYPTION_KEY = 'sharepoint-test-key-0123456789abcdef';
    process.env.STORAGE_PROVIDER = 'local';
    process.env.STORAGE_LOCAL_PATH = path.join(workDir, 'storage');
    process.env.BACKUP_WORK_DIR = path.join(workDir, 'work');
    (await import('@/lib/storage')).resetStorage();

    const { prisma } = await import('@/lib/prisma');
    const { encrypt } = await import('@/lib/encryption');
    const workspace = await prisma.workspace.findFirstOrThrow();
    userId = (await prisma.user.findFirstOrThrow({ where: { tenantId: null } })).id;
    connectorId = (await prisma.connector.create({
      data: { name: 'Firm SharePoint', type: 'STORAGE', provider: 'SHAREPOINT', workspaceId: workspace.id, credentials: encrypt('{}') },
    })).id;
    remote.items.set(FOLDER_ID, { id: FOLDER_ID, name: 'Oakcloud backups', parentId: 'root', folder: true, createdDateTime: '2020-01-01T00:00:00Z' });
    await (await import('@/services/backup/full/backup-settings')).setBackupPassword(PASSWORD, userId);
  }, 240_000);

  afterAll(async () => {
    const globals = global as unknown as { __prisma?: { $disconnect(): Promise<void> }; __prismaPool?: { end(): Promise<void> } };
    await globals.__prisma?.$disconnect();
    await globals.__prismaPool?.end();
    globals.__prisma = undefined;
    globals.__prismaPool = undefined;
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('copies each finished backup into the chosen folder and prunes only Oakcloud files', async () => {
    const target = await import('@/services/backup/full/sharepoint-target');
    const service = await import('@/services/backup/full/full-backup.service');

    await expect(target.setSharePointBackupTarget({ connectorId, folderId: addRemoteFile('not-a-folder.txt', 'root'), maxBackups: 1 }, userId))
      .rejects.toThrow(/folder, not a file/);
    const saved = await target.setSharePointBackupTarget({ connectorId, folderId: FOLDER_ID, maxBackups: 1 }, userId);
    expect(saved).toMatchObject({ folderName: 'Oakcloud backups', driveId: DRIVE_ID, connectorName: 'Firm SharePoint' });

    const older = addRemoteFile('oakcloud-20200101-0000.oakbackup');
    const personal = addRemoteFile('before-migration.oakbackup');

    const { backupId } = await service.createFullBackup({ userId });
    const backup = await waitFor(() => service.getFullBackup(backupId), (value) => value.status !== 'PENDING' && value.status !== 'IN_PROGRESS' && value.sharePointStatus !== 'UPLOADING');
    expect(backup.status).toBe('COMPLETED');
    expect(backup.sharePointStatus).toBe('UPLOADED');
    const copied = remote.items.get(backup.sharePointItemId!)!;
    expect(copied.parentId).toBe(FOLDER_ID);
    expect(copied.content!.length).toBe(Number(backup.sizeBytes));

    // Keep the newest 1 Oakcloud file; a file someone named themselves stays.
    expect(remote.items.has(older)).toBe(false);
    expect(remote.items.has(personal)).toBe(true);

    // A retry after the file already reached SharePoint reuses it.
    const uploadsBefore = remote.uploads;
    await target.startSharePointCopy(backupId);
    const retried = await waitFor(() => service.getFullBackup(backupId), (value) => value.sharePointStatus !== 'UPLOADING');
    expect(retried.sharePointStatus).toBe('UPLOADED');
    expect(retried.sharePointItemId).toBe(copied.id);
    expect(remote.uploads).toBe(uploadsBefore);
  }, 180_000);

  it('lists SharePoint backups and copies one back down to restore', async () => {
    const target = await import('@/services/backup/full/sharepoint-target');
    const service = await import('@/services/backup/full/full-backup.service');

    const { files } = await target.listSharePointBackupFiles();
    const ours = files.find((file) => file.backupId);
    expect(ours).toBeDefined();
    expect(files.map((file) => file.name)).toContain('before-migration.oakbackup');
    // Copying down a backup that is already here returns the local one.
    expect((await service.importSharePointBackup(ours!.itemId, userId)).backupId).toBe(ours!.backupId);

    // As on a new machine: the local copy is gone, only SharePoint has it.
    await service.deleteFullBackup(ours!.backupId!, userId);
    const { backupId } = await service.importSharePointBackup(ours!.itemId, userId);
    const imported = await waitFor(() => service.getFullBackup(backupId), (value) => value.status !== 'PENDING');
    expect(imported.status).toBe('COMPLETED');
    expect(imported.source).toBe('UPLOADED');
    expect(imported.name).toBe(ours!.name.replace('.oakbackup', ''));

    const preview = await service.previewFullRestore(backupId, PASSWORD);
    expect(preview.blockers).toEqual([]);
    expect(preview.counts.connectors).toBe(1);

    await expect(target.downloadSharePointBackupFile(addRemoteFile('elsewhere.oakbackup', 'root')))
      .rejects.toThrow(/not in the SharePoint backup folder/);
  }, 180_000);
});
