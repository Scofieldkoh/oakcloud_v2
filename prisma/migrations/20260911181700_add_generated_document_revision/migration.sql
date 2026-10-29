-- W1 / C07: GeneratedDocument editor concurrency revision.
-- Additive only; existing rows are backfilled to revision 0 by the default.
ALTER TABLE "generated_documents"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
