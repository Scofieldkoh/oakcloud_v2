-- A correction reuses the immutable retained BizFile bytes. After canonical
-- approval the document may therefore already point at the deterministic
-- hash-addressed destination used by STORAGE_FINALIZE. The effect executor
-- still treats finalization as a source transition and PAGE_PREPARATION is
-- bound to source_revision + 1. Preserve that contract without making every
-- same-value source update advance the revision.
--
-- The general source guard continues to advance only for factual source-state
-- changes. Storage-key assignments are handled by a dedicated UPDATE OF
-- trigger so a same-pointer assignment can be recognized only while the exact
-- receipt-bound STORAGE_FINALIZE effect is actively PROCESSING.

CREATE OR REPLACE FUNCTION "oakcloud_documents_source_revision_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Never trust a caller supplied source_revision. A factual source change
  -- derives the next revision from the locked OLD row.
  NEW."source_revision" := OLD."source_revision";

  IF OLD."version" IS DISTINCT FROM NEW."version"
    OR OLD."extractedData" IS DISTINCT FROM NEW."extractedData"
    OR OLD."extractionStatus" IS DISTINCT FROM NEW."extractionStatus"
    OR OLD."extractionError" IS DISTINCT FROM NEW."extractionError"
    OR OLD."fileSize" IS DISTINCT FROM NEW."fileSize"
    OR OLD."mimeType" IS DISTINCT FROM NEW."mimeType"
    OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at" THEN
    NEW."source_revision" := COALESCE(OLD."source_revision", 0) + 1;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "oakcloud_documents_storage_revision_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  logical_finalize BOOLEAN := FALSE;
  old_revision INTEGER := COALESCE(OLD."source_revision", 0);
BEGIN
  IF OLD."storage_key" IS DISTINCT FROM NEW."storage_key" THEN
    -- If another source-field trigger already advanced this statement, keep a
    -- single monotonic increment rather than double-counting the transition.
    NEW."source_revision" := GREATEST(COALESCE(NEW."source_revision", old_revision), old_revision + 1);
    RETURN NEW;
  END IF;

  -- A same-value storage assignment is normally a no-op. It becomes a logical
  -- finalization transition only when the current document is bound to a live,
  -- claimed STORAGE_FINALIZE intent whose immutable payload names this exact
  -- document, pointer and source revision. Concurrent/unrelated metadata writes
  -- do not satisfy this receipt/effect fence.
  SELECT EXISTS (
    SELECT 1
    FROM "bizfile_operation_effect_intents" effect
    JOIN "bizfile_operation_receipts" receipt
      ON receipt."tenant_id" = effect."tenant_id"
      AND receipt."id" = effect."receipt_id"
    WHERE effect."tenant_id" = NEW."tenantId"
      AND effect."effect_kind" = 'STORAGE_FINALIZE'
      AND effect."state" = 'PROCESSING'
      AND effect."claim_token" IS NOT NULL
      AND effect."lease_expires_at" IS NOT NULL
      AND effect."lease_expires_at" > CURRENT_TIMESTAMP
      AND effect."target" = ('document:' || NEW."id")
      AND effect."payload"->>'documentId' = NEW."id"
      AND effect."payload"->>'storageKey' = OLD."storage_key"
      AND effect."payload"->>'sourceRevision' = old_revision::TEXT
      AND receipt."status" = 'COMMITTED'
      AND receipt."document_id" = NEW."id"
  ) INTO logical_finalize;

  IF logical_finalize THEN
    NEW."source_revision" := GREATEST(COALESCE(NEW."source_revision", old_revision), old_revision + 1);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "oakcloud_documents_zz_storage_revision_guard_trigger" ON "documents";
CREATE TRIGGER "oakcloud_documents_zz_storage_revision_guard_trigger"
BEFORE UPDATE OF "storage_key" ON "documents"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_documents_storage_revision_guard"();
