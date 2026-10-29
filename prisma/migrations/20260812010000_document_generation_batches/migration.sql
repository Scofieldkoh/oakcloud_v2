-- Multi-template document generation batches
CREATE TYPE "DocumentGenerationBatchStatus" AS ENUM ('DRAFT', 'PARTIAL', 'COMPLETED');

CREATE TYPE "DocumentGenerationBatchItemStatus" AS ENUM (
  'NOT_STARTED',
  'NEEDS_INPUT',
  'READY',
  'GENERATING',
  'GENERATED',
  'FAILED',
  'BLOCKED'
);

CREATE TABLE "document_generation_batches" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "primary_company_id" TEXT,
  "created_by_id" TEXT NOT NULL,
  "active_item_id" TEXT,
  "current_stage" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "status" "DocumentGenerationBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "master_field_values" JSONB NOT NULL DEFAULT '{}',
  "task_context" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "document_generation_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_generation_batch_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "generated_document_id" TEXT NOT NULL,
  "template_version" INTEGER NOT NULL,
  "display_order" INTEGER NOT NULL,
  "status" "DocumentGenerationBatchItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "configuration" JSONB NOT NULL DEFAULT '{}',
  "preview_content" TEXT,
  "edited_content" TEXT,
  "edited_content_json" JSONB,
  "preview_fingerprint" VARCHAR(64),
  "reviewed_fingerprint" VARCHAR(64),
  "validation_diagnostics" JSONB,
  "last_error" JSONB,
  "generation_attempt_id" VARCHAR(36),
  "generation_claimed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "document_generation_batch_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_generation_batches_tenant_status_updated_idx"
  ON "document_generation_batches" ("tenant_id", "status", "updated_at");

CREATE INDEX "document_generation_batches_tenant_company_idx"
  ON "document_generation_batches" ("tenant_id", "primary_company_id");

CREATE INDEX "document_generation_batches_tenant_deleted_idx"
  ON "document_generation_batches" ("tenant_id", "deleted_at");

CREATE INDEX "document_generation_batch_items_tenant_batch_order_idx"
  ON "document_generation_batch_items" ("tenant_id", "batch_id", "display_order");

CREATE INDEX "document_generation_batch_items_tenant_status_claim_idx"
  ON "document_generation_batch_items" ("tenant_id", "status", "generation_claimed_at");

CREATE UNIQUE INDEX "document_generation_batch_items_batch_template_key"
  ON "document_generation_batch_items" ("batch_id", "template_id");

CREATE UNIQUE INDEX "document_generation_batch_items_batch_order_key"
  ON "document_generation_batch_items" ("batch_id", "display_order");

CREATE UNIQUE INDEX "document_generation_batch_items_generated_document_id_key"
  ON "document_generation_batch_items" ("generated_document_id");

ALTER TABLE "document_generation_batches"
  ADD CONSTRAINT "document_generation_batches_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_generation_batches"
  ADD CONSTRAINT "document_generation_batches_primary_company_id_fkey"
  FOREIGN KEY ("primary_company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_generation_batches"
  ADD CONSTRAINT "document_generation_batches_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_generation_batch_items"
  ADD CONSTRAINT "document_generation_batch_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_generation_batch_items"
  ADD CONSTRAINT "document_generation_batch_items_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "document_generation_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_generation_batch_items"
  ADD CONSTRAINT "document_generation_batch_items_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "document_templates" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_generation_batch_items"
  ADD CONSTRAINT "document_generation_batch_items_generated_document_id_fkey"
  FOREIGN KEY ("generated_document_id") REFERENCES "generated_documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_generation_batches"
  ADD CONSTRAINT "document_generation_batches_active_item_id_fkey"
  FOREIGN KEY ("active_item_id") REFERENCES "document_generation_batch_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
