import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('services administration migration PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const describePostgres = testDatabaseUrl ? describe : describe.skip;
const migrationSql = readFileSync(
  resolve(process.cwd(), 'prisma/migrations/20260817090000_services_admin_foundation/migration.sql'),
  'utf8',
);
const palette = [
  '#2F6F5E',
  '#3F6DA8',
  '#8A5AA5',
  '#B0653C',
  '#467A43',
  '#9A6A18',
  '#9B4D67',
  '#4E7180',
] as const;

describePostgres('services administration foundation migration PostgreSQL integration', () => {
  let pool: Pool;
  let client: PoolClient;
  let schemaName: string | undefined;

  afterAll(async () => {
    if (client) {
      if (schemaName) {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
      client.release();
    }
    await pool?.end();
  });

  it('migrates populated pre-change tables without losing data or weakening the color contract', async () => {
    pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
    client = await pool.connect();
    schemaName = `services_admin_${randomUUID().replaceAll('-', '')}`;
    const schema = `"${schemaName}"`;
    const table = (name: string) => `${schema}."${name}"`;

    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`
        CREATE TABLE ${table('companies')} (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          uen TEXT NOT NULL,
          name TEXT NOT NULL,
          source_marker TEXT NOT NULL
        );
        CREATE TABLE ${table('service_families')} (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          code VARCHAR(100) NOT NULL,
          name VARCHAR(200) NOT NULL,
          description TEXT,
          display_order INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL,
          deleted_at TIMESTAMP(3)
        );
        CREATE TABLE ${table('service_variants')} (
          id TEXT PRIMARY KEY,
          marker TEXT NOT NULL
        );
        CREATE TABLE ${table('client_services')} (
          id TEXT PRIMARY KEY,
          marker TEXT NOT NULL
        );
        CREATE TABLE ${table('service_agreements')} (
          id TEXT PRIMARY KEY,
          marker TEXT NOT NULL
        );
        CREATE TABLE ${table('document_templates')} (
          id TEXT PRIMARY KEY,
          marker TEXT NOT NULL
        );
      `);

      await client.query(
        `INSERT INTO ${table('companies')} (id, tenant_id, uen, name, source_marker)
         VALUES ('company-a', 'tenant-a', 'UEN-A', 'Tenant A Company', 'company-preserved'),
                ('company-b', 'tenant-b', 'UEN-B', 'Tenant B Company', 'company-preserved')`,
      );

      const families = [
        ['a-03', 'tenant-a', 'A03', 'Accounting', 0],
        ['a-01', 'tenant-a', 'A01', 'Accounting', 0],
        ['a-02', 'tenant-a', 'A02', 'Bookkeeping', 0],
        ['a-04', 'tenant-a', 'A04', 'Corporate', 0],
        ['a-05', 'tenant-a', 'A05', 'Payroll', 1],
        ['a-06', 'tenant-a', 'A06', 'Tax', 1],
        ['a-07', 'tenant-a', 'A07', 'Audit', 2],
        ['a-08', 'tenant-a', 'A08', 'Advisory', 2],
        ['a-09', 'tenant-a', 'A09', 'Legal', 2],
        ['b-02', 'tenant-b', 'B02', 'Zulu', 0],
        ['b-01', 'tenant-b', 'B01', 'Alpha', 0],
        ['b-03', 'tenant-b', 'B03', 'Echo', 0],
      ] as const;
      for (const [id, tenantId, code, name, displayOrder] of families) {
        await client.query(
          `INSERT INTO ${table('service_families')}
             (id, tenant_id, code, name, description, display_order, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, TIMESTAMP '2026-08-17 00:00:00')`,
          [id, tenantId, code, name, `description-${id}`, displayOrder],
        );
      }

      for (const [tableName, marker] of [
        ['service_variants', 'catalog-preserved'],
        ['client_services', 'client-service-preserved'],
        ['service_agreements', 'sow-preserved'],
        ['document_templates', 'document-template-preserved'],
      ] as const) {
        await client.query(
          `INSERT INTO ${table(tableName)} (id, marker) VALUES ($1, $2)`,
          [`${tableName}-1`, marker],
        );
      }

      const beforeCompanies = await client.query(
        `SELECT id, tenant_id, uen, name, source_marker FROM ${table('companies')} ORDER BY id`,
      );
      const beforeFamilies = await client.query(
        `SELECT id, tenant_id, code, name, description, display_order, is_active, deleted_at
         FROM ${table('service_families')} ORDER BY id`,
      );

      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL search_path TO ${schema}, public`);
        await client.query(migrationSql);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      await client.query(`SET search_path TO ${schema}, public`);

      expect(
        (await client.query(
          `SELECT id, tenant_id, uen, name, source_marker FROM ${table('companies')} ORDER BY id`,
        )).rows,
      ).toEqual(beforeCompanies.rows);
      expect(
        (await client.query(
          `SELECT id, tenant_id, code, name, description, display_order, is_active, deleted_at
           FROM ${table('service_families')} ORDER BY id`,
        )).rows,
      ).toEqual(beforeFamilies.rows);

      for (const [tableName, marker] of [
        ['service_variants', 'catalog-preserved'],
        ['client_services', 'client-service-preserved'],
        ['service_agreements', 'sow-preserved'],
        ['document_templates', 'document-template-preserved'],
      ] as const) {
        await expect(
          client.query(`SELECT marker FROM ${table(tableName)} WHERE id = $1`, [`${tableName}-1`]),
        ).resolves.toMatchObject({ rows: [{ marker }] });
      }

      const companyColumns = await client.query(
        `SELECT is_nullable, character_maximum_length
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'companies' AND column_name = 'display_alias'`,
        [schemaName],
      );
      expect(companyColumns.rows).toEqual([{ is_nullable: 'YES', character_maximum_length: 40 }]);
      expect(
        (await client.query(`SELECT display_alias FROM ${table('companies')} WHERE id = 'company-a'`)).rows,
      ).toEqual([{ display_alias: null }]);

      const colorColumns = await client.query(
        `SELECT is_nullable, character_maximum_length, column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'service_families' AND column_name = 'display_color'`,
        [schemaName],
      );
      expect(colorColumns.rows).toHaveLength(1);
      expect(colorColumns.rows[0]).toMatchObject({
        is_nullable: 'NO',
        character_maximum_length: 7,
      });
      expect(colorColumns.rows[0].column_default).toContain('#2F6F5E');

      const expectedColors = new Map<string, string>([
        ['a-01', palette[0]],
        ['a-03', palette[1]],
        ['a-02', palette[2]],
        ['a-04', palette[3]],
        ['a-05', palette[4]],
        ['a-06', palette[5]],
        ['a-08', palette[6]],
        ['a-07', palette[7]],
        ['a-09', palette[0]],
        ['b-01', palette[0]],
        ['b-03', palette[1]],
        ['b-02', palette[2]],
      ]);
      const colors = await client.query(`SELECT id, display_color FROM ${table('service_families')}`);
      expect(new Map(colors.rows.map((row) => [row.id, row.display_color]))).toEqual(expectedColors);

      await client.query(
        `INSERT INTO ${table('service_families')}
           (id, tenant_id, code, name, display_order, updated_at)
         VALUES ('a-new', 'tenant-a', 'A_NEW', 'New family', 99, TIMESTAMP '2026-08-17 00:00:00')`,
      );
      expect(
        (await client.query(`SELECT display_color FROM ${table('service_families')} WHERE id = 'a-new'`)).rows,
      ).toEqual([{ display_color: palette[0] }]);
      expect(
        (await client.query(`SELECT count(*)::int AS count FROM ${table('service_families')} WHERE display_color IS NULL`)).rows[0].count,
      ).toBe(0);

      await client.query(`UPDATE ${table('service_families')} SET display_color = '#ABCDEF' WHERE id = 'a-01'`);
      await expect(
        client.query(`SELECT display_color FROM ${table('service_families')} WHERE id = 'a-01'`),
      ).resolves.toMatchObject({ rows: [{ display_color: '#ABCDEF' }] });

      for (const invalidColor of ['#abcdef', '#ABCDE', '123456', 'red']) {
        await expect(
          client.query(
            `UPDATE ${table('service_families')} SET display_color = $1 WHERE id = 'a-01'`,
            [invalidColor],
          ),
        ).rejects.toThrow();
      }
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      schemaName = undefined;
    }
  });
});
