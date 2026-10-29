CREATE TABLE "form_option_presets" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "built_in_key" TEXT,
    "is_protected" BOOLEAN NOT NULL DEFAULT false,
    "allow_csv_replace" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB NOT NULL,
    "option_count" INTEGER NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_option_presets_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "form_fields" ADD COLUMN "option_preset_id" TEXT;

CREATE UNIQUE INDEX "form_option_presets_tenant_id_normalized_key_key"
ON "form_option_presets"("tenant_id", "normalized_key");

CREATE UNIQUE INDEX "form_option_presets_tenant_id_built_in_key_key"
ON "form_option_presets"("tenant_id", "built_in_key");

CREATE INDEX "form_option_presets_tenant_id_updated_at_idx"
ON "form_option_presets"("tenant_id", "updated_at");

CREATE INDEX "form_fields_option_preset_id_idx"
ON "form_fields"("option_preset_id");

ALTER TABLE "form_option_presets"
ADD CONSTRAINT "form_option_presets_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "form_fields"
ADD CONSTRAINT "form_fields_option_preset_id_fkey"
FOREIGN KEY ("option_preset_id") REFERENCES "form_option_presets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
