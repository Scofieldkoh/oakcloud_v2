CREATE TYPE "DocumentTemplateCompositionType" AS ENUM (
  'STANDARD',
  'SERVICE_AGREEMENT'
);

CREATE TYPE "ServiceCadence" AS ENUM (
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUALLY',
  'ANNUALLY',
  'ONE_TIME',
  'AD_HOC',
  'CUSTOM'
);

CREATE TYPE "BillingFrequency" AS ENUM (
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUALLY',
  'ANNUALLY',
  'ONE_TIME',
  'CUSTOM'
);

ALTER TABLE "document_templates"
  ADD COLUMN "composition_type" "DocumentTemplateCompositionType" NOT NULL DEFAULT 'STANDARD';

ALTER TABLE "template_partials"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "service_families" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "service_families_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_variants" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "sow_partial_id" TEXT NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "service_cadence" "ServiceCadence" NOT NULL,
  "custom_cadence_label" VARCHAR(100),
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "service_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_variant_fee_templates" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "variant_id" TEXT NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "default_amount" DECIMAL(18,2),
  "currency" VARCHAR(3) NOT NULL DEFAULT 'SGD',
  "billing_frequency" "BillingFrequency" NOT NULL,
  "custom_frequency_label" VARCHAR(100),
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "service_variant_fee_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_families_tenant_id_code_key"
  ON "service_families"("tenant_id", "code");
CREATE INDEX "service_families_tenant_id_deleted_at_is_active_idx"
  ON "service_families"("tenant_id", "deleted_at", "is_active");
CREATE INDEX "service_families_tenant_id_display_order_idx"
  ON "service_families"("tenant_id", "display_order");

CREATE UNIQUE INDEX "service_variants_tenant_id_code_key"
  ON "service_variants"("tenant_id", "code");
CREATE INDEX "service_variants_tenant_id_family_id_deleted_at_is_active_idx"
  ON "service_variants"("tenant_id", "family_id", "deleted_at", "is_active");
CREATE INDEX "service_variants_tenant_id_display_order_idx"
  ON "service_variants"("tenant_id", "display_order");
CREATE INDEX "service_variants_sow_partial_id_idx"
  ON "service_variants"("sow_partial_id");

CREATE INDEX "service_variant_fee_templates_tenant_id_variant_id_display_order_idx"
  ON "service_variant_fee_templates"("tenant_id", "variant_id", "display_order");

ALTER TABLE "service_families"
  ADD CONSTRAINT "service_families_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_variants"
  ADD CONSTRAINT "service_variants_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_variants"
  ADD CONSTRAINT "service_variants_family_id_fkey"
  FOREIGN KEY ("family_id") REFERENCES "service_families"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_variants"
  ADD CONSTRAINT "service_variants_sow_partial_id_fkey"
  FOREIGN KEY ("sow_partial_id") REFERENCES "template_partials"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_variant_fee_templates"
  ADD CONSTRAINT "service_variant_fee_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_variant_fee_templates"
  ADD CONSTRAINT "service_variant_fee_templates_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "service_variants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
