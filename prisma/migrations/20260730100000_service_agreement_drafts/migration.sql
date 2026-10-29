CREATE TYPE "ServiceAgreementStatus" AS ENUM ('DRAFT', 'EFFECTIVE', 'CANCELLED');

CREATE TABLE "service_agreements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "generated_document_id" TEXT NOT NULL,
    "primary_company_id" TEXT NOT NULL,
    "authorized_contact_id" TEXT,
    "authorized_representative_snapshot" JSONB NOT NULL,
    "agreement_date" DATE NOT NULL,
    "effective_date" DATE,
    "term_months" INTEGER NOT NULL DEFAULT 12,
    "status" "ServiceAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "signed_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_agreements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_agreement_entities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agreement_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name_snapshot" VARCHAR(255) NOT NULL,
    "uen_snapshot" VARCHAR(50) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "service_agreement_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_agreement_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agreement_id" TEXT NOT NULL,
    "service_variant_id" TEXT NOT NULL,
    "variant_version" INTEGER NOT NULL,
    "family_name_snapshot" VARCHAR(200) NOT NULL,
    "variant_name_snapshot" VARCHAR(200) NOT NULL,
    "service_cadence" "ServiceCadence" NOT NULL,
    "custom_cadence_label" VARCHAR(100),
    "sow_partial_id" TEXT NOT NULL,
    "partial_version" INTEGER NOT NULL,
    "partial_content_snapshot" TEXT NOT NULL,
    "partial_placeholders_snapshot" JSONB NOT NULL,
    "partial_dependency_snapshot" JSONB NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "field_values" JSONB NOT NULL DEFAULT '{}',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_agreement_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_agreement_item_entities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "agreement_entity_id" TEXT NOT NULL,
    CONSTRAINT "service_agreement_item_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_agreement_fee_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "agreement_entity_id" TEXT NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'SGD',
    "billing_frequency" "BillingFrequency" NOT NULL,
    "custom_frequency_label" VARCHAR(100),
    "billing_start_date" DATE,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_agreement_fee_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_agreements_generated_document_id_key" ON "service_agreements"("generated_document_id");
CREATE INDEX "service_agreements_tenant_id_status_updated_at_idx" ON "service_agreements"("tenant_id", "status", "updated_at");
CREATE INDEX "service_agreements_tenant_id_primary_company_id_idx" ON "service_agreements"("tenant_id", "primary_company_id");
CREATE UNIQUE INDEX "service_agreement_entities_agreement_id_company_id_key" ON "service_agreement_entities"("agreement_id", "company_id");
CREATE INDEX "service_agreement_entities_tenant_id_company_id_idx" ON "service_agreement_entities"("tenant_id", "company_id");
CREATE INDEX "service_agreement_entities_agreement_id_display_order_idx" ON "service_agreement_entities"("agreement_id", "display_order");
CREATE INDEX "service_agreement_items_tenant_id_agreement_id_display_order_idx" ON "service_agreement_items"("tenant_id", "agreement_id", "display_order");
CREATE INDEX "service_agreement_items_service_variant_id_idx" ON "service_agreement_items"("service_variant_id");
CREATE UNIQUE INDEX "service_agreement_item_entities_item_id_agreement_entity_id_key" ON "service_agreement_item_entities"("item_id", "agreement_entity_id");
CREATE INDEX "service_agreement_item_entities_tenant_id_agreement_entity_id_idx" ON "service_agreement_item_entities"("tenant_id", "agreement_entity_id");
CREATE INDEX "service_agreement_fee_lines_tenant_id_item_id_display_order_idx" ON "service_agreement_fee_lines"("tenant_id", "item_id", "display_order");
CREATE INDEX "service_agreement_fee_lines_agreement_entity_id_idx" ON "service_agreement_fee_lines"("agreement_entity_id");

ALTER TABLE "service_agreements" ADD CONSTRAINT "service_agreements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreements" ADD CONSTRAINT "service_agreements_generated_document_id_fkey" FOREIGN KEY ("generated_document_id") REFERENCES "generated_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreements" ADD CONSTRAINT "service_agreements_primary_company_id_fkey" FOREIGN KEY ("primary_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_agreements" ADD CONSTRAINT "service_agreements_authorized_contact_id_fkey" FOREIGN KEY ("authorized_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_agreement_entities" ADD CONSTRAINT "service_agreement_entities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreement_entities" ADD CONSTRAINT "service_agreement_entities_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "service_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreement_entities" ADD CONSTRAINT "service_agreement_entities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_agreement_items" ADD CONSTRAINT "service_agreement_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreement_items" ADD CONSTRAINT "service_agreement_items_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "service_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreement_items" ADD CONSTRAINT "service_agreement_items_service_variant_id_fkey" FOREIGN KEY ("service_variant_id") REFERENCES "service_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_agreement_items" ADD CONSTRAINT "service_agreement_items_sow_partial_id_fkey" FOREIGN KEY ("sow_partial_id") REFERENCES "template_partials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_agreement_item_entities" ADD CONSTRAINT "service_agreement_item_entities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreement_item_entities" ADD CONSTRAINT "service_agreement_item_entities_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "service_agreement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreement_item_entities" ADD CONSTRAINT "service_agreement_item_entities_agreement_entity_id_fkey" FOREIGN KEY ("agreement_entity_id") REFERENCES "service_agreement_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreement_fee_lines" ADD CONSTRAINT "service_agreement_fee_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreement_fee_lines" ADD CONSTRAINT "service_agreement_fee_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "service_agreement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_agreement_fee_lines" ADD CONSTRAINT "service_agreement_fee_lines_agreement_entity_id_fkey" FOREIGN KEY ("agreement_entity_id") REFERENCES "service_agreement_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
