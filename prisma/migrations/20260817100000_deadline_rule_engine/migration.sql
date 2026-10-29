CREATE TYPE "DeadlineRuleVersionState" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "DeadlineParameterType" AS ENUM ('DATE', 'INTEGER', 'DECIMAL', 'STRING', 'BOOLEAN', 'ENUM');
CREATE TYPE "DeadlineMilestoneGenerationMode" AS ENUM ('ONCE_PER_CYCLE', 'ONCE_PER_SCHEDULE_ENTRY');
CREATE TYPE "BusinessDayAdjustment" AS ENUM ('NONE', 'PREVIOUS', 'NEXT');
CREATE TYPE "DeadlineApplicabilityState" AS ENUM ('APPLICABLE', 'NOT_APPLICABLE', 'MISSING_INPUT');
CREATE TYPE "ServiceCycleOrigin" AS ENUM ('RULE', 'MANUAL_TRIGGER');
CREATE TYPE "DeadlineType" AS ENUM ('STATUTORY', 'CLIENT', 'INTERNAL');
CREATE TYPE "DeadlineOccurrenceStatus" AS ENUM ('OPEN', 'COMPLETED', 'WAIVED', 'CANCELLED');
CREATE TYPE "ScheduleReconciliationScopeType" AS ENUM ('TENANT', 'COMPANY', 'CLIENT_SERVICE', 'RULE', 'BUSINESS_CALENDAR');
CREATE TYPE "ScheduleReconciliationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "deadline_rules" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "archived_at" TIMESTAMP(3),
  "archived_by_id" TEXT,
  "archive_reason" TEXT,
  "current_version_id" TEXT,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deadline_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deadline_rules_current_version_id_key" UNIQUE ("current_version_id")
);

CREATE TABLE "deadline_rule_versions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "state" "DeadlineRuleVersionState" NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "recurrence" JSONB NOT NULL DEFAULT '{}',
  "applicability" JSONB NOT NULL DEFAULT '{}',
  "config_hash" VARCHAR(64) NOT NULL,
  "draft_revision" INTEGER NOT NULL DEFAULT 1,
  "published_at" TIMESTAMP(3),
  "published_by_id" TEXT,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deadline_rule_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deadline_rule_parameter_definitions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "rule_version_id" TEXT NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "label" VARCHAR(200) NOT NULL,
  "type" "DeadlineParameterType" NOT NULL,
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "default_value" JSONB,
  "validation" JSONB,
  "help_text" TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deadline_rule_parameter_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deadline_milestone_templates" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "rule_version_id" TEXT NOT NULL,
  "milestone_key" VARCHAR(100) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "type" "DeadlineType" NOT NULL,
  "generation_mode" "DeadlineMilestoneGenerationMode" NOT NULL,
  "date_expression" JSONB NOT NULL,
  "business_day_adjustment" "BusinessDayAdjustment" NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deadline_milestone_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_variant_deadline_rules" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "service_variant_id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "enabled_by_default" BOOLEAN NOT NULL DEFAULT true,
  "parameter_defaults" JSONB NOT NULL DEFAULT '{}',
  "schedule_defaults" JSONB NOT NULL DEFAULT '[]',
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_variant_deadline_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_service_deadline_rules" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "client_service_id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "parameter_values" JSONB NOT NULL DEFAULT '{}',
  "parameter_provenance" JSONB NOT NULL DEFAULT '{}',
  "schedule_entries" JSONB NOT NULL DEFAULT '[]',
  "last_evaluated_version_id" TEXT,
  "applicability_state" "DeadlineApplicabilityState" NOT NULL DEFAULT 'MISSING_INPUT',
  "applicability_reason" TEXT,
  "config_hash" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_id" TEXT,
  CONSTRAINT "client_service_deadline_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_calendars" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "jurisdiction_code" VARCHAR(10) NOT NULL,
  "time_zone" VARCHAR(100) NOT NULL,
  "weekend_days" INTEGER[] NOT NULL DEFAULT ARRAY[0, 6]::INTEGER[],
  "revision" INTEGER NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_calendars_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_calendars_weekend_days_valid" CHECK (
    cardinality("weekend_days") BETWEEN 1 AND 6
    AND "weekend_days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[]
  )
);

