-- Partials are grouped as agreement, resolution or other in pickers.
CREATE TYPE "TemplatePartialCategory" AS ENUM ('AGREEMENT', 'RESOLUTION', 'OTHER');
ALTER TABLE "template_partials"
  ADD COLUMN "category" "TemplatePartialCategory" NOT NULL DEFAULT 'OTHER';
-- Partials already used as a service's scope of work are agreement partials.
UPDATE "template_partials" SET "category" = 'AGREEMENT'
WHERE "id" IN (SELECT "sow_partial_id" FROM "service_variants");

-- A batch may hold the same template more than once.
DROP INDEX IF EXISTS "document_generation_batch_items_batch_template_key";
CREATE INDEX "document_generation_batch_items_batch_template_idx"
  ON "document_generation_batch_items" ("batch_id", "template_id");
