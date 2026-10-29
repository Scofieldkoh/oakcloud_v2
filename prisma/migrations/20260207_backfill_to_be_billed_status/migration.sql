-- Backfill completed, billable deadlines to "TO_BE_BILLED"
UPDATE "deadlines"
SET "billingStatus" = 'TO_BE_BILLED'
WHERE "status" = 'COMPLETED'
  AND ("billingStatus" IS NULL OR "billingStatus" = 'PENDING')
  AND (
    "overrideBillable" = TRUE
    OR ("overrideBillable" IS NULL AND "isBillable" = TRUE)
  )
  AND "deletedAt" IS NULL;