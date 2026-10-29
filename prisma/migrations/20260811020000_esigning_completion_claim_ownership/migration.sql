-- Claim ownership tokens for post-completion workers.
-- Existing PROCESSING rows are intentionally not backfilled: they are reclaimed
-- only after their lease expires, at which point they receive a fresh token.
ALTER TABLE "esigning_envelopes"
  ADD COLUMN "autoFilingClaimToken" VARCHAR(36);

ALTER TABLE "esigning_email_deliveries"
  ADD COLUMN "claimToken" VARCHAR(36);
