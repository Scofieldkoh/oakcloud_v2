-- Resolutions pre-filled on Configure for RESOLUTION templates.
ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "resolution_preset" JSONB;
