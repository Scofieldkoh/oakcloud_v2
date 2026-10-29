/**
 * Full backup round trip on real PostgreSQL: back up a seeded install, restore
 * it into a brand-new install with a different ENCRYPTION_KEY and storage, then
 * restore again over changed data. Uses its own throwaway databases because a
 * full restore replaces every table.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';
const suffix = randomUUID().slice(0, 8);
const sourceDb = `oak_fullbackup_src_${suffix}`;
const targetDb = `oak_fullbackup_dst_${suffix}`;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oak-full-backup-test-'));

function databaseUrl(name: string): string {
  const url = new URL(testDatabaseUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function admin<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Points the app's Prisma client, storage and encryption key at one install. */
async function useInstall(name: string, encryptionKey: string, storageDir: string): Promise<void> {
  const globals = global as unknown as { __prisma?: { $disconnect(): Promise<void> }; __prismaPool?: { end(): Promise<void> } };
  await globals.__prisma?.$disconnect();
  await globals.__prismaPool?.end();
  globals.__prisma = undefined;
  globals.__prismaPool = undefined;
  process.env.DATABASE_URL = databaseUrl(name);
  process.env.ENCRYPTION_KEY = encryptionKey;
  process.env.STORAGE_PROVIDER = 'local';
  process.env.STORAGE_LOCAL_PATH = storageDir;
  process.env.BACKUP_WORK_DIR = path.join(workDir, 'work');
  const { resetStorage } = await import('@/lib/storage');
  resetStorage();
}

function prepareDatabase(name: string, seed: boolean): void {
  const env = { ...process.env, DATABASE_URL: databaseUrl(name) };
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'ignore' });
  if (seed) execFileSync('npx', ['tsx', 'prisma/seed.ts'], { env, stdio: 'ignore' });
}