CREATE TABLE "business_holidays" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "calendar_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_holidays_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_cycles" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "client_service_id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "rule_version_id" TEXT NOT NULL,
  "business_calendar_id" TEXT,
  "business_calendar_revision" INTEGER,
  "period_key" TEXT NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "generation_key" TEXT NOT NULL,
  "origin" "ServiceCycleOrigin" NOT NULL,
  "recurrence_anchor" JSONB NOT NULL DEFAULT '{}',
  "source_snapshot" JSONB NOT NULL DEFAULT '{}',
  "evaluation_hash" VARCHAR(64) NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_cycles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deadline_occurrences" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "client_service_id" TEXT NOT NULL,
  "cycle_id" TEXT NOT NULL,
  "rule_version_id" TEXT NOT NULL,
  "milestone_key" TEXT NOT NULL,
  "schedule_entry_key" TEXT NOT NULL DEFAULT '',
  "deadline_type" "DeadlineType" NOT NULL,
  "calculated_due_date" DATE NOT NULL,
  "operative_due_date" DATE NOT NULL,
  "date_overridden" BOOLEAN NOT NULL DEFAULT false,
  "date_override" DATE,
  "date_override_reason" TEXT,
  "date_overridden_by_id" TEXT,
  "date_overridden_at" TIMESTAMP(3),
  "status" "DeadlineOccurrenceStatus" NOT NULL DEFAULT 'OPEN',
  "completed_at" TIMESTAMP(3),
  "completed_by_id" TEXT,
  "waived_at" TIMESTAMP(3),
  "waived_by_id" TEXT,
  "waiver_reason" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "cancelled_by_id" TEXT,
  "cancellation_reason" TEXT,
  "origin" "ServiceCycleOrigin" NOT NULL DEFAULT 'RULE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deadline_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_schedule_reconciliation_requests" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "scope_type" "ScheduleReconciliationScopeType" NOT NULL,
  "scope_id" TEXT NOT NULL,
  "trigger_type" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "status" "ScheduleReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "summary" JSONB NOT NULL DEFAULT '{}',
  "requested_by_id" TEXT,
  CONSTRAINT "service_schedule_reconciliation_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_schedule_reconciliation_requests_dedupe_key_key" UNIQUE ("dedupe_key")
);

CREATE UNIQUE INDEX "deadline_rules_tenant_id_code_key"
  ON "deadline_rules" ("tenant_id", "code");
CREATE INDEX "deadline_rules_tenant_id_is_active_idx"
  ON "deadline_rules" ("tenant_id", "is_active");

CREATE UNIQUE INDEX "deadline_rule_versions_rule_id_version_key"
  ON "deadline_rule_versions" ("rule_id", "version");
CREATE INDEX "deadline_rule_versions_tenant_id_state_idx"
  ON "deadline_rule_versions" ("tenant_id", "state");
CREATE INDEX "deadline_rule_versions_rule_id_state_idx"
  ON "deadline_rule_versions" ("rule_id", "state");

CREATE UNIQUE INDEX "deadline_rule_parameter_definitions_rule_version_id_key_key"
  ON "deadline_rule_parameter_definitions" ("rule_version_id", "key");
CREATE INDEX "deadline_rule_parameter_definitions_tenant_id_rule_version_id_display_order_idx"
  ON "deadline_rule_parameter_definitions" ("tenant_id", "rule_version_id", "display_order");

CREATE UNIQUE INDEX "deadline_milestone_templates_rule_version_id_milestone_key_key"
  ON "deadline_milestone_templates" ("rule_version_id", "milestone_key");
CREATE INDEX "deadline_milestone_templates_tenant_id_rule_version_id_display_order_idx"
  ON "deadline_milestone_templates" ("tenant_id", "rule_version_id", "display_order");

CREATE UNIQUE INDEX "service_variant_deadline_rules_service_variant_id_rule_id_key"
  ON "service_variant_deadline_rules" ("service_variant_id", "rule_id");
CREATE INDEX "service_variant_deadline_rules_tenant_id_service_variant_id_display_order_idx"
  ON "service_variant_deadline_rules" ("tenant_id", "service_variant_id", "display_order");
CREATE INDEX "service_variant_deadline_rules_tenant_id_rule_id_idx"
  ON "service_variant_deadline_rules" ("tenant_id", "rule_id");

CREATE UNIQUE INDEX "client_service_deadline_rules_client_service_id_rule_id_key"
  ON "client_service_deadline_rules" ("client_service_id", "rule_id");
