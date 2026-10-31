-- OAK-008 / OAK-021 rework 2: a unique claim identity for issued-artifact generation, separate from the
-- lease time in "pdfGenerationClaimedAt". Every claim writes a fresh random value; publication and
-- failure updates only apply while the envelope still carries exactly that value, so a delayed or
-- expired worker can never be mistaken for the current claimant (timestamps can repeat).
-- Additive and nullable: existing rows have no claim. Rollback: DROP COLUMN is safe, it holds only
-- transient in-flight claim identities.

-- AlterTable
ALTER TABLE "esigning_envelopes" ADD COLUMN "pdfGenerationClaimId" VARCHAR(36);
