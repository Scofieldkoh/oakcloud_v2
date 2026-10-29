/**
 * Restoring chosen modules of a full backup: the rows of the modules' tables
 * are replaced with the backup's, and everything else is left alone.
 *
 * The preview loads the backup's rows into temporary tables and compares them
 * with the live ones (added, replaced, removed), then follows every foreign key
 * that crosses the edge of the selection. A link that would break (restored
 * rows pointing at records this machine no longer has, or live rows pointing at
 * records the restore would remove) blocks the restore and names the module to
 * add, because Postgres would refuse the result anyway.
 */

import { EXCLUDED_TABLES, listTables, loadTableRows, quoteIdent, type RawClient } from './database-snapshot';
import { MODULE_RESTORE_SKIPPED_TABLES, moduleForTable, moduleLabel } from './modules';
import { secretColumnsFor } from './secret-columns';
import type { FullBackupTable, ModuleChange, ModuleLinkProblem, ModuleTableChange } from './types';

interface ForeignKeyColumns {
  name: string;
  child: string;
  childColumns: string[];
  parent: string;
  parentColumns: string[];
  definition: string;
}

export interface ModuleRestoreInput {
  tables: FullBackupTable[];
  modules: string[];
  tableFile: (table: string) => string;
}

/** Tables a module restore replaces: the selected modules' tables that exist both in the backup and here. */
export function tablesForModules(backupTables: FullBackupTable[], liveTables: Map<string, string[]>, modules: string[]): FullBackupTable[] {
  const wanted = new Set(modules);
  return backupTables.filter((table) =>
    wanted.has(moduleForTable(table.name))
    && liveTables.has(table.name)
    && !MODULE_RESTORE_SKIPPED_TABLES.has(table.name));
}

async function listForeignKeyColumns(db: RawClient): Promise<ForeignKeyColumns[]> {
  const rows = await db.$queryRawUnsafe<Array<{
    name: string; child: string; child_columns: string[]; parent: string; parent_columns: string[]; definition: string;
  }>>(
    `SELECT con.conname AS name,
            child.relname AS child,
            ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(attnum, n)
                    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.n)::text[] AS child_columns,
            parent.relname AS parent,
            ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(attnum, n)
                    JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum ORDER BY k.n)::text[] AS parent_columns,
            pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class child ON child.oid = con.conrelid
       JOIN pg_class parent ON parent.oid = con.confrelid
      WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
      ORDER BY child.relname, con.conname`,
  );
  return rows.map((row) => ({
    name: row.name,
    child: row.child,
    childColumns: row.child_columns,
    parent: row.parent,
    parentColumns: row.parent_columns,
    definition: row.definition,
  }));
}

