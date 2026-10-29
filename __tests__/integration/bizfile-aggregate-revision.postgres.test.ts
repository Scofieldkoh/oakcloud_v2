// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Prisma } from '@/generated/prisma';
import { acquireAuthorizationMutationGate } from '@/lib/authorization-mutation-gate';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';

const connectionString = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const schema = `bizfile_aggregate_test_${randomBytes(6).toString('hex')}`;

const companyChildTables = [
  'company_addresses',
  'company_former_names',
  'share_capital',
  'company_officers',
  'company_shareholders',
  'company_auditors',
  'company_charges',
  'company_contacts',
] as const;

suite('BizFile aggregate revision guard on PostgreSQL', () => {
  let control: Client;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !/(?:^|[_-])test(?:[_-]|$)/i.test(url.pathname.slice(1))
      || url.port === '5433') {
      throw new Error('BizFile aggregate revision tests require the isolated disposable PostgreSQL database.');
    }

    control = new Client({ connectionString });
    await control.connect();
    await control.query(`CREATE SCHEMA "${schema}"`);
    await control.query(`SET search_path TO "${schema}"`);
    await control.query(`
      CREATE FUNCTION "oakcloud_authorization_statement_gate"()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended('oakcloud:authorization:global', 0));
        RETURN NULL;
      END;
      $$;

      CREATE TABLE "companies" (
        "id" TEXT PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "uen" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "aggregate_revision" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "deletedReason" TEXT,
        "task_integration_context" JSONB
      );
      CREATE TABLE "company_addresses" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "value" TEXT);
      CREATE TABLE "company_former_names" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "value" TEXT);
      CREATE TABLE "share_capital" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "value" TEXT);
      CREATE TABLE "company_officers" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "contactId" TEXT, "value" TEXT);
      CREATE TABLE "company_shareholders" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "contactId" TEXT, "value" TEXT);
      CREATE TABLE "company_auditors" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "value" TEXT);
      CREATE TABLE "company_charges" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "chargeHolderId" TEXT, "value" TEXT);
      CREATE TABLE "company_contacts" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "contactId" TEXT NOT NULL, "value" TEXT);
      CREATE TABLE "contacts" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "fullName" TEXT NOT NULL);
      CREATE TABLE "contact_details" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "contactId" TEXT, "companyId" TEXT, "value" TEXT NOT NULL);
    `);
    const migration = await readFile(resolve(
      process.cwd(),
      'prisma/migrations/20260907030000_bizfile_aggregate_revision_guard/migration.sql',
    ), 'utf8');
    await control.query(migration);
  }, 15_000);

  afterAll(async () => {
    if (!control) return;
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await control.end();
  });

  function id(prefix: string): string {
    return `${prefix}-${randomBytes(5).toString('hex')}`;
  }

  async function revision(client: Client, companyId: string): Promise<number> {
    const result = await client.query(
      'SELECT "aggregate_revision" FROM "companies" WHERE "id" = $1',
      [companyId],
    );
    return Number(result.rows[0]?.aggregate_revision);
  }

  async function insertCompany(client: Client, companyId: string, name = 'Before'): Promise<void> {
    await client.query(
      'INSERT INTO "companies" ("id", "tenantId", "uen", "name") VALUES ($1, $2, $3, $4)',
      [companyId, 'tenant-1', `${companyId}-UEN`, name],
    );
  }

  async function setSearchPath(client: Client): Promise<void> {
    await client.query(`SET search_path TO "${schema}"`);
  }

  function delay(milliseconds: number): Promise<void> {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
  }

  type PrismaRawQuery = { sql: string; values: unknown[]; strings?: readonly string[] };

  function postgresQuery(query: PrismaRawQuery): { text: string; values: never[] } {
    if (query.strings) {
      return {
        text: query.strings.reduce(
          (text, fragment, index) => `${text}${fragment}${index < query.values.length ? `$${index + 1}` : ''}`,
          '',
        ),
        values: query.values as never[],
      };
    }
    let placeholder = 0;
    return {
      text: query.sql.replace(/\?/g, () => `$${++placeholder}`),
      values: query.values as never[],
    };
  }

  function rawClient(client: Client, events: string[]): Pick<Prisma.TransactionClient, '$executeRaw'> {
    return {
      $executeRaw: (async (query: unknown): Promise<unknown> => {
        const rawQuery = query as PrismaRawQuery;
        const key = rawQuery.values[0];
        if (typeof key === 'string') events.push(key);
        return client.query(postgresQuery(rawQuery));
      }) as Pick<Prisma.TransactionClient, '$executeRaw'>['$executeRaw'],
    };
  }

  it('invalidates a prepared revision after an ordinary child write and rejects the stale plan', async () => {
    const companyId = id('stale');
    await insertCompany(control, companyId);
    await control.query(
      'INSERT INTO "company_addresses" ("id", "companyId", "value") VALUES ($1, $2, $3)',
      [id('address'), companyId, 'new address'],
    );
    await expect(revision(control, companyId)).resolves.toBe(1);

    const operation = new Client({ connectionString });
    await operation.connect();
    await setSearchPath(operation);
    try {
      await operation.query('BEGIN');
      const current = await operation.query(
        'SELECT "aggregate_revision" FROM "companies" WHERE "id" = $1 FOR UPDATE',
        [companyId],
      );
      const expectedRevision = 0;
      await expect(Promise.resolve().then(() => {
        const found = Number(current.rows[0]?.aggregate_revision);
        if (found !== expectedRevision) {
          throw new Error(`STALE_BIZFILE_PLAN: expected aggregate revision ${expectedRevision}, found ${found}`);
        }
      })).rejects.toThrow('STALE_BIZFILE_PLAN');
      await operation.query('ROLLBACK');
    } finally {
      await operation.end();
    }
  });

  it('ignores company metadata, rejects rewinds, and keeps direct increments monotonic', async () => {
    const companyId = id('monotonic');
    await insertCompany(control, companyId);

    await control.query(
      'UPDATE "companies" SET "task_integration_context" = $2, "updatedAt" = $3 WHERE "id" = $1',
      [companyId, JSON.stringify({ task: 'metadata-only' }), new Date('2030-01-01T00:00:00Z')],
    );
    await expect(revision(control, companyId)).resolves.toBe(0);

    await control.query(
      'UPDATE "companies" SET "aggregate_revision" = $2 WHERE "id" = $1',
      [companyId, -100],
    );
    await expect(revision(control, companyId)).resolves.toBe(0);

    await control.query(
      'UPDATE "companies" SET "aggregate_revision" = $2 WHERE "id" = $1',
      [companyId, 4],
    );
    await expect(revision(control, companyId)).resolves.toBe(4);

    await control.query(
      'UPDATE "companies" SET "name" = $2, "aggregate_revision" = $3 WHERE "id" = $1',
      [companyId, 'After', -1],
    );
    await expect(revision(control, companyId)).resolves.toBe(5);
  });

  it('bumps every selected company child table and shared contact dependency', async () => {
    const companyId = id('children');
    await insertCompany(control, companyId);
    for (const table of companyChildTables) {
      const values = table === 'company_contacts'
        ? [id(table), companyId, id('contact'), 'linked']
        : [id(table), companyId, 'changed'];
      const columns = table === 'company_contacts'
        ? '("id", "companyId", "contactId", "value")'
        : '("id", "companyId", "value")';
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
      await control.query(`INSERT INTO "${table}" ${columns} VALUES (${placeholders})`, values);
    }
    await expect(revision(control, companyId)).resolves.toBe(companyChildTables.length);

    const companyA = id('shared-a');
    const companyB = id('shared-b');
    const contactId = id('contact');
    await insertCompany(control, companyA);
    await insertCompany(control, companyB);
    await control.query(
      'INSERT INTO "contacts" ("id", "tenantId", "fullName") VALUES ($1, $2, $3)',
      [contactId, 'tenant-1', 'Person Before'],
    );
    await control.query(
      'INSERT INTO "company_contacts" ("id", "companyId", "contactId", "value") VALUES ($1, $2, $3, $4), ($5, $6, $3, $4)',
      [id('link-a'), companyA, contactId, 'director', id('link-b'), companyB],
    );
    await expect(revision(control, companyA)).resolves.toBe(1);
    await expect(revision(control, companyB)).resolves.toBe(1);

    await control.query('UPDATE "contacts" SET "fullName" = $2 WHERE "id" = $1', [contactId, 'Person After']);
    await expect(revision(control, companyA)).resolves.toBe(2);
    await expect(revision(control, companyB)).resolves.toBe(2);

    await control.query(
      'INSERT INTO "contact_details" ("id", "tenantId", "contactId", "companyId", "value") VALUES ($1, $2, $3, $4, $5)',
      [id('detail'), 'tenant-1', contactId, companyA, 'email@example.test'],
    );
    await expect(revision(control, companyA)).resolves.toBe(3);
    await expect(revision(control, companyB)).resolves.toBe(3);
  });

  it('makes an ordinary child writer wait behind the canonical company lock', async () => {
    const companyId = id('lock');
    await insertCompany(control, companyId);

    const canonical = new Client({ connectionString });
    const ordinary = new Client({ connectionString });
    await Promise.all([canonical.connect(), ordinary.connect()]);
    await Promise.all([setSearchPath(canonical), setSearchPath(ordinary)]);
    await ordinary.query("SET statement_timeout = '2000ms'");
    try {
      await canonical.query('BEGIN');
      await canonical.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('oakcloud:authorization:global', 0))",
      );
      await canonical.query('SELECT "id" FROM "companies" WHERE "id" = $1 FOR UPDATE', [companyId]);

      const childWrite = ordinary.query(
        'INSERT INTO "company_addresses" ("id", "companyId", "value") VALUES ($1, $2, $3)',
        [id('blocked-address'), companyId, 'blocked until canonical commit'],
      );
      const completedBeforeCommit = await Promise.race([
        childWrite.then(() => true),
        delay(100).then(() => false),
      ]);
      expect(completedBeforeCommit).toBe(false);

      await canonical.query('COMMIT');
      await childWrite;
      await expect(revision(control, companyId)).resolves.toBe(1);
    } finally {
      await canonical.query('ROLLBACK').catch(() => undefined);
      await Promise.all([canonical.end(), ordinary.end()]);
    }
  });

  it('keeps contact row locking behind the shared business and global gates during restore', async () => {
    const companyId = id('order-company');
    const contactId = id('order-contact');
    const linkId = id('order-link');
    await insertCompany(control, companyId);
    await control.query(
      'INSERT INTO "contacts" ("id", "tenantId", "fullName") VALUES ($1, $2, $3)',
      [contactId, 'tenant-1', 'Before lock-order regression'],
    );
    await control.query(
      'INSERT INTO "company_contacts" ("id", "companyId", "contactId", "value") VALUES ($1, $2, $3, $4)',
      [linkId, companyId, contactId, 'director'],
    );

    const restore = new Client({ connectionString });
    const contactWriter = new Client({ connectionString });
    const restoreEvents: string[] = [];
    const contactEvents: string[] = [];
    const restoreRaw = rawClient(restore, restoreEvents);
    const contactRaw = rawClient(contactWriter, contactEvents);
    let contactProtocol: Promise<void> | undefined;
    await Promise.all([restore.connect(), contactWriter.connect()]);
    await Promise.all([setSearchPath(restore), setSearchPath(contactWriter)]);
    await Promise.all([
      restore.query("SET statement_timeout = '3000ms'"),
      contactWriter.query("SET statement_timeout = '3000ms'"),
    ]);

    try {
      await restore.query('BEGIN');
      await acquireBusinessOperationBarrier(restoreRaw, 'tenant-1', 'exclusive');
      await acquireAuthorizationMutationGate(restoreRaw);
      await restore.query('SELECT "id" FROM "companies" WHERE "id" = $1 FOR UPDATE', [companyId]);

      await contactWriter.query('BEGIN');
      contactProtocol = (async () => {
        await acquireBusinessOperationBarrier(contactRaw, 'tenant-1', 'shared');
        await acquireAuthorizationMutationGate(contactRaw);
        await contactWriter.query(
          'SELECT "id" FROM "contacts" WHERE "tenantId" = $1 AND "id" = $2 FOR UPDATE',
          ['tenant-1', contactId],
        );
        await contactWriter.query(
          'UPDATE "contacts" SET "fullName" = $2 WHERE "id" = $1',
          [contactId, 'After lock-order regression'],
        );
        await contactWriter.query('COMMIT');
      })();

      await delay(100);
      expect(restoreEvents).toEqual([
        'oakcloud:business-operation:tenant-1',
        'oakcloud:authorization:global',
      ]);
      // Restore owns the exclusive business barrier, so the contact writer
      // cannot reach the global gate or its contact row lock yet.
      expect(contactEvents).toEqual(['oakcloud:business-operation:tenant-1']);

      await restore.query('COMMIT');
      await contactProtocol;
      expect(contactEvents).toEqual([
        'oakcloud:business-operation:tenant-1',
        'oakcloud:authorization:global',
      ]);
      await expect(control.query(
        'SELECT "fullName" FROM "contacts" WHERE "id" = $1',
        [contactId],
      )).resolves.toMatchObject({ rows: [{ fullName: 'After lock-order regression' }] });
    } finally {
      await restore.query('ROLLBACK').catch(() => undefined);
      await contactWriter.query('ROLLBACK').catch(() => undefined);
      await contactProtocol?.catch(() => undefined);
      await Promise.all([restore.end(), contactWriter.end()]);
    }
  });
});
