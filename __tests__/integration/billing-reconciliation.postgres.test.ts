import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@/generated/prisma';
import { Pool, type PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { reconcileClientServiceBilling } from '@/services/billing';
import { reconcileClientServiceThroughWorkerTransaction } from '@/services/schedule-reconciliation/worker';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const migrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');
const billingProvenanceMigration = '20260824100000_billing_reconciliation_provenance';
const describePostgres = testDatabaseUrl ? describe : describe.skip;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('billing reconciliation PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

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

async function applyAllMigrations(client: PoolClient, schemaName: string): Promise<void> {
  const directories = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!directories.includes(billingProvenanceMigration)) throw new Error(`Missing migration ${billingProvenanceMigration}`);
  for (const directory of directories) {
    await applyMigration(client, schemaName, directory);
  }
}

describePostgres('billing reconciliation PostgreSQL integration', () => {
  let setupPool: Pool | undefined;
  let setupClient: PoolClient | undefined;
  let prismaPool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  let schemaName: string | undefined;

  afterAll(async () => {
    await prisma?.$disconnect();
    await prismaPool?.end();
    if (setupClient && schemaName) await setupClient.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    setupClient?.release();
    await setupPool?.end();
  });

  it('creates one row per billing identity under concurrent retries in an isolated schema', async () => {
    setupPool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
    setupClient = await setupPool.connect();
    schemaName = `billing_reconcile_${randomUUID().replaceAll('-', '')}`;
    const schema = quoteIdentifier(schemaName);
    const table = (name: string) => `${schema}."${name}"`;

    try {
      await setupClient.query(`CREATE SCHEMA ${schema}`);
      // The current Prisma client reads every column, so the isolated schema needs every migration.
      await applyAllMigrations(setupClient, schemaName);
      await setupClient.query(`
        INSERT INTO ${table('tenants')} ("id", "name", "slug", "status", "updatedAt")
        VALUES ('tenant-reconcile', 'Reconcile Tenant', 'billing-reconcile-${schemaName}', 'ACTIVE', TIMESTAMP '2026-08-18 00:00:00');
        INSERT INTO ${table('users')}
          ("id", "email", "passwordHash", "firstName", "lastName", "updatedAt", "tenantId")
        VALUES ('user-reconcile', 'billing-reconcile-${schemaName}@example.test', 'hash', 'Billing', 'Worker', TIMESTAMP '2026-08-18 00:00:00', 'tenant-reconcile');
        INSERT INTO ${table('template_partials')}
          ("id", "tenant_id", "name", "content", "created_by_id", "updated_at")
        VALUES ('partial-reconcile', 'tenant-reconcile', 'Billing partial', '<p>billing</p>', 'user-reconcile', TIMESTAMP '2026-08-18 00:00:00');
        INSERT INTO ${table('service_families')}
          ("id", "tenant_id", "code", "name", "description", "display_order", "updated_at")
        VALUES ('family-reconcile', 'tenant-reconcile', 'BILLING', 'Billing', 'Billing services', 0, TIMESTAMP '2026-08-18 00:00:00');
        INSERT INTO ${table('service_variants')}
          ("id", "tenant_id", "family_id", "sow_partial_id", "code", "name", "service_cadence", "updated_at")
        VALUES ('variant-reconcile', 'tenant-reconcile', 'family-reconcile', 'partial-reconcile', 'BILLING_MONTHLY', 'Billing monthly', 'MONTHLY', TIMESTAMP '2026-08-18 00:00:00');
        INSERT INTO ${table('companies')}
          ("id", "tenantId", "uen", "name", "updatedAt")
        VALUES ('company-reconcile', 'tenant-reconcile', 'UEN-RECONCILE', 'Reconcile Company', TIMESTAMP '2026-08-18 00:00:00');
        INSERT INTO ${table('client_services')}
          ("id", "tenant_id", "company_id", "source", "service_variant_id", "family_name", "service_name",
           "status", "service_cadence", "start_date", "billing_disposition", "updated_at")
        VALUES ('service-reconcile', 'tenant-reconcile', 'company-reconcile', 'MANUAL', 'variant-reconcile', 'Billing', 'Billing monthly',
                'ACTIVE', 'MONTHLY', DATE '2026-01-01', 'CONFIGURED', TIMESTAMP '2026-08-18 00:00:00');
        INSERT INTO ${table('client_service_fee_lines')}
          ("id", "tenant_id", "client_service_id", "description", "amount", "currency", "billing_frequency", "billing_start_date", "schedule_config", "updated_at")
        VALUES ('fee-reconcile', 'tenant-reconcile', 'service-reconcile', 'Monthly fee', 125.00, 'SGD', 'MONTHLY', DATE '2026-08-01',
          '{"schemaVersion":1,"cadence":"MONTHLY","startDate":"2026-08-01","customInterval":{"unit":"MONTH","count":1},"scheduleEntries":[{"key":"default","label":"Billing date","expression":{"kind":"DAY_OF_MONTH","day":1},"businessDayAdjustment":"NONE"}]}'::jsonb,
          TIMESTAMP '2026-08-18 00:00:00');
        INSERT INTO ${table('service_schedule_reconciliation_requests')}
          ("id", "tenant_id", "scope_type", "scope_id", "trigger_type", "correlation_id", "dedupe_key", "status", "next_attempt_at", "summary", "requested_by_id", "updated_at")
        VALUES ('request-reconcile', 'tenant-reconcile', 'CLIENT_SERVICE', 'service-reconcile', 'TASK3_TEST', 'corr-reconcile', 'dedupe-reconcile-${schemaName}', 'PENDING', TIMESTAMP '2026-08-18 00:00:00', '{}'::jsonb, NULL, TIMESTAMP '2026-08-18 00:00:00');
      `);

      // PrismaPg's schema option qualifies generated SQL; the pool search_path
      // keeps raw setup/diagnostic statements isolated from public data too.
      prismaPool = new Pool({
        connectionString: testDatabaseUrl,
        max: 4,
        options: `-c search_path=${schemaName},public`,
      });
      prisma = new PrismaClient({ adapter: new PrismaPg(prismaPool, { schema: schemaName }) });

      const input = {
        tenantId: 'tenant-reconcile',
        clientServiceId: 'service-reconcile',
        today: '2026-08-18' as const,
        horizonEnd: '2027-08-18' as const,
        writeMode: 'APPLY' as const,
        reconciliationRequestId: 'request-reconcile',
        cancellationActorId: 'user-reconcile',
      };
      const results = await Promise.all([
        reconcileClientServiceBilling(input, prisma),
        reconcileClientServiceBilling(input, prisma),
      ]);

      const occurrences = await prisma.billingOccurrence.findMany({
        where: { tenantId: input.tenantId, clientServiceId: input.clientServiceId },
        select: { billingPeriodKey: true, scheduleEntryKey: true, generationKey: true },
      });
      expect(occurrences).toHaveLength(12);
      expect(results.reduce((total, result) => total + result.created, 0)).toBe(12);

      const duplicateIdentities = await setupClient.query(`
        SELECT "billing_period_key", "schedule_entry_key", "generation_key", count(*)::int AS count
        FROM ${table('billing_occurrences')}
        WHERE "tenant_id" = 'tenant-reconcile' AND "client_service_id" = 'service-reconcile'
        GROUP BY "billing_period_key", "schedule_entry_key", "generation_key"
        HAVING count(*) > 1
      `);
      expect(duplicateIdentities.rows).toEqual([]);

      const rows = await prisma.billingOccurrence.findMany({
        where: { tenantId: input.tenantId, clientServiceId: input.clientServiceId },
        orderBy: { billingPeriodKey: 'asc' },
        select: { id: true, billingPeriodKey: true },
      });
      expect(rows).toHaveLength(12);
      const db = prisma;
      if (!db) throw new Error('Prisma test client was not initialized');

      let workerLeaseCalls = 0;
      const workerSummary = await reconcileClientServiceThroughWorkerTransaction(db, {
        tenantId: input.tenantId,
        clientServiceId: input.clientServiceId,
        operation: 'PUBLISH',
        today: input.today,
        horizonEnd: input.horizonEnd,
        writeMode: input.writeMode,
        reconciliationRequestId: input.reconciliationRequestId,
        cancellationActorId: null,
        assertLease: async () => { workerLeaseCalls += 1; },
      });
      expect(workerLeaseCalls).toBeGreaterThan(0);
      expect(workerSummary.billing).toEqual(expect.objectContaining({ clientServiceId: input.clientServiceId }));

      const reconcileWithConcurrentWrite = async (
        occurrenceId: string,
        concurrentWrite: () => Promise<void>,
      ) => {
        let leaseCalls = 0;
        let reachedRead: () => void = () => undefined;
        let release: () => void = () => undefined;
        const readReached = new Promise<void>((resolveRead) => { reachedRead = resolveRead; });
        const releaseRead = new Promise<void>((resolveRelease) => { release = resolveRelease; });
        const reconciliation = reconcileClientServiceBilling({
          ...input,
          cancellationActorId: null,
          assertLease: async () => {
            leaseCalls += 1;
            if (leaseCalls === 2) {
              reachedRead();
              await releaseRead;
            }
          },
        }, prisma);
        await readReached;
        await concurrentWrite();
        release();
        return reconciliation;
      };

      const billedId = rows[0]!.id;
      await db.clientServiceFeeLine.update({ where: { id: 'fee-reconcile' }, data: { amount: new Prisma.Decimal('130.00') } });
      const billedResult = await reconcileWithConcurrentWrite(billedId, async () => {
        await db.billingOccurrence.update({
          where: { id: billedId },
          data: { status: 'BILLED', markedBilledAt: new Date(), markedBilledById: 'user-reconcile' },
        });
      });
      expect(billedResult.preservedByReason.BILLED).toBe(1);
      const billedOccurrence = await db.billingOccurrence.findUnique({ where: { id: billedId }, select: { status: true, operativeAmount: true } });
      expect(billedOccurrence?.status).toBe('BILLED');
      expect(billedOccurrence?.operativeAmount.toFixed(2)).toBe('125.00');

      const waivedId = rows[1]!.id;
      await db.clientServiceFeeLine.update({ where: { id: 'fee-reconcile' }, data: { amount: new Prisma.Decimal('140.00') } });
      const waivedResult = await reconcileWithConcurrentWrite(waivedId, async () => {
        await db.billingOccurrence.update({
          where: { id: waivedId },
          data: { status: 'WAIVED', waivedAt: new Date(), waivedById: 'user-reconcile', waiverReason: 'Customer waiver' },
        });
      });
      expect(waivedResult.preservedByReason.WAIVED).toBe(1);
      const waivedOccurrence = await db.billingOccurrence.findUnique({ where: { id: waivedId }, select: { status: true, operativeAmount: true } });
      expect(waivedOccurrence?.status).toBe('WAIVED');
      expect(waivedOccurrence?.operativeAmount.toFixed(2)).toBe('130.00');

      const dateOverrideId = rows[2]!.id;
      await db.clientServiceFeeLine.update({ where: { id: 'fee-reconcile' }, data: { amount: new Prisma.Decimal('150.00') } });
      const dateOverrideResult = await reconcileWithConcurrentWrite(dateOverrideId, async () => {
        await db.billingOccurrence.update({
          where: { id: dateOverrideId },
          data: { dateOverridden: true, operativeExpectedDate: new Date('2026-09-15'), dateOverrideReason: 'Client requested date', dateOverriddenAt: new Date(), dateOverriddenById: 'user-reconcile' },
        });
      });
      expect(dateOverrideResult.preservedByReason.OVERRIDDEN).toBeGreaterThanOrEqual(1);
      expect(await db.billingOccurrence.findUnique({ where: { id: dateOverrideId }, select: { dateOverridden: true, operativeExpectedDate: true } })).toMatchObject({ dateOverridden: true, operativeExpectedDate: new Date('2026-09-15') });

      const valueOverrideId = rows[3]!.id;
      await db.clientServiceFeeLine.update({ where: { id: 'fee-reconcile' }, data: { amount: new Prisma.Decimal('160.00') } });
      const valueOverrideResult = await reconcileWithConcurrentWrite(valueOverrideId, async () => {
        await db.billingOccurrence.update({
          where: { id: valueOverrideId },
          data: { valueOverridden: true, operativeAmount: new Prisma.Decimal('999.00'), valueOverrideReason: 'Client-specific amount', valueOverriddenAt: new Date(), valueOverriddenById: 'user-reconcile' },
        });
      });
      expect(valueOverrideResult.preservedByReason.OVERRIDDEN).toBeGreaterThanOrEqual(1);
      const valueOverrideOccurrence = await db.billingOccurrence.findUnique({ where: { id: valueOverrideId }, select: { valueOverridden: true, operativeAmount: true } });
      expect(valueOverrideOccurrence?.valueOverridden).toBe(true);
      expect(valueOverrideOccurrence?.operativeAmount.toFixed(2)).toBe('999.00');

      await db.clientServiceFeeLine.update({
        where: { id: 'fee-reconcile' },
        data: { isActive: false, deletedAt: new Date(), deletedReason: 'Removed from client service configuration' },
      });
      const cancellationRaceId = rows[4]!.id;
      const cancellationRaceResult = await reconcileWithConcurrentWrite(cancellationRaceId, async () => {
        await db.billingOccurrence.update({ where: { id: cancellationRaceId }, data: { notes: 'Concurrent lifecycle edit' } });
      });
      expect(cancellationRaceResult.cancelled).toBe(8);
      const cancelled = await db.billingOccurrence.findUnique({ where: { id: cancellationRaceId }, select: { status: true, notes: true, cancelledById: true, cancellationReconciliationRequestId: true } });
      expect(cancelled).toEqual({ status: 'CANCELLED', notes: 'Concurrent lifecycle edit', cancelledById: null, cancellationReconciliationRequestId: 'request-reconcile' });

      await expect(setupClient.query(`
        INSERT INTO ${table('billing_occurrences')}
          ("id", "tenant_id", "company_id", "client_service_id", "fee_line_id", "billing_period_key", "schedule_entry_key", "generation_key",
           "calculated_expected_date", "operative_expected_date", "base_amount", "base_currency", "operative_amount", "operative_currency", "status")
        VALUES ('invalid-cancelled', 'tenant-reconcile', 'company-reconcile', 'service-reconcile', 'fee-reconcile', 'invalid', 'default', 'invalid-generation',
                DATE '2026-09-01', DATE '2026-09-01', 1.00, 'SGD', 1.00, 'SGD', 'CANCELLED')
      `)).rejects.toThrow();
      await expect(setupClient.query(`
        INSERT INTO ${table('billing_occurrences')}
          ("id", "tenant_id", "company_id", "client_service_id", "fee_line_id", "billing_period_key", "schedule_entry_key", "generation_key",
           "calculated_expected_date", "operative_expected_date", "base_amount", "base_currency", "operative_amount", "operative_currency", "status", "cancellation_reconciliation_request_id")
        VALUES ('invalid-open-provenance', 'tenant-reconcile', 'company-reconcile', 'service-reconcile', 'fee-reconcile', 'invalid-open', 'default', 'invalid-open-generation',
                DATE '2026-09-01', DATE '2026-09-01', 1.00, 'SGD', 1.00, 'SGD', 'OPEN', 'request-reconcile')
      `)).rejects.toThrow();
    } finally {
      await prisma?.$disconnect();
      prisma = undefined;
      await prismaPool?.end();
      prismaPool = undefined;
      await setupClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      schemaName = undefined;
    }
  });
});
