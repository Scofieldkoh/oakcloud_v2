ALTER TABLE "client_services"
  DROP CONSTRAINT "client_services_billing_disposition_reason";

ALTER TABLE "client_services"
  ADD CONSTRAINT "client_services_billing_disposition_reason"
  CHECK (
    (
      "billing_disposition" = 'NOT_REQUIRED'
      AND (
        "billing_not_required_reason" IS NULL
        OR length(btrim("billing_not_required_reason")) >= 3
      )
    )
    OR
    (
      "billing_disposition" <> 'NOT_REQUIRED'
      AND "billing_not_required_reason" IS NULL
    )
  );
