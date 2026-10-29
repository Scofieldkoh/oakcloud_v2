-- CreateEnum
CREATE TYPE "EsigningPostCompletionStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT');

-- CreateEnum
CREATE TYPE "EsigningEmailDeliveryKind" AS ENUM ('REQUEST', 'REMINDER', 'COMPLETION', 'DECLINED', 'PDF_FAILURE', 'EXPIRY_WARNING', 'EXPIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "EsigningEmailDeliveryAudience" AS ENUM ('RECIPIENT', 'SENDER');

-- CreateEnum
CREATE TYPE "EsigningEmailDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT');

-- Post-completion stage state on the envelope.
ALTER TABLE "esigning_envelopes"
  ADD COLUMN "autoFilingStatus" "EsigningPostCompletionStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "autoFilingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "autoFilingAvailableAt" TIMESTAMP(3),
  ADD COLUMN "autoFilingClaimedAt" TIMESTAMP(3),
  ADD COLUMN "autoFilingLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "autoFilingError" TEXT;

-- Envelopes without a company never need auto-filing.
UPDATE "esigning_envelopes"
SET "autoFilingStatus" = 'NOT_REQUIRED'
WHERE "companyId" IS NULL;

-- Company-linked completed envelopes are reconciled deterministically by document ID.
UPDATE "esigning_envelopes"
SET "autoFilingStatus" = 'PENDING',
    "autoFilingAvailableAt" = COALESCE("completedAt", CURRENT_TIMESTAMP)
WHERE "companyId" IS NOT NULL
  AND "status" = 'COMPLETED'
  AND "deletedAt" IS NULL;

-- CreateTable
CREATE TABLE "esigning_email_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "recipientId" TEXT,
    "audience" "EsigningEmailDeliveryAudience" NOT NULL,
    "kind" "EsigningEmailDeliveryKind" NOT NULL,
    "targetKey" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EsigningEmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "lastAttemptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esigning_email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esigning_email_delivery_attempts" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esigning_email_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- Backfill completion deliveries only for completed envelopes whose artifacts are
-- not yet complete; artifact-complete historical envelopes intentionally get no
-- rows so serialization reports NOT_TRACKED instead of resending a completion email.
INSERT INTO "esigning_email_deliveries" (
    "id", "tenantId", "envelopeId", "recipientId", "audience", "kind", "targetKey",
    "toEmail", "subject", "status", "attemptCount", "availableAt", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    env."tenantId",
    env."id",
    r."id",
    'RECIPIENT',
    'COMPLETION',
    'recipient:' || r."id",
    r."email",
    'Completed: ' || env."title",
    'PENDING',
    0,
    COALESCE(env."completedAt", CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "esigning_envelopes" env
JOIN "esigning_envelope_recipients" r ON r."envelopeId" = env."id"
WHERE env."status" = 'COMPLETED'
  AND env."pdfGenerationStatus" IS DISTINCT FROM 'COMPLETED'
  AND env."deletedAt" IS NULL
  AND r."accessMode" <> 'MANUAL_LINK';

INSERT INTO "esigning_email_deliveries" (
    "id", "tenantId", "envelopeId", "recipientId", "audience", "kind", "targetKey",
    "toEmail", "subject", "status", "attemptCount", "availableAt", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    env."tenantId",
    env."id",
    NULL,
    'SENDER',
    'COMPLETION',
    'sender:' || env."createdById",
    u."email",
    'Completed: ' || env."title",
    'PENDING',
    0,
    COALESCE(env."completedAt", CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "esigning_envelopes" env
JOIN "users" u ON u."id" = env."createdById"
WHERE env."status" = 'COMPLETED'
  AND env."pdfGenerationStatus" IS DISTINCT FROM 'COMPLETED'
  AND env."deletedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "esigning_email_deliveries_envelopeId_kind_targetKey_key"
  ON "esigning_email_deliveries"("envelopeId", "kind", "targetKey");
CREATE INDEX "esigning_email_deliveries_status_availableAt_idx"
  ON "esigning_email_deliveries"("status", "availableAt");
CREATE INDEX "esigning_email_deliveries_status_leaseExpiresAt_idx"
  ON "esigning_email_deliveries"("status", "leaseExpiresAt");
CREATE INDEX "esigning_email_deliveries_tenantId_envelopeId_idx"
  ON "esigning_email_deliveries"("tenantId", "envelopeId");
CREATE INDEX "esigning_email_delivery_attempts_deliveryId_attemptedAt_idx"
  ON "esigning_email_delivery_attempts"("deliveryId", "attemptedAt");
CREATE INDEX "esigning_envelopes_autoFilingStatus_autoFilingAvailableAt_idx"
  ON "esigning_envelopes"("autoFilingStatus", "autoFilingAvailableAt");

-- AddForeignKey
ALTER TABLE "esigning_email_deliveries"
  ADD CONSTRAINT "esigning_email_deliveries_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esigning_email_deliveries"
  ADD CONSTRAINT "esigning_email_deliveries_envelopeId_fkey"
  FOREIGN KEY ("envelopeId") REFERENCES "esigning_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esigning_email_deliveries"
  ADD CONSTRAINT "esigning_email_deliveries_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "esigning_envelope_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "esigning_email_delivery_attempts"
  ADD CONSTRAINT "esigning_email_delivery_attempts_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "esigning_email_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
