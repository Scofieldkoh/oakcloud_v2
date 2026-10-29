ALTER TABLE "companies"
  ADD COLUMN "display_alias" VARCHAR(40);

ALTER TABLE "service_families"
  ADD COLUMN "display_color" VARCHAR(7) NOT NULL DEFAULT '#2F6F5E';

WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "tenant_id"
           ORDER BY "display_order", "name", "id"
         ) - 1 AS color_index
  FROM "service_families"
)
UPDATE "service_families" AS family
SET "display_color" = (ARRAY[
  '#2F6F5E', '#3F6DA8', '#8A5AA5', '#B0653C',
  '#467A43', '#9A6A18', '#9B4D67', '#4E7180'
])[1 + (ranked.color_index % 8)]
FROM ranked
WHERE ranked."id" = family."id";

ALTER TABLE "service_families"
  ADD CONSTRAINT "service_families_display_color_hex"
  CHECK ("display_color" ~ '^#[0-9A-F]{6}$');
