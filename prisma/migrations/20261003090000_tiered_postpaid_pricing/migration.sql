-- Postpaid fee lines can be priced by quantity tiers; billing entries keep the quantity.
ALTER TABLE "service_variant_fee_templates" ADD COLUMN "tiered_pricing" JSONB;

ALTER TABLE "client_service_fee_lines" ADD COLUMN "tiered_pricing" JSONB;

ALTER TABLE "billing_occurrences" ADD COLUMN "quantity" DECIMAL(14,2);
