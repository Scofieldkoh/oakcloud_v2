-- Migrate legacy multi-tenant system-role labels to internal staff roles.
UPDATE "roles"
SET "systemRoleType" = 'ADMIN'
WHERE "systemRoleType" IN ('SUPER_ADMIN', 'TENANT_ADMIN');

UPDATE "roles"
SET "systemRoleType" = 'MANAGER'
WHERE "systemRoleType" = 'COMPANY_ADMIN';

UPDATE "roles"
SET "systemRoleType" = 'STAFF'
WHERE "systemRoleType" = 'COMPANY_USER';

UPDATE "roles"
SET "description" = CASE
  WHEN "description" ILIKE '%tenant%' OR "description" ILIKE '%system-wide%' THEN 'Full internal staff administration access'
  ELSE "description"
END
WHERE "systemRoleType" = 'ADMIN';

UPDATE "roles"
SET "description" = 'Manage assigned companies and operational workflows'
WHERE "systemRoleType" = 'MANAGER' AND "name" = 'Company Admin';

UPDATE "roles"
SET "description" = 'Read and work on assigned companies'
WHERE "systemRoleType" = 'STAFF' AND "name" = 'Company User';

WITH admin_rename_candidates AS (
  SELECT r."id",
         ROW_NUMBER() OVER (
           PARTITION BY r."tenantId"
           ORDER BY CASE WHEN r."name" = 'Tenant Admin' THEN 0 ELSE 1 END, r."createdAt", r."id"
         ) AS row_number
  FROM "roles" r
  WHERE r."systemRoleType" = 'ADMIN'
    AND r."name" IN ('Super Admin', 'Tenant Admin')
    AND NOT EXISTS (
      SELECT 1
      FROM "roles" existing
      WHERE existing."tenantId" = r."tenantId"
        AND existing."name" = 'Admin'
        AND existing."id" <> r."id"
    )
)
UPDATE "roles" r
SET "name" = 'Admin'
FROM admin_rename_candidates c
WHERE r."id" = c."id" AND c.row_number = 1;

UPDATE "roles" r
SET "name" = 'Manager'
WHERE r."systemRoleType" = 'MANAGER'
  AND r."name" = 'Company Admin'
  AND NOT EXISTS (
    SELECT 1
    FROM "roles" existing
    WHERE existing."tenantId" = r."tenantId"
      AND existing."name" = 'Manager'
      AND existing."id" <> r."id"
  );

UPDATE "roles" r
SET "name" = 'Staff'
WHERE r."systemRoleType" = 'STAFF'
  AND r."name" = 'Company User'
  AND NOT EXISTS (
    SELECT 1
    FROM "roles" existing
    WHERE existing."tenantId" = r."tenantId"
      AND existing."name" = 'Staff'
      AND existing."id" <> r."id"
  );

-- Denormalized company list counters.
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "current_officer_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "current_shareholder_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "active_charge_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "document_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "has_poc" BOOLEAN NOT NULL DEFAULT false;

UPDATE "companies" c
SET
  "current_officer_count" = COALESCE(o.count, 0),
  "current_shareholder_count" = COALESCE(s.count, 0),
  "active_charge_count" = COALESCE(ch.count, 0),
  "document_count" = COALESCE(d.count, 0),
  "has_poc" = COALESCE(p.has_poc, false)
FROM "companies" c2
LEFT JOIN (
  SELECT "companyId", COUNT(*)::INTEGER AS count
  FROM "company_officers"
  WHERE "isCurrent" = true
  GROUP BY "companyId"
) o ON o."companyId" = c2."id"
LEFT JOIN (
  SELECT "companyId", COUNT(*)::INTEGER AS count
  FROM "company_shareholders"
  WHERE "isCurrent" = true
  GROUP BY "companyId"
) s ON s."companyId" = c2."id"
LEFT JOIN (
  SELECT "companyId", COUNT(*)::INTEGER AS count
  FROM "company_charges"
  WHERE "isFullyDischarged" = false
  GROUP BY "companyId"
) ch ON ch."companyId" = c2."id"
LEFT JOIN (
  SELECT "companyId", COUNT(*)::INTEGER AS count
  FROM "documents"
  WHERE "deleted_at" IS NULL
  GROUP BY "companyId"
) d ON d."companyId" = c2."id"
LEFT JOIN (
  SELECT "companyId", true AS has_poc
  FROM "company_contacts"
  WHERE "isPoc" = true AND "deletedAt" IS NULL
  GROUP BY "companyId"
) p ON p."companyId" = c2."id"
WHERE c."id" = c2."id";