CREATE INDEX "client_service_deadline_rules_tenant_id_client_service_id_enabled_idx"
  ON "client_service_deadline_rules" ("tenant_id", "client_service_id", "enabled");
CREATE INDEX "client_service_deadline_rules_tenant_id_rule_id_idx"
  ON "client_service_deadline_rules" ("tenant_id", "rule_id");

CREATE UNIQUE INDEX "business_calendars_tenant_id_name_key"
  ON "business_calendars" ("tenant_id", "name");
CREATE INDEX "business_calendars_tenant_id_is_active_idx"
  ON "business_calendars" ("tenant_id", "is_active");

CREATE UNIQUE INDEX "business_holidays_calendar_id_date_key"
  ON "business_holidays" ("calendar_id", "date");
CREATE INDEX "business_holidays_tenant_id_calendar_id_date_idx"
  ON "business_holidays" ("tenant_id", "calendar_id", "date");

CREATE UNIQUE INDEX "service_cycles_tenant_id_client_service_id_rule_id_period_key_generation_key_origin_key"
  ON "service_cycles" ("tenant_id", "client_service_id", "rule_id", "period_key", "generation_key", "origin");
CREATE INDEX "service_cycles_tenant_id_company_id_period_start_period_end_idx"
  ON "service_cycles" ("tenant_id", "company_id", "period_start", "period_end");
CREATE INDEX "service_cycles_tenant_id_client_service_id_period_start_idx"
  ON "service_cycles" ("tenant_id", "client_service_id", "period_start");
CREATE INDEX "service_cycles_tenant_id_rule_id_period_key_idx"
  ON "service_cycles" ("tenant_id", "rule_id", "period_key");

CREATE UNIQUE INDEX "deadline_occurrences_tenant_id_cycle_id_milestone_key_schedule_entry_key_key"
  ON "deadline_occurrences" ("tenant_id", "cycle_id", "milestone_key", "schedule_entry_key");
CREATE INDEX "deadline_occurrences_tenant_id_operative_due_date_status_idx"
  ON "deadline_occurrences" ("tenant_id", "operative_due_date", "status");
CREATE INDEX "deadline_occurrences_tenant_id_company_id_operative_due_date_status_idx"
  ON "deadline_occurrences" ("tenant_id", "company_id", "operative_due_date", "status");
CREATE INDEX "deadline_occurrences_tenant_id_client_service_id_operative_due_date_idx"
  ON "deadline_occurrences" ("tenant_id", "client_service_id", "operative_due_date");

CREATE INDEX "service_schedule_reconciliation_requests_tenant_id_status_next_attempt_at_idx"
  ON "service_schedule_reconciliation_requests" ("tenant_id", "status", "next_attempt_at");
CREATE INDEX "service_schedule_reconciliation_requests_scope_type_scope_id_status_idx"
  ON "service_schedule_reconciliation_requests" ("scope_type", "scope_id", "status");

CREATE UNIQUE INDEX "deadline_rule_versions_one_draft_idx"
  ON "deadline_rule_versions" ("rule_id")
  WHERE "state" = 'DRAFT';

CREATE INDEX "service_schedule_reconciliation_claim_idx"
  ON "service_schedule_reconciliation_requests" ("next_attempt_at", "id")
  WHERE "status" IN ('PENDING', 'FAILED');

CREATE INDEX "service_schedule_reconciliation_expired_lease_idx"
  ON "service_schedule_reconciliation_requests" ("lease_expires_at", "id")
  WHERE "status" = 'PROCESSING';

