-- C06: native (DOCX) reusable partials.
-- Additive only; existing partials keep content_json NULL and stay HTML partials.
ALTER TABLE "template_partials"
ADD COLUMN "content_json" JSONB;
