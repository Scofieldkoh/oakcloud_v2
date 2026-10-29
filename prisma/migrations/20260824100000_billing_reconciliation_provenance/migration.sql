ALTER TABLE "service_schedule_reconciliation_requests"
  ADD CONSTRAINT "service_schedule_reconciliation_requests_tenant_id_id_key" UNIQUE ("tenant_id", "id");

ALTER TABLE "billing_occurrences"
  ADD COLUMN "cancellation_reconciliation_request_id" TEXT;

ALTER TABLE "billing_occurrences"
  ADD CONSTRAINT "billing_occurrences_cancellation_request_fkey"
  FOREIGN KEY ("tenant_id", "cancellation_reconciliation_request_id")
  REFERENCES "service_schedule_reconciliation_requests"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_occurrences"
  DROP CONSTRAINT "billing_occurrences_cancellation_consistency",
  ADD CONSTRAINT "billing_occurrences_cancellation_consistency"
  CHECK (
    (
      "status" = 'CANCELLED'
      AND "cancelled_at" IS NOT NULL
      AND "cancellation_reason" IS NOT NULL
      AND length(btrim("cancellation_reason")) >= 3
      AND ("cancelled_by_id" IS NOT NULL OR "cancellation_reconciliation_request_id" IS NOT NULL)
    )
    OR
    (
      "status" <> 'CANCELLED'
      AND "cancelled_at" IS NULL
      AND "cancelled_by_id" IS NULL
      AND "cancellation_reason" IS NULL
      AND "cancellation_reconciliation_request_id" IS NULL
    )
  );
