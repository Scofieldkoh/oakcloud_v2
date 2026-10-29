ALTER TABLE "esigning_envelope_documents"
ADD COLUMN "originalFileName" TEXT;

UPDATE "esigning_envelope_documents"
SET "originalFileName" = "fileName"
WHERE "originalFileName" IS NULL;
