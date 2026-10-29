import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runPerformanceAssertions = process.env.RUN_PERFORMANCE_TESTS === 'true';
const describePerformance = testDatabaseUrl && runPerformanceAssertions ? describe : describe.skip;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('billing performance PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

type PrismaClient = Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
const INSERT_BATCH_SIZE = 2_000;

describePerformance('billing representative PostgreSQL performance', () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let companyIds: string[] = [];
  let clientServiceIds: string[] = [];
  let feeLineIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import('@/lib/prisma')).getPrisma();
    const userId = randomUUID();
    const partialId = randomUUID();
    const familyId = randomUUID();
    const variantId = randomUUID();
    tenantId = randomUUID();
    const suffix = tenantId.replaceAll('-', '').slice(0, 12);

    await prisma.workspace.create({
      data: {
        id: tenantId,
        name: 'Billing performance workspace',
        slug: `billing-performance-${suffix}`,
        status: 'ACTIVE',
        settings: { servicesWorkspace: { enabled: true, deadlineWritesEnabled: true } },
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: `${suffix}@example.test`,
        passwordHash: 'integration-only',
        firstName: 'Billing',
        lastName: 'Performance',
      },
    });
    await prisma.templatePartial.create({
      data: {
        id: partialId,
        tenantId,
        name: `Billing performance partial ${suffix}`,
        content: '<p>Billing performance service</p>',
        createdById: userId,
      },
    });
    await prisma.serviceFamily.create({
      data: {
        id: familyId,
        tenantId,
        code: `BILLING_PERF_${suffix}`,
        name: 'Billing performance family',
        displayColor: '#2F6F5E',
      },
    });
    await prisma.serviceVariant.create({
      data: {
        id: variantId,
        tenantId,
        familyId,
        sowPartialId: partialId,
        code: `BILLING_PERF_SERVICE_${suffix}`,
        name: 'Billing performance service',
        serviceCadence: 'MONTHLY',
      },
    });

    companyIds = Array.from({ length: 1_000 }, () => randomUUID());
    await createManyInBatches(prisma.company, companyIds.map((id, index) => ({
      id,
      tenantId,
      uen: `P${suffix.toUpperCase()}${String(index).padStart(4, '0')}`,
      name: `Billing performance company ${String(index + 1).padStart(4, '0')}`,
      entityType: 'PRIVATE_LIMITED' as const,
      status: 'LIVE' as const,
    })));

    clientServiceIds = Array.from({ length: 10_000 }, () => randomUUID());
    await createManyInBatches(prisma.clientService, clientServiceIds.map((id, index) => ({
      id,
      tenantId,
      companyId: companyIds[Math.floor(index / 10)]!,
      source: 'MANUAL' as const,
      serviceVariantId: variantId,
      familyName: 'Billing performance family',
      serviceName: `Billing performance service ${String(index + 1).padStart(5, '0')}`,
      status: 'ACTIVE' as const,
      serviceCadence: 'MONTHLY' as const,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      billingDisposition: 'CONFIGURED' as const,
      fieldValues: {},
    })));

    feeLineIds = Array.from({ length: 10_000 }, () => randomUUID());
    await createManyInBatches(prisma.clientServiceFeeLine, feeLineIds.map((id, index) => ({
      id,
      tenantId,
      clientServiceId: clientServiceIds[index]!,
      description: `Representative fee ${String(index + 1).padStart(5, '0')}`,
      amount: '125.00',
      currency: 'SGD',
      billingFrequency: 'MONTHLY' as const,
      billingStartDate: new Date('2026-01-01T00:00:00.000Z'),
      scheduleConfig: {},
    })));

    const occurrenceRows = clientServiceIds.flatMap((clientServiceId, serviceIndex) => Array.from({ length: 10 }, (_, periodIndex) => {
      const month = periodIndex + 1;
      return {
        id: randomUUID(),
        tenantId,
        companyId: companyIds[Math.floor(serviceIndex / 10)]!,
        clientServiceId,
        feeLineId: feeLineIds[serviceIndex]!,
        billingPeriodKey: `2026-${String(month).padStart(2, '0')}`,
        scheduleEntryKey: 'default',
        generationKey: 'billing-performance-v1',
        calculatedExpectedDate: new Date(`2026-${String(month).padStart(2, '0')}-15T00:00:00.000Z`),
        operativeExpectedDate: new Date(`2026-${String(month).padStart(2, '0')}-15T00:00:00.000Z`),
        baseAmount: '125.00',
        baseCurrency: 'SGD',
        operativeAmount: '125.00',
        operativeCurrency: 'SGD',
        status: 'OPEN' as const,
      };
    }));
    await createManyInBatches(prisma.billingOccurrence, occurrenceRows);

    const issueRows = clientServiceIds.slice(0, 1_000).map((clientServiceId, index) => ({
      id: randomUUID(),
      tenantId,
      companyId: companyIds[Math.floor(index / 10)]!,
      clientServiceId,
      feeLineId: null,
      type: 'MISSING_SCHEDULE_PARAMETER' as const,
      severity: 'ERROR' as const,
      issueKey: `${String(index).padStart(63, '0')}1`,
      details: { scheduleKey: 'representative' },
    }));
    await createManyInBatches(prisma.billingCoverageIssue, issueRows);

    // Bulk fixtures bypass the normal write path; refresh planner statistics
    // before measuring the representative read workload.
    await prisma.$executeRawUnsafe('ANALYZE companies, client_services, client_service_fee_lines, billing_occurrences, billing_coverage_issues');
  }, 180_000);

  afterAll(async () => {
    if (!prisma || !tenantId) return;
    const failures: unknown[] = [];
    const attempt = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };
    await attempt(() => prisma.auditLog.deleteMany({ where: { tenantId } }));
    await attempt(() => prisma.billingCoverageIssue.deleteMany({ where: { tenantId } }));
    await attempt(() => prisma.billingOccurrence.deleteMany({ where: { tenantId } }));
    await attempt(() => prisma.clientServiceFeeLine.deleteMany({ where: { tenantId } }));
    await attempt(() => prisma.clientService.deleteMany({ where: { tenantId } }));
    await attempt(() => prisma.serviceVariant.deleteMany({ where: { tenantId } }));
    await attempt(() => prisma.serviceFamily.deleteMany({ where: { tenantId } }));
    await attempt(() => prisma.templatePartial.deleteMany({ where: { tenantId } }));
    await attempt(() => prisma.user.deleteMany({ where: { tenantId } }));
    await attempt(() => prisma.company.deleteMany({ where: { tenantId } }));
    await attempt(() => prisma.workspace.deleteMany({ where: { id: tenantId } }));
    await prisma.$disconnect();
    if (failures.length > 0) throw new Error(`Billing performance cleanup failed in ${failures.length} step(s)`);
  }, 120_000);

  it('uses production billing indexes for selective representative queries', async () => {
    expect(await prisma.company.count({ where: { tenantId } })).toBe(1_000);
    expect(await prisma.clientService.count({ where: { tenantId } })).toBe(10_000);
    expect(await prisma.billingOccurrence.count({ where: { tenantId } })).toBe(100_000);
    expect(await prisma.billingCoverageIssue.count({ where: { tenantId, resolvedAt: null } })).toBe(1_000);

    const { listBillingOccurrences, listBillingCoverage } = await import('@/services/billing');
    const selectiveCompanyIds = companyIds.slice(0, 1);
    const occurrencePlan = await captureProductionQueryPlan(prisma, 'billing_occurrences', () => listBillingOccurrences({
      from: '2026-08-01',
      to: '2026-09-30',
      statuses: ['OPEN'],
      companyIds: selectiveCompanyIds,
      page: 1,
      limit: 100,
      sortBy: 'expectedDate',
      sortOrder: 'asc',
    }, { tenantId, companyIds: selectiveCompanyIds }, prisma, { today: '2026-08-18' }));

    const coverageCompanyIds = companyIds.slice(0, 1);
    const coveragePlan = await captureProductionQueryPlan(prisma, 'billing_coverage_issues', () => listBillingCoverage({
      tenantId,
      companyIds: coverageCompanyIds,
    }, prisma));

    const occurrenceNodes = flattenExplainNodes(occurrencePlan);
    const coverageNodes = flattenExplainNodes(coveragePlan);
    const occurrenceIndex = occurrenceNodes.find((node) => {
      const name = node['Index Name'] ?? '';
      return name.startsWith('billing_occurrences_tenant_id_') && name.includes('_operative_');
    });
    const coverageIndex = coverageNodes.find((node) => node['Index Name']?.startsWith('billing_coverage_issues_tenant_id_company_id_severity_resolved'));
    expect(occurrenceIndex).toBeDefined();
    expect(`${occurrenceIndex?.['Index Cond'] ?? ''} ${occurrenceIndex?.Filter ?? ''}`).toContain('tenant_id');
    expect(`${occurrenceIndex?.['Index Cond'] ?? ''} ${occurrenceIndex?.Filter ?? ''}`).toContain('operative_expected_date');
    expect(`${occurrenceIndex?.['Index Cond'] ?? ''} ${occurrenceIndex?.Filter ?? ''}`).toContain('status');
    expect(coverageIndex).toBeDefined();
    expect(`${coverageIndex?.['Index Cond'] ?? ''} ${coverageIndex?.Filter ?? ''}`).toContain('tenant_id');
    expect(`${coverageIndex?.['Index Cond'] ?? ''} ${coverageIndex?.Filter ?? ''}`).toContain('company_id');
    expect(`${coverageIndex?.['Index Cond'] ?? ''} ${coverageIndex?.Filter ?? ''}`).toContain('resolved_at');
  }, 60_000);

  it('keeps paginated billing and coverage summaries bounded under the acceptance target', async () => {
    const { listBillingOccurrences, listBillingCoverage } = await import('@/services/billing');
    const search = {
      from: '2026-01-01' as const,
      to: '2026-12-31' as const,
      statuses: ['OPEN'] as const,
      page: 1,
      limit: 100,
      sortBy: 'expectedDate' as const,
      sortOrder: 'asc' as const,
    };
    const listStartedAt = performance.now();
    const occurrenceResult = await listBillingOccurrences(search, { tenantId }, prisma, { today: '2026-08-18' });
    const listDurationMs = performance.now() - listStartedAt;

    const coverageStartedAt = performance.now();
    const coverageResult = await listBillingCoverage({ tenantId }, prisma);
    const coverageDurationMs = performance.now() - coverageStartedAt;

    expect(occurrenceResult.total).toBe(100_000);
    expect(occurrenceResult.items).toHaveLength(100);
    expect(coverageResult.openIssueCount).toBe(1_000);
    expect(coverageResult.affectedServiceCount).toBe(1_000);
    expect(coverageResult.healthyActiveServiceCount).toBe(9_000);
    expect(listDurationMs).toBeLessThanOrEqual(1_500);
    expect(coverageDurationMs).toBeLessThanOrEqual(1_500);
  }, 60_000);
});

