// @vitest-environment node
/**
 * Module-by-module restore on real PostgreSQL: the preview counts what would
 * change and refuses a selection that would break links between modules; the
 * restore puts back only the chosen modules and missing stored files.
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
const dbName = `oak_fullbackup_mod_${suffix}`;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oak-full-backup-mod-test-'));

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

async function waitFor(backupId: string, done: (status: string) => boolean) {
  const { getFullBackup } = await import('@/services/backup/full/full-backup.service');
  for (let attempt = 0; attempt < 600; attempt++) {
    const backup = await getFullBackup(backupId);
    if (done(backup.status)) return backup;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for backup');
}

describePostgres('restoring a full backup module by module', () => {
  let backupId: string;
  let userId: string;
  let workspaceId: string;
  let keptCompanyId: string;
  let contactId: string;

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
    process.env.ENCRYPTION_KEY = 'module-restore-test-key-0123456789abcdef';
    process.env.STORAGE_PROVIDER = 'local';
    process.env.STORAGE_LOCAL_PATH = path.join(workDir, 'storage');
    process.env.BACKUP_WORK_DIR = path.join(workDir, 'work');
    (await import('@/lib/storage')).resetStorage();
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

  it('puts every table in a named module', async () => {
    const { listTables } = await import('@/services/backup/full/database-snapshot');
    const { moduleForTable } = await import('@/services/backup/full/modules');
    const { prisma } = await import('@/lib/prisma');
    const unassigned = [...(await listTables(prisma)).keys()].filter((table) => moduleForTable(table) === 'other');
    expect(unassigned).toEqual(['backup_settings']);
  });

  it('backs up, then the preview counts changes and blocks a selection that would break links', async () => {
    const { prisma } = await import('@/lib/prisma');
    const { storage } = await import('@/lib/storage');
    const { setBackupPassword } = await import('@/services/backup/full/backup-settings');
    const service = await import('@/services/backup/full/full-backup.service');

    const workspace = await prisma.workspace.findFirstOrThrow();
    workspaceId = workspace.id;
    userId = (await prisma.user.findFirstOrThrow({ where: { tenantId: null } })).id;
    keptCompanyId = (await prisma.company.create({ data: { tenantId: workspaceId, uen: `M${suffix}A`, name: 'Before Pte. Ltd.' } })).id;
    contactId = (await prisma.contact.create({ data: { tenantId: workspaceId, fullName: 'Tan Ah Kow' } })).id;
    await storage.upload(`${workspaceId}/branding/seal.png`, Buffer.from('seal-bytes'), { contentType: 'image/png' });

    await setBackupPassword(PASSWORD, userId);
    ({ backupId } = await service.createFullBackup({ userId, name: 'Modules' }));
    expect((await waitFor(backupId, (status) => !['PENDING', 'IN_PROGRESS'].includes(status))).status).toBe('COMPLETED');

    // Changes after the backup.
    await prisma.company.update({ where: { id: keptCompanyId }, data: { name: 'Renamed Pte. Ltd.' } });
    const added = await prisma.company.create({ data: { tenantId: workspaceId, uen: `M${suffix}B`, name: 'Added Pte. Ltd.' } });
    await prisma.companyContact.create({ data: { companyId: added.id, contactId, relationship: 'Director' } });
    await prisma.contact.create({ data: { tenantId: workspaceId, fullName: 'Added After Backup' } });
    await storage.delete(`${workspaceId}/branding/seal.png`);

    const check = await service.previewFullRestore(backupId, PASSWORD);
    expect(check.modules.find((module) => module.key === 'companies')).toMatchObject({ label: 'Companies' });

    await expect(service.previewModuleRestore(backupId, 'wrong password!', ['companies'])).rejects.toThrow(/Wrong backup password/);
    await expect(service.previewModuleRestore(backupId, PASSWORD, ['nope'])).rejects.toThrow(/Unknown module/);

    const companiesOnly = await service.previewModuleRestore(backupId, PASSWORD, ['companies']);
    const companies = companiesOnly.changes.find((change) => change.module === 'companies')!;
    expect(companies.tables.find((table) => table.table === 'companies')).toMatchObject({ added: 0, replaced: 1, removed: 1 });
    // The contact link to the company added after the backup would be left pointing at nothing.
    expect(companiesOnly.suggestedModules).toEqual(['contacts']);
    expect(companiesOnly.links[0]).toMatchObject({ fromModule: 'contacts', toModule: 'companies', rows: 1 });
    expect(companiesOnly.blockers.join(' ')).toMatch(/Also restore: Contacts/);
    expect(companiesOnly.missingFiles).toBe(1);

    await expect(service.startModuleRestore({
      backupId, password: PASSWORD, modules: ['companies'], restoreMissingFiles: true, confirmation: 'RESTORE', userId,
    })).resolves.toBeUndefined();
    const refused = await waitFor(backupId, (status) => status !== 'RESTORING');
    expect(refused.errorMessage).toMatch(/Also restore: Contacts/);
    expect(refused.currentStep).toBe('Restore failed; nothing was changed');
    expect((await prisma.company.findUniqueOrThrow({ where: { id: keptCompanyId } })).name).toBe('Renamed Pte. Ltd.');
  }, 240_000);

  it('restores only the chosen modules and puts back missing files', async () => {
    const { prisma } = await import('@/lib/prisma');
    const { storage } = await import('@/lib/storage');
    const service = await import('@/services/backup/full/full-backup.service');
    const usersBefore = await prisma.user.count();
    const lateUser = await prisma.user.create({
      data: { email: `late-${suffix}@example.com`, passwordHash: 'x', firstName: 'Late', lastName: 'User' },
    });

    const preview = await service.previewModuleRestore(backupId, PASSWORD, ['companies', 'contacts']);
    expect(preview.blockers).toEqual([]);
    const contacts = preview.changes.find((change) => change.module === 'contacts')!;
    expect(contacts.tables.find((table) => table.table === 'contacts')).toMatchObject({ added: 0, removed: 1, unchanged: 1 });

    await expect(service.startModuleRestore({
      backupId, password: PASSWORD, modules: ['companies', 'contacts'], restoreMissingFiles: true, confirmation: 'yes', userId,
    })).rejects.toThrow(/Type RESTORE/);
    await service.startModuleRestore({
      backupId, password: PASSWORD, modules: ['companies', 'contacts'], restoreMissingFiles: true, confirmation: 'RESTORE', userId,
    });
    const restored = await waitFor(backupId, (status) => status !== 'RESTORING');
    expect(restored.errorMessage).toBeNull();
    expect(restored.currentStep).toBe('Restored Companies, Contacts');

    expect((await prisma.company.findUniqueOrThrow({ where: { id: keptCompanyId } })).name).toBe('Before Pte. Ltd.');
    expect(await prisma.company.count({ where: { uen: `M${suffix}B` } })).toBe(0);
    expect(await prisma.contact.count({ where: { fullName: 'Added After Backup' } })).toBe(0);
    expect(await prisma.contact.count({ where: { id: contactId } })).toBe(1);
    // Users were not chosen, so the account made after the backup stays.
    expect(await prisma.user.count()).toBe(usersBefore + 1);
    expect(await prisma.user.count({ where: { id: lateUser.id } })).toBe(1);
    expect((await storage.download(`${workspaceId}/branding/seal.png`)).toString()).toBe('seal-bytes');
  }, 240_000);

  it('stops a backup being made, keeps no file and lets a new one start', async () => {
    const { prisma } = await import('@/lib/prisma');
    const service = await import('@/services/backup/full/full-backup.service');

    const { backupId: stoppedId } = await service.createFullBackup({ userId, name: 'To stop' });
    await service.stopFullBackup(stoppedId, userId);
    await expect(service.stopFullBackup(stoppedId, userId)).rejects.toThrow(/being made/);

    // The next backup can start straight away, and the stopped job never overwrites its outcome.
    const { backupId: nextId } = await service.createFullBackup({ userId, name: 'After stop' });
    expect((await waitFor(nextId, (status) => !['PENDING', 'IN_PROGRESS'].includes(status))).status).toBe('COMPLETED');
    const stopped = await prisma.systemBackup.findUniqueOrThrow({ where: { id: stoppedId } });
    expect(stopped).toMatchObject({ status: 'FAILED', currentStep: 'Stopped', archiveKey: null });
    expect(fs.readdirSync(path.join(workDir, 'work')).filter((name) => name.startsWith(`backup-${stoppedId}`))).toEqual([]);
    await expect(service.stopFullBackup(nextId, userId)).rejects.toThrow(/being made/);
  }, 240_000);
});
