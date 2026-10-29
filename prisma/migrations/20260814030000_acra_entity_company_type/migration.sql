-- Replace the business constitution column with the company type description
-- column from the ACRA dataset.
ALTER TABLE "acra_entity" RENAME COLUMN "business_constitution_description" TO "company_type_description";
