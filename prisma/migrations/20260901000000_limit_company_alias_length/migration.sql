-- Keep company aliases compact and consistent with the Companies module.
-- Existing longer values are retained up to the new ten-character limit.
ALTER TABLE "companies"
  ALTER COLUMN "display_alias" TYPE VARCHAR(10)
  USING LEFT("display_alias", 10);
