ALTER TABLE "task_company_recovery_contexts"
DROP CONSTRAINT "task_company_recovery_contexts_company_id_fkey";

ALTER TABLE "task_company_recovery_contexts"
ALTER COLUMN "company_id" DROP NOT NULL;

ALTER TABLE "task_company_recovery_contexts"
ADD CONSTRAINT "task_company_recovery_contexts_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
