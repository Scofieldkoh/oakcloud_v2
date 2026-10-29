import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
const migration = readFileSync(
  join(root, "prisma", "migrations", "20260724090000_modular_tasks_reset", "migration.sql"),
  "utf8",
);
const snapshotGuardsMigration = readFileSync(
  join(root, "prisma", "migrations", "20260727030000_task_snapshot_guards", "migration.sql"),
  "utf8",
);
const esigningPreparationMigrationPath = join(
  root,
  "prisma",
  "migrations",
  "20260728010000_background_esigning_preparation",
  "migration.sql",
);
const esigningPreparationMigration = existsSync(esigningPreparationMigrationPath)
  ? readFileSync(esigningPreparationMigrationPath, "utf8")
  : "";
const sharedDocumentsCleanupMigration = readFileSync(
  join(root, "prisma", "migrations", "20260627231500_remove_shared_documents", "migration.sql"),
  "utf8",
);
const generatedEnums = readFileSync(join(root, "src", "generated", "prisma", "enums.ts"), "utf8");
const contactMergeService = readFileSync(
  join(root, "src", "services", "contact-merge.service.ts"),
  "utf8",
);
const contactDuplicateService = readFileSync(
  join(root, "src", "services", "contact-duplicate.service.ts"),
  "utf8",
);

function schemaBlock(kind: "model" | "enum", name: string): string {
  const match = schema.match(new RegExp(`^${kind} ${name} \\{[\\s\\S]*?^\\}`, "m"));
  return match?.[0] ?? "";
}