async function createManyInBatches<Row>(
  model: { createMany: (args: { data: Row[] }) => Promise<unknown> },
  rows: Row[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    await model.createMany({ data: rows.slice(offset, offset + INSERT_BATCH_SIZE) });
  }
}

type QueryEvent = { query: string; params: string };

async function captureProductionQueryPlan(
  client: PrismaClient,
  relation: 'billing_occurrences' | 'billing_coverage_issues',
  operation: () => Promise<unknown>,
): Promise<unknown> {
  const events: QueryEvent[] = [];
  let capturing = true;
  const queryEventsClient = client as unknown as {
    $on: (event: 'query', listener: (event: QueryEvent) => void) => void;
  };
  queryEventsClient.$on('query', (event: QueryEvent) => {
    if (capturing) events.push(event);
  });
  await operation();
  capturing = false;
  const event = events.find((candidate) => candidate.query.includes(`FROM "public"."${relation}"`));
  if (!event) throw new Error(`Production ${relation} query was not captured`);
  const sql = interpolateQueryParameters(event.query, JSON.parse(event.params) as unknown[]);
  const rows = await client.$queryRawUnsafe<Array<{ 'QUERY PLAN': unknown }>>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
  );
  return rows[0]?.['QUERY PLAN'] ?? rows;
}

function interpolateQueryParameters(query: string, parameters: unknown[]): string {
  return query.replace(/\$(\d+)/g, (_placeholder, index: string) => sqlLiteral(parameters[Number(index) - 1]));
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}

type ExplainNode = {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  Plans?: ExplainNode[];
};

function flattenExplainNodes(value: unknown): ExplainNode[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) return parsed.flatMap((entry) => flattenExplainNodes(entry));
  if (!parsed || typeof parsed !== 'object') return [];
  const record = parsed as { Plan?: ExplainNode } & ExplainNode;
  const node = record.Plan ?? record;
  return [node, ...(node.Plans ?? []).flatMap((child) => flattenExplainNodes(child))];
}
