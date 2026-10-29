-- Rename connector-owned tenant concepts to workspace concepts.

ALTER TABLE "connectors" RENAME COLUMN "tenantId" TO "workspaceId";
ALTER INDEX IF EXISTS "connectors_tenantId_idx" RENAME TO "connectors_workspaceId_idx";
ALTER INDEX IF EXISTS "connectors_tenantId_provider_deletedAt_key" RENAME TO "connectors_workspaceId_provider_deletedAt_key";
ALTER TABLE "connectors" RENAME CONSTRAINT "connectors_tenantId_fkey" TO "connectors_workspaceId_fkey";

ALTER TABLE "tenant_connector_access" RENAME TO "workspace_connector_access";
ALTER TABLE "workspace_connector_access" RENAME COLUMN "tenantId" TO "workspaceId";
ALTER INDEX IF EXISTS "tenant_connector_access_connectorId_idx" RENAME TO "workspace_connector_access_connectorId_idx";
ALTER INDEX IF EXISTS "tenant_connector_access_tenantId_idx" RENAME TO "workspace_connector_access_workspaceId_idx";
ALTER INDEX IF EXISTS "tenant_connector_access_tenantId_connectorId_key" RENAME TO "workspace_connector_access_workspaceId_connectorId_key";
ALTER TABLE "workspace_connector_access" RENAME CONSTRAINT "tenant_connector_access_pkey" TO "workspace_connector_access_pkey";
ALTER TABLE "workspace_connector_access" RENAME CONSTRAINT "tenant_connector_access_connectorId_fkey" TO "workspace_connector_access_connectorId_fkey";
ALTER TABLE "workspace_connector_access" RENAME CONSTRAINT "tenant_connector_access_tenantId_fkey" TO "workspace_connector_access_workspaceId_fkey";

ALTER TABLE "connector_usage_logs" RENAME COLUMN "tenantId" TO "workspaceId";
ALTER INDEX IF EXISTS "connector_usage_logs_tenantId_idx" RENAME TO "connector_usage_logs_workspaceId_idx";
ALTER INDEX IF EXISTS "connector_usage_logs_tenantId_createdAt_idx" RENAME TO "connector_usage_logs_workspaceId_createdAt_idx";
ALTER TABLE "connector_usage_logs" RENAME CONSTRAINT "connector_usage_logs_tenantId_fkey" TO "connector_usage_logs_workspaceId_fkey";
