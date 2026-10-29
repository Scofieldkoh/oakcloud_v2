-- Expand the local ACRA entity table with the additional dataset columns
-- surfaced in the ACRA Data admin page (address parts, SSIC codes,
-- statutory dates, former name, audit firm).
ALTER TABLE "acra_entity"
    ADD COLUMN "business_constitution_description" TEXT,
    ADD COLUMN "registration_incorporate_date" TEXT,
    ADD COLUMN "block" TEXT,
    ADD COLUMN "street_name" TEXT,
    ADD COLUMN "level_no" TEXT,
    ADD COLUMN "unit_no" TEXT,
    ADD COLUMN "building_name" TEXT,
    ADD COLUMN "postal_code" TEXT,
    ADD COLUMN "address" TEXT,
    ADD COLUMN "account_due_date" TEXT,
    ADD COLUMN "annual_return_date" TEXT,
    ADD COLUMN "primary_ssic_code" TEXT,
    ADD COLUMN "primary_ssic_description" TEXT,
    ADD COLUMN "secondary_ssic_code" TEXT,
    ADD COLUMN "secondary_ssic_description" TEXT,
    ADD COLUMN "no_of_officers" TEXT,
    ADD COLUMN "former_entity_name1" TEXT,
    ADD COLUMN "uen_of_audit_firm1" TEXT;
