-- Migration: add_form_contact_connector_esigning_indexes
-- Adds composite indexes for slow queries on form, contact, connector, esigning, and generated_document tables

-- FormSubmission: cover WHERE form_id + tenant_id queries
CREATE INDEX "form_submissions_form_id_tenant_id_submitted_at_idx"
  ON "form_submissions"("form_id", "tenant_id", "submitted_at");

-- FormDraft: cover WHERE form_id + tenant_id COUNT/SELECT
CREATE INDEX "form_drafts_form_id_tenant_id_expires_at_idx"
  ON "form_drafts"("form_id", "tenant_id", "expires_at");

-- Contact: cover vendor/customer resolution scans (tenantId + contactType + isActive)
CREATE INDEX "contacts_tenant_id_contact_type_is_active_idx"
  ON "contacts"("tenantId", "contactType", "isActive");

-- Connector: cover sort on (workspaceId, type, name)
CREATE INDEX "connectors_workspace_type_enabled_deleted_idx"
  ON "connectors"("workspaceId", "type", "isEnabled", "deletedAt");

-- ContactDetail: cover detailType-filtered lookups within tenant
CREATE INDEX "contact_details_tenant_id_detail_type_deleted_at_idx"
  ON "contact_details"("tenantId", "detailType", "deletedAt");

-- EsigningEnvelope: fix full-table scans in background jobs
CREATE INDEX "esigning_envelopes_status_expires_at_idx"
  ON "esigning_envelopes"("status", "expiresAt");
CREATE INDEX "esigning_envelopes_tenant_id_status_expires_at_idx"
  ON "esigning_envelopes"("tenantId", "status", "expiresAt");
CREATE INDEX "esigning_envelopes_status_updated_at_idx"
  ON "esigning_envelopes"("status", "updatedAt");
CREATE INDEX "esigning_envelopes_tenant_id_status_updated_at_idx"
  ON "esigning_envelopes"("tenantId", "status", "updatedAt");

-- GeneratedDocument: cover status-based list and background processing queries
CREATE INDEX "generated_documents_status_created_at_idx"
  ON "generated_documents"("status", "created_at");
CREATE INDEX "generated_documents_tenant_id_status_updated_at_idx"
  ON "generated_documents"("tenant_id", "status", "updated_at");
CREATE INDEX "generated_documents_finalized_at_idx"
  ON "generated_documents"("finalized_at");

-- EsigningEnvelopeRecipient: cover cross-envelope status queries
CREATE INDEX "esigning_envelope_recipients_tenant_id_status_idx"
  ON "esigning_envelope_recipients"("tenantId", "status");
CREATE INDEX "esigning_envelope_recipients_status_idx"
  ON "esigning_envelope_recipients"("status");

-- Refresh planner statistics on all affected tables
ANALYZE "form_submissions";
ANALYZE "form_drafts";
ANALYZE "contacts";
ANALYZE "connectors";
ANALYZE "contact_details";
ANALYZE "esigning_envelopes";
ANALYZE "esigning_envelope_recipients";
ANALYZE "esigning_envelope_documents";
ANALYZE "generated_documents";
ANALYZE "forms";