async function primaryKeyColumns(db: RawClient, table: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey::int2[], a.attnum)`,
    `public.${quoteIdent(table)}`,
  );
  return rows.map((row) => row.column_name);
}

function stagedName(table: string): string {
  return `restore_${table}`;
}

function joinOn(left: string, right: string, leftColumns: string[], rightColumns: string[]): string {
  return leftColumns.map((column, index) => `${left}.${quoteIdent(column)} = ${right}.${quoteIdent(rightColumns[index])}`).join(' AND ');
}

async function count(db: RawClient, sql: string, ...params: unknown[]): Promise<number> {
  const [row] = await db.$queryRawUnsafe<Array<{ n: bigint | number }>>(sql, ...params);
  return Number(row?.n ?? 0);
}

async function compareTable(
  db: RawClient,
  table: FullBackupTable,
  liveColumns: string[],
): Promise<ModuleTableChange> {
  const live = quoteIdent(table.name);
  const staged = quoteIdent(stagedName(table.name));
  const primaryKey = await primaryKeyColumns(db, table.name);
  const liveRows = await count(db, `SELECT count(*) AS n FROM ${live}`);
  if (primaryKey.length === 0) {
    return { table: table.name, added: table.rows, replaced: 0, removed: liveRows, unchanged: 0 };
  }
  const on = joinOn('l', 'b', primaryKey, primaryKey);
  // Columns the backup does not have, and secrets (re-locked with a new key each time), are not compared.
  const ignored = [
    ...liveColumns.filter((column) => !table.columns.includes(column)),
    ...secretColumnsFor(table.name),
  ];
  const added = await count(db, `SELECT count(*) AS n FROM ${staged} b WHERE NOT EXISTS (SELECT 1 FROM ${live} l WHERE ${on})`);
  const removed = await count(db, `SELECT count(*) AS n FROM ${live} l WHERE NOT EXISTS (SELECT 1 FROM ${staged} b WHERE ${on})`);
  const matched = await count(db, `SELECT count(*) AS n FROM ${live} l JOIN ${staged} b ON ${on}`);
  const replaced = await count(
    db,
    `SELECT count(*) AS n FROM ${live} l JOIN ${staged} b ON ${on}
      WHERE (to_jsonb(l) - $1::text[]) IS DISTINCT FROM (to_jsonb(b) - $1::text[])`,
    ignored,
  );
  return { table: table.name, added, replaced, removed, unchanged: matched - replaced };
}

/** Rows whose link (all columns set) finds no row on the other side. */
async function brokenLinks(db: RawClient, fk: ForeignKeyColumns, childSource: string, parentSource: string): Promise<number> {
  const notNull = fk.childColumns.map((column) => `c.${quoteIdent(column)} IS NOT NULL`).join(' AND ');
  return count(
    db,
    `SELECT count(*) AS n FROM ${childSource} c
      WHERE ${notNull}
        AND NOT EXISTS (SELECT 1 FROM ${parentSource} p WHERE ${joinOn('c', 'p', fk.childColumns, fk.parentColumns)})`,
  );
}

async function findLinkProblems(db: RawClient, restored: Set<string>): Promise<ModuleLinkProblem[]> {
  const grouped = new Map<string, ModuleLinkProblem>();
  const add = (problem: Omit<ModuleLinkProblem, 'message'>, message: string) => {
    const key = `${problem.fromModule}>${problem.toModule}>${problem.addModule}`;
    const existing = grouped.get(key);
    if (existing) existing.rows += problem.rows;
    else grouped.set(key, { ...problem, message });
  };

  for (const fk of await listForeignKeyColumns(db)) {
    const childRestored = restored.has(fk.child);
    const parentRestored = restored.has(fk.parent);
    if (childRestored === parentRestored || EXCLUDED_TABLES.has(fk.child)) continue;
    const childModule = moduleForTable(fk.child);
    const parentModule = moduleForTable(fk.parent);
    if (childRestored) {
      const rows = await brokenLinks(db, fk, quoteIdent(stagedName(fk.child)), quoteIdent(fk.parent));
      if (rows > 0) {
        add(
          { fromModule: childModule, toModule: parentModule, addModule: parentModule, rows },
          `${moduleLabel(childModule)} from the backup point at ${moduleLabel(parentModule)} records this machine no longer has.`,
        );
      }
    } else {
      const rows = await brokenLinks(db, fk, quoteIdent(fk.child), quoteIdent(stagedName(fk.parent)));
      if (rows > 0) {
        add(
          { fromModule: childModule, toModule: parentModule, addModule: childModule, rows },
          `${moduleLabel(childModule)} on this machine point at ${moduleLabel(parentModule)} records the restore would remove.`,
        );
      }
    }
  }
  return [...grouped.values()];
}

/**
 * Loads the selected modules' backup rows into temporary tables and reports
 * what would change. Run it in a transaction; the temporary tables go with it.
 */
export async function previewModules(db: RawClient, input: ModuleRestoreInput): Promise<{ changes: ModuleChange[]; links: ModuleLinkProblem[] }> {
  const liveTables = await listTables(db);
  const tables = tablesForModules(input.tables, liveTables, input.modules);

  const changesByModule = new Map<string, ModuleChange>(input.modules.map((module) => [
    module,
    { module, label: moduleLabel(module), added: 0, replaced: 0, removed: 0, unchanged: 0, tables: [] },
  ]));
  for (const table of tables) {
    const liveColumns = liveTables.get(table.name)!;
    const columns = table.columns.filter((column) => liveColumns.includes(column));
    await db.$executeRawUnsafe(
      `CREATE TEMP TABLE ${quoteIdent(stagedName(table.name))} (LIKE ${quoteIdent(table.name)} INCLUDING DEFAULTS) ON COMMIT DROP`,
    );
    if (table.rows > 0) await loadTableRows(db, stagedName(table.name), columns, input.tableFile(table.name));
    const change = await compareTable(db, table, liveColumns);
    const moduleChange = changesByModule.get(moduleForTable(table.name))!;
    moduleChange.tables.push(change);
    moduleChange.added += change.added;
    moduleChange.replaced += change.replaced;
    moduleChange.removed += change.removed;
    moduleChange.unchanged += change.unchanged;
  }
  const links = await findLinkProblems(db, new Set(tables.map((table) => table.name)));
  return { changes: [...changesByModule.values()], links };
}

/**
 * Replaces the selected modules' tables with the backup's rows. Foreign keys
 * that touch those tables are dropped for the load and re-created afterwards,
 * which checks every link again; any break undoes the whole restore.
 */
export async function restoreModules(db: RawClient, input: ModuleRestoreInput): Promise<Record<string, number>> {
  const liveTables = await listTables(db);
  const tables = tablesForModules(input.tables, liveTables, input.modules);
  const names = new Set(tables.map((table) => table.name));
  const touched = (await listForeignKeyColumns(db)).filter((fk) => names.has(fk.child) || names.has(fk.parent));

  for (const fk of touched) {
    await db.$executeRawUnsafe(`ALTER TABLE ${quoteIdent(fk.child)} DROP CONSTRAINT ${quoteIdent(fk.name)}`);
  }
  for (const table of names) await db.$executeRawUnsafe(`ALTER TABLE ${quoteIdent(table)} DISABLE TRIGGER USER`);
  if (names.size > 0) await db.$executeRawUnsafe(`TRUNCATE ${[...names].map(quoteIdent).join(', ')}`);

  const loaded: Record<string, number> = {};
  for (const table of tables) {
    const liveColumns = liveTables.get(table.name)!;
    const columns = table.columns.filter((column) => liveColumns.includes(column));
    loaded[table.name] = table.rows > 0 ? await loadTableRows(db, table.name, columns, input.tableFile(table.name)) : 0;
  }
  if (names.has('tenants')) {
    await db.$executeRawUnsafe(`DELETE FROM tenant_backups WHERE tenant_id NOT IN (SELECT id FROM tenants)`);
  }

  for (const table of names) await db.$executeRawUnsafe(`ALTER TABLE ${quoteIdent(table)} ENABLE TRIGGER USER`);
  for (const fk of touched) {
    try {
      await db.$executeRawUnsafe(`ALTER TABLE ${quoteIdent(fk.child)} ADD CONSTRAINT ${quoteIdent(fk.name)} ${fk.definition}`);
    } catch {
      throw new Error(
        `Nothing was changed: ${moduleLabel(moduleForTable(fk.child))} records would point at missing ` +
        `${moduleLabel(moduleForTable(fk.parent))} records (${fk.child}). Check the backup again and add the modules it suggests.`,
      );
    }
  }
  return loaded;
}
