ALTER TABLE "esigning_envelopes"
ADD COLUMN "emailSubject" TEXT;

UPDATE "esigning_envelopes"
SET "emailSubject" = "title"
WHERE "emailSubject" IS NULL;

ALTER TABLE "esigning_envelope_recipients"
ALTER COLUMN "accessMode" SET DEFAULT 'MANUAL_LINK';
