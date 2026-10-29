import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PERFORMANCE_BUDGETS,
  REQUIRED_PERFORMANCE_DIMENSIONS,
} from '@/lib/performance-budgets';

const root = process.cwd();

describe('performance regression checks', () => {
  it('defines budgets for request count, payload, server timing, DB timing, and bundle size', () => {
    expect(Object.keys(PERFORMANCE_BUDGETS)).toEqual(
      expect.arrayContaining(['companies', 'processing', 'publicForm', 'publicSigning'])
    );

    for (const budget of Object.values(PERFORMANCE_BUDGETS)) {
      for (const dimension of REQUIRED_PERFORMANCE_DIMENSIONS) {
        expect(budget[dimension]).toEqual(expect.any(Number));
        expect(budget[dimension]).toBeGreaterThan(0);
      }
    }
  });

  it('keeps public pages in the public route group without the app provider stack', () => {
    const publicPages = [
      'src/app/(public)/forms/f/[slug]/page.tsx',
      'src/app/(public)/esigning/sign/[token]/page.tsx',
      'src/app/(public)/verify/[certificateId]/page.tsx',
    ];

    for (const relativePath of publicPages) {
      const filePath = join(root, relativePath);
      expect(existsSync(filePath), `${relativePath} should exist`).toBe(true);
      const source = readFileSync(filePath, 'utf8');
      expect(source).not.toContain('@/app/providers');
      expect(source).not.toContain('NavigationProgress');
      expect(source).not.toContain('Sidebar');
    }
  });

  it('keeps compact bootstrap, summary, and measurement endpoints present', () => {
    const routes = [
      'src/app/api/public-bootstrap/forms/[slug]/route.ts',
      'src/app/api/public-bootstrap/esigning/session/route.ts',
      'src/app/api/public-bootstrap/verify/[certificateId]/route.ts',
      'src/app/api/page-bootstrap/companies/route.ts',
      'src/app/api/page-bootstrap/processing/route.ts',
      'src/app/api/companies/summary/route.ts',
      'src/app/api/processing-documents/summary/route.ts',
      'src/app/api/performance/measurements/route.ts',
    ];

    for (const relativePath of routes) {
      expect(existsSync(join(root, relativePath)), `${relativePath} should exist`).toBe(true);
    }
  });

  it('keeps Prisma migration coverage for internal roles, denormalized counts, materialized views, and measurements', () => {
    const migrationPath = join(
      root,
      'prisma/migrations/20260626090000_internal_roles_and_summary_counts/migration.sql'
    );
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain("'ADMIN'");
    expect(migration).toContain('"current_officer_count"');
    expect(migration).toContain('CREATE MATERIALIZED VIEW "company_summary_counts"');
    expect(migration).toContain('CREATE MATERIALIZED VIEW "processing_document_summary_counts"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "performance_measurements"');
  });

  it('mounts app providers only in auth and dashboard route groups', () => {
    const rootLayout = readFileSync(join(root, 'src/app/layout.tsx'), 'utf8');
    const dashboardLayout = readFileSync(join(root, 'src/app/(dashboard)/layout.tsx'), 'utf8');
    const authLayout = readFileSync(join(root, 'src/app/(auth)/layout.tsx'), 'utf8');
    const publicLayout = readFileSync(join(root, 'src/app/(public)/layout.tsx'), 'utf8');

    expect(rootLayout).not.toContain('<Providers>');
    expect(dashboardLayout).toContain('<Providers>');
    expect(authLayout).toContain('<Providers>');
    expect(publicLayout).not.toContain('<Providers>');
  });
});
