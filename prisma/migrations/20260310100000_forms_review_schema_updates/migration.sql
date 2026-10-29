-- FORM-DB-001: Add aiReviewStatus column with index for AI queue queries
-- FORM-DATA-001: Add updatedAt column to FormSubmission
-- FORM-DB-002: Add composite index on FormUpload(formId, submissionId)

-- Add aiReviewStatus column to form_submissions
ALTER TABLE "form_submissions" ADD COLUMN "ai_review_status" TEXT;

-- Add index for AI review status queries (covers queue processor scan)
CREATE INDEX "idx_form_submissions_ai_review_status" ON "form_submissions"("ai_review_status");

-- Add updatedAt column to form_submissions (Prisma @updatedAt)
ALTER TABLE "form_submissions" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add composite index on form_uploads(formId, submissionId) for faster join queries
CREATE INDEX "form_uploads_form_id_submission_id_idx" ON "form_uploads"("form_id", "submission_id");

-- FORM-PERF-002: Add hasUnresolvedAiWarning column for efficient dashboard warning queries
ALTER TABLE "form_submissions" ADD COLUMN "has_unresolved_ai_warning" BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for warning dashboard queries (tenant + unresolved filter)
CREATE INDEX "idx_form_submissions_unresolved_warning" ON "form_submissions"("tenant_id", "has_unresolved_ai_warning");
