-- Business Assistant foundation and canonical BizFile operation ledger.
-- Additive only: dispatch and mutation flags remain disabled until release gates pass.

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "aggregate_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "source_revision" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "BusinessAssistantConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');
CREATE TYPE "BusinessAssistantMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "BusinessAssistantMessageType" AS ENUM ('INPUT', 'ANSWER', 'CLARIFICATION', 'PROPOSAL', 'RESULT', 'ERROR');
CREATE TYPE "BusinessAssistantMessageStatus" AS ENUM ('ACCEPTED', 'PROCESSING', 'PROCESSED', 'FAILED');
CREATE TYPE "BusinessAssistantRunStatus" AS ENUM ('DRAFT', 'PREPARING', 'WAITING_CONFIRMATION', 'READY', 'RUNNING', 'REVIEWING', 'RECOVERING', 'CANCEL_REQUESTED', 'COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'FAILED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "BusinessAssistantItemState" AS ENUM ('PENDING', 'PREPARING', 'BLOCKED', 'WAITING_CONFIRMATION', 'READY', 'EXECUTING', 'RECOVERING', 'READING_BACK', 'REVIEWING', 'SUCCEEDED', 'PASSED', 'PASSED_WITH_WARNINGS', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "BusinessAssistantExecutionOutcome" AS ENUM ('NOT_STARTED', 'SUCCEEDED_READ', 'COMMITTED', 'NO_CHANGE', 'FAILED_NO_COMMIT', 'OUTCOME_UNKNOWN');
CREATE TYPE "BusinessAssistantReviewOutcome" AS ENUM ('NOT_REQUIRED', 'NOT_STARTED', 'RUNNING', 'PASS', 'PASS_WITH_WARNINGS', 'NEEDS_REVIEW', 'REVIEW_FAILED', 'NOT_RUN');
CREATE TYPE "BusinessAssistantEffectStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'COMPLETE', 'FAILED');
CREATE TYPE "BusinessAssistantStage" AS ENUM ('CLASSIFICATION', 'PREPARATION', 'EXECUTION', 'EFFECTS', 'READ_BACK', 'REVIEW');
CREATE TYPE "BusinessAssistantAttemptStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'SKIPPED');
CREATE TYPE "BusinessAssistantProposalStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'EXPIRED', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "BusinessAssistantApprovalDecision" AS ENUM ('APPROVED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED');
CREATE TYPE "BusinessAssistantReviewVerdict" AS ENUM ('PASS', 'PASS_WITH_WARNINGS', 'NEEDS_REVIEW', 'REVIEW_FAILED');
CREATE TYPE "BusinessAssistantConformance" AS ENUM ('PASS', 'FAIL', 'UNVERIFIABLE');
CREATE TYPE "BusinessAssistantSourceAlignment" AS ENUM ('NO_UNEXPLAINED_DIFFERENCE', 'DIFFERENCES_PRESENT', 'INCOMPLETE');
CREATE TYPE "BusinessAssistantFeedbackTarget" AS ENUM ('MESSAGE', 'RUN', 'ITEM', 'PROPOSAL', 'REVIEW', 'MEMORY');
CREATE TYPE "BusinessAssistantFeedbackEvent" AS ENUM ('OUTCOME', 'SENTIMENT', 'REVIEW_FINDING', 'CORRECTNESS');
CREATE TYPE "BusinessAssistantAdjudicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "BusinessAssistantMemoryScope" AS ENUM ('SESSION', 'USER', 'TENANT');
CREATE TYPE "BusinessAssistantMemoryRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "BusinessAssistantMemoryState" AS ENUM ('CANDIDATE', 'ACTIVE', 'REJECTED', 'DEACTIVATED', 'SUPERSEDED', 'EXPIRED', 'DELETED');
CREATE TYPE "BusinessAssistantLearningTarget" AS ENUM ('PREFERENCE', 'PROMPT_PROFILE');
CREATE TYPE "BusinessAssistantLearningState" AS ENUM ('CANDIDATE', 'EVALUATING', 'EVALUATED', 'APPROVED', 'PROMOTED', 'ROLLED_BACK', 'REJECTED');
CREATE TYPE "BusinessAssistantActionKind" AS ENUM ('REVISE', 'CONFIRM', 'CANCEL', 'RETRY', 'ARCHIVE_CONVERSATION', 'DELETE_CONVERSATION', 'MEMORY_CONFIRM', 'MEMORY_REVISE', 'MEMORY_DEACTIVATE', 'MEMORY_DELETE', 'LEARNING_EVALUATE', 'LEARNING_APPROVE', 'LEARNING_PROMOTE', 'LEARNING_ROLLBACK', 'LEARNING_REJECT');
CREATE TYPE "BusinessAssistantActionStatus" AS ENUM ('ACCEPTED', 'APPLIED', 'REJECTED');

CREATE TABLE "business_assistant_conversations" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "title" VARCHAR(200),
  "status" "BusinessAssistantConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "deleted_at" TIMESTAMP(3),
  "deleted_reason" VARCHAR(300),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ba_conversations_tenant_id_id_key" ON "business_assistant_conversations" ("tenant_id", "id");
CREATE INDEX "ba_conversations_owner_updated_idx" ON "business_assistant_conversations" ("tenant_id", "owner_id", "updated_at");
CREATE INDEX "ba_conversations_deleted_idx" ON "business_assistant_conversations" ("tenant_id", "deleted_at");

CREATE TABLE "business_assistant_messages" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "role" "BusinessAssistantMessageRole" NOT NULL,
  "type" "BusinessAssistantMessageType" NOT NULL,
  "status" "BusinessAssistantMessageStatus" NOT NULL DEFAULT 'ACCEPTED',
  "content" VARCHAR(12000),
  "payload" JSONB,
  "resources" JSONB,
  "operation_kind" VARCHAR(40) NOT NULL DEFAULT 'TURN',
  "client_request_id" VARCHAR(200),
  "body_hash" VARCHAR(128),
  "claim_token" VARCHAR(128),
  "claim_generation" INTEGER,
  "lease_expires_at" TIMESTAMP(3),
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_assistant_messages_conversation_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "business_assistant_conversations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ba_messages_conversation_sequence_key" ON "business_assistant_messages" ("tenant_id", "conversation_id", "sequence");
CREATE UNIQUE INDEX "ba_messages_request_key" ON "business_assistant_messages" ("tenant_id", "owner_id", "operation_kind", "client_request_id");
CREATE INDEX "ba_messages_status_available_idx" ON "business_assistant_messages" ("tenant_id", "status", "available_at");
CREATE INDEX "ba_messages_conversation_created_idx" ON "business_assistant_messages" ("tenant_id", "conversation_id", "created_at");

CREATE TABLE "business_assistant_runs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "conversation_tenant_id" TEXT,
  "owner_id" TEXT NOT NULL,
  "capability_id" VARCHAR(200) NOT NULL,
  "capability_version" VARCHAR(40) NOT NULL,
  "contract_version" VARCHAR(40) NOT NULL,
  "schema_version" VARCHAR(40) NOT NULL,
  "input" JSONB NOT NULL,
  "resources" JSONB NOT NULL,
  "status" "BusinessAssistantRunStatus" NOT NULL DEFAULT 'DRAFT',
  "active_proposal_id" TEXT,
  "cancellation_requested_at" TIMESTAMP(3),
  "cancellation_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "business_assistant_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_assistant_runs_conversation_fkey" FOREIGN KEY ("conversation_tenant_id", "conversation_id") REFERENCES "business_assistant_conversations"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ba_runs_tenant_id_id_key" ON "business_assistant_runs" ("tenant_id", "id");
CREATE INDEX "ba_runs_owner_updated_idx" ON "business_assistant_runs" ("tenant_id", "owner_id", "updated_at");
CREATE INDEX "ba_runs_status_updated_idx" ON "business_assistant_runs" ("tenant_id", "status", "updated_at");

CREATE TABLE "business_assistant_run_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "item_key" VARCHAR(200) NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "input" JSONB NOT NULL,
  "resources" JSONB NOT NULL,
  "lifecycle_state" "BusinessAssistantItemState" NOT NULL DEFAULT 'PENDING',
  "execution_outcome" "BusinessAssistantExecutionOutcome" NOT NULL DEFAULT 'NOT_STARTED',
  "review_outcome" "BusinessAssistantReviewOutcome" NOT NULL DEFAULT 'NOT_REQUIRED',
  "required_effect_status" "BusinessAssistantEffectStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "disposition_reason" VARCHAR(100),
  "operation_id" VARCHAR(200),
  "receipt_ref" JSONB,
  "output" JSONB,
  "active_stage" "BusinessAssistantStage",
  "active_attempt" INTEGER,
  "claim_token" VARCHAR(128),
  "claim_generation" INTEGER,
  "lease_expires_at" TIMESTAMP(3),
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_run_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_run_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_assistant_run_items_run_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "business_assistant_runs"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ba_run_items_run_item_key" ON "business_assistant_run_items" ("tenant_id", "run_id", "item_key");
CREATE UNIQUE INDEX "ba_run_items_tenant_id_id_key" ON "business_assistant_run_items" ("tenant_id", "id");
CREATE INDEX "ba_run_items_state_available_idx" ON "business_assistant_run_items" ("tenant_id", "lifecycle_state", "available_at");
CREATE INDEX "ba_run_items_run_ordinal_idx" ON "business_assistant_run_items" ("tenant_id", "run_id", "ordinal");
CREATE INDEX "ba_run_items_claim_idx" ON "business_assistant_run_items" ("tenant_id", "claim_token", "claim_generation");

CREATE TABLE "business_assistant_run_steps" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "run_item_id" TEXT NOT NULL,
  "stage" "BusinessAssistantStage" NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" "BusinessAssistantAttemptStatus" NOT NULL DEFAULT 'RUNNING',
  "input_artifact" JSONB,
  "output_artifact" JSONB,
  "error" JSONB,
  "provider_ref" VARCHAR(200),
  "claim_token" VARCHAR(128),
  "claim_generation" INTEGER,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "next_retry_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_run_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_run_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_assistant_run_steps_item_fkey" FOREIGN KEY ("tenant_id", "run_item_id") REFERENCES "business_assistant_run_items"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ba_run_steps_attempt_key" ON "business_assistant_run_steps" ("tenant_id", "run_item_id", "stage", "attempt_number");
CREATE INDEX "ba_run_steps_stage_status_idx" ON "business_assistant_run_steps" ("tenant_id", "stage", "status", "next_retry_at");
CREATE INDEX "ba_run_steps_item_started_idx" ON "business_assistant_run_steps" ("tenant_id", "run_item_id", "started_at");

CREATE TABLE "business_assistant_proposals" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "BusinessAssistantProposalStatus" NOT NULL DEFAULT 'ACTIVE',
  "prepared_artifact" JSONB NOT NULL,
  "prepared_hash" VARCHAR(128) NOT NULL,
  "eligible_items" JSONB NOT NULL,
  "effect_manifest" JSONB,
  "policy_version" VARCHAR(40) NOT NULL,
  "serializer_version" VARCHAR(40) NOT NULL,
  "schema_version" VARCHAR(40) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_assistant_proposals_run_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "business_assistant_runs"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ba_proposals_run_revision_key" ON "business_assistant_proposals" ("tenant_id", "run_id", "revision");
CREATE UNIQUE INDEX "ba_proposals_tenant_id_id_key" ON "business_assistant_proposals" ("tenant_id", "id");
CREATE INDEX "ba_proposals_run_status_idx" ON "business_assistant_proposals" ("tenant_id", "run_id", "status");
CREATE INDEX "ba_proposals_expiry_idx" ON "business_assistant_proposals" ("tenant_id", "expires_at");

CREATE TABLE "business_assistant_approvals" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "selected_items" JSONB NOT NULL,
  "selected_bindings" JSONB NOT NULL,
  "decision" "BusinessAssistantApprovalDecision" NOT NULL DEFAULT 'APPROVED',
  "policy_version" VARCHAR(40) NOT NULL,
  "approver_id" TEXT NOT NULL,
  "action_key" VARCHAR(200) NOT NULL,
  "action_body_hash" VARCHAR(128) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_assistant_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_assistant_approvals_run_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "business_assistant_runs"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_assistant_approvals_proposal_fkey" FOREIGN KEY ("tenant_id", "proposal_id") REFERENCES "business_assistant_proposals"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ba_approvals_action_key" ON "business_assistant_approvals" ("tenant_id", "action_key");
CREATE UNIQUE INDEX "ba_approvals_tenant_id_id_key" ON "business_assistant_approvals" ("tenant_id", "id");
CREATE INDEX "ba_approvals_run_revision_idx" ON "business_assistant_approvals" ("tenant_id", "run_id", "revision");
CREATE INDEX "ba_approvals_expiry_idx" ON "business_assistant_approvals" ("tenant_id", "expires_at");

CREATE TABLE "business_assistant_reviews" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "run_item_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "verdict" "BusinessAssistantReviewVerdict" NOT NULL,
  "execution_conformance" "BusinessAssistantConformance" NOT NULL,
  "source_alignment" "BusinessAssistantSourceAlignment" NOT NULL,
  "evidence" JSONB NOT NULL,
  "findings" JSONB NOT NULL,
  "coverage" JSONB NOT NULL,
  "schema_version" VARCHAR(40) NOT NULL,
  "prompt_version" VARCHAR(80) NOT NULL,
  "provider_version" VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_assistant_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_assistant_reviews_item_fkey" FOREIGN KEY ("tenant_id", "run_item_id") REFERENCES "business_assistant_run_items"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ba_reviews_item_attempt_key" ON "business_assistant_reviews" ("tenant_id", "run_item_id", "attempt_number");
CREATE INDEX "ba_reviews_verdict_created_idx" ON "business_assistant_reviews" ("tenant_id", "verdict", "created_at");

CREATE TABLE "business_assistant_feedback" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "target_type" "BusinessAssistantFeedbackTarget" NOT NULL,
  "target_id" VARCHAR(200) NOT NULL,
  "event_type" "BusinessAssistantFeedbackEvent" NOT NULL,
  "comment" VARCHAR(2000),
  "body_hash" VARCHAR(128) NOT NULL,
  "provenance" JSONB,
  "adjudication" "BusinessAssistantAdjudicationStatus" NOT NULL DEFAULT 'PENDING',
  "client_event_id" VARCHAR(200),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ba_feedback_client_event_key" ON "business_assistant_feedback" ("tenant_id", "owner_id", "client_event_id");
CREATE INDEX "ba_feedback_owner_created_idx" ON "business_assistant_feedback" ("tenant_id", "owner_id", "created_at");
CREATE INDEX "ba_feedback_target_idx" ON "business_assistant_feedback" ("tenant_id", "target_type", "target_id");

CREATE TABLE "business_assistant_memories" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "scope" "BusinessAssistantMemoryScope" NOT NULL,
  "conversation_id" TEXT,
  "capability_id" VARCHAR(200),
  "capability_version" VARCHAR(40),
  "key" VARCHAR(100) NOT NULL,
  "value" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  "evidence_count" INTEGER NOT NULL DEFAULT 0,
  "risk" "BusinessAssistantMemoryRisk" NOT NULL DEFAULT 'LOW',
  "state" "BusinessAssistantMemoryState" NOT NULL DEFAULT 'CANDIDATE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "effective_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "supersedes_id" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_memories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_memories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ba_memories_version_key" ON "business_assistant_memories" ("tenant_id", "owner_id", "scope", "conversation_id", "key", "version");
CREATE INDEX "ba_memories_owner_state_expiry_idx" ON "business_assistant_memories" ("tenant_id", "owner_id", "state", "expires_at");
CREATE INDEX "ba_memories_capability_idx" ON "business_assistant_memories" ("tenant_id", "owner_id", "capability_id", "capability_version");

CREATE TABLE "business_assistant_learning_changes" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "target_key" VARCHAR(200) NOT NULL,
  "target_kind" "BusinessAssistantLearningTarget" NOT NULL,
  "risk" "BusinessAssistantMemoryRisk" NOT NULL,
  "baseline_version" VARCHAR(100) NOT NULL,
  "candidate_version" VARCHAR(100) NOT NULL,
  "candidate_value" JSONB,
  "evidence" JSONB NOT NULL,
  "evaluation" JSONB,
  "state" "BusinessAssistantLearningState" NOT NULL DEFAULT 'CANDIDATE',
  "expected_version" INTEGER NOT NULL DEFAULT 1,
  "approved_by_id" TEXT,
  "approved_at" TIMESTAMP(3),
  "promoted_at" TIMESTAMP(3),
  "rollback_target" VARCHAR(100),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_learning_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_learning_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ba_learning_target_candidate_key" ON "business_assistant_learning_changes" ("tenant_id", "target_key", "candidate_version");
CREATE INDEX "ba_learning_owner_state_created_idx" ON "business_assistant_learning_changes" ("tenant_id", "owner_id", "state", "created_at");
CREATE INDEX "ba_learning_target_version_idx" ON "business_assistant_learning_changes" ("tenant_id", "target_key", "expected_version");

CREATE TABLE "business_assistant_learning_targets" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "target_key" VARCHAR(200) NOT NULL,
  "active_version" VARCHAR(100) NOT NULL,
  "active_value" JSONB,
  "previous_version" VARCHAR(100),
  "previous_value" JSONB,
  "active_change_id" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_learning_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_learning_targets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ba_learning_target_active_key" ON "business_assistant_learning_targets" ("tenant_id", "target_key");
CREATE INDEX "ba_learning_target_active_version_idx" ON "business_assistant_learning_targets" ("tenant_id", "active_version");

CREATE TABLE "business_assistant_action_requests" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "run_id" TEXT,
  "action_kind" "BusinessAssistantActionKind" NOT NULL,
  "client_request_id" VARCHAR(200) NOT NULL,
  "body_hash" VARCHAR(128) NOT NULL,
  "response" JSONB,
  "status" "BusinessAssistantActionStatus" NOT NULL DEFAULT 'ACCEPTED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_action_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_assistant_action_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ba_action_requests_dedupe_key" ON "business_assistant_action_requests" ("tenant_id", "owner_id", "action_kind", "client_request_id");
CREATE INDEX "ba_action_requests_owner_created_idx" ON "business_assistant_action_requests" ("tenant_id", "owner_id", "created_at");

CREATE TABLE "business_assistant_capacity_slots" (
  "id" TEXT NOT NULL,
  "slot_key" VARCHAR(100) NOT NULL,
  "claim_token" VARCHAR(128),
  "claim_generation" INTEGER NOT NULL DEFAULT 0,
  "tenant_id" TEXT,
  "user_id" TEXT,
  "run_item_id" TEXT,
  "stage" "BusinessAssistantStage",
  "lease_expires_at" TIMESTAMP(3),
  "heartbeat_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_assistant_capacity_slots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "business_assistant_capacity_slots_slot_key_key" ON "business_assistant_capacity_slots" ("slot_key");
CREATE INDEX "business_assistant_capacity_slots_lease_idx" ON "business_assistant_capacity_slots" ("lease_expires_at");
CREATE INDEX "business_assistant_capacity_slots_owner_idx" ON "business_assistant_capacity_slots" ("tenant_id", "user_id");

CREATE TYPE "BizFileOperationMode" AS ENUM ('CREATE', 'UPDATE');
CREATE TYPE "BizFileOperationStatus" AS ENUM ('COMMITTED', 'NO_COMMIT', 'UNKNOWN');
CREATE TYPE "BizFileOperationEffectStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'COMPLETE', 'FAILED');
CREATE TYPE "BizFileOperationEvidenceKind" AS ENUM ('BEFORE', 'AFTER', 'SOURCE', 'READBACK');
CREATE TYPE "BizFileOperationEffectState" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED_RETRYABLE', 'FAILED_PERMANENT');

CREATE TABLE "bizfile_operation_receipts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "operation_id" VARCHAR(200) NOT NULL,
  "capability_id" VARCHAR(200) NOT NULL,
  "capability_version" VARCHAR(40) NOT NULL,
  "schema_version" VARCHAR(40) NOT NULL,
  "mode" "BizFileOperationMode" NOT NULL,
  "company_id" TEXT,
  "document_id" TEXT,
  "payload_hash" VARCHAR(128) NOT NULL,
  "expected_aggregate_revision" INTEGER NOT NULL,
  "before_revision" INTEGER,
  "after_revision" INTEGER,
  "status" "BizFileOperationStatus" NOT NULL,
  "effect_status" "BizFileOperationEffectStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "safe_error" JSONB,
  "committed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bizfile_operation_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bizfile_operation_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "bizfile_operation_receipts_operation_key" ON "bizfile_operation_receipts" ("tenant_id", "operation_id");
CREATE UNIQUE INDEX "bizfile_operation_receipts_tenant_id_id_key" ON "bizfile_operation_receipts" ("tenant_id", "id");
CREATE INDEX "bizfile_operation_receipts_company_idx" ON "bizfile_operation_receipts" ("tenant_id", "company_id");
CREATE INDEX "bizfile_operation_receipts_document_idx" ON "bizfile_operation_receipts" ("tenant_id", "document_id");
CREATE INDEX "bizfile_operation_receipts_status_idx" ON "bizfile_operation_receipts" ("tenant_id", "status", "effect_status");

CREATE TABLE "bizfile_operation_evidence" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "receipt_id" TEXT NOT NULL,
  "kind" "BizFileOperationEvidenceKind" NOT NULL,
  "artifact" JSONB NOT NULL,
  "artifact_hash" VARCHAR(128) NOT NULL,
  "source_ref" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bizfile_operation_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bizfile_operation_evidence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "bizfile_operation_evidence_receipt_fkey" FOREIGN KEY ("tenant_id", "receipt_id") REFERENCES "bizfile_operation_receipts"("tenant_id", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "bizfile_operation_evidence_kind_key" ON "bizfile_operation_evidence" ("tenant_id", "receipt_id", "kind");
CREATE INDEX "bizfile_operation_evidence_receipt_idx" ON "bizfile_operation_evidence" ("tenant_id", "receipt_id", "created_at");

CREATE TABLE "bizfile_operation_effect_intents" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "receipt_id" TEXT NOT NULL,
  "effect_kind" VARCHAR(100) NOT NULL,
  "target" VARCHAR(500) NOT NULL,
  "payload" JSONB,
  "payload_hash" VARCHAR(128),
  "state" "BizFileOperationEffectState" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3),
  "last_error" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bizfile_operation_effect_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bizfile_operation_effect_intents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "bizfile_operation_effect_intents_receipt_fkey" FOREIGN KEY ("tenant_id", "receipt_id") REFERENCES "bizfile_operation_receipts"("tenant_id", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "bizfile_operation_effect_target_key" ON "bizfile_operation_effect_intents" ("tenant_id", "receipt_id", "effect_kind", "target");
CREATE INDEX "bizfile_operation_effect_state_idx" ON "bizfile_operation_effect_intents" ("tenant_id", "state", "next_attempt_at");
CREATE INDEX "bizfile_operation_effect_receipt_idx" ON "bizfile_operation_effect_intents" ("tenant_id", "receipt_id");