/** Row count and content hash of every application table. */
async function fingerprint(name: string): Promise<Record<string, string>> {
  const client = new Client({ connectionString: databaseUrl(name) });
  await client.connect();
  try {
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        -- Audit entries are written after the snapshot (backup completed, restore completed).
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name NOT IN ('_prisma_migrations', 'system_backups', 'tenant_backups', 'audit_logs', 'acra_entity', 'acra_sync_state')
        ORDER BY table_name`,
    );
    const result: Record<string, string> = {};
    for (const { table_name: table } of tables.rows) {
      // Connector secrets are re-locked with the new key, so compare everything else.
      const row = await client.query<{ n: string; h: string | null }>(
        `SELECT count(*)::text AS n,
                md5(string_agg((to_jsonb(t) - 'credentials' - 'password_ciphertext')::text, '|' ORDER BY (to_jsonb(t) - 'credentials' - 'password_ciphertext')::text)) AS h
           FROM "${table}" t`,
      );
      result[table] = `${row.rows[0].n}:${row.rows[0].h ?? ''}`;
    }
    return result;
  } finally {
    await client.end();
  }
}

async function waitFor(backupId: string, done: (status: string) => boolean) {
  const { getFullBackup } = await import('@/services/backup/full/full-backup.service');
  for (let attempt = 0; attempt < 600; attempt++) {
    const backup = await getFullBackup(backupId);
    if (done(backup.status)) return backup;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for backup');
}

describePostgres('full backup and restore on PostgreSQL', () => {
  let archive: Buffer;
  let sourceFingerprint: Record<string, string>;
  let workspaceId: string;

  beforeAll(async () => {
    await admin(async (client) => {
      await client.query(`CREATE DATABASE "${sourceDb}"`);
      await client.query(`CREATE DATABASE "${targetDb}"`);
    });
    prepareDatabase(sourceDb, true);
    prepareDatabase(targetDb, false);
  }, 240_000);

  afterAll(async () => {
    const globals = global as unknown as { __prisma?: { $disconnect(): Promise<void> }; __prismaPool?: { end(): Promise<void> } };
    await globals.__prisma?.$disconnect();
    await globals.__prismaPool?.end();
    globals.__prisma = undefined;
    globals.__prismaPool = undefined;
    await admin(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${sourceDb}" WITH (FORCE)`);
      await client.query(`DROP DATABASE IF EXISTS "${targetDb}" WITH (FORCE)`);
    });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('backs up every table, every stored file and unlocked connector secrets', async () => {
    await useInstall(sourceDb, 'source-install-key-0123456789abcdef', path.join(workDir, 'storage-src'));
    const { prisma } = await import('@/lib/prisma');
    const { storage } = await import('@/lib/storage');
    const { encrypt } = await import('@/lib/encryption');
    const { setBackupPassword } = await import('@/services/backup/full/backup-settings');
    const { createFullBackup, downloadFullBackup } = await import('@/services/backup/full/full-backup.service');

    const workspace = await prisma.workspace.findFirstOrThrow();
    workspaceId = workspace.id;
    const superAdmin = await prisma.user.findFirstOrThrow({ where: { tenantId: null } });
    const company = await prisma.company.create({
      data: { tenantId: workspace.id, uen: `2026${suffix}`.slice(0, 10), name: 'Round Trip Pte. Ltd.' },
    });
    // Auditors hang off the company only; the old workspace backup skipped them.
    await prisma.companyAuditor.create({ data: { companyId: company.id, name: 'Audit LLP' } });
    await prisma.connector.create({
      data: {
        name: 'SharePoint',
        type: 'STORAGE',
        provider: 'SHAREPOINT',
        workspaceId: workspace.id,
        credentials: encrypt(JSON.stringify({ clientSecret: 'client-secret-value' })),
      },
    });
    await storage.upload(`${workspace.id}/branding/logo.png`, Buffer.from('logo-bytes'), { contentType: 'image/png' });
    // The public ACRA register is downloaded again by its sync, never backed up.
    await prisma.acraEntity.create({
      data: { uen: `ACRA${suffix}`, entityName: 'REGISTER ONLY PTE. LTD.', entityStatus: 'Live', entityType: 'LC', dataAsOf: '2026-09-01' },
    });

    await setBackupPassword(PASSWORD, superAdmin.id);
    const { backupId } = await createFullBackup({ userId: superAdmin.id, name: 'Round trip' });
    const backup = await waitFor(backupId, (status) => status !== 'PENDING' && status !== 'IN_PROGRESS');
    expect(backup.status).toBe('COMPLETED');
    expect(backup.filesCount).toBe(1);

    archive = (await downloadFullBackup(backupId)).content;
    expect(archive.includes(Buffer.from('client-secret-value'))).toBe(false);
    expect((await prisma.systemBackup.findUniqueOrThrow({ where: { id: backupId } })).manifestJson).not.toMatchObject({
      tables: expect.arrayContaining([expect.objectContaining({ name: 'acra_entity' })]),
    });
    sourceFingerprint = await fingerprint(sourceDb);
    expect(Number(sourceFingerprint.deadline_rules.split(':')[0])).toBeGreaterThan(0);
  }, 180_000);

  it('restores into a brand-new install with a different encryption key', async () => {
    await useInstall(targetDb, 'target-install-key-fedcba9876543210', path.join(workDir, 'storage-dst'));
    const { prisma } = await import('@/lib/prisma');
    const { storage } = await import('@/lib/storage');
    const { decrypt } = await import('@/lib/encryption');
    const service = await import('@/services/backup/full/full-backup.service');
    // The default admin a fresh install is set up with; the restore replaces it.
    await prisma.acraEntity.create({
      data: { uen: `KEEP${suffix}`, entityName: 'KEPT ON THIS MACHINE PTE. LTD.', entityStatus: 'Live', entityType: 'LC', dataAsOf: '2026-09-01' },
    });
    const { id: uploader } = await prisma.user.create({
      data: { email: `setup-${suffix}@example.com`, passwordHash: 'x', firstName: 'Setup', lastName: 'Admin' },
    });

    const { backupId } = await service.startBackupUpload({ fileName: 'moved.oakbackup', size: archive.length, userId: uploader });
    const chunk = Math.ceil(archive.length / 3);
    for (let offset = 0; offset < archive.length; offset += chunk) {
      await service.appendBackupUploadChunk(backupId, offset, archive.subarray(offset, offset + chunk));
    }
    // A retried chunk is ignored rather than appended twice.
    await service.appendBackupUploadChunk(backupId, 0, archive.subarray(0, chunk));
    await service.completeBackupUpload(backupId, uploader);

    await expect(service.previewFullRestore(backupId, 'not the password')).rejects.toThrow(/Wrong backup password/);
    const preview = await service.previewFullRestore(backupId, PASSWORD);
    expect(preview.blockers).toEqual([]);
    expect(preview.counts.companies).toBe(1);
    expect(preview.counts.connectors).toBe(1);

    await expect(service.startFullRestore({ backupId, password: PASSWORD, confirmation: 'yes', userId: uploader }))
      .rejects.toThrow(/Type RESTORE/);
    await service.startFullRestore({ backupId, password: PASSWORD, confirmation: 'RESTORE', userId: uploader });
    const restored = await waitFor(backupId, (status) => status !== 'RESTORING');
    expect(restored.errorMessage).toBeNull();
    expect(restored.status).toBe('RESTORED');

    expect(await fingerprint(targetDb)).toEqual(sourceFingerprint);
    // A restore leaves this machine's ACRA register alone.
    expect(await prisma.acraEntity.count({ where: { uen: `KEEP${suffix}` } })).toBe(1);
    const connector = await prisma.connector.findFirstOrThrow();
    expect(JSON.parse(decrypt(connector.credentials))).toEqual({ clientSecret: 'client-secret-value' });
    expect((await storage.download(`${workspaceId}/branding/logo.png`)).toString()).toBe('logo-bytes');
    expect((await storage.getMetadata(`${workspaceId}/branding/logo.png`)).contentType).toBe('image/png');
    // The restored backup password works on the new install for its next backups.
    const { getBackupPassword } = await import('@/services/backup/full/backup-settings');
    expect(await getBackupPassword()).toBe(PASSWORD);
  }, 180_000);

  it('restores again over changed data, putting back exactly what was backed up', async () => {
    const { prisma } = await import('@/lib/prisma');
    const service = await import('@/services/backup/full/full-backup.service');
    await prisma.companyAuditor.deleteMany();
    await prisma.company.create({ data: { tenantId: workspaceId, uen: 'EXTRA0001X', name: 'Added After Backup Pte. Ltd.' } });

    const [uploaded] = (await service.listFullBackups()).backups;
    const restorer = await prisma.user.findFirstOrThrow({ where: { tenantId: null } });
    await service.startFullRestore({ backupId: uploaded.id, password: PASSWORD, confirmation: 'RESTORE', userId: restorer.id });
    const restored = await waitFor(uploaded.id, (status) => status !== 'RESTORING');
    expect(restored.errorMessage).toBeNull();
    expect(await fingerprint(targetDb)).toEqual(sourceFingerprint);
  }, 180_000);
});
