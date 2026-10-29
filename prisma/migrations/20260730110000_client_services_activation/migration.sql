CREATE TYPE "ClientServiceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');
CREATE TYPE "ServiceAgreementActivationStatus" AS ENUM ('NOT_READY', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT');
CREATE TYPE "ServiceAgreementActivationSource" AS ENUM ('ESIGNING', 'MANUAL');

ALTER TABLE "service_agreements"
  ADD COLUMN "activation_status" "ServiceAgreementActivationStatus" NOT NULL DEFAULT 'NOT_READY',
  ADD COLUMN "activation_source" "ServiceAgreementActivationSource",
  ADD COLUMN "activation_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "activation_available_at" TIMESTAMP(3),
  ADD COLUMN "activation_claimed_at" TIMESTAMP(3),
  ADD COLUMN "activation_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "activation_claim_token" VARCHAR(36),
  ADD COLUMN "activation_last_error" TEXT,
  ADD COLUMN "activation_requested_by_id" TEXT,
  ADD COLUMN "activation_reason" VARCHAR(1000);

CREATE TABLE "client_services" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "agreement_id" TEXT NOT NULL,
  "agreement_item_id" TEXT NOT NULL,
  "service_variant_id" TEXT NOT NULL,
  "family_name" VARCHAR(200) NOT NULL,
  "service_name" VARCHAR(200) NOT NULL,
  "status" "ClientServiceStatus" NOT NULL DEFAULT 'ACTIVE',
  "service_cadence" "ServiceCadence" NOT NULL,
  "custom_cadence_label" VARCHAR(100),
  "start_date" DATE NOT NULL,
  "end_date" DATE,
  "field_values" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "deleted_reason" TEXT,
  CONSTRAINT "client_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_service_fee_lines" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "client_service_id" TEXT NOT NULL,
  "source_agreement_fee_line_id" TEXT,
  "description" VARCHAR(500) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'SGD',
  "billing_frequency" "BillingFrequency" NOT NULL,
  "custom_frequency_label" VARCHAR(100),
  "billing_start_date" DATE,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_service_fee_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_services_agreement_item_id_company_id_key" ON "client_services"("agreement_item_id", "company_id");
CREATE INDEX "client_services_tenant_id_company_id_status_deleted_at_idx" ON "client_services"("tenant_id", "company_id", "status", "deleted_at");
CREATE INDEX "client_services_tenant_id_agreement_id_idx" ON "client_services"("tenant_id", "agreement_id");
CREATE INDEX "client_services_service_variant_id_idx" ON "client_services"("service_variant_id");
CREATE UNIQUE INDEX "client_service_fee_lines_client_service_id_source_agreement_fee_line_id_key" ON "client_service_fee_lines"("client_service_id", "source_agreement_fee_line_id");
CREATE INDEX "client_service_fee_lines_tenant_id_client_service_id_display_order_idx" ON "client_service_fee_lines"("tenant_id", "client_service_id", "display_order");
CREATE INDEX "service_agreements_activation_available_claim_idx" ON "service_agreements"("activation_available_at", "id") WHERE "activation_status" IN ('PENDING', 'FAILED_RETRYABLE');
CREATE INDEX "service_agreements_activation_expired_lease_idx" ON "service_agreements"("activation_lease_expires_at", "id") WHERE "activation_status" = 'PROCESSING';

ALTER TABLE "service_agreements" ADD CONSTRAINT "service_agreements_activation_requested_by_id_fkey" FOREIGN KEY ("activation_requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_services" ADD CONSTRAINT "client_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_services" ADD CONSTRAINT "client_services_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_services" ADD CONSTRAINT "client_services_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "service_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_services" ADD CONSTRAINT "client_services_agreement_item_id_fkey" FOREIGN KEY ("agreement_item_id") REFERENCES "service_agreement_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_services" ADD CONSTRAINT "client_services_service_variant_id_fkey" FOREIGN KEY ("service_variant_id") REFERENCES "service_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_service_fee_lines" ADD CONSTRAINT "client_service_fee_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_service_fee_lines" ADD CONSTRAINT "client_service_fee_lines_client_service_id_fkey" FOREIGN KEY ("client_service_id") REFERENCES "client_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_service_fee_lines" ADD CONSTRAINT "client_service_fee_lines_source_agreement_fee_line_id_fkey" FOREIGN KEY ("source_agreement_fee_line_id") REFERENCES "service_agreement_fee_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
