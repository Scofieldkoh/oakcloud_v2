-- Keep prepared BizFile proposals bound to the complete company aggregate.
--
-- The authorization mutation migration installs
-- oakcloud_authorization_statement_gate(), which takes the global
-- oakcloud:authorization:global transaction advisory lock. Every writer in
-- this aggregate takes that same statement lock before any row-level trigger
-- can lock a company, matching the order used by canonical operations.

CREATE OR REPLACE FUNCTION "oakcloud_company_aggregate_revision_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_business JSONB;
  new_business JSONB;
  old_revision INTEGER;
BEGIN
  old_revision := COALESCE(OLD."aggregate_revision", 0);

  -- createdAt/updatedAt and task_integration_context are operational metadata.
  -- All other columns, including soft-delete state and denormalized counts,
  -- are part of the company snapshot and therefore invalidate a proposal.
  old_business := to_jsonb(OLD) - ARRAY[
    'aggregate_revision',
    'createdAt',
    'updatedAt',
    'task_integration_context'
  ]::TEXT[];
  new_business := to_jsonb(NEW) - ARRAY[
    'aggregate_revision',
    'createdAt',
    'updatedAt',
    'task_integration_context'
  ]::TEXT[];

  IF old_business IS DISTINCT FROM new_business THEN
    -- A caller supplied revision may be stale or may intentionally jump
    -- forward. Either way, never let a business write move the token
    -- backwards or suppress the invalidation caused by that write.
    NEW."aggregate_revision" := GREATEST(
      old_revision + 1,
      COALESCE(NEW."aggregate_revision", old_revision + 1)
    );
  ELSIF NEW."aggregate_revision" IS NULL
    OR NEW."aggregate_revision" < old_revision THEN
    -- An explicit rewind is ignored. A direct non-decreasing increment is
    -- retained because it is a safe invalidation even without field changes.
    NEW."aggregate_revision" := old_revision;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  company_ids TEXT[];
  contact_ids TEXT[];
BEGIN
  IF TG_TABLE_NAME IN (
    'company_addresses',
    'company_former_names',
    'share_capital',
    'company_officers',
    'company_shareholders',
    'company_auditors',
    'company_charges',
    'company_contacts'
  ) THEN
    IF TG_OP = 'INSERT' THEN
      UPDATE "companies" AS c
      SET "aggregate_revision" = COALESCE(c."aggregate_revision", 0) + 1
      WHERE c."id" = NEW."companyId"
        AND c."deletedAt" IS NULL;
      RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
      -- A move between companies invalidates both snapshots. IN is a set, so
      -- the same company is bumped once for a companyId-only update.
      UPDATE "companies" AS c
      SET "aggregate_revision" = COALESCE(c."aggregate_revision", 0) + 1
      WHERE c."id" IN (OLD."companyId", NEW."companyId")
        AND c."deletedAt" IS NULL;
      RETURN NEW;
    ELSE
      UPDATE "companies" AS c
      SET "aggregate_revision" = COALESCE(c."aggregate_revision", 0) + 1
      WHERE c."id" = OLD."companyId"
        AND c."deletedAt" IS NULL;
      RETURN OLD;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'contacts' THEN
    IF TG_OP = 'INSERT' THEN
      RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
      contact_ids := ARRAY[OLD."id"];
    ELSE
      contact_ids := ARRAY[OLD."id", NEW."id"];
    END IF;

    -- A contact can be shared by many companies. The statement-level global
    -- authorization gate above serializes this set before these parent rows
    -- are locked, so linked companies cannot deadlock with canonical writes.
    UPDATE "companies" AS c
    SET "aggregate_revision" = COALESCE(c."aggregate_revision", 0) + 1
    WHERE c."id" IN (
      SELECT cc."companyId"
      FROM "company_contacts" AS cc
      WHERE cc."contactId" = ANY(contact_ids)
      UNION
      SELECT co."companyId"
      FROM "company_officers" AS co
      WHERE co."contactId" = ANY(contact_ids)
      UNION
      SELECT cs."companyId"
      FROM "company_shareholders" AS cs
      WHERE cs."contactId" = ANY(contact_ids)
      UNION
      SELECT ch."companyId"
      FROM "company_charges" AS ch
      WHERE ch."chargeHolderId" = ANY(contact_ids)
      UNION
      SELECT cd."companyId"
      FROM "contact_details" AS cd
      WHERE cd."contactId" = ANY(contact_ids)
        AND cd."companyId" IS NOT NULL
    )
      AND c."deletedAt" IS NULL;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'contact_details' THEN
    IF TG_OP = 'INSERT' THEN
      company_ids := ARRAY[NEW."companyId"];
      contact_ids := ARRAY[NEW."contactId"];
    ELSIF TG_OP = 'DELETE' THEN
      company_ids := ARRAY[OLD."companyId"];
      contact_ids := ARRAY[OLD."contactId"];
    ELSE
      company_ids := ARRAY[OLD."companyId", NEW."companyId"];
      contact_ids := ARRAY[OLD."contactId", NEW."contactId"];
    END IF;

    -- Details attached through a shared contact affect every linked company;
    -- the direct companyId array covers company-specific details. UNION keeps
    -- one company at one revision step when both paths point to it.
    UPDATE "companies" AS c
    SET "aggregate_revision" = COALESCE(c."aggregate_revision", 0) + 1
    WHERE c."id" IN (
      SELECT unnest(company_ids)
      UNION
      SELECT cc."companyId"
      FROM "company_contacts" AS cc
      WHERE cc."contactId" = ANY(contact_ids)
      UNION
      SELECT co."companyId"
      FROM "company_officers" AS co
      WHERE co."contactId" = ANY(contact_ids)
      UNION
      SELECT cs."companyId"
      FROM "company_shareholders" AS cs
      WHERE cs."contactId" = ANY(contact_ids)
      UNION
      SELECT ch."companyId"
      FROM "company_charges" AS ch
      WHERE ch."chargeHolderId" = ANY(contact_ids)
    )
      AND c."deletedAt" IS NULL
      ;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported BizFile aggregate trigger table: %', TG_TABLE_NAME;
