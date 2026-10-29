-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'DROPDOWN', 'FILE_UPLOAD', 'SIGNATURE', 'PARAGRAPH', 'HTML', 'PAGE_BREAK', 'HIDDEN');

-- CreateEnum
CREATE TYPE "FormSubmissionStatus" AS ENUM ('COMPLETED', 'PARTIAL', 'SPAM');

-- CreateTable
CREATE TABLE "forms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "settings" JSONB,
    "views_count" INTEGER NOT NULL DEFAULT 0,
    "submissions_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "FormFieldType" NOT NULL,
    "label" TEXT,
    "field_key" TEXT NOT NULL,
    "placeholder" TEXT,
    "subtext" TEXT,
    "help_text" TEXT,
    "input_type" TEXT,
    "options" JSONB,
    "validation" JSONB,
    "condition" JSONB,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "hide_label" BOOLEAN NOT NULL DEFAULT false,
    "is_read_only" BOOLEAN NOT NULL DEFAULT false,
    "layout_width" INTEGER NOT NULL DEFAULT 100,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" "FormSubmissionStatus" NOT NULL DEFAULT 'COMPLETED',
    "respondent_name" TEXT,
    "respondent_email" TEXT,
    "answers" JSONB NOT NULL,
    "metadata" JSONB,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_uploads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "field_id" TEXT,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forms_slug_key" ON "forms"("slug");

-- CreateIndex
CREATE INDEX "forms_tenant_id_status_deleted_at_idx" ON "forms"("tenant_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "forms_tenant_id_created_at_idx" ON "forms"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "forms_slug_idx" ON "forms"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_form_id_field_key_key" ON "form_fields"("form_id", "field_key");

-- CreateIndex
CREATE INDEX "form_fields_form_id_position_idx" ON "form_fields"("form_id", "position");

-- CreateIndex
CREATE INDEX "form_fields_tenant_id_form_id_idx" ON "form_fields"("tenant_id", "form_id");

-- CreateIndex
CREATE INDEX "form_submissions_form_id_submitted_at_idx" ON "form_submissions"("form_id", "submitted_at");

-- CreateIndex
CREATE INDEX "form_submissions_tenant_id_submitted_at_idx" ON "form_submissions"("tenant_id", "submitted_at");

-- CreateIndex
CREATE INDEX "form_uploads_form_id_created_at_idx" ON "form_uploads"("form_id", "created_at");

-- CreateIndex
CREATE INDEX "form_uploads_submission_id_idx" ON "form_uploads"("submission_id");

-- CreateIndex
CREATE INDEX "form_uploads_tenant_id_form_id_idx" ON "form_uploads"("tenant_id", "form_id");

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_uploads" ADD CONSTRAINT "form_uploads_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_uploads" ADD CONSTRAINT "form_uploads_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "form_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_uploads" ADD CONSTRAINT "form_uploads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
