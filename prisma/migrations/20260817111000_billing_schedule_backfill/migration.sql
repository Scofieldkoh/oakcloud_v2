CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Label-only CUSTOM values cannot be converted into a valid structured
-- interval. Keep schedule_config NULL and open one stable issue per fee line.
WITH issue_rows AS (
  SELECT
    fee_line."tenant_id",
    service."company_id",
    fee_line."client_service_id",
    fee_line."id" AS "fee_line_id",
    'INVALID_CUSTOM_SCHEDULE'::"BillingCoverageIssueType" AS "issue_type",
    'ERROR'::"BillingCoverageIssueSeverity" AS "severity",
    encode(digest(replace(replace(replace(json_build_object(
      'clientServiceId', fee_line."client_service_id",
      'feeLineId', fee_line."id",
      'scheduleKey', 'schedule',
      'tenantId', fee_line."tenant_id",
      'type', 'INVALID_CUSTOM_SCHEDULE'
    )::text, ' : ', ':'), ': ', ':'), ', ', ','), 'sha256'), 'hex') AS "issue_key",
    jsonb_build_object('billingFrequency', fee_line."billing_frequency"::text, 'customFrequencyLabel', fee_line."custom_frequency_label") AS "details"
  FROM "client_service_fee_lines" AS fee_line
  JOIN "client_services" AS service
    ON service."tenant_id" = fee_line."tenant_id"
   AND service."id" = fee_line."client_service_id"
  WHERE fee_line."billing_frequency" = 'CUSTOM'::"BillingFrequency"
    AND fee_line."schedule_config" IS NULL

  UNION ALL

  SELECT
    fee_line."tenant_id",
    service."company_id",
    fee_line."client_service_id",
    fee_line."id" AS "fee_line_id",
    'MISSING_START_DATE'::"BillingCoverageIssueType" AS "issue_type",
    'ERROR'::"BillingCoverageIssueSeverity" AS "severity",
    encode(digest(replace(replace(replace(json_build_object(
      'clientServiceId', fee_line."client_service_id",
      'feeLineId', fee_line."id",
      'scheduleKey', 'schedule',
      'tenantId', fee_line."tenant_id",
      'type', 'MISSING_START_DATE'
    )::text, ' : ', ':'), ': ', ':'), ', ', ','), 'sha256'), 'hex') AS "issue_key",
    jsonb_build_object('billingFrequency', fee_line."billing_frequency"::text) AS "details"
  FROM "client_service_fee_lines" AS fee_line
  JOIN "client_services" AS service
    ON service."tenant_id" = fee_line."tenant_id"
   AND service."id" = fee_line."client_service_id"
  WHERE fee_line."billing_frequency" IN (
    'MONTHLY'::"BillingFrequency",
    'QUARTERLY'::"BillingFrequency",
    'SEMI_ANNUALLY'::"BillingFrequency",
    'ANNUALLY'::"BillingFrequency",
    'ONE_TIME'::"BillingFrequency"
  )
    AND fee_line."billing_start_date" IS NULL
    AND fee_line."schedule_config" IS NULL
)
INSERT INTO "billing_coverage_issues" (
  "id", "tenant_id", "company_id", "client_service_id", "fee_line_id",
  "issue_type", "severity", "issue_key", "details",
  "first_detected_at", "last_detected_at", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), "tenant_id", "company_id", "client_service_id", "fee_line_id",
  "issue_type", "severity", "issue_key", "details",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM issue_rows
ON CONFLICT ("tenant_id", "issue_key") WHERE "resolved_at" IS NULL
DO UPDATE SET
  "issue_type" = EXCLUDED."issue_type",
  "severity" = EXCLUDED."severity",
  "details" = EXCLUDED."details",
  "last_detected_at" = CURRENT_TIMESTAMP,
  "updated_at" = CURRENT_TIMESTAMP;

-- Convert only deterministic legacy fee-line frequencies. The legacy amount,
-- currency, and frequency columns remain the source of truth for compatibility;
-- this migration adds a structured schedule snapshot beside them. Issue rows
-- are captured above while schedule_config is still NULL, so missing-start
-- coverage remains observable after its deterministic config is written.
UPDATE "client_service_fee_lines" AS fee_line
SET "schedule_config" = jsonb_build_object(
  'schemaVersion', 1,
  'cadence', fee_line."billing_frequency"::text,
  'startDate', CASE
    WHEN fee_line."billing_start_date" IS NULL THEN NULL
    ELSE to_char(fee_line."billing_start_date", 'YYYY-MM-DD')
  END,
  'customInterval', CASE
    WHEN fee_line."billing_frequency" = 'ONE_TIME'::"BillingFrequency" THEN NULL::jsonb
    WHEN fee_line."billing_frequency" = 'MONTHLY'::"BillingFrequency" THEN jsonb_build_object('unit', 'MONTH', 'count', 1)
    WHEN fee_line."billing_frequency" = 'QUARTERLY'::"BillingFrequency" THEN jsonb_build_object('unit', 'MONTH', 'count', 3)
    WHEN fee_line."billing_frequency" = 'SEMI_ANNUALLY'::"BillingFrequency" THEN jsonb_build_object('unit', 'MONTH', 'count', 6)
    WHEN fee_line."billing_frequency" = 'ANNUALLY'::"BillingFrequency" THEN jsonb_build_object('unit', 'MONTH', 'count', 12)
    ELSE NULL::jsonb
  END,
  'scheduleEntries', CASE
    WHEN fee_line."billing_start_date" IS NULL THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object(
      'key', 'default',
      'label', 'Billing date',
      'expression', jsonb_build_object(
        'kind', 'DAY_OF_MONTH',
        'day', EXTRACT(DAY FROM fee_line."billing_start_date")::integer
      ),
      'businessDayAdjustment', 'NONE'
    ))
  END
)
WHERE fee_line."billing_frequency" IN (
  'MONTHLY'::"BillingFrequency",
  'QUARTERLY'::"BillingFrequency",
  'SEMI_ANNUALLY'::"BillingFrequency",
  'ANNUALLY'::"BillingFrequency",
  'ONE_TIME'::"BillingFrequency"
)
  AND fee_line."schedule_config" IS NULL;

-- Queue one durable tenant-scoped request for the shared reconciliation worker.
-- md5 is deterministic and fits the existing VARCHAR(64) dedupe-key contract.
INSERT INTO "service_schedule_reconciliation_requests" (
  "id", "tenant_id", "scope_type", "scope_id", "trigger_type", "correlation_id",
  "dedupe_key", "status", "next_attempt_at", "summary"
)
SELECT
  gen_random_uuid(),
  tenant."id",
  'TENANT'::"ScheduleReconciliationScopeType",
  tenant."id",
  'BILLING_BACKFILL',
  concat('billing-backfill:', tenant."id"),
  md5(concat('BILLING_BACKFILL|', tenant."id")),
  'PENDING'::"ScheduleReconciliationStatus",
  CURRENT_TIMESTAMP,
  '{}'::jsonb
FROM "tenants" AS tenant
WHERE tenant."status" = 'ACTIVE'::"TenantStatus"
  AND tenant."deletedAt" IS NULL
ON CONFLICT ("dedupe_key") DO NOTHING;