function migrationFunction(name: string): string {
  const match = snapshotGuardsMigration.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION "${name}"\\(\\)[\\s\\S]*?\\$\\$ LANGUAGE plpgsql;`,
    ),
  );
  return match?.[0] ?? "";
}

describe("modular task schema reset", () => {
  it("removes the legacy workflow schema and contact-service references", () => {
    expect(schema).not.toMatch(/^model workflow_/m);
    expect(schema).not.toMatch(/^enum Workflow/m);
    expect(schema).not.toMatch(/\bworkflow_[a-z0-9_]+\b/);
    expect(contactMergeService).not.toMatch(/workflow/i);
    expect(contactDuplicateService).not.toMatch(/workflow/i);
  });

  it.each([
    "TaskPipeline",
    "TaskPipelineVersion",
    "TaskPipelineStage",
    "Task",
    "TaskStage",
    "TaskStageChecklistItem",
    "TaskStageOutcome",
    "TaskEsigningPreparation",
  ])("defines the %s model", (modelName) => {
    expect(schemaBlock("model", modelName)).not.toBe("");
  });

  it.each([
    "TaskStatus",
    "TaskStageStatus",
    "TaskStageActionType",
    "TaskStageOutcomeType",
    "TaskEsigningPreparationStatus",
  ])("defines the %s enum", (enumName) => {
    expect(schemaBlock("enum", enumName)).not.toBe("");
  });

  it("defines durable background E-signing preparation ownership and leasing", () => {
    const preparation = schemaBlock("model", "TaskEsigningPreparation");
    const envelopeDocument = schemaBlock("model", "EsigningEnvelopeDocument");
    const status = schemaBlock("enum", "TaskEsigningPreparationStatus");

    expect(preparation).toMatch(/taskStageId\s+String\s+@unique/);
    expect(preparation).toMatch(/generatedDocumentId\s+String\?/);
    expect(preparation).toMatch(/leaseExpiresAt\s+DateTime\?/);
    expect(preparation).toMatch(/status\s+TaskEsigningPreparationStatus/);
    expect(envelopeDocument).toMatch(/generatedDocumentId\s+String\?/);
    expect(envelopeDocument).toMatch(/@@unique\(\[envelopeId,\s*generatedDocumentId\]\)/);
    expect(status).toMatch(/\bWAITING\b/);
    expect(status).toMatch(/\bQUEUED\b/);
    expect(status).toMatch(/\bPROCESSING\b/);
    expect(status).toMatch(/\bREADY\b/);
    expect(status).toMatch(/\bFAILED_RETRYABLE\b/);
    expect(status).toMatch(/\bFAILED_PERMANENT\b/);
  });

  it("migrates the E-signing preparation queue with tenant and lease indexes", () => {
    expect(esigningPreparationMigration).toContain(
      'CREATE TYPE "TaskEsigningPreparationStatus"',
    );
    expect(esigningPreparationMigration).toContain(
      'CREATE TABLE "task_esigning_preparations"',
    );
    expect(esigningPreparationMigration).toContain(
      'ADD COLUMN "generated_document_id" TEXT',
    );
    expect(esigningPreparationMigration).toContain(
      'ON "esigning_envelope_documents"("envelopeId", "generated_document_id")',
    );
    expect(esigningPreparationMigration).toContain(
      'esigning_envelope_documents_envelopeId_generated_document_id_key',
    );
    expect(esigningPreparationMigration).not.toContain(
      'ON "esigning_envelope_documents"("envelope_id", "generated_document_id")',
    );
    expect(esigningPreparationMigration).toContain(
      'FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")',
    );
    expect(esigningPreparationMigration).not.toContain(
      'FOREIGN KEY ("tenant_id") REFERENCES "workspaces"("id")',
    );
    expect(esigningPreparationMigration).toContain(
      'task_esigning_preparations_task_stage_id_key',
    );
    expect(esigningPreparationMigration).toContain(
      'task_esigning_preparations_tenant_id_status_available_at_idx',
    );
    expect(esigningPreparationMigration).toContain(
      'task_esigning_preparations_status_lease_expires_at_idx',
    );
  });

  it("declares the required task schema invariants", () => {
    const pipeline = schemaBlock("model", "TaskPipeline");
    const version = schemaBlock("model", "TaskPipelineVersion");
    const pipelineStage = schemaBlock("model", "TaskPipelineStage");
    const task = schemaBlock("model", "Task");
    const taskStage = schemaBlock("model", "TaskStage");
    const outcome = schemaBlock("model", "TaskStageOutcome");

    expect(version).toMatch(/version\s+Int/);
    expect(version).toMatch(/publishedAt\s+DateTime\?/);
    expect(version).toMatch(/@@unique\(\[pipelineId,\s*version\]\)/);
    expect(pipelineStage).toMatch(/position\s+Int/);
    expect(task).toMatch(/companyId\s+String\?/);
    expect(task).toMatch(/ownerId\s+String\?/);
    expect(task).toMatch(/dueDate\s+DateTime\?/);
    expect(task).toMatch(/snapshotLockedAt\s+DateTime\?/);
    expect(taskStage).toMatch(/assigneeId\s+String\?/);
    expect(pipeline).toMatch(/deletedAt\s+DateTime\?/);
    expect(task).toMatch(/deletedAt\s+DateTime\?/);
    expect(outcome).toMatch(
      /company\s+Company\?\s+@relation\(fields: \[companyId\], references: \[id\], onDelete: SetNull\)/,
    );
    expect(outcome).toMatch(
      /generatedDocument\s+GeneratedDocument\?\s+@relation\(fields: \[generatedDocumentId\], references: \[id\], onDelete: SetNull\)/,
    );
    expect(outcome).toMatch(
      /esigningEnvelope\s+EsigningEnvelope\?\s+@relation\(fields: \[esigningEnvelopeId\], references: \[id\], onDelete: SetNull\)/,
    );
  });

  it("uses WAITING, rather than BLOCKED, for task-stage status across schema artifacts", () => {
    const taskStageStatus = schemaBlock("enum", "TaskStageStatus");

    expect(taskStageStatus).toMatch(/\bWAITING\b/);
    expect(taskStageStatus).not.toMatch(/\bBLOCKED\b/);
    expect(migration).toMatch(/CREATE TYPE "TaskStageStatus"[\s\S]*?'BLOCKED'/);
    expect(snapshotGuardsMigration).toMatch(
      /ALTER TYPE "TaskStageStatus" RENAME VALUE 'BLOCKED' TO 'WAITING'/,
    );
    const generatedTaskStageStatus =
      generatedEnums.match(/export const TaskStageStatus = \{[\s\S]*?\} as const/)?.[0] ?? '';
    expect(generatedTaskStageStatus).toMatch(/WAITING: 'WAITING'/);
    expect(generatedTaskStageStatus).not.toMatch(/BLOCKED/);
  });

  it("covers the full task schema reset in the migration, including ordered constraints and indexes", () => {
    for (const table of [
      "task_pipelines", "task_pipeline_versions", "task_pipeline_stages", "tasks",
      "task_stages", "task_stage_checklist_items", "task_stage_outcomes",
    ]) expect(migration).toContain(`CREATE TABLE "${table}"`);

    for (const enumName of ["TaskStatus", "TaskStageStatus", "TaskStageActionType", "TaskStageOutcomeType"]) {
      expect(migration).toContain(`CREATE TYPE "${enumName}"`);
    }

    expect(migration).toContain('DROP TABLE IF EXISTS "workflow_instances" CASCADE;');
    expect(migration).toContain('DROP TYPE IF EXISTS "WorkflowInstanceStatus";');
    expect(migration).toContain('CREATE UNIQUE INDEX "task_pipeline_versions_pipeline_id_version_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "task_pipeline_stages_version_id_position_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "task_stages_task_id_position_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "task_stage_checklist_items_task_stage_id_position_key"');
    expect(migration).toContain('CREATE INDEX "task_pipeline_stages_tenant_id_version_id_position_idx"');
    expect(migration).toContain('CREATE INDEX "task_stage_checklist_items_tenant_id_task_stage_id_position_idx"');
  });

  it("lets pristine databases pass the legacy shared-documents cleanup before the reset", () => {
    expect(sharedDocumentsCleanupMigration).toContain(
      "IF to_regclass('public.workflow_artifacts') IS NOT NULL THEN",
    );
    expect(sharedDocumentsCleanupMigration).toMatch(
      /IF to_regclass\('public\.workflow_artifacts'\) IS NOT NULL THEN[\s\S]*?ALTER TABLE "workflow_artifacts"[\s\S]*?END IF;/,
    );
  });

  it("locks published pipeline snapshots against every structural mutation in the migration", () => {
    const pipelineVersionGuard = migrationFunction("prevent_published_task_pipeline_version_change");
    const pipelineStageGuard = migrationFunction("prevent_published_task_pipeline_stage_change");

    expect(snapshotGuardsMigration).toContain('"published_at" TIMESTAMP(3)');
    expect(pipelineVersionGuard).toContain('OLD."published_at" IS NOT NULL');
    expect(pipelineVersionGuard).toContain('NEW."published_at" IS DISTINCT FROM OLD."published_at"');
    expect(pipelineStageGuard).toContain('"published_at" IS NOT NULL');

    for (const [functionName, table, event] of [
      ["prevent_published_task_pipeline_version_change", "task_pipeline_versions", "UPDATE OR DELETE"],
      ["prevent_published_task_pipeline_stage_change", "task_pipeline_stages", "INSERT OR UPDATE OR DELETE"],
    ]) {
      expect(migrationFunction(functionName)).not.toBe("");
      expect(snapshotGuardsMigration).toMatch(new RegExp(`CREATE TRIGGER "${functionName}_trigger"[\\s\\S]*?BEFORE ${event} ON "${table}"`));
    }
  });

  it("locks task snapshots against new or deleted structure while keeping operational fields editable", () => {
    const taskGuard = migrationFunction("prevent_locked_task_pipeline_version_change");
    const taskStageGuard = migrationFunction("prevent_locked_task_stage_change");
    const checklistGuard = migrationFunction("prevent_locked_task_stage_checklist_item_change");

    expect(snapshotGuardsMigration).toContain('"snapshot_locked_at" TIMESTAMP(3)');
    expect(taskGuard).toContain('OLD."snapshot_locked_at" IS NOT NULL');
    expect(taskGuard).toContain('NEW."snapshot_locked_at" IS DISTINCT FROM OLD."snapshot_locked_at"');
    expect(taskGuard).toContain('NEW."pipeline_version_id" IS DISTINCT FROM OLD."pipeline_version_id"');
    expect(taskStageGuard).not.toBe("");
    for (const field of ["tenant_id", "task_id", "name", "description", "position", "action_type", "icon", "is_required", "action_config"]) {
      expect(taskStageGuard).toContain(`NEW."${field}" IS DISTINCT FROM OLD."${field}"`);
    }
    for (const operationalField of ["status", "assignee_id", "notes", "skip_reason", "started_at", "completed_at"]) {
      expect(taskStageGuard).not.toContain(`NEW."${operationalField}"`);
    }
    expect(snapshotGuardsMigration).toMatch(/CREATE TRIGGER "prevent_locked_task_stage_change_trigger"[\s\S]*?BEFORE INSERT OR UPDATE OR DELETE ON "task_stages"/);

    expect(checklistGuard).not.toBe("");
    for (const field of ["tenant_id", "task_stage_id", "label", "position"]) {
      expect(checklistGuard).toContain(`NEW."${field}" IS DISTINCT FROM OLD."${field}"`);
    }
    expect(snapshotGuardsMigration).toMatch(/CREATE TRIGGER "prevent_locked_task_stage_checklist_item_change_trigger"[\s\S]*?BEFORE INSERT OR UPDATE OR DELETE ON "task_stage_checklist_items"/);
  });
});
