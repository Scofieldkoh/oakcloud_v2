import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('billing tracking schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migrationPath = resolve(
    process.cwd(),
    'prisma/migrations/20260817110000_billing_tracking/migration.sql',
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
  const provenanceMigrationPath = resolve(
    process.cwd(),
    'prisma/migrations/20260824100000_billing_reconciliation_provenance/migration.sql',
  );
  const provenanceMigration = existsSync(provenanceMigrationPath) ? readFileSync(provenanceMigrationPath, 'utf8') : '';
  const optionalReasonMigrationPath = resolve(
    process.cwd(),
    'prisma/migrations/20260831183000_allow_null_billing_not_required_reason/migration.sql',
  );
  const optionalReasonMigration = existsSync(optionalReasonMigrationPath) ? readFileSync(optionalReasonMigrationPath, 'utf8') : '';

  const enumMembers = (name: string): string[] => {
    const match = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`));
    return match?.[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean) ?? [];
  };

  it('defines the billing disposition and occurrence models', () => {
    expect(schema).toContain('enum BillingDisposition');
    expect(schema).toContain('model BillingOccurrence');
    expect(schema).toContain('model BillingCoverageIssue');
    expect(schema).toContain('billingDisposition');
    expect(schema).toContain('scheduleConfig');
    expect(migration).toContain('billing_occurrences_identity_key');
    expect(migration).toContain('billing_coverage_issues_open_issue_key');
  });

  it.each([
    ['BillingDisposition', ['CONFIGURED', 'NOT_REQUIRED', 'UNREVIEWED']],
    ['BillingOccurrenceStatus', ['OPEN', 'BILLED', 'WAIVED', 'CANCELLED']],
    ['BillingCoverageIssueSeverity', ['ERROR', 'WARNING']],
    [
      'BillingCoverageIssueType',
      [
        'MISSING_DISPOSITION',
        'MISSING_FEE_LINES',
        'MISSING_START_DATE',
        'INVALID_CUSTOM_SCHEDULE',
        'MISSING_SCHEDULE_PARAMETER',
        'OCCURRENCE_GAP',
        'INVALID_AMOUNT_OR_CURRENCY',
      ],
    ],
  ] as const)('defines exact %s members', (name, expected) => {
    expect(enumMembers(name)).toEqual(expected);
  });

  it('preserves mapped fields, inverse relations, and identity indexes', () => {
    expect(schema).toMatch(/billingDisposition\s+BillingDisposition\s+@default\(UNREVIEWED\)\s+@map\("billing_disposition"\)/);
    expect(schema).toMatch(/billingNotRequiredReason\s+String\?\s+@map\("billing_not_required_reason"\)\s+@db\.VarChar\(500\)/);
    expect(schema).toMatch(/scheduleConfig\s+Json\?\s+@map\("schedule_config"\)/);
    expect(schema).toMatch(/isActive\s+Boolean\s+@default\(true\)\s+@map\("is_active"\)/);
    expect(schema).toMatch(/deletedAt\s+DateTime\?\s+@map\("deleted_at"\)/);
    expect(schema).toMatch(/deletedReason\s+String\?\s+@map\("deleted_reason"\)\s+@db\.VarChar\(1000\)/);
    expect(schema).toMatch(/billingPeriodKey\s+String\s+@map\("billing_period_key"\)\s+@db\.VarChar\(100\)/);
    expect(schema).toMatch(/billedDate\s+DateTime\?\s+@map\("billed_date"\)\s+@db\.Date/);
    expect(schema).toMatch(/details\s+Json\s+@default\("\{\}"\)/);
    expect(schema).toMatch(/billingOccurrences\s+BillingOccurrence\[\]/);
    expect(schema).toMatch(/billingCoverageIssues\s+BillingCoverageIssue\[\]/);
    expect(schema).toContain('@@unique([tenantId, feeLineId, billingPeriodKey, scheduleEntryKey, generationKey], map: "billing_occurrences_identity_key")');
    expect(schema).toContain('@@index([tenantId, operativeExpectedDate, status])');
    expect(schema).toContain('@@index([tenantId, companyId, operativeExpectedDate, status])');
    expect(schema).toContain('@@index([tenantId, clientServiceId, operativeExpectedDate])');
    expect(schema).toContain('@@unique([tenantId, id], map: "companies_tenant_id_id_key")');
    expect(schema).toContain('@@unique([tenantId, id, companyId], map: "client_services_tenant_id_id_company_id_key")');
    expect(schema).toContain('@@unique([tenantId, id, clientServiceId], map: "client_service_fee_lines_tenant_id_id_client_service_id_key")');
    expect(schema).toMatch(/company\s+Company\s+@relation\(fields:\s*\[tenantId, companyId\], references:\s*\[tenantId, id\], onDelete:\s*Restrict\)/);
    expect(schema).toMatch(/clientService\s+ClientService\s+@relation\(fields:\s*\[tenantId, clientServiceId, companyId\], references:\s*\[tenantId, id, companyId\], onDelete:\s*Restrict\)/);
    expect(schema).toMatch(/feeLine\s+ClientServiceFeeLine\??\s+@relation\(fields:\s*\[tenantId, feeLineId, clientServiceId\], references:\s*\[tenantId, id, clientServiceId\], onDelete:\s*Restrict\)/);
    expect(schema).not.toContain('billing_coverage_issues_open_issue_key');
  });

  it('uses partial open-issue uniqueness and migration-only consistency checks', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "billing_coverage_issues_open_issue_key"\s+ON "billing_coverage_issues" \("tenant_id", "issue_key"\)\s+WHERE "resolved_at" IS NULL;/,
    );
    expect(migration).toContain('billing_occurrences_date_override_consistency');
    expect(migration).toContain('billing_occurrences_value_override_consistency');
    expect(migration).toContain('billing_occurrences_billed_consistency');
    expect(migration).toContain('billing_occurrences_waiver_consistency');
    expect(migration).toContain('billing_occurrences_cancellation_consistency');
    expect(migration).toContain('billing_occurrences_billed_date_status');
    expect(migration).toContain('billing_occurrences_currency_codes');
    expect(migration).toContain('billing_occurrences_nonnegative_amounts');
    expect(migration).toMatch(/"billing_disposition" = 'NOT_REQUIRED'[\s\S]*?"billing_not_required_reason" IS NOT NULL[\s\S]*?length\(btrim\("billing_not_required_reason"\)\) >= 3/);
    expect(migration).toContain('client_service_fee_lines_archive_consistency');
    expect(migration).toContain('"calculated_expected_date" = "operative_expected_date"');
    expect(migration).toContain('"base_amount" = "operative_amount"');
    expect(migration).toContain('"base_currency" = "operative_currency"');
    expect(migration).toContain('"companies_tenant_id_id_key" UNIQUE ("tenantId", "id")');
    expect(migration).toContain('"client_services_tenant_id_id_company_id_key" UNIQUE ("tenant_id", "id", "company_id")');
    expect(migration).toContain('"client_service_fee_lines_tenant_id_id_client_service_id_key" UNIQUE ("tenant_id", "id", "client_service_id")');
    expect(migration).toContain('"billed_date" IS NULL');
    expect(migration).toContain('"marked_billed_at" IS NULL');
    expect(migration).toContain('"marked_billed_by_id" IS NULL');
    expect(migration).toContain('"waived_by_id" IS NULL');
    expect(migration).toContain('"cancelled_by_id" IS NULL');
    expect(migration).toMatch(/FOREIGN KEY \("tenant_id", "company_id"\) REFERENCES "companies"\("tenantId", "id"\)/);
    expect(migration).toMatch(/FOREIGN KEY \("tenant_id", "client_service_id", "company_id"\) REFERENCES "client_services"\("tenant_id", "id", "company_id"\)/);
    expect(migration).toMatch(/FOREIGN KEY \("tenant_id", "fee_line_id", "client_service_id"\) REFERENCES "client_service_fee_lines"\("tenant_id", "id", "client_service_id"\)/);
    expect(migration).not.toMatch(/@@index.*billing_coverage_issues_open_issue_key/);
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
  });

  it('keeps source lineage restrictive and user actors retained', () => {
    expect(migration).toMatch(/billing_occurrences_fee_line_lineage_fkey[\s\S]*?ON DELETE RESTRICT/);
    expect(migration).toMatch(/billing_coverage_issues_fee_line_lineage_fkey[\s\S]*?ON DELETE RESTRICT/);
    for (const actor of [
      'date_overridden_by_id',
      'value_overridden_by_id',
      'marked_billed_by_id',
      'waived_by_id',
      'cancelled_by_id',
    ]) {
      expect(migration).toMatch(new RegExp(`${actor}_fkey[\\s\\S]*?ON DELETE RESTRICT`));
    }
    expect(schema).toContain('@relation("BillingOccurrenceDateOverrideActor"');
    expect(schema).toContain('@relation("BillingOccurrenceValueOverrideActor"');
    expect(schema).toContain('@relation("BillingOccurrenceBilledActor"');
    expect(schema).toContain('@relation("BillingOccurrenceWaiverActor"');
    expect(schema).toContain('@relation("BillingOccurrenceCancellationActor"');
  });

  it('allows a null reason when billing is not required', () => {
    expect(optionalReasonMigration).toContain('DROP CONSTRAINT "client_services_billing_disposition_reason"');
    expect(optionalReasonMigration).toMatch(
      /"billing_disposition" = 'NOT_REQUIRED'[\s\S]*?"billing_not_required_reason" IS NULL[\s\S]*?OR length\(btrim\("billing_not_required_reason"\)\) >= 3/,
    );
    expect(optionalReasonMigration).toMatch(
      /"billing_disposition" <> 'NOT_REQUIRED'[\s\S]*?"billing_not_required_reason" IS NULL/,
    );
  });

  it('attributes automatic cancellations to durable reconciliation requests', () => {
    expect(schema).toMatch(/cancellationReconciliationRequestId\s+String\?\s+@map\("cancellation_reconciliation_request_id"\)/);
    expect(schema).toContain('@relation("BillingOccurrenceCancellationRequest"');
    expect(schema).toContain('@@unique([tenantId, id], map: "service_schedule_reconciliation_requests_tenant_id_id_key")');
    expect(provenanceMigration).toContain('cancellation_reconciliation_request_id');
    expect(provenanceMigration).toContain('billing_occurrences_cancellation_request_fkey');
    expect(provenanceMigration).toContain('ON DELETE RESTRICT');
    expect(provenanceMigration).toMatch(/"status" = 'CANCELLED'[\s\S]*?"cancelled_by_id" IS NOT NULL OR "cancellation_reconciliation_request_id" IS NOT NULL/);
    expect(provenanceMigration).toMatch(/"status" <> 'CANCELLED'[\s\S]*?"cancellation_reconciliation_request_id" IS NULL/);
  });
});
