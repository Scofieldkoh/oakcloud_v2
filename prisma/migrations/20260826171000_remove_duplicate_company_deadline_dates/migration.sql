-- Accounts due is the single persisted source for annual-return and AGM deadlines.
-- Preserve legacy annual-return values only when Accounts due is still empty.
UPDATE "companies"
SET "accountsDueDate" = "nextArDueDate"
WHERE "accountsDueDate" IS NULL
  AND "nextArDueDate" IS NOT NULL;

-- Update only the canonical starter definitions. Tenant-authored rules with the
-- same codes but different identities remain untouched.
WITH starter(
  "code", "name", "old_description", "new_description", "old_hash", "new_hash",
  "milestone_key", "milestone_name", "old_expression", "new_expression"
) AS (
  VALUES
    (
      'SG_AGM_DUE', 'Singapore AGM Due Date',
      'Starter statutory AGM rule sourced from Company.nextAgmDueDate',
      'Starter statutory AGM rule due one month before Company.accountsDueDate',
      '1d35fb5366ca3e0765d99aa3be8a7b1a3419cd72a59010007d2f28c43c125472',
      '5064178cfb8a0675bd7a4520c5e91e5e64c0b5f0097b97794d63ebbd52e5380d',
      'agm-due', 'AGM due date',
      '{"kind":"SOURCE","source":{"kind":"COMPANY_FIELD","field":"nextAgmDueDate"}}'::jsonb,
      '{"kind":"ADD_MONTHS","source":{"kind":"COMPANY_FIELD","field":"accountsDueDate"},"amount":-1}'::jsonb
    ),
    (
      'SG_ANNUAL_RETURN', 'Singapore Annual Return',
      'Starter statutory Annual Return rule sourced from Company.nextArDueDate',
      'Starter statutory Annual Return rule sourced from Company.accountsDueDate',
      '73fd8c37145eec8adea9f1172a6cb7ec2f065fc90cf01b57b291381a3bcead4e',
      'babbb099210ec2afbfaf460482b2200f609ea894dd4fda1b08bc5b6e6116797f',
      'annual-return-due', 'Annual Return due date',
      '{"kind":"SOURCE","source":{"kind":"COMPANY_FIELD","field":"nextArDueDate"}}'::jsonb,
      '{"kind":"SOURCE","source":{"kind":"COMPANY_FIELD","field":"accountsDueDate"}}'::jsonb
    )
), eligible AS (
  SELECT r."id" AS "rule_id", v."id" AS "version_id", starter.*
  FROM "deadline_rules" r
  JOIN "deadline_rule_versions" v
    ON v."rule_id" = r."id"
   AND v."tenant_id" = r."tenant_id"
  JOIN starter
    ON starter."code" = r."code"
   AND starter."name" = r."name"
   AND starter."old_description" = r."description"
   AND starter."old_hash" = v."config_hash"
)
UPDATE "deadline_milestone_templates" milestone
SET "date_expression" = eligible."new_expression",
    "updated_at" = CURRENT_TIMESTAMP
FROM eligible
WHERE milestone."rule_version_id" = eligible."version_id"
  AND milestone."milestone_key" = eligible."milestone_key"
  AND milestone."name" = eligible."milestone_name"
  AND milestone."date_expression" = eligible."old_expression";

WITH starter("code", "name", "old_description", "old_hash", "new_hash") AS (
  VALUES
    (
      'SG_AGM_DUE', 'Singapore AGM Due Date',
      'Starter statutory AGM rule sourced from Company.nextAgmDueDate',
      '1d35fb5366ca3e0765d99aa3be8a7b1a3419cd72a59010007d2f28c43c125472',
      '5064178cfb8a0675bd7a4520c5e91e5e64c0b5f0097b97794d63ebbd52e5380d'
    ),
    (
      'SG_ANNUAL_RETURN', 'Singapore Annual Return',
      'Starter statutory Annual Return rule sourced from Company.nextArDueDate',
      '73fd8c37145eec8adea9f1172a6cb7ec2f065fc90cf01b57b291381a3bcead4e',
      'babbb099210ec2afbfaf460482b2200f609ea894dd4fda1b08bc5b6e6116797f'
    )
)
UPDATE "deadline_rule_versions" version
SET "config_hash" = starter."new_hash",
    "updated_at" = CURRENT_TIMESTAMP
