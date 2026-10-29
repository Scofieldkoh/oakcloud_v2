/**
 * Exports and replaces every application table, worked out from the live
 * database catalog so new tables are covered without code changes.
 *
 * Rows travel as one JSON object per line (`row_to_json`), and are loaded back
 * with `json_populate_recordset`, which keeps Postgres types (enums, arrays,
 * jsonb, numerics, timestamps) exact.
 */

import fs from 'fs';
import readline from 'readline';
import { Prisma } from '@/generated/prisma';
import { decodeSecretColumn, encodeSecretColumn, secretColumnsFor } from './secret-columns';
import type { FullBackupTable } from './types';

/**
 * Tables that describe this install rather than its data. Migration history
 * belongs to the running code, and backup records point at files on this
 * machine only. The ACRA register (hundreds of thousands of public records)
 * and its sync state are downloaded again by the ACRA sync, so they are
 * neither backed up nor replaced by a restore.
 */
export const EXCLUDED_TABLES = new Set([
  '_prisma_migrations',
  'system_backups',
  'tenant_backups',
  'acra_entity',
  'acra_sync_state',
]);

const EXPORT_BATCH_ROWS = 2000;
const IMPORT_BATCH_ROWS = 500;

export type RawClient = Pick<Prisma.TransactionClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Application tables in the public schema, with their columns in table order. */
export async function listTables(db: RawClient): Promise<Map<string, string[]>> {
  const rows = await db.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`,
  );
  const tables = new Map<string, string[]>();
  for (const row of rows) {
    if (EXCLUDED_TABLES.has(row.table_name)) continue;
    const columns = tables.get(row.table_name) ?? [];
    columns.push(row.column_name);
    tables.set(row.table_name, columns);
  }
  return tables;
}

export async function listAppliedMigrations(db: RawClient): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ migration_name: string }>>(
    `SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`,
  );
  return rows.map((row) => row.migration_name);
}

/**
 * Writes one table to a JSON-lines file. Must run inside a repeatable-read
 * transaction so every table comes from the same snapshot.
 */
export async function exportTable(
  db: RawClient,
  table: string,
  filePath: string,
  /** Called every few batches; throw to stop the export (a stopped backup). */
  checkpoint?: () => Promise<void>,
): Promise<{ rows: number; lockedSecrets: number }> {
  const secrets = secretColumnsFor(table);
  const output = fs.createWriteStream(filePath);
  let rows = 0;
  let lockedSecrets = 0;
  const cursor = 'full_backup_export';
  // One cursor reads the table in a single pass; paging with ORDER BY re-sorted the whole table per page.
  await db.$executeRawUnsafe(`DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS row FROM ${quoteIdent(table)} t`);
  try {
    for (;;) {
      const batch = await db.$queryRawUnsafe<Array<{ row: string }>>(`FETCH ${EXPORT_BATCH_ROWS} FROM ${cursor}`);
      if (batch.length === 0) break;
      const lines = batch.map(({ row }) => {
        if (secrets.length === 0) return row;
        const parsed = JSON.parse(row) as Record<string, unknown>;
        for (const column of secrets) {
          const encoded = encodeSecretColumn(parsed[column]);
          parsed[column] = encoded.value;
          if (encoded.locked) lockedSecrets += 1;
        }
        return JSON.stringify(parsed);
      });
      if (!output.write(lines.join('\n') + '\n')) await new Promise<void>((resolve) => output.once('drain', () => resolve()));
      rows += batch.length;
      if (batch.length < EXPORT_BATCH_ROWS) break;
      if (checkpoint && rows % (EXPORT_BATCH_ROWS * 25) === 0) await checkpoint();
    }
  } finally {
    await db.$executeRawUnsafe(`CLOSE ${cursor}`).catch(() => undefined);
    await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => (error ? reject(error) : resolve())));
  }
  return { rows, lockedSecrets };
}

export interface ForeignKey {
  table: string;
  name: string;
  definition: string;
}

export async function listForeignKeys(db: RawClient): Promise<ForeignKey[]> {
  return db.$queryRawUnsafe<ForeignKey[]>(
    `SELECT cl.relname AS "table", con.conname AS name, pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
      WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
      ORDER BY cl.relname, con.conname`,
  );
}

/** Inserts the rows of one extracted table file; `table` may be a temporary copy of the real table. */
export async function loadTableRows(
  db: RawClient,
  table: string,
  columns: string[],
  filePath: string,
): Promise<number> {
  const secrets = secretColumnsFor(table).filter((column) => columns.includes(column));
  const columnList = columns.map(quoteIdent).join(', ');
  const statement = `INSERT INTO ${quoteIdent(table)} (${columnList})
    SELECT ${columnList} FROM json_populate_recordset(NULL::${quoteIdent(table)}, $1::json)`;

  let loaded = 0;
  let batch: string[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    await db.$executeRawUnsafe(statement, `[${batch.join(',')}]`);
    loaded += batch.length;
    batch = [];
  };

  const lines = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    if (secrets.length === 0) {
      batch.push(line);
    } else {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      for (const column of secrets) parsed[column] = decodeSecretColumn(parsed[column]);
      batch.push(JSON.stringify(parsed));
    }
    if (batch.length >= IMPORT_BATCH_ROWS) await flush();
  }
  await flush();
  return loaded;
}

export interface ReplaceDatabaseInput {
  /** Tables recorded in the backup, keyed by name. */
  tables: FullBackupTable[];
  /** Where `<table>.jsonl` files were extracted. */
  tableFile: (table: string) => string;
  onProgress?: (done: number, total: number) => void | Promise<void>;
}

/**
 * Replaces the contents of every application table with the backup's rows.
 *
 * Foreign keys are dropped and re-created around the load, so rows can go in
 * any order (circular links such as deadline rules and their versions included),
 * and re-creating them proves the restored data is consistent. User triggers
 * (append-only ledgers, authorization gates) are paused for the load only.
 * Everything runs in the caller's transaction, so a failure leaves the
 * database untouched.
 */
export async function replaceDatabase(db: RawClient, input: ReplaceDatabaseInput): Promise<Record<string, number>> {
  const liveTables = await listTables(db);
  const foreignKeys = await listForeignKeys(db);
  const tableNames = [...liveTables.keys()];

  for (const fk of foreignKeys) {
    await db.$executeRawUnsafe(`ALTER TABLE ${quoteIdent(fk.table)} DROP CONSTRAINT ${quoteIdent(fk.name)}`);
  }
  for (const table of tableNames) {
    await db.$executeRawUnsafe(`ALTER TABLE ${quoteIdent(table)} DISABLE TRIGGER USER`);
  }
  if (tableNames.length > 0) {
    await db.$executeRawUnsafe(`TRUNCATE ${tableNames.map(quoteIdent).join(', ')}`);
  }

  const loaded: Record<string, number> = {};
  let done = 0;
  for (const table of input.tables) {
    const liveColumns = liveTables.get(table.name);
    done += 1;
    // A table dropped by a newer migration has nowhere to go.
    if (!liveColumns || table.rows === 0) continue;
    const columns = table.columns.filter((column) => liveColumns.includes(column));
    loaded[table.name] = await loadTableRows(db, table.name, columns, input.tableFile(table.name));
    await input.onProgress?.(done, input.tables.length);
  }

  // Backup records of this install stay, but only for workspaces that still exist.
  await db.$executeRawUnsafe(`DELETE FROM tenant_backups WHERE tenant_id NOT IN (SELECT id FROM tenants)`);

  for (const table of tableNames) {
    await db.$executeRawUnsafe(`ALTER TABLE ${quoteIdent(table)} ENABLE TRIGGER USER`);
  }
  for (const fk of foreignKeys) {
    await db.$executeRawUnsafe(
      `ALTER TABLE ${quoteIdent(fk.table)} ADD CONSTRAINT ${quoteIdent(fk.name)} ${fk.definition}`,
    );
  }
  return loaded;
}
