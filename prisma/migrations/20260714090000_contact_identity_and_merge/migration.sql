-- Enable trigram matching for canonical contact names.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add nullable identity fields for a staged rollout and backfill.
ALTER TABLE "contacts" ADD COLUMN "canonicalName" TEXT;
ALTER TABLE "document_revisions" ADD COLUMN "counterparty_identity" JSONB;

-- Add merge to the audit action vocabulary.
ALTER TYPE "AuditAction" ADD VALUE 'MERGE';

-- Persist dismissed duplicate pairs together with the fingerprints that were reviewed.
CREATE TABLE "contact_duplicate_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leftContactId" TEXT NOT NULL,
    "rightContactId" TEXT NOT NULL,
    "leftFingerprint" TEXT NOT NULL,
    "rightFingerprint" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_duplicate_decisions_pkey" PRIMARY KEY ("id")
);

-- Record immutable merge inputs, decisions, and effects for reversal and audit.
CREATE TABLE "contact_merge_operations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "masterContactId" TEXT NOT NULL,
    "masterSnapshot" JSONB NOT NULL,
    "sourceContactIds" TEXT[] NOT NULL,
    "sourceSnapshots" JSONB NOT NULL,
    "fingerprints" JSONB NOT NULL,
    "fieldDecisions" JSONB NOT NULL,
    "movedRecordCounts" JSONB NOT NULL,
    "matchingReasons" JSONB NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_merge_operations_pkey" PRIMARY KEY ("id")
);

-- Reject mutation of recorded merge operations while allowing new ledger entries.
CREATE FUNCTION "prevent_contact_merge_operation_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'contact_merge_operations is append-only';
END;
$$;

CREATE TRIGGER "contact_merge_operations_append_only"
BEFORE UPDATE OR DELETE ON "contact_merge_operations"
FOR EACH ROW
EXECUTE FUNCTION "prevent_contact_merge_operation_mutation"();

-- Exact-match lookup for active contacts within a tenant and contact type.
CREATE INDEX "contacts_tenantId_contactType_deletedAt_canonicalName_idx"
    ON "contacts"("tenantId", "contactType", "deletedAt", "canonicalName");

-- Fuzzy lookup only needs indexed entries for active contacts with a canonical name.
CREATE INDEX "contacts_canonicalName_active_trgm_idx"
    ON "contacts" USING GIN ("canonicalName" gin_trgm_ops)
    WHERE "deletedAt" IS NULL AND "canonicalName" IS NOT NULL;

CREATE UNIQUE INDEX "contact_duplicate_decisions_tenantId_leftContactId_rightContactId_key"
    ON "contact_duplicate_decisions"("tenantId", "leftContactId", "rightContactId");

CREATE INDEX "contact_duplicate_decisions_tenantId_updatedAt_idx"
    ON "contact_duplicate_decisions"("tenantId", "updatedAt");

CREATE UNIQUE INDEX "contact_merge_operations_tenantId_idempotencyKey_key"
    ON "contact_merge_operations"("tenantId", "idempotencyKey");

CREATE INDEX "contact_merge_operations_tenantId_approvedAt_idx"
    ON "contact_merge_operations"("tenantId", "approvedAt");

CREATE INDEX "contact_merge_operations_masterContactId_idx"
    ON "contact_merge_operations"("masterContactId");
