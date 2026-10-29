CREATE TYPE "ClientServiceSource" AS ENUM ('AGREEMENT', 'MANUAL');

ALTER TABLE "client_services"
  ADD COLUMN "source" "ClientServiceSource" NOT NULL DEFAULT 'AGREEMENT';

UPDATE "client_services" SET "source" = 'AGREEMENT';

ALTER TABLE "client_services"
  ALTER COLUMN "agreement_id" DROP NOT NULL,
  ALTER COLUMN "agreement_item_id" DROP NOT NULL;

ALTER TABLE "client_services"
  ADD CONSTRAINT "client_services_source_reference_consistency"
  CHECK (
    ("source" = 'AGREEMENT' AND "agreement_id" IS NOT NULL AND "agreement_item_id" IS NOT NULL)
    OR
    ("source" = 'MANUAL' AND "agreement_id" IS NULL AND "agreement_item_id" IS NULL)
  );

CREATE INDEX "client_services_tenant_id_company_id_service_variant_id_start_date_deleted_at_idx"
  ON "client_services"("tenant_id", "company_id", "service_variant_id", "start_date", "deleted_at");
