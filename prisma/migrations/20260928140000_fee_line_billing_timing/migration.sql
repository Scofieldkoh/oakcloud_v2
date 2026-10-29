-- Prepaid (scheduled) or postpaid (billed when a filing is Filed) fee lines.
CREATE TYPE "BillingTiming" AS ENUM ('PREPAID', 'POSTPAID');

ALTER TABLE "service_variant_fee_templates"
  ADD COLUMN "billing_timing" "BillingTiming" NOT NULL DEFAULT 'PREPAID',
  ADD COLUMN "postpaid_trigger" VARCHAR(60);

ALTER TABLE "client_service_fee_lines"
  ADD COLUMN "billing_timing" "BillingTiming" NOT NULL DEFAULT 'PREPAID',
  ADD COLUMN "postpaid_trigger" VARCHAR(60);