ALTER TABLE "deadline_rules"
  ADD CONSTRAINT "deadline_rules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_rules_current_version_id_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "deadline_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_rules_archived_by_id_fkey"
  FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_rules_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_rules_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deadline_rule_versions"
  ADD CONSTRAINT "deadline_rule_versions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_rule_versions_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "deadline_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_rule_versions_published_by_id_fkey"
  FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_rule_versions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deadline_rule_parameter_definitions"
  ADD CONSTRAINT "deadline_rule_parameter_definitions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_rule_parameter_definitions_rule_version_id_fkey"
  FOREIGN KEY ("rule_version_id") REFERENCES "deadline_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deadline_milestone_templates"
  ADD CONSTRAINT "deadline_milestone_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_milestone_templates_rule_version_id_fkey"
  FOREIGN KEY ("rule_version_id") REFERENCES "deadline_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_variant_deadline_rules"
  ADD CONSTRAINT "service_variant_deadline_rules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "service_variant_deadline_rules_service_variant_id_fkey"
  FOREIGN KEY ("service_variant_id") REFERENCES "service_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "service_variant_deadline_rules_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "deadline_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "client_service_deadline_rules"
  ADD CONSTRAINT "client_service_deadline_rules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "client_service_deadline_rules_client_service_id_fkey"
  FOREIGN KEY ("client_service_id") REFERENCES "client_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "client_service_deadline_rules_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "deadline_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "client_service_deadline_rules_last_evaluated_version_id_fkey"
  FOREIGN KEY ("last_evaluated_version_id") REFERENCES "deadline_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "client_service_deadline_rules_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "business_calendars"
  ADD CONSTRAINT "business_calendars_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "business_holidays"
  ADD CONSTRAINT "business_holidays_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "business_holidays_calendar_id_fkey"
  FOREIGN KEY ("calendar_id") REFERENCES "business_calendars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_cycles"
  ADD CONSTRAINT "service_cycles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "service_cycles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "service_cycles_client_service_id_fkey"
  FOREIGN KEY ("client_service_id") REFERENCES "client_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "service_cycles_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "deadline_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "service_cycles_rule_version_id_fkey"
  FOREIGN KEY ("rule_version_id") REFERENCES "deadline_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "service_cycles_business_calendar_id_fkey"
  FOREIGN KEY ("business_calendar_id") REFERENCES "business_calendars"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "service_cycles_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deadline_occurrences"
  ADD CONSTRAINT "deadline_occurrences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_occurrences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_occurrences_client_service_id_fkey"
  FOREIGN KEY ("client_service_id") REFERENCES "client_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_occurrences_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "service_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_occurrences_rule_version_id_fkey"
  FOREIGN KEY ("rule_version_id") REFERENCES "deadline_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_occurrences_date_overridden_by_id_fkey"
  FOREIGN KEY ("date_overridden_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_occurrences_completed_by_id_fkey"
  FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_occurrences_waived_by_id_fkey"
  FOREIGN KEY ("waived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_occurrences_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_schedule_reconciliation_requests"
  ADD CONSTRAINT "service_schedule_reconciliation_requests_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "service_schedule_reconciliation_requests_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deadline_occurrences"
  ADD CONSTRAINT "deadline_occurrences_override_consistency"
  CHECK (
    ("date_overridden" = FALSE AND "date_override" IS NULL AND "date_override_reason" IS NULL AND "date_overridden_at" IS NULL AND "date_overridden_by_id" IS NULL)
    OR
    ("date_overridden" = TRUE AND "date_override" IS NOT NULL AND "date_override_reason" IS NOT NULL AND "date_overridden_at" IS NOT NULL AND "date_overridden_by_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "deadline_occurrences_completion_consistency"
  CHECK (
    ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL AND "completed_by_id" IS NOT NULL)
    OR
    ("status" <> 'COMPLETED' AND "completed_at" IS NULL AND "completed_by_id" IS NULL)
  ),
  ADD CONSTRAINT "deadline_occurrences_waiver_consistency"
  CHECK (
    ("status" = 'WAIVED' AND "waived_at" IS NOT NULL AND "waived_by_id" IS NOT NULL AND "waiver_reason" IS NOT NULL)
    OR
    ("status" <> 'WAIVED' AND "waived_at" IS NULL AND "waived_by_id" IS NULL AND "waiver_reason" IS NULL)
  ),
  ADD CONSTRAINT "deadline_occurrences_cancellation_consistency"
  CHECK (
  ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancellation_reason" IS NOT NULL)
    OR
    ("status" <> 'CANCELLED' AND "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancellation_reason" IS NULL)
  ),
  ADD CONSTRAINT "deadline_occurrences_stable_keys_nonempty"
  CHECK (length("milestone_key") > 0);

ALTER TABLE "service_cycles"
  ADD CONSTRAINT "service_cycles_generation_key_nonempty"
  CHECK (length(btrim("generation_key")) > 0);

INSERT INTO "business_calendars" (
  "id", "tenant_id", "name", "jurisdiction_code", "time_zone", "weekend_days",
  "revision", "is_active", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), t."id", 'Singapore Business Calendar', 'SG', 'Asia/Singapore',
  ARRAY[0, 6]::INTEGER[], 1, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" AS t;
