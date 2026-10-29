BEGIN;

-- Remove deadline management and service/contract domain tables.
DROP TABLE IF EXISTS "public"."deadlines" CASCADE;
DROP TABLE IF EXISTS "public"."deadline_rules" CASCADE;
DROP TABLE IF EXISTS "public"."deadline_templates" CASCADE;
DROP TABLE IF EXISTS "public"."contract_services" CASCADE;
DROP TABLE IF EXISTS "public"."contracts" CASCADE;

-- Remove company columns used only by deadline/service orchestration.
ALTER TABLE "public"."companies"
  DROP COLUMN IF EXISTS "agmDispensed",
  DROP COLUMN IF EXISTS "isDormant",
  DROP COLUMN IF EXISTS "dormantTaxExemptionApproved",
  DROP COLUMN IF EXISTS "gstFilingFrequency";

-- Remove enums that are no longer used.
DROP TYPE IF EXISTS "public"."DeadlineBillingStatus";
DROP TYPE IF EXISTS "public"."DeadlineStatus";
DROP TYPE IF EXISTS "public"."DeadlineCategory";
DROP TYPE IF EXISTS "public"."DeadlineAnchorType";
DROP TYPE IF EXISTS "public"."DeadlineFrequency";
DROP TYPE IF EXISTS "public"."DeadlineGenerationType";
DROP TYPE IF EXISTS "public"."DeadlineRuleType";
DROP TYPE IF EXISTS "public"."BillingFrequency";
DROP TYPE IF EXISTS "public"."ServiceStatus";
DROP TYPE IF EXISTS "public"."ServiceType";
DROP TYPE IF EXISTS "public"."ContractStatus";
DROP TYPE IF EXISTS "public"."ContractType";
DROP TYPE IF EXISTS "public"."GstFilingFrequency";

COMMIT;
