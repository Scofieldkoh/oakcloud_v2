import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { billingCoverageIssueKey } from '@/services/billing/coverage';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const migrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');
const billingTrackingMigration = '20260817110000_billing_tracking';
const billingBackfillMigration = '20260817111000_billing_schedule_backfill';

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('billing schedule backfill PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const describePostgres = testDatabaseUrl ? describe : describe.skip;

function quoteIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
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
    // Some legacy migrations contain their own COMMIT. Keep the isolated
    // schema on the connection across those transaction boundaries.
    await client.query(`SET search_path TO ${schema}, public`);
    await client.query(isolateMigrationSql(sql, schemaName));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function applyMigrationsBefore(client: PoolClient, schemaName: string, target: string): Promise<void> {
  const directories = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const targetIndex = directories.indexOf(target);
  if (targetIndex < 1) throw new Error(`Missing migration ${target}`);
  for (const directory of directories.slice(0, targetIndex)) {
    await applyMigration(client, schemaName, directory);
  }
}

describePostgres('billing schedule backfill PostgreSQL integration', () => {
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  let schemaName: string | undefined;

  afterAll(async () => {
    if (client && schemaName) await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    client?.release();
    await pool?.end();
  });

  it('backfills deterministic schedules, preserves legacy values, isolates tenants, and is repeat-idempotent', async () => {
    pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
    client = await pool.connect();
    schemaName = `billing_backfill_${randomUUID().replaceAll('-', '')}`;
    const schema = quoteIdentifier(schemaName);
    const table = (name: string) => `${schema}."${name}"`;

    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await applyMigrationsBefore(client, schemaName, billingTrackingMigration);
      await client.query(`
        INSERT INTO ${table('tenants')} ("id", "name", "slug", "status", "updatedAt")
        VALUES ('tenant-a', 'Tenant A', 'tenant-a', 'ACTIVE', TIMESTAMP '2026-08-17 00:00:00'),
               ('tenant-b', 'Tenant B', 'tenant-b', 'ACTIVE', TIMESTAMP '2026-08-17 00:00:00');
        INSERT INTO ${table('users')}
          ("id", "email", "passwordHash", "firstName", "lastName", "updatedAt", "tenantId")
        VALUES ('user-a', 'billing@example.test', 'hash', 'Billing', 'Owner', TIMESTAMP '2026-08-17 00:00:00', 'tenant-a'),
               ('user-b', 'billing-b@example.test', 'hash', 'Billing', 'Owner', TIMESTAMP '2026-08-17 00:00:00', 'tenant-b');
        INSERT INTO ${table('template_partials')}
          ("id", "tenant_id", "name", "content", "created_by_id", "updated_at")
        VALUES ('partial-a', 'tenant-a', 'Billing partial', '<p>service</p>', 'user-a', TIMESTAMP '2026-08-17 00:00:00'),
               ('partial-b', 'tenant-b', 'Billing partial', '<p>service</p>', 'user-b', TIMESTAMP '2026-08-17 00:00:00');
        INSERT INTO ${table('service_families')}
          ("id", "tenant_id", "code", "name", "description", "display_order", "updated_at")
        VALUES ('family-a', 'tenant-a', 'ACCOUNTING', 'Accounting', 'Accounting services', 0, TIMESTAMP '2026-08-17 00:00:00'),
               ('family-b', 'tenant-b', 'ACCOUNTING', 'Accounting', 'Accounting services', 0, TIMESTAMP '2026-08-17 00:00:00');
        INSERT INTO ${table('service_variants')}
          ("id", "tenant_id", "family_id", "sow_partial_id", "code", "name", "service_cadence", "updated_at")
        VALUES ('variant-a', 'tenant-a', 'family-a', 'partial-a', 'ACCOUNTING_YEARLY', 'Accounting yearly', 'ANNUALLY', TIMESTAMP '2026-08-17 00:00:00'),
               ('variant-b', 'tenant-b', 'family-b', 'partial-b', 'ACCOUNTING_YEARLY', 'Accounting yearly', 'ANNUALLY', TIMESTAMP '2026-08-17 00:00:00');
        INSERT INTO ${table('companies')}
          ("id", "tenantId", "uen", "name", "updatedAt")
        VALUES ('company-a', 'tenant-a', 'UEN-A', 'Tenant A Company', TIMESTAMP '2026-08-17 00:00:00'),
               ('company-b', 'tenant-b', 'UEN-B', 'Tenant B Company', TIMESTAMP '2026-08-17 00:00:00');
        INSERT INTO ${table('client_services')}
          ("id", "tenant_id", "company_id", "source", "service_variant_id", "family_name", "service_name",
           "status", "service_cadence", "start_date", "updated_at")
        VALUES ('service-a', 'tenant-a', 'company-a', 'MANUAL', 'variant-a', 'Accounting', 'Accounting yearly',
                'ACTIVE', 'ANNUALLY', DATE '2026-01-01', TIMESTAMP '2026-08-17 00:00:00'),
               ('service-b', 'tenant-b', 'company-b', 'MANUAL', 'variant-b', 'Accounting', 'Accounting yearly',
                'ACTIVE', 'ANNUALLY', DATE '2026-01-01', TIMESTAMP '2026-08-17 00:00:00');
      `);

      await applyMigration(client, schemaName, billingTrackingMigration);
      await client.query(`
        INSERT INTO ${table('client_service_fee_lines')}
          ("id", "tenant_id", "client_service_id", "description", "amount", "currency", "billing_frequency", "billing_start_date", "updated_at")
        VALUES ('fee-monthly', 'tenant-a', 'service-a', 'Monthly fee', 125.00, 'SGD', 'MONTHLY', DATE '2026-08-31', TIMESTAMP '2026-08-17 00:00:00'),
               ('fee-custom', 'tenant-a', 'service-a', 'Custom fee', 200.00, 'USD', 'CUSTOM', NULL, TIMESTAMP '2026-08-17 00:00:00'),
               ('fee-missing', 'tenant-a', 'service-a', 'Annual fee', 300.00, 'EUR', 'ANNUALLY', NULL, TIMESTAMP '2026-08-17 00:00:00'),
               ('fee-other-tenant', 'tenant-b', 'service-b', 'Quarterly fee', 400.00, 'SGD', 'QUARTERLY', DATE '2026-08-01', TIMESTAMP '2026-08-17 00:00:00');
      `);

      await applyMigration(client, schemaName, billingBackfillMigration);

      const initialIssues = await client.query(`
        SELECT fee_line_id, issue_type, issue_key, resolved_at
        FROM ${table('billing_coverage_issues')}
        ORDER BY fee_line_id
      `);
      expect(initialIssues.rows).toEqual([
        {
          fee_line_id: 'fee-custom', issue_type: 'INVALID_CUSTOM_SCHEDULE',
          issue_key: billingCoverageIssueKey({ tenantId: 'tenant-a', clientServiceId: 'service-a', feeLineId: 'fee-custom', type: 'INVALID_CUSTOM_SCHEDULE', scheduleKey: 'schedule' }),
          resolved_at: null,
        },
        {
          fee_line_id: 'fee-missing', issue_type: 'MISSING_START_DATE',
          issue_key: billingCoverageIssueKey({ tenantId: 'tenant-a', clientServiceId: 'service-a', feeLineId: 'fee-missing', type: 'MISSING_START_DATE', scheduleKey: 'schedule' }),
          resolved_at: null,
        },
      ]);

      // APPLY must refresh the migration-created row by the same runtime key;
      // opening a second issue would make coverage counts drift.
      const runtimeIssueKey = billingCoverageIssueKey({ tenantId: 'tenant-a', clientServiceId: 'service-a', feeLineId: 'fee-custom', type: 'INVALID_CUSTOM_SCHEDULE', scheduleKey: 'schedule' });
      const refresh = await client.query(`
        INSERT INTO ${table('billing_coverage_issues')}
          (id, tenant_id, company_id, client_service_id, fee_line_id, issue_key, issue_type, severity, details, updated_at)
        VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tenant-a', 'company-a', 'service-a', 'fee-custom', $1, 'INVALID_CUSTOM_SCHEDULE', 'ERROR', '{}'::jsonb, TIMESTAMP '2026-08-18 00:00:00')
        ON CONFLICT (tenant_id, issue_key) WHERE (resolved_at IS NULL) DO UPDATE SET details = EXCLUDED.details, updated_at = EXCLUDED.updated_at
        RETURNING (xmax = 0) AS inserted
      `, [runtimeIssueKey]);
      expect(refresh.rows).toEqual([{ inserted: false }]);
      const openCount = await client.query(`SELECT count(*)::int AS count FROM ${table('billing_coverage_issues')} WHERE resolved_at IS NULL`);
      expect(openCount.rows[0]?.count).toBe(2);

      // Simulate a user/reconciliation update between migration applications.
      // The rerun must preserve these structured schedules and must not insert
      // new open legacy-derived issues after the existing issues are resolved.
      await client.query(`
        UPDATE ${table('client_service_fee_lines')}
        SET schedule_config = '{
          "schemaVersion": 1,
          "cadence": "MONTHLY",
          "startDate": "2026-08-31",
          "customInterval": {"unit": "MONTH", "count": 1},
          "scheduleEntries": [
            {"key": "configured-date", "label": "Configured date", "expression": {"kind": "DAY_OF_MONTH", "day": 5}, "businessDayAdjustment": "PREVIOUS"},
            {"key": "second-date", "label": "Second configured date", "expression": {"kind": "DAY_OF_MONTH", "day": 20}, "businessDayAdjustment": "NEXT"}
          ]
        }'::jsonb
        WHERE id = 'fee-monthly';

        UPDATE ${table('client_service_fee_lines')}
        SET schedule_config = '{
          "schemaVersion": 1,
          "cadence": "CUSTOM",
          "startDate": "2026-09-15",
          "customInterval": {"unit": "MONTH", "count": 2},
          "scheduleEntries": [{"key": "configured-custom", "label": "Configured custom date", "expression": {"kind": "DAY_OF_MONTH", "day": 15}, "businessDayAdjustment": "NONE"}]
        }'::jsonb
        WHERE id = 'fee-custom';

        UPDATE ${table('client_service_fee_lines')}
        SET schedule_config = '{
          "schemaVersion": 1,
          "cadence": "ANNUALLY",
          "startDate": "2026-10-10",
          "customInterval": {"unit": "MONTH", "count": 12},
          "scheduleEntries": [{"key": "configured-annual", "label": "Configured annual date", "expression": {"kind": "DAY_OF_MONTH", "day": 10}, "businessDayAdjustment": "NONE"}]
        }'::jsonb
        WHERE id = 'fee-missing';

        UPDATE ${table('billing_coverage_issues')}
        SET resolved_at = TIMESTAMP '2026-08-18 00:00:00', updated_at = TIMESTAMP '2026-08-18 00:00:00'
        WHERE fee_line_id IN ('fee-custom', 'fee-missing') AND resolved_at IS NULL;
      `);

      await applyMigration(client, schemaName, billingBackfillMigration);

      const lines = await client.query(`
        SELECT id, amount::text, currency, schedule_config
        FROM ${table('client_service_fee_lines')}
        ORDER BY id
      `);
      expect(lines.rows).toEqual([
        {
          id: 'fee-custom', amount: '200.00', currency: 'USD', schedule_config: {
            schemaVersion: 1, cadence: 'CUSTOM', startDate: '2026-09-15',
            customInterval: { unit: 'MONTH', count: 2 }, scheduleEntries: [{
              key: 'configured-custom', label: 'Configured custom date',
              expression: { kind: 'DAY_OF_MONTH', day: 15 }, businessDayAdjustment: 'NONE',
            }],
          },
        },
        {
          id: 'fee-missing', amount: '300.00', currency: 'EUR', schedule_config: {
            schemaVersion: 1, cadence: 'ANNUALLY', startDate: '2026-10-10',
            customInterval: { unit: 'MONTH', count: 12 }, scheduleEntries: [{
              key: 'configured-annual', label: 'Configured annual date',
              expression: { kind: 'DAY_OF_MONTH', day: 10 }, businessDayAdjustment: 'NONE',
            }],
          },
        },
        {
          id: 'fee-monthly', amount: '125.00', currency: 'SGD', schedule_config: {
            schemaVersion: 1, cadence: 'MONTHLY', startDate: '2026-08-31',
            customInterval: { unit: 'MONTH', count: 1 }, scheduleEntries: [
              { key: 'configured-date', label: 'Configured date', expression: { kind: 'DAY_OF_MONTH', day: 5 }, businessDayAdjustment: 'PREVIOUS' },
              { key: 'second-date', label: 'Second configured date', expression: { kind: 'DAY_OF_MONTH', day: 20 }, businessDayAdjustment: 'NEXT' },
            ],
          },
        },
        {
          id: 'fee-other-tenant', amount: '400.00', currency: 'SGD', schedule_config: {
            schemaVersion: 1, cadence: 'QUARTERLY', startDate: '2026-08-01',
            customInterval: { unit: 'MONTH', count: 3 }, scheduleEntries: [{
              key: 'default', label: 'Billing date',
              expression: { kind: 'DAY_OF_MONTH', day: 1 }, businessDayAdjustment: 'NONE',
            }],
          },
        },
      ]);

      const dispositions = await client.query(`
        SELECT id, billing_disposition
        FROM ${table('client_services')}
        ORDER BY id
      `);
      expect(dispositions.rows).toEqual([
        { id: 'service-a', billing_disposition: 'UNREVIEWED' },
        { id: 'service-b', billing_disposition: 'UNREVIEWED' },
      ]);

      const issues = await client.query(`
        SELECT tenant_id, client_service_id, fee_line_id, issue_type, resolved_at
        FROM ${table('billing_coverage_issues')}
        ORDER BY fee_line_id NULLS FIRST, fee_line_id
      `);
      expect(issues.rows).toEqual(expect.arrayContaining([
        { tenant_id: 'tenant-a', client_service_id: 'service-a', fee_line_id: 'fee-custom', issue_type: 'INVALID_CUSTOM_SCHEDULE', resolved_at: expect.anything() },
        { tenant_id: 'tenant-a', client_service_id: 'service-a', fee_line_id: 'fee-missing', issue_type: 'MISSING_START_DATE', resolved_at: expect.anything() },
      ]));
      expect(issues.rows).toHaveLength(2);

      const requests = await client.query(`
        SELECT tenant_id, scope_type, scope_id, trigger_type, status, count(*) OVER ()::int AS total
        FROM ${table('service_schedule_reconciliation_requests')}
        WHERE trigger_type = 'BILLING_BACKFILL'
        ORDER BY tenant_id
      `);
      expect(requests.rows).toEqual([
        expect.objectContaining({ tenant_id: 'tenant-a', scope_type: 'TENANT', scope_id: 'tenant-a', trigger_type: 'BILLING_BACKFILL', status: 'PENDING', total: 2 }),
        expect.objectContaining({ tenant_id: 'tenant-b', scope_type: 'TENANT', scope_id: 'tenant-b', trigger_type: 'BILLING_BACKFILL', status: 'PENDING', total: 2 }),
      ]);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      schemaName = undefined;
    }
  });
});
