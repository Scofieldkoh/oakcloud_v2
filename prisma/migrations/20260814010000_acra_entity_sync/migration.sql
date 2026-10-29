-- Local ACRA entity table for company name availability checks
-- plus sync state/lock singleton for the daily dataset import task.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "acra_entity" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "uen" TEXT NOT NULL,
    "entity_name" TEXT NOT NULL,
    "entity_status" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "data_as_of" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acra_entity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acra_entity_uen_key" ON "acra_entity"("uen");

-- GIN trigram on the raw column: Prisma's `contains` with `mode: insensitive`
-- generates ILIKE '%word%', which the pg_trgm opclass matches directly.
-- (A lower(entity_name) expression index is NOT used for ILIKE predicates.)
CREATE INDEX "acra_entity_entity_name_trgm_idx"
ON "acra_entity" USING gin ("entity_name" gin_trgm_ops);

CREATE TABLE "acra_sync_state" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "collection_last_updated_at" TEXT,
    "entity_count" INTEGER NOT NULL DEFAULT 0,
    "last_started_at" TIMESTAMP(3),
    "last_completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acra_sync_state_pkey" PRIMARY KEY ("id")
);
