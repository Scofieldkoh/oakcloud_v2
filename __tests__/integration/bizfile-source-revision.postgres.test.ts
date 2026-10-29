// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { PrismaTransactionClient } from '@/services/contact.service';
import { assertFreshBizFileSourceRevision } from '@/services/bizfile/application/source-revision';

const connectionString = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const schema = `bizfile_source_test_${randomBytes(6).toString('hex')}`;

suite('BizFile source revision guard on PostgreSQL', () => {
  let control: Client;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !/(?:^|[_-])test(?:[_-]|$)/i.test(url.pathname.slice(1))
      || url.port === '5433') {
      throw new Error('BizFile source revision tests require the isolated disposable PostgreSQL database.');
    }

    control = new Client({ connectionString });
    await control.connect();
    await control.query(`CREATE SCHEMA "${schema}"`);
    await control.query(`SET search_path TO "${schema}"`);
    await control.query(`
      CREATE TABLE "documents" AS
      SELECT "id", "tenantId", "deleted_at", "source_revision", "storage_key",
        "version", "extractedData", "extractionStatus", "extractionError",
        "fileSize", "mimeType", "originalFileName"
      FROM public."documents" WITH NO DATA;
      ALTER TABLE "documents" ADD PRIMARY KEY ("id");
      ALTER TABLE "documents" ALTER COLUMN "source_revision" SET DEFAULT 0;
      ALTER TABLE "documents" ALTER COLUMN "version" SET DEFAULT 1;
    `);
    const migration = await readFile(resolve(
      process.cwd(),
      'prisma/migrations/20260907020000_bizfile_source_revision_guard/migration.sql',
    ), 'utf8');
    await control.query(migration);
    const correction = await readFile(resolve(
      process.cwd(),
      'prisma/migrations/20260908010000_bizfile_source_guard_column_mapping/migration.sql',
    ), 'utf8');
    await control.query(correction);
  }, 15_000);

  afterAll(async () => {
    if (!control) return;
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await control.end();
  });

  async function insertDocument(id: string): Promise<void> {
    await control.query(
      `INSERT INTO "documents" ("id", "tenantId", "storage_key", "version", "extractedData", "extractionStatus", "extractionError", "fileSize", "mimeType", "originalFileName")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, 'tenant-1', `${id}.pdf`, 9, JSON.stringify({ name: 'before' }), 'COMPLETED', null, 10, 'application/pdf', `${id}.pdf`],
    );
  }

  function transactionClient(client: Client): PrismaTransactionClient {
    return {
      $queryRawUnsafe: async <T = unknown>(query: string, ...values: unknown[]) =>
        (await client.query(query, values)).rows as T,
    } as unknown as PrismaTransactionClient;
  }

  it('rejects a revision-zero preparation after a source update in the real database', async () => {
    const documentId = 'stale-source';
    await insertDocument(documentId);
    await control.query('UPDATE "documents" SET "extractedData" = $2 WHERE "id" = $1', [documentId, JSON.stringify({ name: 'after' })]);
    await expect(control.query('SELECT "source_revision" FROM "documents" WHERE "id" = $1', [documentId]))
      .resolves.toMatchObject({ rows: [{ source_revision: 1 }] });

    const operation = new Client({ connectionString });
    await operation.connect();
    await operation.query(`SET search_path TO "${schema}"`);
    try {
      await operation.query('BEGIN');
      await expect(assertFreshBizFileSourceRevision(transactionClient(operation), {
        tenantId: 'tenant-1', documentId, expectedSourceRevision: 0,
      })).rejects.toMatchObject({ code: 'STALE_BIZFILE_SOURCE' });
      await operation.query('ROLLBACK');
    } finally {
      await operation.end();
    }
  });

  it('does not bump for irrelevant metadata and ignores an attempted rewind', async () => {
    const documentId = 'metadata-source';
    await insertDocument(documentId);

    await control.query('UPDATE "documents" SET "originalFileName" = $2 WHERE "id" = $1', [documentId, 'renamed.pdf']);
    await expect(control.query('SELECT "source_revision" FROM "documents" WHERE "id" = $1', [documentId]))
      .resolves.toMatchObject({ rows: [{ source_revision: 0 }] });

    await control.query('UPDATE "documents" SET "source_revision" = $2 WHERE "id" = $1', [documentId, -100]);
    await expect(control.query('SELECT "source_revision" FROM "documents" WHERE "id" = $1', [documentId]))
      .resolves.toMatchObject({ rows: [{ source_revision: 0 }] });
  });

  it('advances from the locked old revision when a source field changes', async () => {
    const documentId = 'monotonic-source';
    await insertDocument(documentId);

    await control.query('UPDATE "documents" SET "storage_key" = $2, "source_revision" = $3 WHERE "id" = $1', [documentId, 'replacement.pdf', 0]);
    await expect(control.query('SELECT "source_revision" FROM "documents" WHERE "id" = $1', [documentId]))
      .resolves.toMatchObject({ rows: [{ source_revision: 1 }] });

    await control.query('UPDATE "documents" SET "version" = $2, "source_revision" = $3 WHERE "id" = $1', [documentId, 10, 0]);
    await expect(control.query('SELECT "source_revision" FROM "documents" WHERE "id" = $1', [documentId]))
      .resolves.toMatchObject({ rows: [{ source_revision: 2 }] });
  });

  it('tracks approval and storage finalization as separate source transitions', async () => {
    const documentId = 'approval-source';
    await insertDocument(documentId);
    await control.query('UPDATE "documents" SET "extractionStatus" = $2, "extractedData" = $3 WHERE "id" = $1',
      [documentId, 'COMPLETED', JSON.stringify({ name: 'reviewed and approved' })]);
    await expect(control.query('SELECT "source_revision" FROM "documents" WHERE "id" = $1', [documentId]))
      .resolves.toMatchObject({ rows: [{ source_revision: 1 }] });
    await control.query('UPDATE "documents" SET "storage_key" = $2 WHERE "id" = $1', [documentId, 'finalized-by-hash.pdf']);
    await expect(control.query('SELECT "source_revision" FROM "documents" WHERE "id" = $1', [documentId]))
      .resolves.toMatchObject({ rows: [{ source_revision: 2 }] });
  });
});
