-- Align DeadlineStatus enum to internal workflow statuses
BEGIN;
CREATE TYPE "DeadlineStatus_new" AS ENUM (
  'PENDING',
  'PENDING_CLIENT',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'COMPLETED',
  'CANCELLED',
  'WAIVED'
);

ALTER TABLE "deadlines" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "deadlines" ALTER COLUMN "status" TYPE "DeadlineStatus_new"
USING (
  CASE "status"::text
    WHEN 'UPCOMING' THEN 'PENDING'
    WHEN 'DUE_SOON' THEN 'PENDING'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    WHEN 'WAIVED' THEN 'WAIVED'
    WHEN 'PENDING' THEN 'PENDING'
    WHEN 'PENDING_CLIENT' THEN 'PENDING_CLIENT'
    WHEN 'PENDING_REVIEW' THEN 'PENDING_REVIEW'
    ELSE 'PENDING'
  END
)::"DeadlineStatus_new";

ALTER TYPE "DeadlineStatus" RENAME TO "DeadlineStatus_old";
ALTER TYPE "DeadlineStatus_new" RENAME TO "DeadlineStatus";
DROP TYPE "DeadlineStatus_old";
ALTER TABLE "deadlines" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- Add internal notes for team comments
ALTER TABLE "deadlines" ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;

-- Remove unused contract service billing fields
ALTER TABLE "contract_services"
  DROP COLUMN IF EXISTS "autoRenewal",
  DROP COLUMN IF EXISTS "nextBillingDate",
  DROP COLUMN IF EXISTS "renewalPeriodMonths";