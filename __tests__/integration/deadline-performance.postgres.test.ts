// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deadlineSearchSchema } from '@/lib/validations/deadline';
import { serviceRosterSearchSchema } from '@/lib/validations/service-roster';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('deadline performance PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const describePostgres = testDatabaseUrl ? describe : describe.skip;
const runPerformanceAssertions = process.env.RUN_PERFORMANCE_TESTS === 'true';
const INSERT_BATCH_SIZE = 2_000;

type PrismaClient = Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;

describePostgres('deadline workspace representative PostgreSQL performance', () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let companyIds: string[];
  let clientServiceCount = 0;
  let occurrenceCount = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import('@/lib/prisma')).getPrisma();
    tenantId = randomUUID();
    const userId = randomUUID();
    const partialId = randomUUID();
    const familyId = randomUUID();
    const variantId = randomUUID();
    const ruleId = randomUUID();
    const versionId = randomUUID();

    await prisma.workspace.create({
      data: {
        id: tenantId,
        name: `Deadline performance ${tenantId}`,
        slug: `deadline-performance-${tenantId}`,
        settings: { servicesWorkspace: { enabled: true, deadlineWritesEnabled: true } },
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: `${userId}@example.test`,
        passwordHash: 'integration-only',
        firstName: 'Performance',
        lastName: 'Fixture',
      },
    });
    await prisma.templatePartial.create({
      data: {
        id: partialId,
        tenantId,
        name: `deadline-performance-partial-${tenantId}`,
        content: '<p>Performance service</p>',
        createdById: userId,
      },
    });
    await prisma.serviceFamily.create({
      data: {
        id: familyId,
        tenantId,
        code: `PERF_${tenantId.slice(0, 8)}`,
        name: 'Performance family',
        displayColor: '#2F6F5E',
      },
    });
    await prisma.serviceVariant.create({
      data: {
        id: variantId,
        tenantId,
        familyId,
        sowPartialId: partialId,
        code: `PERF_SERVICE_${tenantId.slice(0, 8)}`,
        name: 'Performance service',
        serviceCadence: 'ANNUALLY',
      },
    });
    await prisma.deadlineRule.create({
      data: {
        id: ruleId,
        tenantId,
        code: `PERF_RULE_${tenantId.slice(0, 8)}`,
        name: 'Performance deadline rule',
      },
    });
    await prisma.deadlineRuleVersion.create({
      data: {
        id: versionId,
        tenantId,
        ruleId,
        version: 1,
        state: 'PUBLISHED',
        schemaVersion: 1,
        configHash: 'a'.repeat(64),
        recurrence: { schemaVersion: 1, kind: 'ANNUALLY', interval: 1 },
        applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
      },
    });
    await prisma.deadlineRule.update({ where: { id: ruleId }, data: { currentVersionId: versionId } });

    const companies = Array.from({ length: 1_000 }, (_, index) => ({
      id: randomUUID(),
      tenantId,
      uen: `P${tenantId.replaceAll('-', '').slice(0, 7)}${String(index).padStart(4, '0')}`,
      name: `Performance Company ${String(index + 1).padStart(4, '0')}`,
      entityType: 'PRIVATE_LIMITED' as const,
      status: 'LIVE' as const,
      financialYearEndDay: 31,
      financialYearEndMonth: 12,
    }));
    companyIds = companies.map((company) => company.id);
    await createManyInBatches(prisma.company, companies);

    const clientServices = Array.from({ length: 10_000 }, (_, index) => {
      const companyId = companyIds[Math.floor(index / 10)]!;
      return {
        id: randomUUID(),
        tenantId,
        companyId,
        source: 'MANUAL' as const,
        serviceVariantId: variantId,
        familyName: 'Performance family',
        serviceName: `Performance service ${index + 1}`,
        status: 'ACTIVE' as const,
        serviceCadence: 'ANNUALLY' as const,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        fieldValues: {},
      };
    });
    clientServiceCount = clientServices.length;
    await createManyInBatches(prisma.clientService, clientServices);

    const cycles = clientServices.map((clientService) => ({
      id: randomUUID(),
      tenantId,
      companyId: clientService.companyId,
      clientServiceId: clientService.id,
      ruleId,
      ruleVersionId: versionId,
      periodKey: '2026',
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-12-31T00:00:00.000Z'),
      generationKey: 'rolling-v1',
      origin: 'RULE' as const,
      recurrenceAnchor: {},
      sourceSnapshot: {},
      evaluationHash: 'b'.repeat(64),
    }));
    await createManyInBatches(prisma.serviceCycle, cycles);

    const occurrences = cycles.flatMap((cycle, cycleIndex) => Array.from({ length: 10 }, (_, offset) => ({
      id: randomUUID(),
      tenantId,
      companyId: cycle.companyId,
      clientServiceId: cycle.clientServiceId,
      cycleId: cycle.id,
      ruleVersionId: versionId,
      milestoneKey: `milestone-${offset}`,
      scheduleEntryKey: `entry-${offset}`,
      deadlineType: (offset % 3 === 0 ? 'STATUTORY' : offset % 3 === 1 ? 'CLIENT' : 'INTERNAL') as 'STATUTORY' | 'CLIENT' | 'INTERNAL',
      calculatedDueDate: new Date(`2026-${String((cycleIndex % 12) + 1).padStart(2, '0')}-15T00:00:00.000Z`),
      operativeDueDate: new Date(`2026-${String((cycleIndex % 12) + 1).padStart(2, '0')}-15T00:00:00.000Z`),
      status: 'OPEN' as const,
      origin: 'RULE' as const,
    })));
    occurrenceCount = occurrences.length;
    await createManyInBatches(prisma.deadlineOccurrence, occurrences);
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    const failures: unknown[] = [];
    const attempt = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };
    try {
      const where = { tenantId };
      await attempt(() => prisma.auditLog.deleteMany({ where }));
      await attempt(() => prisma.deadlineOccurrence.deleteMany({ where }));
      await attempt(() => prisma.serviceCycle.deleteMany({ where }));
      await attempt(() => prisma.clientService.deleteMany({ where }));
      await attempt(() => prisma.deadlineRule.updateMany({ where, data: { currentVersionId: null } }));
      await attempt(() => prisma.deadlineRuleVersion.deleteMany({ where }));
      await attempt(() => prisma.deadlineRule.deleteMany({ where }));
      await attempt(() => prisma.serviceVariant.deleteMany({ where }));
      await attempt(() => prisma.serviceFamily.deleteMany({ where }));
      await attempt(() => prisma.templatePartial.deleteMany({ where }));
      await attempt(() => prisma.user.deleteMany({ where }));
      await attempt(() => prisma.company.deleteMany({ where }));
      await attempt(() => prisma.workspace.deleteMany({ where: { id: tenantId } }));
    } finally {
      await prisma.$disconnect();
    }
    if (failures.length > 0) {
      throw new Error(`Performance cleanup failed in ${failures.length} step(s)`);
    }
  }, 120_000);

  it('uses tenant/date/status and roster tenant/company indexes in JSON plans', async () => {
    expect(await prisma.company.count({ where: { tenantId } })).toBe(1_000);
    expect(await prisma.clientService.count({ where: { tenantId } })).toBe(10_000);
    expect(await prisma.deadlineOccurrence.count({ where: { tenantId } })).toBe(100_000);
    expect(clientServiceCount).toBe(10_000);
    expect(occurrenceCount).toBe(100_000);
    // Fresh statistics after the bulk seed keep the planner's index choice stable.
    await prisma.$executeRawUnsafe('ANALYZE client_services, companies, deadline_occurrences');

    const deadlinePlan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return explainJsonWithClient(tx, `
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id
        FROM deadline_occurrences
        WHERE tenant_id = $1
          AND operative_due_date >= $2::date
          AND operative_due_date <= $3::date
          AND status = 'OPEN'
        ORDER BY operative_due_date ASC
        LIMIT 5000
      `, tenantId, '2026-08-01', '2026-09-30');
    });
    const rosterPlan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return explainJsonWithClient(tx, `
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT cs.id
        FROM client_services AS cs
        INNER JOIN companies AS c ON c.id = cs.company_id AND c."tenantId" = $1
        WHERE cs.tenant_id = $1
          AND cs.company_id = ANY($2::text[])
          AND cs.status = 'ACTIVE'
          AND cs.deleted_at IS NULL
        ORDER BY cs.company_id ASC, cs.id ASC
        LIMIT 100
      `, tenantId, companyIds);
    });

    const deadlineNodes = flattenExplainNodes(deadlinePlan);
    const rosterNodes = flattenExplainNodes(rosterPlan);
    const deadlineIndex = deadlineNodes.find((node) => node['Index Name'] === 'deadline_occurrences_tenant_id_operative_due_date_status_idx');
    // Either tenant/company index on client_services serves the roster; the planner may pick either.
    const rosterIndex = rosterNodes.find((node) => String(node['Index Name'] ?? '').startsWith('client_services_tenant_id_company_id_'));
    expect(deadlineIndex).toBeDefined();
    const deadlineConditions = `${deadlineIndex?.['Index Cond'] ?? ''} ${deadlineIndex?.Filter ?? ''}`;
    expect(deadlineConditions).toContain('tenant_id');
    expect(deadlineConditions).toContain('operative_due_date');
    expect(deadlineConditions).toContain('status');
    expect(deadlineIndex?.['Actual Rows'] ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(5_000);
    expect(rosterIndex).toBeDefined();
    const rosterConditions = `${rosterIndex?.['Index Cond'] ?? ''} ${rosterIndex?.Filter ?? ''}`;
    expect(rosterConditions).toContain('tenant_id');
    expect(rosterConditions).toContain('company_id');
    expect(rosterConditions).toContain('status');
    expect(rosterConditions).toContain('deleted_at');
    // Under the join, the index scan can hand over one row past LIMIT 100 before the limit stops it.
    expect(rosterIndex?.['Actual Rows'] ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(101);

    const normalDeadlinePlan = await explainJsonWithClient(prisma, `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id
      FROM deadline_occurrences
      WHERE tenant_id = $1
        AND operative_due_date >= $2::date
        AND operative_due_date <= $3::date
        AND status = 'OPEN'
      ORDER BY operative_due_date ASC
      LIMIT 5000
    `, tenantId, '2026-08-01', '2026-09-30');
    const normalDeadlineNodes = flattenExplainNodes(normalDeadlinePlan);
    expect(normalDeadlineNodes.some((node) => node['Relation Name'] === 'deadline_occurrences' && node['Node Type'] === 'Seq Scan')).toBe(false);
    expect(normalDeadlineNodes.some((node) => node['Index Name'] === 'deadline_occurrences_tenant_id_operative_due_date_status_idx')).toBe(true);
    expect(normalDeadlineNodes[0]?.['Actual Rows'] ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(5_000);
  });

  it('runs representative roster and two-month calendar queries with bounded results', async () => {
    const { listServiceRoster } = await import('@/services/service-roster');
    const { listDeadlines } = await import('@/services/deadline');
    const rosterSearch = serviceRosterSearchSchema.parse({ statuses: ['ACTIVE'], page: 1, limit: 20 });
    const deadlineSearch = deadlineSearchSchema.parse({
      from: '2026-08-01',
      to: '2026-09-30',
      mode: 'CALENDAR',
      openOnly: true,
      limit: 50,
    });

    const rosterStartedAt = performance.now();
    const rosterResult = await listServiceRoster(rosterSearch, { tenantId });
    const rosterDurationMs = performance.now() - rosterStartedAt;

    const calendarStartedAt = performance.now();
    const calendarResult = await listDeadlines(deadlineSearch, { tenantId });
    const calendarDurationMs = performance.now() - calendarStartedAt;

    expect(rosterResult.total).toBe(10_000);
    expect(calendarResult.mode).toBe('CALENDAR');
    expect(calendarResult.items.length).toBeLessThanOrEqual(5_000);
    if (calendarResult.mode === 'CALENDAR') expect(calendarResult.truncated).toBe(true);

    if (runPerformanceAssertions) {
      expect(rosterDurationMs).toBeLessThanOrEqual(1_500);
      expect(calendarDurationMs).toBeLessThanOrEqual(1_500);
    }
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

async function explainJsonWithClient(
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  sql: string,
  ...parameters: unknown[]
): Promise<unknown> {
  const rows = await client.$queryRawUnsafe<Array<{ 'QUERY PLAN': unknown }>>(sql, ...parameters);
  return rows[0]?.['QUERY PLAN'] ?? rows;
}

type ExplainNode = {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  'Actual Rows'?: number;
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
