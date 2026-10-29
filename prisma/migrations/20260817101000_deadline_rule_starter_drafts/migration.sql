-- Seed only unpublished, tenant-scoped authoring records. These drafts are
-- deliberately unattached to variants and therefore cannot generate dates.
-- The fixed hashes are SHA-256 values of the complete canonical definitions
-- in src/services/deadline-rule/starter-drafts.ts.

INSERT INTO "deadline_rules" (
  "id", "tenant_id", "code", "name", "description", "is_active",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), t."id", starter."code", starter."name", starter."description", TRUE,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" AS t
CROSS JOIN (
  VALUES
    ('SG_AGM_DUE', 'Singapore AGM Due Date', 'Starter statutory AGM rule sourced from Company.nextAgmDueDate'),
    ('SG_ANNUAL_RETURN', 'Singapore Annual Return', 'Starter statutory Annual Return rule sourced from Company.nextArDueDate'),
    ('SG_ECI', 'Singapore ECI', 'Starter statutory ECI rule requiring monthsAfterFye'),
    ('SG_FORM_C', 'Singapore Form C', 'Starter statutory Form C rule requiring monthsAfterFye')
) AS starter("code", "name", "description")
WHERE t."status" = 'ACTIVE'
ON CONFLICT ("tenant_id", "code") DO NOTHING;

WITH starter("code", "name", "description", "config_hash") AS (
  VALUES
    ('SG_AGM_DUE', 'Singapore AGM Due Date', 'Starter statutory AGM rule sourced from Company.nextAgmDueDate', '1d35fb5366ca3e0765d99aa3be8a7b1a3419cd72a59010007d2f28c43c125472'),
    ('SG_ANNUAL_RETURN', 'Singapore Annual Return', 'Starter statutory Annual Return rule sourced from Company.nextArDueDate', '73fd8c37145eec8adea9f1172a6cb7ec2f065fc90cf01b57b291381a3bcead4e'),
    ('SG_ECI', 'Singapore ECI', 'Starter statutory ECI rule requiring monthsAfterFye', '4124dcf4fcc2a1894d4517bc099d5d1c146587b3ad573eae1474cfb8ea134f2b'),
    ('SG_FORM_C', 'Singapore Form C', 'Starter statutory Form C rule requiring monthsAfterFye', '5f7f8c126d394bcf24e1cb3303e78f9e0508bf39a431b9e049a3ac884fcbe23c')
)
INSERT INTO "deadline_rule_versions" (
  "id", "tenant_id", "rule_id", "version", "state", "schema_version",
  "recurrence", "applicability", "config_hash", "draft_revision",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), r."tenant_id", r."id", 0, 'DRAFT', 1,
  '{"schemaVersion":1,"kind":"ANNUALLY"}'::jsonb,
  '{"schemaVersion":1,"kind":"ALL","conditions":[]}'::jsonb,
  starter."config_hash", 1,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "deadline_rules" AS r
JOIN "tenants" AS t ON t."id" = r."tenant_id"
JOIN starter ON starter."code" = r."code"
WHERE t."status" = 'ACTIVE'
  AND r."archived_at" IS NULL
  AND r."is_active" = TRUE
  AND r."name" = starter."name"
  AND r."description" = starter."description"
  AND r."current_version_id" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "deadline_rule_versions" AS existing
    WHERE existing."rule_id" = r."id"
  )
ON CONFLICT ("rule_id", "version") DO NOTHING;

WITH starter("code", "name", "description", "config_hash") AS (
  VALUES
    ('SG_AGM_DUE', 'Singapore AGM Due Date', 'Starter statutory AGM rule sourced from Company.nextAgmDueDate', '1d35fb5366ca3e0765d99aa3be8a7b1a3419cd72a59010007d2f28c43c125472'),
    ('SG_ANNUAL_RETURN', 'Singapore Annual Return', 'Starter statutory Annual Return rule sourced from Company.nextArDueDate', '73fd8c37145eec8adea9f1172a6cb7ec2f065fc90cf01b57b291381a3bcead4e'),
    ('SG_ECI', 'Singapore ECI', 'Starter statutory ECI rule requiring monthsAfterFye', '4124dcf4fcc2a1894d4517bc099d5d1c146587b3ad573eae1474cfb8ea134f2b'),
    ('SG_FORM_C', 'Singapore Form C', 'Starter statutory Form C rule requiring monthsAfterFye', '5f7f8c126d394bcf24e1cb3303e78f9e0508bf39a431b9e049a3ac884fcbe23c')
)
INSERT INTO "deadline_rule_parameter_definitions" (
  "id", "tenant_id", "rule_version_id", "key", "label", "type",
  "is_required", "default_value", "validation", "display_order",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), r."tenant_id", v."id", 'monthsAfterFye', 'Months after FYE',
  'INTEGER', TRUE, NULL, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "deadline_rules" AS r