END;
$$;

-- Parent scalar writes use the same guarded token. Child/contact triggers call
-- an UPDATE on companies; the parent trigger leaves each non-decreasing
-- internal increment intact.
DROP TRIGGER IF EXISTS "oakcloud_bizfile_company_aggregate_revision_guard" ON "companies";
CREATE TRIGGER "oakcloud_bizfile_company_aggregate_revision_guard"
BEFORE UPDATE ON "companies"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_company_aggregate_revision_guard"();

-- Acquire the global authorization gate before any related row can be locked.
-- This covers only the company aggregate and selected contact identity paths;
-- unrelated company relations retain their existing behavior.
DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_companies" ON "companies";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_companies"
BEFORE INSERT OR UPDATE OR DELETE ON "companies"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_company_addresses" ON "company_addresses";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_company_addresses"
BEFORE INSERT OR UPDATE OR DELETE ON "company_addresses"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_company_former_names" ON "company_former_names";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_company_former_names"
BEFORE INSERT OR UPDATE OR DELETE ON "company_former_names"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_share_capital" ON "share_capital";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_share_capital"
BEFORE INSERT OR UPDATE OR DELETE ON "share_capital"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_company_officers" ON "company_officers";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_company_officers"
BEFORE INSERT OR UPDATE OR DELETE ON "company_officers"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_company_shareholders" ON "company_shareholders";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_company_shareholders"
BEFORE INSERT OR UPDATE OR DELETE ON "company_shareholders"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_company_auditors" ON "company_auditors";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_company_auditors"
BEFORE INSERT OR UPDATE OR DELETE ON "company_auditors"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_company_charges" ON "company_charges";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_company_charges"
BEFORE INSERT OR UPDATE OR DELETE ON "company_charges"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_company_contacts" ON "company_contacts";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_company_contacts"
BEFORE INSERT OR UPDATE OR DELETE ON "company_contacts"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_contacts" ON "contacts";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_contacts"
BEFORE INSERT OR UPDATE OR DELETE ON "contacts"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_gate_contact_details" ON "contact_details";
CREATE TRIGGER "oakcloud_bizfile_aggregate_gate_contact_details"
BEFORE INSERT OR UPDATE OR DELETE ON "contact_details"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();

-- Company-owned rows bump one parent per row. A multi-row canonical write is
-- intentionally allowed to advance once per changed row; only monotonicity
-- and stale-plan invalidation are contractual. The canonical processor records
-- the persisted post-write revision as evidence.
DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_revision_company_addresses" ON "company_addresses";
CREATE TRIGGER "oakcloud_bizfile_aggregate_revision_company_addresses"
AFTER INSERT OR UPDATE OR DELETE ON "company_addresses"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_revision_company_former_names" ON "company_former_names";
CREATE TRIGGER "oakcloud_bizfile_aggregate_revision_company_former_names"
AFTER INSERT OR UPDATE OR DELETE ON "company_former_names"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_revision_share_capital" ON "share_capital";
CREATE TRIGGER "oakcloud_bizfile_aggregate_revision_share_capital"
AFTER INSERT OR UPDATE OR DELETE ON "share_capital"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_revision_company_officers" ON "company_officers";
CREATE TRIGGER "oakcloud_bizfile_aggregate_revision_company_officers"
AFTER INSERT OR UPDATE OR DELETE ON "company_officers"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_revision_company_shareholders" ON "company_shareholders";
CREATE TRIGGER "oakcloud_bizfile_aggregate_revision_company_shareholders"
AFTER INSERT OR UPDATE OR DELETE ON "company_shareholders"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_revision_company_auditors" ON "company_auditors";
CREATE TRIGGER "oakcloud_bizfile_aggregate_revision_company_auditors"
AFTER INSERT OR UPDATE OR DELETE ON "company_auditors"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_revision_company_charges" ON "company_charges";
CREATE TRIGGER "oakcloud_bizfile_aggregate_revision_company_charges"
AFTER INSERT OR UPDATE OR DELETE ON "company_charges"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_revision_company_contacts" ON "company_contacts";
CREATE TRIGGER "oakcloud_bizfile_aggregate_revision_company_contacts"
AFTER INSERT OR UPDATE OR DELETE ON "company_contacts"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_revision_contacts" ON "contacts";
CREATE TRIGGER "oakcloud_bizfile_aggregate_revision_contacts"
AFTER INSERT OR UPDATE OR DELETE ON "contacts"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"();

DROP TRIGGER IF EXISTS "oakcloud_bizfile_aggregate_revision_contact_details" ON "contact_details";
CREATE TRIGGER "oakcloud_bizfile_aggregate_revision_contact_details"
AFTER INSERT OR UPDATE OR DELETE ON "contact_details"
FOR EACH ROW EXECUTE FUNCTION "oakcloud_bizfile_aggregate_revision_child_bump"();
