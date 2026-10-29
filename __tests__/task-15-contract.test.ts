import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const servicePatterns = readFileSync(resolve(process.cwd(), 'docs/guides/SERVICE_PATTERNS.md'), 'utf8');
const reconciliationWorker = readFileSync(
  resolve(process.cwd(), 'src/services/schedule-reconciliation/worker.ts'),
  'utf8',
);
const reconciliationSettings = readFileSync(
  resolve(process.cwd(), 'src/services/schedule-reconciliation/settings.ts'),
  'utf8',
);
const tenantIsolationSuite = readFileSync(
  resolve(process.cwd(), '__tests__/integration/deadline-tenant-isolation.postgres.test.ts'),
  'utf8',
);
const performanceSuite = readFileSync(
  resolve(process.cwd(), '__tests__/integration/deadline-performance.postgres.test.ts'),
  'utf8',
);

describe('Task 15 rollout contract', () => {
  it('registers the gated PostgreSQL and performance scripts exactly', () => {
    expect(packageJson.scripts?.['test:deadlines:postgres']).toBe(
      'vitest run __tests__/integration/deadline-reconciliation.postgres.test.ts __tests__/integration/deadline-tenant-isolation.postgres.test.ts',
    );
    expect(packageJson.scripts?.['test:deadlines:performance']).toBe(
      'vitest run __tests__/integration/deadline-performance.postgres.test.ts',
    );
  });

  it('documents observation/apply flags, scheduler cadence, retry schedule, and rolling horizon', () => {
    expect(servicePatterns).toContain('Workspace.settings.servicesWorkspace.enabled');
    expect(servicePatterns).toContain('Workspace.settings.servicesWorkspace.deadlineWritesEnabled');
    expect(servicePatterns).toContain('DEADLINE_OCCURRENCE_WRITES_ENABLED=true');
    expect(servicePatterns).toContain('service-schedule-reconciliation');
    expect(servicePatterns).toContain('runs each minute');
    expect(servicePatterns).toContain('1/5/15/60/240-minute');
    expect(servicePatterns).toContain('12 months from the Singapore date');
  });

  it('keeps the shared schedule engine and editor free of payroll-specific branches', () => {
    const files = [
      'src/services/service-schedule',
      'src/lib/validations/service-schedule.ts',
      'src/components/services/shared/schedule-entry-editor.tsx',
    ];

    for (const file of files) {
      const path = resolve(process.cwd(), file);
      const contents = statSync(path).isDirectory()
        ? readFileSync(resolve(path, 'index.ts'), 'utf8')
        : readFileSync(path, 'utf8');
      expect(contents.toLowerCase()).not.toContain('payroll');
    }
  });

  it('has one structured reconciliation log call and no duplicate request-level error logs', () => {
    expect(reconciliationWorker.match(/emitReconciliationLogEvent\(log,/g)).toHaveLength(1);
    expect(reconciliationWorker).not.toContain('log.error(\'Reconciliation request failed\'');
    expect(reconciliationWorker).not.toContain('log.warn(\'Reconciliation request completion lost lease ownership\'');
    expect(reconciliationWorker).not.toContain('log.warn(\'Transient reconciliation outcome lost lease ownership\'');
  });

  it('uses boolean-OR rollout semantics and guards PostgreSQL gates in CI', () => {
    expect(reconciliationSettings).toContain("deadlineWritesEnabled: tenantDeadlineWritesEnabled === true || process.env.DEADLINE_OCCURRENCE_WRITES_ENABLED === 'true'");
    expect(tenantIsolationSuite).toContain("if (process.env.CI === 'true' && !testDatabaseUrl)");
    expect(performanceSuite).toContain("if (process.env.CI === 'true' && !testDatabaseUrl)");
  });
});
