-- Preserve the original modular-task reset checksum. All later schema
-- refinements are applied forward and are idempotent for environments where
-- the pre-release reset migration may already have contained these changes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'TaskStageStatus' AND e.enumlabel = 'BLOCKED'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'TaskStageStatus' AND e.enumlabel = 'WAITING'
  ) THEN
    ALTER TYPE "TaskStageStatus" RENAME VALUE 'BLOCKED' TO 'WAITING';
  END IF;
END
$$;

ALTER TABLE "task_pipeline_versions"
  ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3);
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "snapshot_locked_at" TIMESTAMP(3);

CREATE OR REPLACE FUNCTION "prevent_published_task_pipeline_version_change"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."published_at" IS NOT NULL THEN
      RAISE EXCEPTION 'Published task pipeline versions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."published_at" IS NOT NULL
    AND NEW."published_at" IS DISTINCT FROM OLD."published_at" THEN
    RAISE EXCEPTION 'Published task pipeline versions cannot be unpublished';
  END IF;
  IF OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Published task pipeline versions cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "prevent_published_task_pipeline_version_change_trigger"
  ON "task_pipeline_versions";
CREATE TRIGGER "prevent_published_task_pipeline_version_change_trigger"
BEFORE UPDATE OR DELETE ON "task_pipeline_versions"
FOR EACH ROW EXECUTE FUNCTION "prevent_published_task_pipeline_version_change"();

CREATE OR REPLACE FUNCTION "prevent_published_task_pipeline_stage_change"()
RETURNS TRIGGER AS $$
DECLARE
  version_is_published BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "published_at" IS NOT NULL INTO version_is_published
    FROM "task_pipeline_versions" WHERE "id" = NEW."version_id";
  ELSIF TG_OP = 'DELETE' THEN
    SELECT "published_at" IS NOT NULL INTO version_is_published
    FROM "task_pipeline_versions" WHERE "id" = OLD."version_id";
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM "task_pipeline_versions"
      WHERE "id" IN (OLD."version_id", NEW."version_id")
        AND "published_at" IS NOT NULL
    ) INTO version_is_published;
  END IF;
  IF COALESCE(version_is_published, false) THEN
    RAISE EXCEPTION 'Published task pipeline stages cannot be changed';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "prevent_published_task_pipeline_stage_change_trigger"
  ON "task_pipeline_stages";
CREATE TRIGGER "prevent_published_task_pipeline_stage_change_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "task_pipeline_stages"
FOR EACH ROW EXECUTE FUNCTION "prevent_published_task_pipeline_stage_change"();

CREATE OR REPLACE FUNCTION "prevent_locked_task_pipeline_version_change"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."snapshot_locked_at" IS NOT NULL
    AND NEW."snapshot_locked_at" IS DISTINCT FROM OLD."snapshot_locked_at" THEN
    RAISE EXCEPTION 'Task snapshots cannot be unlocked';
  END IF;
  IF OLD."snapshot_locked_at" IS NOT NULL
    AND NEW."pipeline_version_id" IS DISTINCT FROM OLD."pipeline_version_id" THEN
    RAISE EXCEPTION 'Locked tasks cannot change pipeline version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "prevent_locked_task_pipeline_version_change_trigger"
  ON "tasks";
CREATE TRIGGER "prevent_locked_task_pipeline_version_change_trigger"
BEFORE UPDATE ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "prevent_locked_task_pipeline_version_change"();

CREATE OR REPLACE FUNCTION "prevent_locked_task_stage_change"()
RETURNS TRIGGER AS $$
DECLARE
  snapshot_is_locked BOOLEAN;
  structural_change BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "snapshot_locked_at" IS NOT NULL INTO snapshot_is_locked
    FROM "tasks" WHERE "id" = NEW."task_id";
    structural_change := true;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT "snapshot_locked_at" IS NOT NULL INTO snapshot_is_locked
    FROM "tasks" WHERE "id" = OLD."task_id";
    structural_change := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM "tasks"
      WHERE "id" IN (OLD."task_id", NEW."task_id")
        AND "snapshot_locked_at" IS NOT NULL
    ) INTO snapshot_is_locked;
    structural_change := NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
      OR NEW."task_id" IS DISTINCT FROM OLD."task_id"
      OR NEW."name" IS DISTINCT FROM OLD."name"
      OR NEW."description" IS DISTINCT FROM OLD."description"
      OR NEW."position" IS DISTINCT FROM OLD."position"
      OR NEW."action_type" IS DISTINCT FROM OLD."action_type"
      OR NEW."icon" IS DISTINCT FROM OLD."icon"
      OR NEW."is_required" IS DISTINCT FROM OLD."is_required"
      OR NEW."action_config" IS DISTINCT FROM OLD."action_config";
  END IF;
  IF COALESCE(snapshot_is_locked, false) AND structural_change THEN
    RAISE EXCEPTION 'Locked task stages cannot be structurally changed';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "prevent_locked_task_stage_change_trigger"
  ON "task_stages";
CREATE TRIGGER "prevent_locked_task_stage_change_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "task_stages"
FOR EACH ROW EXECUTE FUNCTION "prevent_locked_task_stage_change"();

CREATE OR REPLACE FUNCTION "prevent_locked_task_stage_checklist_item_change"()
RETURNS TRIGGER AS $$
DECLARE
  snapshot_is_locked BOOLEAN;
  structural_change BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT t."snapshot_locked_at" IS NOT NULL INTO snapshot_is_locked
    FROM "task_stages" ts JOIN "tasks" t ON t."id" = ts."task_id"
    WHERE ts."id" = NEW."task_stage_id";
    structural_change := true;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT t."snapshot_locked_at" IS NOT NULL INTO snapshot_is_locked
    FROM "task_stages" ts JOIN "tasks" t ON t."id" = ts."task_id"
    WHERE ts."id" = OLD."task_stage_id";
    structural_change := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM "task_stages" ts JOIN "tasks" t ON t."id" = ts."task_id"
      WHERE ts."id" IN (OLD."task_stage_id", NEW."task_stage_id")
        AND t."snapshot_locked_at" IS NOT NULL
    ) INTO snapshot_is_locked;
    structural_change := NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
      OR NEW."task_stage_id" IS DISTINCT FROM OLD."task_stage_id"
      OR NEW."label" IS DISTINCT FROM OLD."label"
      OR NEW."position" IS DISTINCT FROM OLD."position";
  END IF;
  IF COALESCE(snapshot_is_locked, false) AND structural_change THEN
    RAISE EXCEPTION 'Locked task-stage checklist items cannot be structurally changed';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "prevent_locked_task_stage_checklist_item_change_trigger"
  ON "task_stage_checklist_items";
CREATE TRIGGER "prevent_locked_task_stage_checklist_item_change_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "task_stage_checklist_items"
FOR EACH ROW EXECUTE FUNCTION "prevent_locked_task_stage_checklist_item_change"();
