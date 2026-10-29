-- CreateTable
CREATE TABLE "form_drafts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "access_token_hash" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "metadata" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_drafts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "form_uploads" ADD COLUMN "draft_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "form_drafts_code_key" ON "form_drafts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "form_drafts_access_token_hash_key" ON "form_drafts"("access_token_hash");

-- CreateIndex
CREATE INDEX "form_drafts_form_id_expires_at_idx" ON "form_drafts"("form_id", "expires_at");

-- CreateIndex
CREATE INDEX "form_drafts_tenant_id_expires_at_idx" ON "form_drafts"("tenant_id", "expires_at");

-- CreateIndex
CREATE INDEX "form_drafts_last_saved_at_idx" ON "form_drafts"("last_saved_at");

-- CreateIndex
CREATE INDEX "form_uploads_draft_id_idx" ON "form_uploads"("draft_id");

-- AddForeignKey
ALTER TABLE "form_drafts" ADD CONSTRAINT "form_drafts_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_drafts" ADD CONSTRAINT "form_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_uploads" ADD CONSTRAINT "form_uploads_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "form_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
