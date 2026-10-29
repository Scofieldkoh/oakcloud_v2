-- Match the application identifier normalizer without introducing persisted keys
-- that could drift from contact write paths.
CREATE INDEX "contacts_active_normalized_identification_idx"
    ON "contacts"(
        "tenantId",
        "contactType",
        "identificationType",
        (
            CASE
                WHEN "identificationType" IN ('NRIC', 'FIN', 'UEN')
                    THEN regexp_replace(upper(normalize("identificationNumber", NFKC)), '[[:space:]-]+', '', 'g')
                ELSE regexp_replace(trim(upper(normalize("identificationNumber", NFKC))), '[[:space:]]+', ' ', 'g')
            END
        )
    )
    WHERE "deletedAt" IS NULL
      AND "isActive" = true
      AND "identificationType" IS NOT NULL
      AND "identificationNumber" IS NOT NULL;

CREATE INDEX "contacts_active_normalized_corporate_uen_idx"
    ON "contacts"(
        "tenantId",
        "contactType",
        (regexp_replace(upper(normalize("corporateUen", NFKC)), '[[:space:]-]+', '', 'g'))
    )
    WHERE "deletedAt" IS NULL
      AND "isActive" = true
      AND "corporateUen" IS NOT NULL;
