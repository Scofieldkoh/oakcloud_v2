-- Remove the Shared Documents module and its public share-link data model.

ALTER TABLE "document_comments" DROP CONSTRAINT IF EXISTS "document_comments_share_id_fkey";
DROP INDEX IF EXISTS "document_comments_share_id_idx";
ALTER TABLE "document_comments" DROP COLUMN IF EXISTS "share_id";

DROP TABLE IF EXISTS "document_shares";

ALTER TABLE "document_templates" DROP COLUMN IF EXISTS "default_share_expiry_hours";
ALTER TABLE "generated_documents" DROP COLUMN IF EXISTS "share_expiry_hours";

DO $$
BEGIN
  IF to_regclass('public.workflow_artifacts') IS NOT NULL THEN
    ALTER TABLE "workflow_artifacts" DROP CONSTRAINT IF EXISTS "workflow_artifacts_source_document_share_id_fkey";
    DROP INDEX IF EXISTS "workflow_artifacts_source_document_share_id_idx";
    UPDATE "workflow_artifacts"
    SET "source_type" = 'INLINE'
    WHERE "source_type" = 'DOCUMENT_SHARE';
    ALTER TABLE "workflow_artifacts" DROP COLUMN IF EXISTS "source_document_share_id";

    ALTER TABLE "workflow_artifacts" ALTER COLUMN "source_type" DROP DEFAULT;
    CREATE TYPE "WorkflowArtifactSourceType_new" AS ENUM (
      'INLINE',
      'DOCUMENT',
      'PROCESSING_DOCUMENT',
      'GENERATED_DOCUMENT'
    );
    ALTER TABLE "workflow_artifacts"
      ALTER COLUMN "source_type" TYPE "WorkflowArtifactSourceType_new"
      USING "source_type"::text::"WorkflowArtifactSourceType_new";
    ALTER TYPE "WorkflowArtifactSourceType" RENAME TO "WorkflowArtifactSourceType_old";
    ALTER TYPE "WorkflowArtifactSourceType_new" RENAME TO "WorkflowArtifactSourceType";
    DROP TYPE "WorkflowArtifactSourceType_old";
    ALTER TABLE "workflow_artifacts" ALTER COLUMN "source_type" SET DEFAULT 'INLINE';
  END IF;
END
$$;
