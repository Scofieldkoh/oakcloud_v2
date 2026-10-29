CREATE TYPE "BillingDisposition" AS ENUM ('CONFIGURED', 'NOT_REQUIRED', 'UNREVIEWED');
CREATE TYPE "BillingOccurrenceStatus" AS ENUM ('OPEN', 'BILLED', 'WAIVED', 'CANCELLED');
CREATE TYPE "BillingCoverageIssueSeverity" AS ENUM ('ERROR', 'WARNING');
CREATE TYPE "BillingCoverageIssueType" AS ENUM (
  'MISSING_DISPOSITION',
  'MISSING_FEE_LINES',
  'MISSING_START_DATE',
  'INVALID_CUSTOM_SCHEDULE',
  'MISSING_SCHEDULE_PARAMETER',
  'OCCURRENCE_GAP',
  'INVALID_AMOUNT_OR_CURRENCY'
);

ALTER TABLE "client_services"
  ADD COLUMN "billing_disposition" "BillingDisposition" NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN "billing_not_required_reason" VARCHAR(500);

ALTER TABLE "client_service_fee_lines"
  ADD COLUMN "schedule_config" JSONB,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_reason" VARCHAR(1000);

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_tenant_id_id_key" UNIQUE ("tenantId", "id");

ALTER TABLE "client_services"
  ADD CONSTRAINT "client_services_tenant_id_id_company_id_key" UNIQUE ("tenant_id", "id", "company_id");

ALTER TABLE "client_service_fee_lines"
  ADD CONSTRAINT "client_service_fee_lines_tenant_id_id_client_service_id_key" UNIQUE ("tenant_id", "id", "client_service_id");

CREATE TABLE "billing_occurrences" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "client_service_id" TEXT NOT NULL,
  "fee_line_id" TEXT NOT NULL,
  "billing_period_key" VARCHAR(100) NOT NULL,
  "schedule_entry_key" VARCHAR(64) NOT NULL DEFAULT '',
  "generation_key" VARCHAR(100) NOT NULL,
  "calculated_expected_date" DATE NOT NULL,
  "operative_expected_date" DATE NOT NULL,
  "date_overridden" BOOLEAN NOT NULL DEFAULT FALSE,
  "date_override_reason" VARCHAR(1000),
  "date_overridden_at" TIMESTAMP(3),
  "date_overridden_by_id" TEXT,
  "base_amount" DECIMAL(18,2) NOT NULL,
  "base_currency" VARCHAR(3) NOT NULL,
  "operative_amount" DECIMAL(18,2) NOT NULL,
  "operative_currency" VARCHAR(3) NOT NULL,
  "value_overridden" BOOLEAN NOT NULL DEFAULT FALSE,
  "value_override_reason" VARCHAR(1000),
  "value_overridden_at" TIMESTAMP(3),
  "value_overridden_by_id" TEXT,
  "status" "BillingOccurrenceStatus" NOT NULL DEFAULT 'OPEN',
  "billed_date" DATE,
  "marked_billed_at" TIMESTAMP(3),
  "marked_billed_by_id" TEXT,
  "external_reference" VARCHAR(200),
  "notes" TEXT,
  "waived_at" TIMESTAMP(3),
  "waived_by_id" TEXT,
  "waiver_reason" VARCHAR(1000),
  "cancelled_at" TIMESTAMP(3),
  "cancelled_by_id" TEXT,
  "cancellation_reason" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_coverage_issues" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "client_service_id" TEXT NOT NULL,
  "fee_line_id" TEXT,
  "issue_type" "BillingCoverageIssueType" NOT NULL,
  "severity" "BillingCoverageIssueSeverity" NOT NULL,
  "issue_key" VARCHAR(64) NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_coverage_issues_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_occurrences_identity_key"
  ON "billing_occurrences" ("tenant_id", "fee_line_id", "billing_period_key", "schedule_entry_key", "generation_key");
CREATE INDEX "billing_occurrences_tenant_id_operative_expected_date_status_idx"
  ON "billing_occurrences" ("tenant_id", "operative_expected_date", "status");
CREATE INDEX "billing_occurrences_tenant_id_company_id_operative_expected_date_status_idx"
  ON "billing_occurrences" ("tenant_id", "company_id", "operative_expected_date", "status");
CREATE INDEX "billing_occurrences_tenant_id_client_service_id_operative_expected_date_idx"
  ON "billing_occurrences" ("tenant_id", "client_service_id", "operative_expected_date");

CREATE INDEX "billing_coverage_issues_tenant_id_client_service_id_resolved_at_idx"
  ON "billing_coverage_issues" ("tenant_id", "client_service_id", "resolved_at");
CREATE INDEX "billing_coverage_issues_tenant_id_company_id_severity_resolved_at_idx"
  ON "billing_coverage_issues" ("tenant_id", "company_id", "severity", "resolved_at");
CREATE UNIQUE INDEX "billing_coverage_issues_open_issue_key"
  ON "billing_coverage_issues" ("tenant_id", "issue_key")
  WHERE "resolved_at" IS NULL;

