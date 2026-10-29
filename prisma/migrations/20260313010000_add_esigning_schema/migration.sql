-- CreateEnum
CREATE TYPE "EsigningEnvelopeStatus" AS ENUM ('DRAFT', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'VOIDED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EsigningSigningOrder" AS ENUM ('PARALLEL', 'SEQUENTIAL', 'MIXED');

-- CreateEnum
CREATE TYPE "EsigningPdfGenerationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EsigningRecipientType" AS ENUM ('SIGNER', 'CC');

-- CreateEnum
CREATE TYPE "EsigningRecipientStatus" AS ENUM ('QUEUED', 'NOTIFIED', 'VIEWED', 'SIGNED', 'DECLINED');

-- CreateEnum
CREATE TYPE "EsigningRecipientAccessMode" AS ENUM ('EMAIL_LINK', 'EMAIL_WITH_CODE', 'MANUAL_LINK');

-- CreateEnum
CREATE TYPE "EsigningFieldType" AS ENUM ('SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'NAME', 'TEXT', 'CHECKBOX', 'COMPANY', 'TITLE');

-- CreateEnum
CREATE TYPE "EsigningEnvelopeEventAction" AS ENUM ('CREATED', 'SENT', 'VIEWED', 'CONSENTED', 'SIGNED', 'DECLINED', 'VOIDED', 'CORRECTED', 'COMPLETED', 'REMINDER_SENT', 'EXPIRED', 'PDF_GENERATION_FAILED');

-- CreateTable
CREATE TABLE "esigning_envelopes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "status" "EsigningEnvelopeStatus" NOT NULL DEFAULT 'DRAFT',
    "signingOrder" "EsigningSigningOrder" NOT NULL DEFAULT 'PARALLEL',
    "expiresAt" TIMESTAMP(3),
    "reminderFrequencyDays" INTEGER,
    "reminderStartDays" INTEGER,
    "expiryWarningDays" INTEGER,
    "companyId" TEXT,
    "certificateId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "pdfGenerationStatus" "EsigningPdfGenerationStatus",
    "pdfGenerationAttempts" INTEGER NOT NULL DEFAULT 0,
    "pdfGenerationClaimedAt" TIMESTAMP(3),
    "pdfGenerationError" TEXT,
    "consentVersion" TEXT NOT NULL DEFAULT '1.0',
    "consentDisclosureSnapshot" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "esigning_envelopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esigning_envelope_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "signedStoragePath" TEXT,
    "originalHash" TEXT NOT NULL,
    "signedHash" TEXT,
    "pageCount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esigning_envelope_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esigning_envelope_recipients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "type" "EsigningRecipientType" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "signingOrder" INTEGER,
    "status" "EsigningRecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "accessMode" "EsigningRecipientAccessMode" NOT NULL DEFAULT 'EMAIL_LINK',
    "accessTokenHash" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "accessCodeHash" TEXT,
    "consentedAt" TIMESTAMP(3),
    "consentIp" TEXT,
    "consentUserAgent" TEXT,
    "signedAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "signedIp" TEXT,
    "signedUserAgent" TEXT,
    "lastReminderAt" TIMESTAMP(3),
    "colorTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esigning_envelope_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esigning_document_field_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "EsigningFieldType" NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "xPercent" DOUBLE PRECISION NOT NULL,
    "yPercent" DOUBLE PRECISION NOT NULL,
    "widthPercent" DOUBLE PRECISION NOT NULL,
    "heightPercent" DOUBLE PRECISION NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "placeholder" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esigning_document_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esigning_document_field_values" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fieldDefinitionId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "value" TEXT,
    "signatureStoragePath" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "filledAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esigning_document_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esigning_envelope_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "recipientId" TEXT,
    "action" "EsigningEnvelopeEventAction" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esigning_envelope_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "esigning_envelopes_certificateId_key" ON "esigning_envelopes"("certificateId");

-- CreateIndex
CREATE INDEX "esigning_envelopes_tenantId_status_createdAt_idx" ON "esigning_envelopes"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "esigning_envelopes_createdById_status_createdAt_idx" ON "esigning_envelopes"("createdById", "status", "createdAt");

-- CreateIndex
CREATE INDEX "esigning_envelopes_companyId_idx" ON "esigning_envelopes"("companyId");

-- CreateIndex
CREATE INDEX "esigning_envelopes_tenantId_deletedAt_idx" ON "esigning_envelopes"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "esigning_envelope_documents_envelopeId_sortOrder_idx" ON "esigning_envelope_documents"("envelopeId", "sortOrder");

-- CreateIndex
CREATE INDEX "esigning_envelope_documents_tenantId_envelopeId_idx" ON "esigning_envelope_documents"("tenantId", "envelopeId");

-- CreateIndex
CREATE INDEX "esigning_envelope_recipients_envelopeId_signingOrder_idx" ON "esigning_envelope_recipients"("envelopeId", "signingOrder");

-- CreateIndex
CREATE INDEX "esigning_envelope_recipients_tenantId_envelopeId_idx" ON "esigning_envelope_recipients"("tenantId", "envelopeId");

-- CreateIndex
CREATE INDEX "esigning_envelope_recipients_envelopeId_status_idx" ON "esigning_envelope_recipients"("envelopeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "esigning_envelope_recipients_envelopeId_email_type_key" ON "esigning_envelope_recipients"("envelopeId", "email", "type");

-- CreateIndex
CREATE INDEX "esigning_document_field_definitions_envelopeId_recipientId_idx" ON "esigning_document_field_definitions"("envelopeId", "recipientId");

-- CreateIndex
CREATE INDEX "esigning_document_field_definitions_documentId_pageNumber_idx" ON "esigning_document_field_definitions"("documentId", "pageNumber");

-- CreateIndex
CREATE INDEX "esigning_document_field_definitions_recipientId_sortOrder_idx" ON "esigning_document_field_definitions"("recipientId", "sortOrder");

-- CreateIndex
CREATE INDEX "esigning_document_field_values_recipientId_finalizedAt_idx" ON "esigning_document_field_values"("recipientId", "finalizedAt");

-- CreateIndex
CREATE INDEX "esigning_document_field_values_tenantId_recipientId_idx" ON "esigning_document_field_values"("tenantId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "esigning_document_field_values_fieldDefinitionId_recipientI_key" ON "esigning_document_field_values"("fieldDefinitionId", "recipientId");

-- CreateIndex
CREATE INDEX "esigning_envelope_events_envelopeId_createdAt_idx" ON "esigning_envelope_events"("envelopeId", "createdAt");

-- CreateIndex
CREATE INDEX "esigning_envelope_events_recipientId_idx" ON "esigning_envelope_events"("recipientId");

-- CreateIndex
CREATE INDEX "esigning_envelope_events_tenantId_envelopeId_idx" ON "esigning_envelope_events"("tenantId", "envelopeId");

-- AddForeignKey
ALTER TABLE "esigning_envelopes" ADD CONSTRAINT "esigning_envelopes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_envelopes" ADD CONSTRAINT "esigning_envelopes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_envelopes" ADD CONSTRAINT "esigning_envelopes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_envelope_documents" ADD CONSTRAINT "esigning_envelope_documents_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "esigning_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_envelope_recipients" ADD CONSTRAINT "esigning_envelope_recipients_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "esigning_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_document_field_definitions" ADD CONSTRAINT "esigning_document_field_definitions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "esigning_envelope_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_document_field_definitions" ADD CONSTRAINT "esigning_document_field_definitions_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "esigning_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_document_field_definitions" ADD CONSTRAINT "esigning_document_field_definitions_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "esigning_envelope_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_document_field_values" ADD CONSTRAINT "esigning_document_field_values_fieldDefinitionId_fkey" FOREIGN KEY ("fieldDefinitionId") REFERENCES "esigning_document_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_document_field_values" ADD CONSTRAINT "esigning_document_field_values_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "esigning_envelope_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_envelope_events" ADD CONSTRAINT "esigning_envelope_events_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "esigning_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esigning_envelope_events" ADD CONSTRAINT "esigning_envelope_events_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "esigning_envelope_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
