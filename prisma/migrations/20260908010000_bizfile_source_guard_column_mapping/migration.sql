-- Document retains camelCase database columns except for explicitly mapped
-- fields. Replace the earlier trigger body so real document writes use the
-- actual schema, while preserving monotonic source revision semantics.
CREATE OR REPLACE FUNCTION "oakcloud_documents_source_revision_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."source_revision" := OLD."source_revision";
  IF OLD."storage_key" IS DISTINCT FROM NEW."storage_key"
    OR OLD."version" IS DISTINCT FROM NEW."version"
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
