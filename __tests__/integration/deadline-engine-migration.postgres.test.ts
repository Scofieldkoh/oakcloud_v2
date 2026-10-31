// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const migrationRoot = resolve(process.cwd(), 'prisma/migrations');
const foundationMigration = '20260817090000_services_admin_foundation';
const deadlineMigration = '20260817100000_deadline_rule_engine';

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('deadline engine migration PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const describePostgres = testDatabaseUrl ? describe : describe.skip;

function quoteIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function isolateMigrationSql(sql: string, schemaName: string): string {
  const schema = quoteIdentifier(schemaName);
  return sql
    .replaceAll('"public".', `${schema}.`)
    .replaceAll("'public.", `'${schemaName}.`)
    .replaceAll('public.', `${schemaName}.`);
}

async function applyMigration(client: PoolClient, schemaName: string, migrationDirectory: string): Promise<void> {
  const sql = readFileSync(resolve(migrationRoot, migrationDirectory, 'migration.sql'), 'utf8');
  const schema = quoteIdentifier(schemaName);

  await client.query('BEGIN');
  try {
    // Some legacy migrations contain their own COMMIT, which would drop a SET LOCAL.
    // Keep the isolated schema on the connection across those transaction boundaries.
    await client.query(`SET search_path TO ${schema}, public`);
    await client.query(isolateMigrationSql(sql, schemaName));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function applyPriorMigrations(client: PoolClient, schemaName: string): Promise<void> {
  const directories = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const foundationIndex = directories.indexOf(foundationMigration);
  if (foundationIndex < 1) {
    throw new Error(`Missing prior migration ${foundationMigration}`);
  }

  for (const migrationDirectory of directories.slice(0, foundationIndex)) {
    await applyMigration(client, schemaName, migrationDirectory);
  }
}

describePostgres('deadline engine migration PostgreSQL integration', () => {
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  let schemaName: string | undefined;

  afterAll(async () => {
    if (client && schemaName) {
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    }
    client?.release();
    await pool?.end();
  });

  it('applies after the real prior migrations, preserves fixtures, seeds calendars, and enforces invariants', async () => {
    pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
    const db = await pool.connect();
    client = db;
    schemaName = `deadline_engine_${randomUUID().replaceAll('-', '')}`;
    const schema = quoteIdentifier(schemaName);
    const table = (name: string) => `${schema}."${name}"`;

    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      await applyPriorMigrations(db, schemaName);

      // These rows use the actual pre-change tables/columns created by the
      // repository migrations, including the service-catalog/client-service
      // prerequisites that the deadline migration references.
      await db.query(`
        INSERT INTO ${table('tenants')} ("id", "name", "slug", "updatedAt")
        VALUES ('tenant-a', 'Tenant A', 'tenant-a', TIMESTAMP '2026-08-17 00:00:00'),
               ('tenant-b', 'Tenant B', 'tenant-b', TIMESTAMP '2026-08-17 00:00:00');
        INSERT INTO ${table('users')}
          ("id", "email", "passwordHash", "firstName", "lastName", "updatedAt", "tenantId")
        VALUES ('user-a', 'deadline@example.test', 'hash', 'Deadline', 'Owner', TIMESTAMP '2026-08-17 00:00:00', 'tenant-a');
        INSERT INTO ${table('template_partials')}
          ("id", "tenant_id", "name", "content", "created_by_id", "updated_at")
        VALUES ('partial-a', 'tenant-a', 'Deadline partial', '<p>service</p>', 'user-a', TIMESTAMP '2026-08-17 00:00:00');
        INSERT INTO ${table('service_families')}
          ("id", "tenant_id", "code", "name", "description", "display_order", "updated_at")
        VALUES ('family-a', 'tenant-a', 'ACCOUNTING', 'Accounting', 'Accounting services', 0, TIMESTAMP '2026-08-17 00:00:00'),
               ('family-b', 'tenant-b', 'ACCOUNTING', 'Accounting', 'Accounting services', 0, TIMESTAMP '2026-08-17 00:00:00');
        INSERT INTO ${table('companies')}
          ("id", "tenantId", "uen", "name", "financialYearEndDay", "financialYearEndMonth",
           "nextAgmDueDate", "nextArDueDate", "updatedAt")
        VALUES ('company-a', 'tenant-a', 'UEN-A', 'Oaktree Accounting Pte. Ltd.', 31, 12,
                TIMESTAMP '2027-05-31', TIMESTAMP '2027-07-31', TIMESTAMP '2026-08-17 00:00:00');
        INSERT INTO ${table('service_variants')}
          ("id", "tenant_id", "family_id", "sow_partial_id", "code", "name", "service_cadence", "updated_at")
        VALUES ('variant-a', 'tenant-a', 'family-a', 'partial-a', 'ACCOUNTING_YEARLY', 'Accounting yearly', 'ANNUALLY', TIMESTAMP '2026-08-17 00:00:00');
        INSERT INTO ${table('client_services')}
          ("id", "tenant_id", "company_id", "source", "service_variant_id", "family_name",
           "service_name", "status", "service_cadence", "start_date", "updated_at")
        VALUES ('client-service-a', 'tenant-a', 'company-a', 'MANUAL', 'variant-a', 'Accounting',
                'Accounting yearly', 'ACTIVE', 'ANNUALLY', DATE '2026-01-01', TIMESTAMP '2026-08-17 00:00:00');
      `);

      const beforeTenantRows = await db.query(
        `SELECT "id", "name", "slug", "status", "maxUsers", "maxCompanies" FROM ${table('tenants')} ORDER BY "id"`,
      );
      const beforeUserRows = await db.query(
        `SELECT "id", "email", "firstName", "lastName", "tenantId" FROM ${table('users')} ORDER BY "id"`,
      );
      const beforeCompanyRows = await db.query(
        `SELECT "id", "tenantId", "uen", "name", "financialYearEndDay", "financialYearEndMonth", "nextAgmDueDate", "nextArDueDate" FROM ${table('companies')} ORDER BY "id"`,
      );
      const beforeFamilyRows = await db.query(
        `SELECT "id", "tenant_id", "code", "name", "description", "display_order", "is_active", "deleted_at" FROM ${table('service_families')} ORDER BY "id"`,
      );
      const beforeVariantRows = await db.query(
        `SELECT "id", "tenant_id", "family_id", "sow_partial_id", "code", "name", "service_cadence", "display_order", "version", "is_active", "deleted_at" FROM ${table('service_variants')} ORDER BY "id"`,
      );
      const beforeClientServiceRows = await db.query(
        `SELECT "id", "tenant_id", "company_id", "source", "agreement_id", "agreement_item_id", "service_variant_id", "family_name", "service_name", "status", "service_cadence", "start_date", "field_values", "deleted_at" FROM ${table('client_services')} ORDER BY "id"`,
      );

      await applyMigration(db, schemaName, foundationMigration);

      await expect(db.query(`SELECT "id", "name", "slug", "status", "maxUsers", "maxCompanies" FROM ${table('tenants')} ORDER BY "id"`)).resolves.toMatchObject({ rows: beforeTenantRows.rows });
      await expect(db.query(`SELECT "id", "email", "firstName", "lastName", "tenantId" FROM ${table('users')} ORDER BY "id"`)).resolves.toMatchObject({ rows: beforeUserRows.rows });
      await expect(db.query(`SELECT "id", "tenantId", "uen", "name", "financialYearEndDay", "financialYearEndMonth", "nextAgmDueDate", "nextArDueDate" FROM ${table('companies')} ORDER BY "id"`)).resolves.toMatchObject({ rows: beforeCompanyRows.rows });
      await expect(db.query(`SELECT "id", "tenant_id", "code", "name", "description", "display_order", "is_active", "deleted_at" FROM ${table('service_families')} ORDER BY "id"`)).resolves.toMatchObject({ rows: beforeFamilyRows.rows });
      await expect(db.query(`SELECT "id", "tenant_id", "family_id", "sow_partial_id", "code", "name", "service_cadence", "display_order", "version", "is_active", "deleted_at" FROM ${table('service_variants')} ORDER BY "id"`)).resolves.toMatchObject({ rows: beforeVariantRows.rows });
      await expect(db.query(`SELECT "id", "tenant_id", "company_id", "source", "agreement_id", "agreement_item_id", "service_variant_id", "family_name", "service_name", "status", "service_cadence", "start_date", "field_values", "deleted_at" FROM ${table('client_services')} ORDER BY "id"`)).resolves.toMatchObject({ rows: beforeClientServiceRows.rows });
      await expect(db.query(`SELECT "display_alias" FROM ${table('companies')} WHERE "id" = 'company-a'`)).resolves.toMatchObject({ rows: [{ display_alias: null }] });

      const colors = await db.query(`SELECT "tenant_id", "display_color" FROM ${table('service_families')} ORDER BY "tenant_id"`);
      expect(colors.rows).toEqual([
        { tenant_id: 'tenant-a', display_color: '#2F6F5E' },
        { tenant_id: 'tenant-b', display_color: '#2F6F5E' },
      ]);

      await applyMigration(db, schemaName, deadlineMigration);

      const indexes = await db.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename IN ('deadline_rule_versions', 'service_schedule_reconciliation_requests')`,
        [schemaName],
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
        'deadline_rule_versions_one_draft_idx',
        'service_schedule_reconciliation_claim_idx',
        'service_schedule_reconciliation_expired_lease_idx',
      ]));

      const constraints = await db.query(
        `SELECT conname FROM pg_constraint WHERE connamespace = $1::regnamespace`,
        [schemaName],
      );
      expect(constraints.rows.map((row) => row.conname)).toEqual(expect.arrayContaining([
        'deadline_occurrences_override_consistency',
        'deadline_occurrences_completion_consistency',
        'deadline_occurrences_waiver_consistency',
        'deadline_occurrences_cancellation_consistency',
        'deadline_occurrences_stable_keys_nonempty',
        'service_cycles_generation_key_nonempty',
      ]));

      const versionChildren = await db.query(`
        SELECT conname, confdeltype
        FROM pg_constraint
        WHERE connamespace = $1::regnamespace
          AND conname IN (
            'deadline_rule_parameter_definitions_rule_version_id_fkey',
            'deadline_milestone_templates_rule_version_id_fkey'
          )
      `, [schemaName]);
      expect(versionChildren.rows).toEqual([
        { conname: 'deadline_milestone_templates_rule_version_id_fkey', confdeltype: 'r' },
        { conname: 'deadline_rule_parameter_definitions_rule_version_id_fkey', confdeltype: 'r' },
      ]);

      const calendars = await db.query(`
        SELECT tenant_id, time_zone, revision, weekend_days, is_active
        FROM ${table('business_calendars')}
        WHERE is_active = TRUE
        ORDER BY tenant_id
      `);
      expect(calendars.rows).toEqual([
        { tenant_id: 'tenant-a', time_zone: 'Asia/Singapore', revision: 1, weekend_days: [0, 6], is_active: true },
        { tenant_id: 'tenant-b', time_zone: 'Asia/Singapore', revision: 1, weekend_days: [0, 6], is_active: true },
      ]);
      expect((await db.query(`SELECT count(*)::int AS count FROM ${table('business_holidays')}`)).rows[0].count).toBe(0);

      await db.query(`
        INSERT INTO ${table('deadline_rules')} (id, tenant_id, code, name)
        VALUES ('rule-a', 'tenant-a', 'RULE_A', 'Rule A');
        INSERT INTO ${table('deadline_rule_versions')}
          (id, tenant_id, rule_id, version, state, schema_version, recurrence, applicability, config_hash)
        VALUES ('version-draft-1', 'tenant-a', 'rule-a', 1, 'DRAFT', 1, '{}', '{}', 'hash-a')
      `);
      await expect(
        db.query(`
          INSERT INTO ${table('deadline_rule_versions')}
            (id, tenant_id, rule_id, version, state, schema_version, recurrence, applicability, config_hash)
          VALUES ('version-draft-2', 'tenant-a', 'rule-a', 2, 'DRAFT', 1, '{}', '{}', 'hash-b')
        `),
      ).rejects.toThrow();

      await db.query(`
        INSERT INTO ${table('service_cycles')}
          (id, tenant_id, company_id, client_service_id, rule_id, rule_version_id,
           period_key, period_start, period_end, generation_key, origin,
           recurrence_anchor, source_snapshot, evaluation_hash)
        VALUES ('cycle-a', 'tenant-a', 'company-a', 'client-service-a', 'rule-a',
                'version-draft-1', '2026', '2026-01-01', '2026-12-31', 'generation-a',
                'RULE', '{}', '{}', 'hash-cycle')
      `);

      const insertOccurrence = async (id: string, values: Record<string, unknown>) => {
        const row: Record<string, unknown> = {
          id,
          tenant_id: 'tenant-a',
          company_id: 'company-a',
          client_service_id: 'client-service-a',
          cycle_id: 'cycle-a',
          rule_version_id: 'version-draft-1',
          milestone_key: `milestone-${id}`,
          schedule_entry_key: '',
          deadline_type: 'CLIENT',
          calculated_due_date: '2026-08-20',
          operative_due_date: '2026-08-20',
          status: 'OPEN',
          ...values,
        };
        return db.query(`
          INSERT INTO ${table('deadline_occurrences')}
            (id, tenant_id, company_id, client_service_id, cycle_id, rule_version_id,
             milestone_key, schedule_entry_key, deadline_type, calculated_due_date,
             operative_due_date, date_overridden, date_override, date_override_reason,
             date_overridden_by_id, date_overridden_at, status, completed_at,
             completed_by_id, waived_at, waived_by_id, waiver_reason, cancelled_at,
             cancelled_by_id, cancellation_reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                  $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
        `, [
          row.id, row.tenant_id, row.company_id, row.client_service_id, row.cycle_id,
          row.rule_version_id, row.milestone_key, row.schedule_entry_key,
          row.deadline_type, row.calculated_due_date, row.operative_due_date,
          row.date_overridden ?? false, row.date_override ?? null,
          row.date_override_reason ?? null, row.date_overridden_by_id ?? null,
          row.date_overridden_at ?? null, row.status, row.completed_at ?? null,
          row.completed_by_id ?? null, row.waived_at ?? null, row.waived_by_id ?? null,
          row.waiver_reason ?? null, row.cancelled_at ?? null,
          row.cancelled_by_id ?? null, row.cancellation_reason ?? null,
        ]);
      };

      await expect(insertOccurrence('override-no-date', {
        date_overridden: true,
        date_override_reason: 'manual',
        date_overridden_by_id: 'user-a',
        date_overridden_at: '2026-08-18 10:00:00',
      })).rejects.toThrow();
      await expect(insertOccurrence('override-stale-date', {
        date_override: '2026-08-19',
      })).rejects.toThrow();
      await expect(insertOccurrence('waiver-stale', {
        waived_at: '2026-08-18 10:00:00',
      })).rejects.toThrow();
      await expect(insertOccurrence('cancellation-stale', {
        cancelled_by_id: 'user-a',
      })).rejects.toThrow();
      await expect(insertOccurrence('cancellation-partial', {
        status: 'CANCELLED',
        cancelled_at: '2026-08-18 10:00:00',
      })).rejects.toThrow();
      await expect(insertOccurrence('cancellation-system-valid', {
        status: 'CANCELLED',
        cancelled_at: '2026-08-18 10:00:00',
        cancellation_reason: 'System reconciliation removed future occurrence',
      })).resolves.toBeDefined();
      await expect(insertOccurrence('completion-actor-stale', {
        completed_by_id: 'user-a',
      })).rejects.toThrow();
      await expect(insertOccurrence('completed-valid', {
        status: 'COMPLETED',
        completed_at: '2026-08-20 10:00:00',
        completed_by_id: 'user-a',
      })).resolves.toBeDefined();

      await expect(
        db.query(`
          INSERT INTO ${table('service_cycles')}
            (id, tenant_id, company_id, client_service_id, rule_id, rule_version_id,
             period_key, period_start, period_end, generation_key, origin,
             recurrence_anchor, source_snapshot, evaluation_hash)
          VALUES ('cycle-empty-generation', 'tenant-a', 'company-a', 'client-service-a',
                  'rule-a', 'version-draft-1', '2027', '2027-01-01', '2027-12-31',
                  '', 'RULE', '{}', '{}', 'hash-empty')
        `),
      ).rejects.toThrow();
      await expect(
        db.query(`
          INSERT INTO ${table('deadline_occurrences')}
            (id, tenant_id, company_id, client_service_id, cycle_id, rule_version_id,
             milestone_key, schedule_entry_key, deadline_type, calculated_due_date,
             operative_due_date, status)
          VALUES ('occurrence-invalid', 'tenant-a', 'company-a', 'client-service-a',
                  'cycle-a', 'version-draft-1', '', '', 'CLIENT', '2026-08-20',
                  '2026-08-20', 'OPEN')
        `),
      ).rejects.toThrow();

      await db.query(`
        INSERT INTO ${table('service_schedule_reconciliation_requests')}
          (id, tenant_id, scope_type, scope_id, trigger_type, correlation_id,
           dedupe_key, status, next_attempt_at)
        VALUES ('request-a', 'tenant-a', 'TENANT', 'tenant-a', 'TEST', 'correlation-a',
                'dedupe-a', 'PENDING', CURRENT_TIMESTAMP)
      `);
      await expect(
        db.query(`
          INSERT INTO ${table('service_schedule_reconciliation_requests')}
            (id, tenant_id, scope_type, scope_id, trigger_type, correlation_id,
             dedupe_key, status, next_attempt_at)
          VALUES ('request-duplicate', 'tenant-a', 'TENANT', 'tenant-a', 'TEST',
                  'correlation-b', 'dedupe-a', 'PENDING', CURRENT_TIMESTAMP)
        `),
      ).rejects.toThrow();
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      schemaName = undefined;
    }
  });
});