JOIN "tenants" AS t ON t."id" = r."tenant_id"
JOIN starter ON starter."code" = r."code"
JOIN "deadline_rule_versions" AS v
  ON v."rule_id" = r."id"
 AND v."tenant_id" = r."tenant_id"
 AND v."version" = 0
 AND v."state" = 'DRAFT'
 AND v."config_hash" = starter."config_hash"
WHERE r."code" IN ('SG_ECI', 'SG_FORM_C')
  AND t."status" = 'ACTIVE'
  AND r."archived_at" IS NULL
  AND r."is_active" = TRUE
  AND r."name" = starter."name"
  AND r."description" = starter."description"
  AND r."current_version_id" IS NULL
ON CONFLICT ("rule_version_id", "key") DO NOTHING;

WITH starter("code", "name", "description", "config_hash", "milestone_key", "milestone_name", "date_expression") AS (
  VALUES
    (
      'SG_AGM_DUE', 'Singapore AGM Due Date', 'Starter statutory AGM rule sourced from Company.nextAgmDueDate', '1d35fb5366ca3e0765d99aa3be8a7b1a3419cd72a59010007d2f28c43c125472',
      'agm-due', 'AGM due date',
      '{"kind":"SOURCE","source":{"kind":"COMPANY_FIELD","field":"nextAgmDueDate"}}'
    ),
    (
      'SG_ANNUAL_RETURN', 'Singapore Annual Return', 'Starter statutory Annual Return rule sourced from Company.nextArDueDate', '73fd8c37145eec8adea9f1172a6cb7ec2f065fc90cf01b57b291381a3bcead4e',
      'annual-return-due', 'Annual Return due date',
      '{"kind":"SOURCE","source":{"kind":"COMPANY_FIELD","field":"nextArDueDate"}}'
    ),
    (
      'SG_ECI', 'Singapore ECI', 'Starter statutory ECI rule requiring monthsAfterFye', '4124dcf4fcc2a1894d4517bc099d5d1c146587b3ad573eae1474cfb8ea134f2b',
      'eci-due', 'ECI due date',
      '{"kind":"ADD_MONTHS","source":{"kind":"COMPANY_FIELD","field":"financialYearEnd"},"amount":{"kind":"INTEGER_PARAMETER","key":"monthsAfterFye"}}'
    ),
    (
      'SG_FORM_C', 'Singapore Form C', 'Starter statutory Form C rule requiring monthsAfterFye', '5f7f8c126d394bcf24e1cb3303e78f9e0508bf39a431b9e049a3ac884fcbe23c',
      'form-c-due', 'Form C due date',
      '{"kind":"ADD_MONTHS","source":{"kind":"COMPANY_FIELD","field":"financialYearEnd"},"amount":{"kind":"INTEGER_PARAMETER","key":"monthsAfterFye"}}'
    )
)
INSERT INTO "deadline_milestone_templates" (
  "id", "tenant_id", "rule_version_id", "milestone_key", "name", "description",
  "type", "generation_mode", "date_expression", "business_day_adjustment",
  "display_order", "is_active", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), r."tenant_id", v."id", starter."milestone_key", starter."milestone_name", NULL,
  'STATUTORY', 'ONCE_PER_CYCLE', starter."date_expression"::jsonb, 'NONE',
  0, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "deadline_rules" AS r
JOIN "tenants" AS t ON t."id" = r."tenant_id"
JOIN starter ON starter."code" = r."code"
JOIN "deadline_rule_versions" AS v
  ON v."rule_id" = r."id"
 AND v."tenant_id" = r."tenant_id"
 AND v."version" = 0
 AND v."state" = 'DRAFT'
 AND v."config_hash" = starter."config_hash"
WHERE t."status" = 'ACTIVE'
  AND r."archived_at" IS NULL
  AND r."is_active" = TRUE
  AND r."name" = starter."name"
  AND r."description" = starter."description"
  AND r."current_version_id" IS NULL
ON CONFLICT ("rule_version_id", "milestone_key") DO NOTHING;
