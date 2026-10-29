-- Official public holiday sync (MOM via data.gov.sg). Additive only: every
-- existing business holiday is classified as MANUAL by the column default.
CREATE TYPE "BusinessHolidaySourceType" AS ENUM ('MANUAL', 'EXTERNAL');
CREATE TYPE "PublicHolidayProvider" AS ENUM ('DATA_GOV_SG_MOM');

ALTER TABLE "business_holidays"
  ADD COLUMN "source_type" "BusinessHolidaySourceType" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "source_provider" "PublicHolidayProvider",
  ADD COLUMN "source_dataset_id" VARCHAR(100),
  ADD COLUMN "source_record_key" VARCHAR(100),
  ADD COLUMN "source_data_as_of" VARCHAR(64),
  ADD COLUMN "source_imported_at" TIMESTAMP(3);

ALTER TABLE "business_holidays"
  ADD CONSTRAINT "business_holidays_external_source_check"
  CHECK ("source_type" = 'MANUAL' OR "source_provider" IS NOT NULL);

CREATE TABLE "public_holiday_source_records" (
    "id" TEXT NOT NULL,
    "provider" "PublicHolidayProvider" NOT NULL,
    "jurisdiction_code" VARCHAR(10) NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "source_dataset_id" VARCHAR(100) NOT NULL,
    "source_record_key" VARCHAR(100) NOT NULL,
    "data_as_of" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_holiday_source_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_holiday_source_records_provider_jurisdiction_code_da_key"
  ON "public_holiday_source_records"("provider", "jurisdiction_code", "date");
CREATE INDEX "public_holiday_source_records_provider_jurisdiction_code_da_idx"
  ON "public_holiday_source_records"("provider", "jurisdiction_code", "data_as_of");

CREATE TABLE "public_holiday_sync_state" (
    "id" TEXT NOT NULL,
    "provider" "PublicHolidayProvider" NOT NULL,
    "jurisdiction_code" VARCHAR(10) NOT NULL,
    "dataset_id" VARCHAR(100),
    "source_last_updated_at" VARCHAR(64),
    "data_as_of" VARCHAR(64),
    "source_hash" VARCHAR(64),
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "coverage_start" DATE,
    "coverage_end" DATE,
    "last_checked_at" TIMESTAMP(3),
    "last_started_at" TIMESTAMP(3),
    "last_completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_holiday_sync_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_holiday_sync_state_provider_jurisdiction_code_key"
  ON "public_holiday_sync_state"("provider", "jurisdiction_code");
