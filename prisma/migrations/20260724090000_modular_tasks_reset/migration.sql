-- This is an intentional destructive reset of the retired Workflow/Projects module.
DROP TABLE IF EXISTS "workflow_artifacts" CASCADE;
DROP TABLE IF EXISTS "workflow_billing_states" CASCADE;
DROP TABLE IF EXISTS "workflow_blockers" CASCADE;
DROP TABLE IF EXISTS "workflow_client_group_members" CASCADE;
DROP TABLE IF EXISTS "workflow_client_groups" CASCADE;
DROP TABLE IF EXISTS "workflow_communication_log_entries" CASCADE;
DROP TABLE IF EXISTS "workflow_cross_dependencies" CASCADE;
DROP TABLE IF EXISTS "workflow_deviations" CASCADE;
DROP TABLE IF EXISTS "workflow_engagement_services" CASCADE;
DROP TABLE IF EXISTS "workflow_engagements" CASCADE;
DROP TABLE IF EXISTS "workflow_instances" CASCADE;
DROP TABLE IF EXISTS "workflow_milestone_templates" CASCADE;
DROP TABLE IF EXISTS "workflow_milestones" CASCADE;
DROP TABLE IF EXISTS "workflow_notification_log" CASCADE;
DROP TABLE IF EXISTS "workflow_program_requirements" CASCADE;
DROP TABLE IF EXISTS "workflow_project_instances" CASCADE;
DROP TABLE IF EXISTS "workflow_project_settings" CASCADE;
DROP TABLE IF EXISTS "workflow_scheduled_instances_queue" CASCADE;
DROP TABLE IF EXISTS "workflow_service_definitions" CASCADE;
DROP TABLE IF EXISTS "workflow_task_dependencies" CASCADE;
DROP TABLE IF EXISTS "workflow_task_items" CASCADE;
DROP TABLE IF EXISTS "workflow_task_templates" CASCADE;

DROP TYPE IF EXISTS "WorkflowArtifactSourceType";
DROP TYPE IF EXISTS "WorkflowArtifactType";
DROP TYPE IF EXISTS "WorkflowBillingStateStatus";
DROP TYPE IF EXISTS "WorkflowBillingType";
DROP TYPE IF EXISTS "WorkflowBlockerStatus";
DROP TYPE IF EXISTS "WorkflowBlockerType";
DROP TYPE IF EXISTS "WorkflowCommunicationChannel";
DROP TYPE IF EXISTS "WorkflowCommunicationDirection";
DROP TYPE IF EXISTS "WorkflowCrossDependencyType";
DROP TYPE IF EXISTS "WorkflowDeviationType";
DROP TYPE IF EXISTS "WorkflowEngagementStatus";
DROP TYPE IF EXISTS "WorkflowInstanceStatus";
DROP TYPE IF EXISTS "WorkflowMilestoneStatus";
DROP TYPE IF EXISTS "WorkflowMilestoneType";
DROP TYPE IF EXISTS "WorkflowNotificationChannel";
DROP TYPE IF EXISTS "WorkflowNotificationStatus";
DROP TYPE IF EXISTS "WorkflowPeriodType";
DROP TYPE IF EXISTS "WorkflowProgramRequirementStatus";
DROP TYPE IF EXISTS "WorkflowProgramRequirementType";
DROP TYPE IF EXISTS "WorkflowRiskLevel";
DROP TYPE IF EXISTS "WorkflowScheduledQueueStatus";
DROP TYPE IF EXISTS "WorkflowServiceCategory";
DROP TYPE IF EXISTS "WorkflowSpawnType";
DROP TYPE IF EXISTS "WorkflowTaskItemStatus";

CREATE TYPE "TaskStatus" AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'PAUSED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "TaskStageStatus" AS ENUM (
  'NOT_STARTED',
  'BLOCKED',
  'IN_PROGRESS',
  'COMPLETED',
  'SKIPPED',
  'FAILED'
);

CREATE TYPE "TaskStageActionType" AS ENUM (
  'MANUAL',
  'COMPANY_PROFILE',
  'DOCUMENT_GENERATION',
  'ESIGNING'
);

CREATE TYPE "TaskStageOutcomeType" AS ENUM (
  'COMPANY',
  'GENERATED_DOCUMENT',
  'ESIGNING_ENVELOPE'
);

CREATE TABLE "task_pipelines" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "deleted_reason" TEXT,
  CONSTRAINT "task_pipelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_pipeline_versions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "pipeline_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_pipeline_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_pipeline_stages" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "action_type" "TaskStageActionType" NOT NULL,
  "icon" VARCHAR(100) NOT NULL,
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "action_config" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tasks" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "pipeline_version_id" TEXT NOT NULL,
  "company_id" TEXT,
  "owner_id" TEXT,
  "title" VARCHAR(300) NOT NULL,
  "description" TEXT,
  "status" "TaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "due_date" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "deleted_reason" TEXT,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_stages" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "action_type" "TaskStageActionType" NOT NULL,
  "icon" VARCHAR(100) NOT NULL,
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "action_config" JSONB,
  "status" "TaskStageStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "assignee_id" TEXT,
  "notes" TEXT,
  "skip_reason" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_stage_checklist_items" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "task_stage_id" TEXT NOT NULL,
  "label" VARCHAR(300) NOT NULL,
  "position" INTEGER NOT NULL,
  "is_completed" BOOLEAN NOT NULL DEFAULT false,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_stage_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_stage_outcomes" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" TEXT NOT NULL,
  "task_stage_id" TEXT NOT NULL,
  "type" "TaskStageOutcomeType" NOT NULL,
  "company_id" TEXT,
  "generated_document_id" TEXT,
  "esigning_envelope_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_stage_outcomes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_pipelines_tenant_id_deleted_at_idx"
  ON "task_pipelines"("tenant_id", "deleted_at");
