-- FORM-DATA-003: Add soft delete support to form_submissions

ALTER TABLE "form_submissions" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Partial index: only index non-deleted rows for common list queries
CREATE INDEX "idx_form_submissions_deleted_at" ON "form_submissions"("deleted_at") WHERE "deleted_at" IS NULL;
