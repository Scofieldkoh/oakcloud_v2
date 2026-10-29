CREATE TYPE "TaskEsigningPreparationStatus" AS ENUM (
  'WAITING',
  'QUEUED',
  'PROCESSING',
  'READY',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT'
);

ALTER TABLE "esigning_envelope_documents"
  ADD COLUMN "generated_document_id" TEXT;

CREATE TABLE "task_esigning_preparations" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "task_stage_id" TEXT NOT NULL,
  "source_task_stage_id" TEXT,
  "generated_document_id" TEXT,
  "esigning_envelope_id" TEXT,
  "envelope_document_id" TEXT,
  "initiated_by_id" TEXT,
  "status" "TaskEsigningPreparationStatus" NOT NULL DEFAULT 'WAITING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "task_esigning_preparations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "esigning_envelope_documents_envelopeId_generated_document_id_key"
  ON "esigning_envelope_documents"("envelopeId", "generated_document_id");
CREATE UNIQUE INDEX "task_esigning_preparations_task_stage_id_key"
  ON "task_esigning_preparations"("task_stage_id");
CREATE UNIQUE INDEX "task_esigning_preparations_envelope_document_id_key"
  ON "task_esigning_preparations"("envelope_document_id");
CREATE INDEX "task_esigning_preparations_tenant_id_status_available_at_idx"
  ON "task_esigning_preparations"("tenant_id", "status", "available_at");
CREATE INDEX "task_esigning_preparations_status_lease_expires_at_idx"
  ON "task_esigning_preparations"("status", "lease_expires_at");
CREATE INDEX "task_esigning_preparations_tenant_id_task_id_idx"
  ON "task_esigning_preparations"("tenant_id", "task_id");
CREATE INDEX "task_esigning_preparations_tenant_id_generated_document_id_idx"
  ON "task_esigning_preparations"("tenant_id", "generated_document_id");
CREATE INDEX "task_esigning_preparations_tenant_id_esigning_envelope_id_idx"
  ON "task_esigning_preparations"("tenant_id", "esigning_envelope_id");

ALTER TABLE "esigning_envelope_documents"
  ADD CONSTRAINT "esigning_envelope_documents_generated_document_id_fkey"
  FOREIGN KEY ("generated_document_id") REFERENCES "generated_documents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_esigning_preparations"
  ADD CONSTRAINT "task_esigning_preparations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_esigning_preparations"
  ADD CONSTRAINT "task_esigning_preparations_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_esigning_preparations"
  ADD CONSTRAINT "task_esigning_preparations_task_stage_id_fkey"
  FOREIGN KEY ("task_stage_id") REFERENCES "task_stages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_esigning_preparations"
  ADD CONSTRAINT "task_esigning_preparations_source_task_stage_id_fkey"
  FOREIGN KEY ("source_task_stage_id") REFERENCES "task_stages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_esigning_preparations"
  ADD CONSTRAINT "task_esigning_preparations_generated_document_id_fkey"
  FOREIGN KEY ("generated_document_id") REFERENCES "generated_documents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_esigning_preparations"
  ADD CONSTRAINT "task_esigning_preparations_esigning_envelope_id_fkey"
  FOREIGN KEY ("esigning_envelope_id") REFERENCES "esigning_envelopes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_esigning_preparations"
  ADD CONSTRAINT "task_esigning_preparations_envelope_document_id_fkey"
  FOREIGN KEY ("envelope_document_id") REFERENCES "esigning_envelope_documents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_esigning_preparations"
  ADD CONSTRAINT "task_esigning_preparations_initiated_by_id_fkey"
  FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