CREATE INDEX "task_pipelines_tenant_id_name_idx"
  ON "task_pipelines"("tenant_id", "name");

CREATE UNIQUE INDEX "task_pipeline_versions_pipeline_id_version_key"
  ON "task_pipeline_versions"("pipeline_id", "version");
CREATE INDEX "task_pipeline_versions_tenant_id_pipeline_id_version_idx"
  ON "task_pipeline_versions"("tenant_id", "pipeline_id", "version");

CREATE UNIQUE INDEX "task_pipeline_stages_version_id_position_key"
  ON "task_pipeline_stages"("version_id", "position");
CREATE INDEX "task_pipeline_stages_tenant_id_version_id_position_idx"
  ON "task_pipeline_stages"("tenant_id", "version_id", "position");

CREATE INDEX "tasks_tenant_id_status_deleted_at_idx"
  ON "tasks"("tenant_id", "status", "deleted_at");
CREATE INDEX "tasks_tenant_id_pipeline_version_id_idx"
  ON "tasks"("tenant_id", "pipeline_version_id");
CREATE INDEX "tasks_tenant_id_company_id_idx"
  ON "tasks"("tenant_id", "company_id");
CREATE INDEX "tasks_tenant_id_owner_id_idx"
  ON "tasks"("tenant_id", "owner_id");
CREATE INDEX "tasks_tenant_id_due_date_idx"
  ON "tasks"("tenant_id", "due_date");

CREATE UNIQUE INDEX "task_stages_task_id_position_key"
  ON "task_stages"("task_id", "position");
CREATE INDEX "task_stages_tenant_id_task_id_status_idx"
  ON "task_stages"("tenant_id", "task_id", "status");
CREATE INDEX "task_stages_tenant_id_assignee_id_idx"
  ON "task_stages"("tenant_id", "assignee_id");

CREATE UNIQUE INDEX "task_stage_checklist_items_task_stage_id_position_key"
  ON "task_stage_checklist_items"("task_stage_id", "position");
CREATE INDEX "task_stage_checklist_items_tenant_id_task_stage_id_position_idx"
  ON "task_stage_checklist_items"("tenant_id", "task_stage_id", "position");

CREATE UNIQUE INDEX "task_stage_outcomes_task_stage_id_key"
  ON "task_stage_outcomes"("task_stage_id");
CREATE INDEX "task_stage_outcomes_tenant_id_type_idx"
  ON "task_stage_outcomes"("tenant_id", "type");
CREATE INDEX "task_stage_outcomes_tenant_id_company_id_idx"
  ON "task_stage_outcomes"("tenant_id", "company_id");
CREATE INDEX "task_stage_outcomes_tenant_id_generated_document_id_idx"
  ON "task_stage_outcomes"("tenant_id", "generated_document_id");
CREATE INDEX "task_stage_outcomes_tenant_id_esigning_envelope_id_idx"
  ON "task_stage_outcomes"("tenant_id", "esigning_envelope_id");

ALTER TABLE "task_pipelines"
  ADD CONSTRAINT "task_pipelines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_pipeline_versions"
  ADD CONSTRAINT "task_pipeline_versions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_pipeline_versions"
  ADD CONSTRAINT "task_pipeline_versions_pipeline_id_fkey"
  FOREIGN KEY ("pipeline_id") REFERENCES "task_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_pipeline_stages"
  ADD CONSTRAINT "task_pipeline_stages_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_pipeline_stages"
  ADD CONSTRAINT "task_pipeline_stages_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "task_pipeline_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_pipeline_version_id_fkey"
  FOREIGN KEY ("pipeline_version_id") REFERENCES "task_pipeline_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_stages"
  ADD CONSTRAINT "task_stages_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_stages"
  ADD CONSTRAINT "task_stages_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_stages"
  ADD CONSTRAINT "task_stages_assignee_id_fkey"
  FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_stage_checklist_items"
  ADD CONSTRAINT "task_stage_checklist_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_stage_checklist_items"
  ADD CONSTRAINT "task_stage_checklist_items_task_stage_id_fkey"
  FOREIGN KEY ("task_stage_id") REFERENCES "task_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_stage_outcomes"
  ADD CONSTRAINT "task_stage_outcomes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_stage_outcomes"
  ADD CONSTRAINT "task_stage_outcomes_task_stage_id_fkey"
  FOREIGN KEY ("task_stage_id") REFERENCES "task_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_stage_outcomes"
  ADD CONSTRAINT "task_stage_outcomes_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_stage_outcomes"
  ADD CONSTRAINT "task_stage_outcomes_generated_document_id_fkey"
  FOREIGN KEY ("generated_document_id") REFERENCES "generated_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_stage_outcomes"
  ADD CONSTRAINT "task_stage_outcomes_esigning_envelope_id_fkey"
  FOREIGN KEY ("esigning_envelope_id") REFERENCES "esigning_envelopes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
