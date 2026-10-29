ALTER TABLE "service_agreements"
  DROP CONSTRAINT IF EXISTS "service_agreements_authorized_contact_id_fkey";

ALTER TABLE "service_agreements"
  DROP COLUMN "authorized_contact_id",
  DROP COLUMN "authorized_representative_snapshot",
  ADD COLUMN "authorized_representative_snapshots" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "signer_contact_ids" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "service_agreements"
  ALTER COLUMN "authorized_representative_snapshots" DROP DEFAULT,
  ALTER COLUMN "signer_contact_ids" DROP DEFAULT;
