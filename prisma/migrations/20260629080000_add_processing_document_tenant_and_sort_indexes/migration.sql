-- Migration: add_processing_document_tenant_and_sort_indexes
-- Adds tenantId to processing_documents for direct index scans (eliminates FK chain JOIN for tenant filters)
-- Adds composite index on share_capital(companyId, effectiveDate) for ORDER BY coverage

-- Step 1: Add tenant_id column to processing_documents (plain string, no FK — consistent with DocumentTag/VendorAlias pattern)
ALTER TABLE "processing_documents" ADD COLUMN "tenant_id" TEXT;

-- Step 2: Backfill tenant_id from the documents table
UPDATE "processing_documents" pd
SET "tenant_id" = d."tenantId"
FROM "documents" d
WHERE pd."document_id" = d."id";

-- Step 3: Make tenant_id NOT NULL now that it's populated
ALTER TABLE "processing_documents" ALTER COLUMN "tenant_id" SET NOT NULL;

-- Step 4: Add indexes on processing_documents
CREATE INDEX "processing_documents_tenant_id_idx" ON "processing_documents"("tenant_id");
CREATE INDEX "processing_documents_tenant_id_pipeline_status_idx" ON "processing_documents"("tenant_id", "pipeline_status");

-- Step 5: Add sort-covering index on share_capital
CREATE INDEX "share_capital_company_id_effective_date_idx" ON "share_capital"("companyId", "effectiveDate" DESC);

-- Step 6: Refresh planner statistics on hot tables
ANALYZE "processing_documents";
ANALYZE "documents";
ANALYZE "document_pages";
ANALYZE "company_officers";
ANALYZE "company_shareholders";
ANALYZE "share_capital";
ANALYZE "company_charges";
ANALYZE "company_addresses";
ANALYZE "users";
