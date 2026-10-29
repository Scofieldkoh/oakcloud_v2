import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('deadline engine schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20260817100000_deadline_rule_engine/migration.sql'),
    'utf8',
  );
  const integration = readFileSync(
    resolve(process.cwd(), '__tests__/integration/deadline-engine-migration.postgres.test.ts'),
    'utf8',
  );

  const enumMembers = (name: string): string[] => {
    const match = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`));
    return match?.[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean) ?? [];
  };

  it.each([
    'DeadlineRule', 'DeadlineRuleVersion', 'DeadlineRuleParameterDefinition',
    'DeadlineMilestoneTemplate', 'ServiceVariantDeadlineRule',
    'ClientServiceDeadlineRule', 'BusinessCalendar', 'BusinessHoliday',
    'ServiceCycle', 'DeadlineOccurrence', 'ServiceScheduleReconciliationRequest',
  ])('defines model %s', (name) => expect(schema).toContain(`model ${name}`));

  it('uses partial indexes for one draft and queue claims', () => {
    expect(migration).toContain('deadline_rule_versions_one_draft_idx');
    expect(migration).toContain('service_schedule_reconciliation_claim_idx');
    expect(migration).toContain("WHERE \"state\" = 'DRAFT'");
    expect(migration).toContain("WHERE \"status\" IN ('PENDING', 'FAILED')");
    expect(migration).toContain('service_schedule_reconciliation_expired_lease_idx');
    expect(migration).toContain('WHERE \"status\" = \'PROCESSING\'');
    expect(schema).not.toContain('deadline_rule_versions_one_draft_idx');
    expect(schema).not.toContain('service_schedule_reconciliation_claim_idx');
    expect(schema).not.toContain('service_schedule_reconciliation_expired_lease_idx');
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX \"deadline_rule_versions_one_draft_idx\"\s+ON \"deadline_rule_versions\" \(\"rule_id\"\)\s+WHERE \"state\" = 'DRAFT';/,
    );
    expect(migration).toMatch(
      /CREATE INDEX \"service_schedule_reconciliation_claim_idx\"\s+ON \"service_schedule_reconciliation_requests\" \(\"next_attempt_at\", \"id\"\)\s+WHERE \"status\" IN \('PENDING', 'FAILED'\);/,
    );
    expect(migration).toMatch(
      /CREATE INDEX \"service_schedule_reconciliation_expired_lease_idx\"\s+ON \"service_schedule_reconciliation_requests\" \(\"lease_expires_at\", \"id\"\)\s+WHERE \"status\" = 'PROCESSING';/,
    );
  });

  it.each([
    ['DeadlineRuleVersionState', ['DRAFT', 'PUBLISHED']],
    ['DeadlineParameterType', ['DATE', 'INTEGER', 'DECIMAL', 'STRING', 'BOOLEAN', 'ENUM']],
    ['DeadlineMilestoneGenerationMode', ['ONCE_PER_CYCLE', 'ONCE_PER_SCHEDULE_ENTRY']],
    ['BusinessDayAdjustment', ['NONE', 'PREVIOUS', 'NEXT']],
    ['DeadlineApplicabilityState', ['APPLICABLE', 'NOT_APPLICABLE', 'MISSING_INPUT']],
    ['ServiceCycleOrigin', ['RULE', 'MANUAL_TRIGGER']],
    ['DeadlineType', ['STATUTORY', 'CLIENT', 'INTERNAL']],
    ['DeadlineOccurrenceStatus', ['OPEN', 'COMPLETED', 'WAIVED', 'CANCELLED']],
    ['ScheduleReconciliationScopeType', ['TENANT', 'COMPANY', 'CLIENT_SERVICE', 'RULE', 'BUSINESS_CALENDAR']],
    ['ScheduleReconciliationStatus', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']],
  ] as const)('defines the exact %s enum members', (name, expected) => {
    expect(enumMembers(name)).toEqual(expected);
  });

  it('preserves mapped fields, inverse relations, and identity constraints', () => {
    expect(schema).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)/);
    expect(schema).toMatch(/ruleVersionId\s+String\s+@map\("rule_version_id"\)/);
    expect(schema).toMatch(/scheduleEntryKey\s+String\s+@default\(""\)\s+@map\("schedule_entry_key"\)/);
    expect(schema).toContain('deadlineRuleVersions             DeadlineRuleVersion[]');
    expect(schema).toContain('deadlineOccurrences              DeadlineOccurrence[]');
    expect(schema).toContain('deadlineRuleAssociations ServiceVariantDeadlineRule[]');
    expect(schema).toContain('deadlineRules       ClientServiceDeadlineRule[]');
    expect(schema).toContain('@@unique([tenantId, clientServiceId, ruleId, periodKey, generationKey, origin])');
    expect(schema).toContain('@@unique([tenantId, cycleId, milestoneKey, scheduleEntryKey])');
    expect(schema).toContain('@@index([tenantId, operativeDueDate, status])');
    expect(schema).toContain('@@index([tenantId, companyId, operativeDueDate, status])');
    expect(schema).toContain('@@index([tenantId, clientServiceId, operativeDueDate])');
  });

  it('keeps published version children restrictive and validates all lifecycle metadata atomically', () => {
    expect(schema).toMatch(/ruleVersion\s+DeadlineRuleVersion\s+@relation\(fields:\s*\[ruleVersionId\], references:\s*\[id\], onDelete:\s*Restrict\)/);
    expect(migration).toMatch(/deadline_rule_parameter_definitions_rule_version_id_fkey[\s\S]*?ON DELETE RESTRICT/);
    expect(migration).toMatch(/deadline_milestone_templates_rule_version_id_fkey[\s\S]*?ON DELETE RESTRICT/);
    expect(migration).toContain('("date_overridden" = FALSE AND "date_override" IS NULL');
    expect(migration).toContain('"date_overridden" = TRUE AND "date_override" IS NOT NULL');
    expect(migration).toContain('"completed_at" IS NULL AND "completed_by_id" IS NULL');
    expect(migration).toContain('"waived_at" IS NULL AND "waived_by_id" IS NULL AND "waiver_reason" IS NULL');
    expect(migration).toContain('("status" = \'CANCELLED\' AND "cancelled_at" IS NOT NULL AND "cancellation_reason" IS NOT NULL)');
    expect(migration).toContain('"cancelled_by_id" IS NULL AND "cancellation_reason" IS NULL');
    expect(migration).toContain('"cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancellation_reason" IS NULL');
    expect(migration).toContain('length(btrim("generation_key")) > 0');
  });

  it('includes queue lifecycle fields and real prior-migration coverage', () => {
    for (const field of [
      'attempt_count', 'lease_owner', 'lease_expires_at', 'next_attempt_at',
      'last_error_code', 'last_error_message', 'created_at', 'started_at',
      'completed_at', 'updated_at', 'summary', 'requested_by_id', 'correlation_id',
    ]) {
      expect(migration).toContain(`"${field}"`);
    }
    expect(migration).toContain('"service_schedule_reconciliation_requests_dedupe_key_key" UNIQUE');
    expect(migration).toContain("'Singapore Business Calendar', 'SG', 'Asia/Singapore'");
    expect(migration).toContain('ARRAY[0, 6]::INTEGER[]');
    expect(migration).not.toContain('INSERT INTO "business_holidays"');
    expect(integration).toContain('20260817090000_services_admin_foundation');
    expect(integration).toContain('applyPriorMigrations');
    expect(integration).toContain('client_services');
  });
});
