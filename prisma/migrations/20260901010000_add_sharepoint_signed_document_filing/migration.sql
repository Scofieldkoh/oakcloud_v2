-- SharePoint company mappings, template route snapshots, and per-document filing ledger.
-- This migration intentionally does not backfill existing mappings or envelopes.

ALTER TABLE "document_templates"
  ADD COLUMN "sharepoint_relative_folder_path" TEXT;

ALTER TABLE "generated_documents"
  ADD COLUMN "sharepoint_relative_folder_path_snapshot" TEXT;

CREATE TYPE "EsigningSharePointFilingStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
  'REVIEW_REQUIRED'
);

CREATE TYPE "EsigningSharePointDestinationKind" AS ENUM ('INTENDED', 'ORPHAN');

CREATE TYPE "EsigningSharePointRoutingReason" AS ENUM (
  'TEMPLATE_ROUTE',
  'NO_COMPANY_MAPPING',
  'NO_TEMPLATE_PATH',
  'MANUAL_DOCUMENT',
  'COMPANY_FOLDER_UNAVAILABLE',
  'DESTINATION_PATH_INVALID'
);

CREATE TABLE "company_sharepoint_folders" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "connector_id" TEXT NOT NULL,
  "drive_id" TEXT NOT NULL,
  "folder_item_id" TEXT NOT NULL,
  "folder_name" TEXT NOT NULL,
  "folder_web_url" TEXT NOT NULL,
  "last_verified_at" TIMESTAMP(3),
  "verified_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "company_sharepoint_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "esigning_sharepoint_filings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "envelope_id" TEXT NOT NULL,
  "envelope_document_id" TEXT NOT NULL,
  "company_id" TEXT,
  "connector_id" TEXT NOT NULL,
  "destination_kind" "EsigningSharePointDestinationKind" NOT NULL,
  "routing_reason" "EsigningSharePointRoutingReason" NOT NULL,
  "template_id" TEXT,
  "template_version" INTEGER,
  "config_version" INTEGER NOT NULL,
  "company_name_snapshot" TEXT,
  "document_title_snapshot" TEXT NOT NULL,
  "intended_company_drive_id" TEXT,
  "intended_company_folder_id" TEXT,
  "intended_relative_path" TEXT,
  "orphan_drive_id" TEXT NOT NULL,
  "orphan_folder_item_id" TEXT NOT NULL,
  "resolved_destination_drive_id" TEXT,
  "resolved_destination_id" TEXT,
  "source_signed_hash" TEXT,
  "source_size" INTEGER,
  "target_file_name" TEXT,
  "uploaded_drive_id" TEXT,
  "uploaded_item_id" TEXT,
  "uploaded_web_url" TEXT,
  "uploaded_file_name" TEXT,
  "status" "EsigningSharePointFilingStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "claim_token" VARCHAR(36),
  "last_error_code" VARCHAR(100),
  "last_error" VARCHAR(2000),
  "filed_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "resolved_by_id" TEXT,
  "resolution_note" VARCHAR(2000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "esigning_sharepoint_filings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_sharepoint_folders_company_id_key"
  ON "company_sharepoint_folders"("company_id");
CREATE UNIQUE INDEX "company_sharepoint_folders_tenant_id_connector_id_drive_id_folder_item_id_key"
  ON "company_sharepoint_folders"("tenant_id", "connector_id", "drive_id", "folder_item_id");
CREATE INDEX "company_sharepoint_folders_tenant_id_company_id_idx"
  ON "company_sharepoint_folders"("tenant_id", "company_id");
CREATE INDEX "company_sharepoint_folders_connector_id_drive_id_folder_item_id_idx"
  ON "company_sharepoint_folders"("connector_id", "drive_id", "folder_item_id");

CREATE UNIQUE INDEX "esigning_sharepoint_filings_envelope_document_id_key"
  ON "esigning_sharepoint_filings"("envelope_document_id");
CREATE UNIQUE INDEX "esigning_sharepoint_filings_connector_destination_name_key"
  ON "esigning_sharepoint_filings"("connector_id", "resolved_destination_drive_id", "resolved_destination_id", "target_file_name");
CREATE UNIQUE INDEX "esigning_sharepoint_filings_connector_uploaded_item_key"
  ON "esigning_sharepoint_filings"("connector_id", "uploaded_drive_id", "uploaded_item_id");
CREATE INDEX "esigning_sharepoint_filings_status_available_at_idx"
  ON "esigning_sharepoint_filings"("status", "available_at");
CREATE INDEX "esigning_sharepoint_filings_tenant_id_destination_kind_status_idx"
  ON "esigning_sharepoint_filings"("tenant_id", "destination_kind", "status");
CREATE INDEX "esigning_sharepoint_filings_envelope_id_idx"
  ON "esigning_sharepoint_filings"("envelope_id");
CREATE INDEX "esigning_sharepoint_filings_tenant_id_status_available_at_idx"
  ON "esigning_sharepoint_filings"("tenant_id", "status", "available_at");

ALTER TABLE "company_sharepoint_folders"
  ADD CONSTRAINT "company_sharepoint_folders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "company_sharepoint_folders_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "company_sharepoint_folders_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "company_sharepoint_folders_verified_by_id_fkey"
  FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "esigning_sharepoint_filings"
  ADD CONSTRAINT "esigning_sharepoint_filings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "esigning_sharepoint_filings_envelope_id_fkey"
  FOREIGN KEY ("envelope_id") REFERENCES "esigning_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "esigning_sharepoint_filings_envelope_document_id_fkey"
  FOREIGN KEY ("envelope_document_id") REFERENCES "esigning_envelope_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "esigning_sharepoint_filings_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "esigning_sharepoint_filings_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "esigning_sharepoint_filings_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "esigning_sharepoint_filings_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