FROM "deadline_rules" rule, starter
WHERE version."rule_id" = rule."id"
  AND version."tenant_id" = rule."tenant_id"
  AND rule."code" = starter."code"
  AND rule."name" = starter."name"
  AND rule."description" = starter."old_description"
  AND version."config_hash" = starter."old_hash";

WITH starter("code", "name", "old_description", "new_description") AS (
  VALUES
    (
      'SG_AGM_DUE', 'Singapore AGM Due Date',
      'Starter statutory AGM rule sourced from Company.nextAgmDueDate',
      'Starter statutory AGM rule due one month before Company.accountsDueDate'
    ),
    (
      'SG_ANNUAL_RETURN', 'Singapore Annual Return',
      'Starter statutory Annual Return rule sourced from Company.nextArDueDate',
      'Starter statutory Annual Return rule sourced from Company.accountsDueDate'
    )
)
UPDATE "deadline_rules" rule
SET "description" = starter."new_description",
    "updated_at" = CURRENT_TIMESTAMP
FROM starter
WHERE rule."code" = starter."code"
  AND rule."name" = starter."name"
  AND rule."description" = starter."old_description";

-- Existing active services need a durable reconciliation request so the new
-- source mapping creates their occurrences without waiting for another edit.
INSERT INTO "service_schedule_reconciliation_requests" (
  "id", "tenant_id", "scope_type", "scope_id", "trigger_type", "correlation_id",
  "dedupe_key", "status", "next_attempt_at", "summary"
)
SELECT
  gen_random_uuid(),
  tenant."id",
  'TENANT'::"ScheduleReconciliationScopeType",
  tenant."id",
  'ACCOUNTS_DUE_SOURCE_MIGRATION',
  concat('accounts-due-source-migration:', tenant."id"),
  md5(concat('ACCOUNTS_DUE_SOURCE_MIGRATION|', tenant."id")),
  'PENDING'::"ScheduleReconciliationStatus",
  CURRENT_TIMESTAMP,
  '{"source":"accountsDueDate"}'::jsonb
FROM "tenants" tenant
WHERE tenant."status" = 'ACTIVE'::"TenantStatus"
  AND tenant."deletedAt" IS NULL
ON CONFLICT ("dedupe_key") DO NOTHING;

-- The summary view depended on nextArDueDate, so rebuild it around Accounts due.
DROP MATERIALIZED VIEW IF EXISTS "company_summary_counts";

ALTER TABLE "companies"
  DROP COLUMN "nextAgmDueDate",
  DROP COLUMN "nextArDueDate";

CREATE INDEX "companies_accountsDueDate_idx" ON "companies"("accountsDueDate");
CREATE INDEX "companies_status_accountsDueDate_idx" ON "companies"("status", "accountsDueDate");

CREATE MATERIALIZED VIEW "company_summary_counts" AS
SELECT
  "tenantId",
  COUNT(*)::INTEGER AS total,
  COUNT(*) FILTER (WHERE status = 'LIVE')::INTEGER AS live_count,
  COUNT(*) FILTER (WHERE "accountsDueDate" < now() AND status = 'LIVE')::INTEGER AS overdue_filings_count,
  COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '30 days')::INTEGER AS recently_added_count,
  SUM("current_officer_count")::INTEGER AS current_officer_count,
  SUM("current_shareholder_count")::INTEGER AS current_shareholder_count,
  SUM("active_charge_count")::INTEGER AS active_charge_count,
  SUM("document_count")::INTEGER AS document_count
FROM "companies"
WHERE "deletedAt" IS NULL
GROUP BY "tenantId";

CREATE UNIQUE INDEX "company_summary_counts_tenant_id_idx"
  ON "company_summary_counts"("tenantId");
