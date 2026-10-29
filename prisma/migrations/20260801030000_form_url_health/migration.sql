CREATE TABLE "form_url_health" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "checked_url" TEXT NOT NULL,
    "url_fingerprint" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "last_http_status" INTEGER,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_checked_at" TIMESTAMP(3) NOT NULL,
    "last_succeeded_at" TIMESTAMP(3),
    "warning_activated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_url_health_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "form_url_health_tenant_id_form_id_field_key_key"
ON "form_url_health"("tenant_id", "form_id", "field_key");

CREATE INDEX "form_url_health_tenant_id_warning_activated_at_idx"
ON "form_url_health"("tenant_id", "warning_activated_at");

CREATE INDEX "form_url_health_last_checked_at_idx"
ON "form_url_health"("last_checked_at");

ALTER TABLE "form_url_health"
ADD CONSTRAINT "form_url_health_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "form_url_health"
ADD CONSTRAINT "form_url_health_form_id_fkey"
FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
