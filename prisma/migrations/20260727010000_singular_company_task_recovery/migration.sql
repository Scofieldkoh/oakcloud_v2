DELETE FROM "task_company_recovery_contexts" AS older
USING "task_company_recovery_contexts" AS newer
WHERE older."tenant_id" = newer."tenant_id"
  AND older."task_stage_id" = newer."task_stage_id"
  AND (
    older."updated_at" < newer."updated_at"
    OR (
      older."updated_at" = newer."updated_at"
      AND older."id" < newer."id"
    )
  );

DROP INDEX "task_company_recovery_contexts_tenant_id_task_stage_id_company_id_key";

CREATE UNIQUE INDEX "task_company_recovery_contexts_tenant_id_task_stage_id_key"
ON "task_company_recovery_contexts"("tenant_id", "task_stage_id");

ALTER TABLE "task_company_recovery_contexts"
ADD CONSTRAINT "task_company_recovery_contexts_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
