CREATE TABLE "task_company_recovery_contexts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "task_stage_id" TEXT NOT NULL,
    "return_to" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_company_recovery_contexts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_company_recovery_contexts_tenant_id_task_stage_id_company_id_key"
ON "task_company_recovery_contexts"("tenant_id", "task_stage_id", "company_id");

CREATE INDEX "task_company_recovery_contexts_tenant_id_company_id_idx"
ON "task_company_recovery_contexts"("tenant_id", "company_id");

CREATE INDEX "task_company_recovery_contexts_tenant_id_task_stage_id_idx"
ON "task_company_recovery_contexts"("tenant_id", "task_stage_id");

ALTER TABLE "task_company_recovery_contexts"
ADD CONSTRAINT "task_company_recovery_contexts_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_company_recovery_contexts"
ADD CONSTRAINT "task_company_recovery_contexts_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_company_recovery_contexts"
ADD CONSTRAINT "task_company_recovery_contexts_task_stage_id_fkey"
FOREIGN KEY ("task_stage_id") REFERENCES "task_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
