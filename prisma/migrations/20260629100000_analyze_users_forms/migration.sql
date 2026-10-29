-- Migration: analyze_users_forms
-- Refreshes planner statistics on tables that gained indexes in recent migrations
-- but haven't had ANALYZE run since data volume grew.

ANALYZE "users";
ANALYZE "user_role_assignments";
ANALYZE "forms";
ANALYZE "form_submissions";
ANALYZE "form_drafts";
