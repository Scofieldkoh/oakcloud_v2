-- Add TO_BE_BILLED to billing status enum
ALTER TYPE "DeadlineBillingStatus" ADD VALUE IF NOT EXISTS 'TO_BE_BILLED';