CREATE INDEX IF NOT EXISTS "companies_tenant_current_officer_count_idx" ON "companies"("tenantId", "current_officer_count");
CREATE INDEX IF NOT EXISTS "companies_tenant_current_shareholder_count_idx" ON "companies"("tenantId", "current_shareholder_count");
CREATE INDEX IF NOT EXISTS "companies_tenant_active_charge_count_idx" ON "companies"("tenantId", "active_charge_count");
CREATE INDEX IF NOT EXISTS "companies_tenant_document_count_idx" ON "companies"("tenantId", "document_count");
CREATE INDEX IF NOT EXISTS "companies_tenant_has_poc_idx" ON "companies"("tenantId", "has_poc");

-- Materialized summary views for high-traffic dashboards.
DROP MATERIALIZED VIEW IF EXISTS "company_summary_counts";
CREATE MATERIALIZED VIEW "company_summary_counts" AS
SELECT
  "tenantId",
  COUNT(*)::INTEGER AS total,
  COUNT(*) FILTER (WHERE status = 'LIVE')::INTEGER AS live_count,
  COUNT(*) FILTER (WHERE "nextArDueDate" < now() AND status = 'LIVE')::INTEGER AS overdue_filings_count,
  COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '30 days')::INTEGER AS recently_added_count,
  SUM("current_officer_count")::INTEGER AS current_officer_count,
  SUM("current_shareholder_count")::INTEGER AS current_shareholder_count,
  SUM("active_charge_count")::INTEGER AS active_charge_count,
  SUM("document_count")::INTEGER AS document_count
FROM "companies"
WHERE "deletedAt" IS NULL
GROUP BY "tenantId";

CREATE UNIQUE INDEX IF NOT EXISTS "company_summary_counts_tenant_id_idx" ON "company_summary_counts"("tenantId");

DROP MATERIALIZED VIEW IF EXISTS "processing_document_summary_counts";
CREATE MATERIALIZED VIEW "processing_document_summary_counts" AS
SELECT
  d."tenantId",
  d."companyId",
  pd."pipeline_status",
  pd."duplicate_status",
  dr."status" AS "revision_status",
  COUNT(*)::INTEGER AS total
FROM "processing_documents" pd
JOIN "documents" d ON d."id" = pd."document_id"
LEFT JOIN "document_revisions" dr ON dr."id" = pd."current_revision_id"
WHERE pd."deleted_at" IS NULL
GROUP BY d."tenantId", d."companyId", pd."pipeline_status", pd."duplicate_status", dr."status";

CREATE INDEX IF NOT EXISTS "processing_document_summary_counts_tenant_idx"
  ON "processing_document_summary_counts"("tenantId");
CREATE INDEX IF NOT EXISTS "processing_document_summary_counts_company_idx"
  ON "processing_document_summary_counts"("companyId");

CREATE TABLE IF NOT EXISTS "performance_measurements" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "route" TEXT NOT NULL,
  "metric_type" TEXT NOT NULL,
  "value" DECIMAL(18,4) NOT NULL,
  "unit" TEXT NOT NULL,
  "metadata" JSONB,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_measurements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "performance_measurements_route_metric_created_idx"
  ON "performance_measurements"("route", "metric_type", "created_at");
CREATE INDEX IF NOT EXISTS "performance_measurements_created_at_idx"
  ON "performance_measurements"("created_at");
