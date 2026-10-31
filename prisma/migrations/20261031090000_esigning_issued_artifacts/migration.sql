-- OAK-008 / OAK-021: immutable, versioned record of every issued e-signing PDF.
-- Additive only: one enum, one nullable column, one new table, plus a data backfill.
-- Nothing existing is altered or dropped, so it is safe to apply online.
-- Rollback (only if no app version that writes these rows has run): see the DROP statements at the end.

-- CreateEnum
CREATE TYPE "EsigningIssuedArtifactKind" AS ENUM ('SIGNED_DOCUMENT', 'CERTIFICATE', 'DOCUMENT_WITH_CERTIFICATE');

-- AlterTable
ALTER TABLE "esigning_envelopes" ADD COLUMN     "currentArtifactVersion" INTEGER;

-- CreateTable
CREATE TABLE "esigning_issued_artifacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "documentId" TEXT,
    "version" INTEGER NOT NULL,
    "kind" "EsigningIssuedArtifactKind" NOT NULL,
    "storagePath" TEXT NOT NULL,
    "blake3" TEXT NOT NULL,
    "byteSize" INTEGER,
    "rendererVersion" INTEGER NOT NULL,
    "sourceDigests" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esigning_issued_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "esigning_issued_artifacts_envelopeId_idx" ON "esigning_issued_artifacts"("envelopeId");

-- CreateIndex
CREATE INDEX "esigning_issued_artifacts_blake3_idx" ON "esigning_issued_artifacts"("blake3");

-- One row per (envelope, version, kind, document). The certificate has no document, so a plain
-- unique constraint would allow duplicates (NULLs are distinct); COALESCE makes them collide.
-- Prisma cannot express an expression index, so it exists only here.
CREATE UNIQUE INDEX "esigning_issued_artifacts_version_kind_document_key"
  ON "esigning_issued_artifacts"("envelopeId", "version", "kind", COALESCE("documentId", ''));

-- AddForeignKey
ALTER TABLE "esigning_issued_artifacts" ADD CONSTRAINT "esigning_issued_artifacts_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "esigning_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_issued_artifacts" ADD CONSTRAINT "esigning_issued_artifacts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "esigning_envelope_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every envelope whose signed PDFs were already generated becomes version 1, document
-- only. The files stay where they are (storagePath records the legacy key) and the hash is the
-- signedHash the old code stored. Certificate and document+certificate rows are added by the app on
-- first delivery (it hashes the stored certificate and merges once). Such rows carry
-- "backfilled": true so the verify page can say that copies emailed before this release were never
-- fingerprinted. Envelopes with any unsigned document (a failed or partial run) are left alone and
-- are generated normally on demand.
INSERT INTO "esigning_issued_artifacts" (
  "id", "tenantId", "envelopeId", "documentId", "version", "kind", "storagePath", "blake3",
  "byteSize", "rendererVersion", "sourceDigests"
)
SELECT
  gen_random_uuid()::text,
  d."tenantId",
  d."envelopeId",
  d."id",
  1,
  'SIGNED_DOCUMENT',
  d."signedStoragePath",
  d."signedHash",
  NULL,
  CASE WHEN e."metadata"->>'artifactVersion' ~ '^[0-9]{1,9}$' THEN (e."metadata"->>'artifactVersion')::int ELSE 0 END,
  jsonb_build_object(
    'backfilled', true,
    'origin', 'migration',
    'originalHashes', (
      SELECT jsonb_object_agg(d2."id", d2."originalHash")
      FROM "esigning_envelope_documents" d2
      WHERE d2."envelopeId" = e."id"
    )
  )
FROM "esigning_envelope_documents" d
JOIN "esigning_envelopes" e ON e."id" = d."envelopeId"
WHERE e."status" = 'COMPLETED'
  AND e."pdfGenerationStatus" = 'COMPLETED'
  AND NOT EXISTS (
    SELECT 1 FROM "esigning_envelope_documents" u
    WHERE u."envelopeId" = e."id" AND (u."signedStoragePath" IS NULL OR u."signedHash" IS NULL)
  )
  AND NOT EXISTS (
    SELECT 1 FROM "esigning_issued_artifacts" a WHERE a."envelopeId" = e."id"
  );

UPDATE "esigning_envelopes" e
SET "currentArtifactVersion" = 1
WHERE EXISTS (
  SELECT 1 FROM "esigning_issued_artifacts" a
  WHERE a."envelopeId" = e."id" AND a."version" = 1 AND a."kind" = 'SIGNED_DOCUMENT'
);

-- Rollback, only before any version-2 or certificate row matters (it discards the issued fingerprints):
--   ALTER TABLE "esigning_envelopes" DROP COLUMN "currentArtifactVersion";
--   DROP TABLE "esigning_issued_artifacts";
--   DROP TYPE "EsigningIssuedArtifactKind";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261031090000_esigning_issued_artifacts';
