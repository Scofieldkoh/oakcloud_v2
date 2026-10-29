-- Durable, fenced ownership for the BizFile required-effect outbox.
-- Storage and PDF work is performed after this short claim transaction; the
-- token/generation/lease predicates fence a delayed worker during settlement.

ALTER TABLE "bizfile_operation_effect_intents"
  ADD COLUMN IF NOT EXISTS "claim_token" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "claim_generation" INTEGER,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "bizfile_operation_effect_claim_idx"
  ON "bizfile_operation_effect_intents" ("tenant_id", "state", "lease_expires_at");
