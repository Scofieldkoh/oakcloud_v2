import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../',
  'prisma/migrations/20260817111000_billing_schedule_backfill/migration.sql',
), 'utf8');

describe('billing schedule backfill migration contract', () => {
  it('updates only the mapped schedule column for deterministic legacy frequencies', () => {
    expect(migration).toContain('"client_service_fee_lines"');
    expect(migration).toContain('"billing_frequency"');
    expect(migration).toContain('"billing_start_date"');
    expect(migration).toContain('"schedule_config"');
    expect(migration).toContain("'MONTHLY'");
    expect(migration).toContain("'QUARTERLY'");
    expect(migration).toContain("'SEMI_ANNUALLY'");
    expect(migration).toContain("'ANNUALLY'");
    expect(migration).toContain("'ONE_TIME'");
    expect(migration).not.toMatch(/SET[\s\S]*\b(amount|currency)\b\s*=/i);
    expect(migration).not.toMatch(/SET[\s\S]*billing_disposition\s*=/i);
    expect(migration).toMatch(/fee_line\."schedule_config"\s+IS\s+NULL/i);
  });

  it('does not fabricate custom dates and records deterministic open coverage issues', () => {
    expect(migration).toContain("'CUSTOM'");
    expect(migration).toMatch(/WHERE fee_line\."billing_frequency" = 'CUSTOM'/i);
    expect(migration).toContain('Keep schedule_config NULL');
    expect(migration).toContain("'INVALID_CUSTOM_SCHEDULE'");
    expect(migration).toContain("'MISSING_START_DATE'");
    expect(migration).toContain('ON CONFLICT');
    expect(migration).toContain('resolved_at');
    expect(migration).toContain('issue_key');
    expect(migration.match(/fee_line\."schedule_config"\s+IS\s+NULL/gi)?.length).toBeGreaterThanOrEqual(3);
  });

  it('uses the runtime SHA-256 issue identity fields for migration-derived issues', () => {
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    expect(migration).toMatch(/digest\([\s\S]*json_build_object\([\s\S]*scheduleKey[\s\S]*'sha256'/i);
    expect(migration).not.toMatch(/md5\(concat_ws\('\|',[\s\S]*INVALID_CUSTOM_SCHEDULE/i);
    expect(migration).not.toMatch(/md5\(concat_ws\('\|',[\s\S]*MISSING_START_DATE/i);
  });

  it('creates one pending tenant backfill request per active tenant with a stable dedupe key', () => {
    expect(migration).toContain('"service_schedule_reconciliation_requests"');
    expect(migration).toContain("'TENANT'");
    expect(migration).toContain("'BILLING_BACKFILL'");
    expect(migration).toContain("'PENDING'");
    expect(migration).toContain("md5(concat('BILLING_BACKFILL|', tenant.\"id\"))");
    expect(migration).toMatch(/status[^\n]*ACTIVE/i);
    expect(migration).toContain('ON CONFLICT ("dedupe_key") DO NOTHING');
  });
});
