-- Keep prepared BizFile proposals bound to the source artifact and extraction
-- that was reviewed. The source_revision column is server maintained: a
-- caller cannot rewind it by including a stale value in an UPDATE.

CREATE OR REPLACE FUNCTION "oakcloud_documents_source_revision_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Never trust a client supplied source_revision value. A source update
  -- below derives the next value from the locked OLD row instead.
  NEW."source_revision" := OLD."source_revision";

  IF OLD."storage_key" IS DISTINCT FROM NEW."storage_key"
    OR OLD."version" IS DISTINCT FROM NEW."version"
    OR OLD."extracted_data" IS DISTINCT FROM NEW."extracted_data"
    OR OLD."extraction_status" IS DISTINCT FROM NEW."extraction_status"
    OR OLD."extraction_error" IS DISTINCT FROM NEW."extraction_error"
    OR OLD."file_size" IS DISTINCT FROM NEW."file_size"
    OR OLD."mime_type" IS DISTINCT FROM NEW."mime_type"
    OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at" THEN
    NEW."source_revision" := COALESCE(OLD."source_revision", 0) + 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "oakcloud_documents_source_revision_guard_trigger" ON "documents";
CREATE TRIGGER "oakcloud_documents_source_revision_guard_trigger"
BEFORE UPDATE ON "documents"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_documents_source_revision_guard"();
