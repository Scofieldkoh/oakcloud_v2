ALTER TABLE "generated_documents"
  ADD COLUMN "signed_at" TIMESTAMP(3);

UPDATE "generated_documents" AS document
SET "signed_at" = completed_envelope."completed_at"
FROM (
  SELECT
    envelope_document."generated_document_id",
    MIN(envelope."completedAt") AS "completed_at"
  FROM "esigning_envelope_documents" AS envelope_document
  INNER JOIN "esigning_envelopes" AS envelope
    ON envelope."id" = envelope_document."envelopeId"
  WHERE envelope_document."generated_document_id" IS NOT NULL
    AND envelope."status" = 'COMPLETED'
    AND envelope."completedAt" IS NOT NULL
  GROUP BY envelope_document."generated_document_id"
) AS completed_envelope
WHERE document."id" = completed_envelope."generated_document_id";

CREATE INDEX "generated_documents_tenant_id_signed_at_idx"
  ON "generated_documents"("tenant_id", "signed_at");
