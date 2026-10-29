-- Authorization writers acquire the same transaction gate as durable mutation
-- evaluators before locking any row. Row-level triggers invert this order and
-- can deadlock against an evaluator that already owns the advisory gate.
-- Coarse global serialization is deliberate for the first release: these
-- transactions are short and must contain no provider or storage I/O.
CREATE FUNCTION "oakcloud_authorization_statement_gate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('oakcloud:authorization:global', 0));
  RETURN NULL;
END;
$$;

CREATE TRIGGER "oakcloud_authorization_gate_tenants"
BEFORE INSERT OR UPDATE OR DELETE ON "tenants"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();
CREATE TRIGGER "oakcloud_authorization_gate_users"
BEFORE INSERT OR UPDATE OR DELETE ON "users"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();
CREATE TRIGGER "oakcloud_authorization_gate_roles"
BEFORE INSERT OR UPDATE OR DELETE ON "roles"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();
CREATE TRIGGER "oakcloud_authorization_gate_role_permissions"
BEFORE INSERT OR UPDATE OR DELETE ON "role_permissions"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();
CREATE TRIGGER "oakcloud_authorization_gate_user_role_assignments"
BEFORE INSERT OR UPDATE OR DELETE ON "user_role_assignments"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();
CREATE TRIGGER "oakcloud_authorization_gate_permissions"
BEFORE INSERT OR UPDATE OR DELETE ON "permissions"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();
-- A company deletion can cascade into role assignments. Acquire the gate at
-- the parent statement rather than after its company rows have been locked.
CREATE TRIGGER "oakcloud_authorization_gate_company_delete"
BEFORE DELETE ON "companies"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();
CREATE TRIGGER "oakcloud_authorization_gate_company_workspace"
BEFORE UPDATE OF "tenantId" ON "companies"
FOR EACH STATEMENT EXECUTE FUNCTION "oakcloud_authorization_statement_gate"();
