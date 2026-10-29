import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('billing tracking PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const describePostgres = testDatabaseUrl ? describe : describe.skip;
const migrationSql = readFileSync(
  resolve(process.cwd(), 'prisma/migrations/20260817110000_billing_tracking/migration.sql'),
  'utf8',
);

function quoteIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  }
  return `"${value}"`;
}

describePostgres('billing tracking migration PostgreSQL integrity', () => {
  let pool: Pool;
  let client: PoolClient;
  let schemaName: string;

  const schema = () => quoteIdentifier(schemaName);
  const table = (name: string) => `${schema()}."${name}"`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
    client = await pool.connect();
    schemaName = `billing_tracking_${randomUUID().replaceAll('-', '')}`;

    await client.query(`CREATE SCHEMA ${schema()}`);
    await client.query(`
      CREATE TABLE ${table('tenants')} (
        "id" TEXT PRIMARY KEY
      );
      CREATE TABLE ${table('users')} (
        "id" TEXT PRIMARY KEY
      );
      CREATE TABLE ${table('companies')} (
        "id" TEXT PRIMARY KEY,
        "tenantId" TEXT NOT NULL
      );
      CREATE TABLE ${table('client_services')} (
        "id" TEXT PRIMARY KEY,
        "tenant_id" TEXT NOT NULL,
        "company_id" TEXT NOT NULL
      );
      CREATE TABLE ${table('client_service_fee_lines')} (
        "id" TEXT PRIMARY KEY,
        "tenant_id" TEXT NOT NULL,
        "client_service_id" TEXT NOT NULL
      );
    `);

    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL search_path TO ${schema()}, public`);
      await client.query(migrationSql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  afterAll(async () => {
    if (client && schemaName) {
      await client.query(`DROP SCHEMA IF EXISTS ${schema()} CASCADE`);
    }
    client?.release();
    await pool?.end();
  });

  async function insertTenantFixture(): Promise<void> {
    await client.query(`
      INSERT INTO ${table('tenants')} ("id") VALUES ('tenant-a'), ('tenant-b');
      INSERT INTO ${table('users')} ("id") VALUES ('user-a'), ('user-b');
      INSERT INTO ${table('companies')} ("id", "tenantId")
      VALUES ('company-a', 'tenant-a'), ('company-b', 'tenant-b'), ('company-a2', 'tenant-a');
      INSERT INTO ${table('client_services')} ("id", "tenant_id", "company_id")
      VALUES ('service-a', 'tenant-a', 'company-a'),
             ('service-b', 'tenant-b', 'company-b'),
             ('service-a2', 'tenant-a', 'company-a2');
      INSERT INTO ${table('client_service_fee_lines')} ("id", "tenant_id", "client_service_id")
      VALUES ('fee-a', 'tenant-a', 'service-a'),
             ('fee-b', 'tenant-b', 'service-b'),
             ('fee-a2', 'tenant-a', 'service-a2');
    `);
  }

  async function insertOccurrence(overrides: Record<string, unknown> = {}): Promise<void> {
    const id = String(overrides.id ?? `occ-${randomUUID()}`);
    const values: Record<string, unknown> = {
      id,
      tenant_id: 'tenant-a',
      company_id: 'company-a',
      client_service_id: 'service-a',
      fee_line_id: 'fee-a',
      billing_period_key: `period-${id}`,
      schedule_entry_key: '',
      generation_key: `generation-${id}`,
      calculated_expected_date: '2026-08-17',
      operative_expected_date: '2026-08-17',
      date_overridden: false,
      date_override_reason: null,
      date_overridden_at: null,
      date_overridden_by_id: null,
      base_amount: '100.00',
      base_currency: 'SGD',
      operative_amount: '100.00',
      operative_currency: 'SGD',
      value_overridden: false,
      value_override_reason: null,
      value_overridden_at: null,
      value_overridden_by_id: null,
      status: 'OPEN',
      billed_date: null,
      marked_billed_at: null,
      marked_billed_by_id: null,
      external_reference: null,
      notes: null,
      waived_at: null,
      waived_by_id: null,
      waiver_reason: null,
      cancelled_at: null,
      cancelled_by_id: null,
      cancellation_reason: null,
      created_at: '2026-08-17 00:00:00',
      updated_at: '2026-08-17 00:00:00',
      ...overrides,
    };
    const columns = Object.keys(values);
    const parameters = columns.map((column) => values[column]);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO ${table('billing_occurrences')} (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${placeholders})`,
      parameters,
    );
  }

  async function insertCoverageIssue(
    issueKey: string,
    resolvedAt: string | null = null,
    feeLineId: string | null = 'fee-a',
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${table('billing_coverage_issues')}
        ("id", "tenant_id", "company_id", "client_service_id", "fee_line_id", "issue_type", "severity", "issue_key", "details", "first_detected_at", "last_detected_at", "resolved_at", "created_at", "updated_at")
       VALUES ($1, 'tenant-a', 'company-a', 'service-a', $2, 'MISSING_START_DATE', 'ERROR', $3, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [`issue-${randomUUID()}`, feeLineId, issueKey, resolvedAt],
    );
  }

  it('rejects cross-tenant and mismatched company/service/fee lineage', async () => {
    await insertTenantFixture();

    await expect(insertOccurrence({ id: 'occ-cross-tenant-company', company_id: 'company-b' })).rejects.toThrow();
    await expect(insertOccurrence({ id: 'occ-cross-company-service', client_service_id: 'service-a2', fee_line_id: 'fee-a2' })).rejects.toThrow();
    await expect(insertOccurrence({ id: 'occ-cross-service-fee', fee_line_id: 'fee-a2' })).rejects.toThrow();
    await expect(
      client.query(`
        INSERT INTO ${table('billing_coverage_issues')}
          ("id", "tenant_id", "company_id", "client_service_id", "fee_line_id", "issue_type", "severity", "issue_key", "details", "first_detected_at", "last_detected_at", "created_at", "updated_at")
        VALUES ('issue-cross-tenant', 'tenant-a', 'company-b', 'service-a', 'fee-a', 'MISSING_START_DATE', 'ERROR', 'cross-tenant', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `),
    ).rejects.toThrow();
  });

  it('requires explicit not-required reasons and canonical fee-line archive metadata', async () => {
    await expect(
      client.query(`UPDATE ${table('client_services')} SET "billing_disposition" = 'NOT_REQUIRED', "billing_not_required_reason" = NULL WHERE "id" = 'service-a'`),
    ).rejects.toThrow();
    await expect(
      client.query(`UPDATE ${table('client_services')} SET "billing_disposition" = 'NOT_REQUIRED', "billing_not_required_reason" = '   ' WHERE "id" = 'service-a'`),
    ).rejects.toThrow();
    await expect(
      client.query(`UPDATE ${table('client_services')} SET "billing_disposition" = 'NOT_REQUIRED', "billing_not_required_reason" = 'no' WHERE "id" = 'service-a'`),
    ).rejects.toThrow();
    await expect(
      client.query(`UPDATE ${table('client_services')} SET "billing_disposition" = 'NOT_REQUIRED', "billing_not_required_reason" = 'No billable work' WHERE "id" = 'service-a'`),
    ).resolves.toBeDefined();

    await expect(
      client.query(`UPDATE ${table('client_service_fee_lines')} SET "is_active" = FALSE WHERE "id" = 'fee-a'`),
    ).rejects.toThrow();
    await expect(
      client.query(`UPDATE ${table('client_service_fee_lines')} SET "is_active" = TRUE, "deleted_at" = CURRENT_TIMESTAMP, "deleted_reason" = 'archived' WHERE "id" = 'fee-a'`),
    ).rejects.toThrow();
    await expect(
      client.query(`UPDATE ${table('client_service_fee_lines')} SET "is_active" = FALSE, "deleted_at" = CURRENT_TIMESTAMP, "deleted_reason" = 'Archived by request' WHERE "id" = 'fee-a'`),
    ).resolves.toBeDefined();
  });

  it('enforces override equivalence and complete lifecycle metadata', async () => {
    await expect(insertOccurrence({ id: 'occ-date-drift', operative_expected_date: '2026-08-18' })).rejects.toThrow();
    await expect(insertOccurrence({ id: 'occ-amount-drift', operative_amount: '101.00' })).rejects.toThrow();
    await expect(insertOccurrence({ id: 'occ-currency-drift', operative_currency: 'USD' })).rejects.toThrow();
    await expect(insertOccurrence({ id: 'occ-open-billed-date', billed_date: '2026-08-17' })).rejects.toThrow();
    await expect(insertOccurrence({ id: 'occ-open-actor', marked_billed_by_id: 'user-a' })).rejects.toThrow();
    await expect(insertOccurrence({ id: 'occ-billed-no-actor', status: 'BILLED', marked_billed_at: '2026-08-17 00:00:00' })).rejects.toThrow();
    await expect(insertOccurrence({ id: 'occ-billed', status: 'BILLED', marked_billed_at: '2026-08-17 00:00:00', marked_billed_by_id: 'user-a' })).resolves.toBeUndefined();
    await expect(insertOccurrence({ id: 'occ-waived-no-actor', status: 'WAIVED', waived_at: '2026-08-17 00:00:00', waiver_reason: 'Client waived' })).rejects.toThrow();
    await expect(insertOccurrence({ id: 'occ-waived', status: 'WAIVED', waived_at: '2026-08-17 00:00:00', waived_by_id: 'user-a', waiver_reason: 'Client waived' })).resolves.toBeUndefined();
    await expect(insertOccurrence({ id: 'occ-cancelled-no-actor', status: 'CANCELLED', cancelled_at: '2026-08-17 00:00:00', cancellation_reason: 'Service ended' })).rejects.toThrow();
    await expect(insertOccurrence({ id: 'occ-cancelled', status: 'CANCELLED', cancelled_at: '2026-08-17 00:00:00', cancelled_by_id: 'user-a', cancellation_reason: 'Service ended' })).resolves.toBeUndefined();
    await expect(insertOccurrence({ id: 'occ-date-override', date_overridden: true, date_override_reason: 'Moved', date_overridden_at: '2026-08-17 00:00:00', date_overridden_by_id: 'user-a', operative_expected_date: '2026-08-18' })).resolves.toBeUndefined();
    await expect(insertOccurrence({ id: 'occ-value-override', value_overridden: true, value_override_reason: 'Adjusted', value_overridden_at: '2026-08-17 00:00:00', value_overridden_by_id: 'user-a', operative_amount: '101.00', operative_currency: 'USD' })).resolves.toBeUndefined();
    await expect(client.query(`DELETE FROM ${table('users')} WHERE "id" = 'user-a'`)).rejects.toThrow();
  });

  it('enforces partial open-issue uniqueness and restrictive source deletion', async () => {
    await insertCoverageIssue('duplicate-key');
    await expect(insertCoverageIssue('duplicate-key')).rejects.toThrow();
    await expect(insertCoverageIssue('duplicate-key', '2026-08-18')).resolves.toBeUndefined();
    await expect(insertCoverageIssue('nullable-fee-line', null, null)).resolves.toBeUndefined();
    await expect(client.query(`DELETE FROM ${table('companies')} WHERE "id" = 'company-a'`)).rejects.toThrow();
    await expect(client.query(`DELETE FROM ${table('client_services')} WHERE "id" = 'service-a'`)).rejects.toThrow();
    await expect(client.query(`DELETE FROM ${table('client_service_fee_lines')} WHERE "id" = 'fee-a'`)).rejects.toThrow();
  });
});
