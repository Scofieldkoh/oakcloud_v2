-- OAK-008 / OAK-021 rework: the combined package that "Download all" serves for an envelope with
-- several documents is now stored and fingerprinted like every other issued file, so the public
-- check recognises it. Additive only: two enum values, no table or data changes.
-- Rollback: enum values cannot be dropped in place. If no app version that writes these kinds has run,
-- nothing uses them and they can stay; otherwise delete the rows first
--   (DELETE FROM "esigning_issued_artifacts" WHERE "kind" IN ('PACKAGE_DOCUMENTS', 'PACKAGE_DOCUMENTS_WITH_CERTIFICATE'))
-- and restore a backup, or recreate the type, rather than treating this as a lossless rollback.

-- AlterEnum
ALTER TYPE "EsigningIssuedArtifactKind" ADD VALUE 'PACKAGE_DOCUMENTS';
ALTER TYPE "EsigningIssuedArtifactKind" ADD VALUE 'PACKAGE_DOCUMENTS_WITH_CERTIFICATE';