ALTER TABLE "billing_occurrences"
  ADD CONSTRAINT "billing_occurrences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_occurrences_company_tenant_id_fkey"
  FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_occurrences_client_service_lineage_fkey"
  FOREIGN KEY ("tenant_id", "client_service_id", "company_id") REFERENCES "client_services"("tenant_id", "id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_occurrences_fee_line_lineage_fkey"
  FOREIGN KEY ("tenant_id", "fee_line_id", "client_service_id") REFERENCES "client_service_fee_lines"("tenant_id", "id", "client_service_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_occurrences_date_overridden_by_id_fkey"
  FOREIGN KEY ("date_overridden_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_occurrences_value_overridden_by_id_fkey"
  FOREIGN KEY ("value_overridden_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_occurrences_marked_billed_by_id_fkey"
  FOREIGN KEY ("marked_billed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_occurrences_waived_by_id_fkey"
  FOREIGN KEY ("waived_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_occurrences_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_coverage_issues"
  ADD CONSTRAINT "billing_coverage_issues_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_coverage_issues_company_tenant_id_fkey"
  FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_coverage_issues_client_service_lineage_fkey"
  FOREIGN KEY ("tenant_id", "client_service_id", "company_id") REFERENCES "client_services"("tenant_id", "id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_coverage_issues_fee_line_lineage_fkey"
  FOREIGN KEY ("tenant_id", "fee_line_id", "client_service_id") REFERENCES "client_service_fee_lines"("tenant_id", "id", "client_service_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "client_service_fee_lines"
  ADD CONSTRAINT "client_service_fee_lines_archive_consistency"
  CHECK (
    ("is_active" = TRUE AND "deleted_at" IS NULL AND "deleted_reason" IS NULL)
    OR
    ("is_active" = FALSE AND "deleted_at" IS NOT NULL AND "deleted_reason" IS NOT NULL AND length(btrim("deleted_reason")) >= 3)
  );

ALTER TABLE "client_services"
  ADD CONSTRAINT "client_services_billing_disposition_reason"
  CHECK (
    ("billing_disposition" = 'NOT_REQUIRED' AND "billing_not_required_reason" IS NOT NULL AND length(btrim("billing_not_required_reason")) >= 3)
    OR
    ("billing_disposition" <> 'NOT_REQUIRED' AND "billing_not_required_reason" IS NULL)
  );

ALTER TABLE "billing_occurrences"
  ADD CONSTRAINT "billing_occurrences_date_override_consistency"
  CHECK (
    ("date_overridden" = FALSE AND "calculated_expected_date" = "operative_expected_date" AND "date_override_reason" IS NULL AND "date_overridden_at" IS NULL AND "date_overridden_by_id" IS NULL)
    OR
    ("date_overridden" = TRUE AND "date_override_reason" IS NOT NULL AND "date_overridden_at" IS NOT NULL AND "date_overridden_by_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "billing_occurrences_value_override_consistency"
  CHECK (
    ("value_overridden" = FALSE AND "base_amount" = "operative_amount" AND "base_currency" = "operative_currency" AND "value_override_reason" IS NULL AND "value_overridden_at" IS NULL AND "value_overridden_by_id" IS NULL)
    OR
    ("value_overridden" = TRUE AND "value_override_reason" IS NOT NULL AND "value_overridden_at" IS NOT NULL AND "value_overridden_by_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "billing_occurrences_billed_consistency"
  CHECK (
    ("status" = 'BILLED' AND "marked_billed_at" IS NOT NULL AND "marked_billed_by_id" IS NOT NULL)
    OR
    ("status" <> 'BILLED' AND "marked_billed_at" IS NULL AND "marked_billed_by_id" IS NULL)
  ),
  ADD CONSTRAINT "billing_occurrences_waiver_consistency"
  CHECK (
    ("status" = 'WAIVED' AND "waived_at" IS NOT NULL AND "waived_by_id" IS NOT NULL AND "waiver_reason" IS NOT NULL)
    OR
    ("status" <> 'WAIVED' AND "waived_at" IS NULL AND "waived_by_id" IS NULL AND "waiver_reason" IS NULL)
  ),
  ADD CONSTRAINT "billing_occurrences_cancellation_consistency"
  CHECK (
    ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by_id" IS NOT NULL AND "cancellation_reason" IS NOT NULL)
    OR
    ("status" <> 'CANCELLED' AND "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancellation_reason" IS NULL)
  ),
  ADD CONSTRAINT "billing_occurrences_billed_date_status"
  CHECK ("status" = 'BILLED' OR "billed_date" IS NULL),
  ADD CONSTRAINT "billing_occurrences_currency_codes"
  CHECK ("base_currency" ~ '^[A-Z]{3}$' AND "operative_currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "billing_occurrences_nonnegative_amounts"
  CHECK ("base_amount" >= 0 AND "operative_amount" >= 0);
