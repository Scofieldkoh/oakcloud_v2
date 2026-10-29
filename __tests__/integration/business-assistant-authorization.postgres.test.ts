// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Prisma } from '@/generated/prisma';
import { lockFreshAuthorizationScope, type FreshAuthorizationTransactionClient } from '@/lib/fresh-authorization';

const connectionString = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const schema = `ba_auth_test_${randomBytes(6).toString('hex')}`;

suite('Business Assistant authorization gate on PostgreSQL', () => {
  let control: Client;
  let operation: Client;
  let revocation: Client;
  let revocationPid: number;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!/(?:^|[_-])test(?:[_-]|$)/i.test(url.pathname.slice(1)) || url.port === '5433') throw new Error('An isolated assistant test database is required');
    control = new Client({ connectionString }); await control.connect();
    await control.query(`CREATE SCHEMA "${schema}"`);
    await control.query(`SET search_path TO "${schema}"`);
    await control.query(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE users (id TEXT PRIMARY KEY, "tenantId" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true);
      CREATE TABLE roles (id TEXT PRIMARY KEY, "tenantId" TEXT);
      CREATE TABLE permissions (id TEXT PRIMARY KEY);
      CREATE TABLE user_role_assignments (id TEXT PRIMARY KEY, "userId" TEXT, "roleId" TEXT, "companyId" TEXT);
      CREATE TABLE role_permissions (id TEXT PRIMARY KEY, "roleId" TEXT, "permissionId" TEXT);
      CREATE TABLE companies (id TEXT PRIMARY KEY, "tenantId" TEXT);
      INSERT INTO tenants VALUES ('workspace-1');
      INSERT INTO users VALUES ('user-1', 'workspace-1', true);
      INSERT INTO roles VALUES ('role-1', 'workspace-1');
      INSERT INTO permissions VALUES ('permission-1');
      INSERT INTO user_role_assignments VALUES ('assignment-1', 'user-1', 'role-1', NULL);
      INSERT INTO role_permissions VALUES ('grant-1', 'role-1', 'permission-1');
    `);
    await control.query(await readFile('prisma/migrations/20260907010000_authorization_mutation_gate/migration.sql', 'utf8'));
    operation = new Client({ connectionString }); revocation = new Client({ connectionString });
    await Promise.all([operation.connect(), revocation.connect()]);
    for (const client of [operation, revocation]) {
      await client.query(`SET search_path TO "${schema}"`);
      await client.query("SET statement_timeout TO '5s'");
    }
    revocationPid = Number((await revocation.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  }, 15_000);

  afterAll(async () => {
    await Promise.all([operation?.query('ROLLBACK'), revocation?.query('ROLLBACK')]);
    await Promise.all([operation?.end(), revocation?.end()]);
    if (control) { await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await control.end(); }
  });

  function gate(client: Client) {
    const tx = { $queryRaw: async (sql: Prisma.Sql) => (await client.query(sql.text, [...sql.values])).rows };
    return lockFreshAuthorizationScope(tx as unknown as FreshAuthorizationTransactionClient, { userId: 'user-1', workspaceId: 'workspace-1' });
  }

  async function expectAdvisoryWait(pid: number) {
    await expect.poll(async () => {
      const result = await control.query('SELECT wait_event FROM pg_stat_activity WHERE pid = $1', [pid]);
      return result.rows[0]?.wait_event;
    }, { timeout: 2000, interval: 20 }).toBe('advisory');
  }

  it('gate-first operation holds authority stable until commit without a row-lock inversion', async () => {
    await operation.query('BEGIN'); await gate(operation);
    expect((await operation.query('SELECT "isActive" FROM users WHERE id = $1', ['user-1'])).rows[0].isActive).toBe(true);
    const revoke = revocation.query('UPDATE users SET "isActive" = false WHERE id = $1', ['user-1']);
    try {
      await expectAdvisoryWait(revocationPid);
      await operation.query('COMMIT'); await revoke;
      expect((await control.query('SELECT "isActive" FROM users WHERE id = $1', ['user-1'])).rows[0].isActive).toBe(false);
    } finally { await operation.query('ROLLBACK'); await revoke.catch(() => undefined); }
  });

  it('revoke-first operation observes the committed revocation after waiting for its gate', async () => {
    await control.query('UPDATE users SET "isActive" = true');
    await revocation.query('BEGIN');
    await revocation.query('UPDATE users SET "isActive" = false WHERE id = $1', ['user-1']);
    await operation.query('BEGIN');
    const pid = Number((await operation.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    const acquire = gate(operation);
    try {
      await expectAdvisoryWait(pid);
      await revocation.query('COMMIT'); await acquire;
      expect((await operation.query('SELECT "isActive" FROM users WHERE id = $1', ['user-1'])).rows[0].isActive).toBe(false);
    } finally { await revocation.query('ROLLBACK'); await acquire.catch(() => undefined); await operation.query('ROLLBACK'); }
  });

  it('role-permission deletion also takes the gate before locking grant rows', async () => {
    await operation.query('BEGIN'); await gate(operation);
    const revoke = revocation.query('DELETE FROM role_permissions WHERE id = $1', ['grant-1']);
    try {
      await expectAdvisoryWait(revocationPid);
      expect((await operation.query('SELECT count(*)::int AS count FROM role_permissions')).rows[0].count).toBe(1);
      await operation.query('COMMIT'); await revoke;
      expect((await control.query('SELECT count(*)::int AS count FROM role_permissions')).rows[0].count).toBe(0);
    } finally { await operation.query('ROLLBACK'); await revoke.catch(() => undefined); }
  });
});
