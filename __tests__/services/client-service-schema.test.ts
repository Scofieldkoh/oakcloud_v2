import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('client service activation schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260730110000_client_services_activation/migration.sql'), 'utf8');
  const sourceMigration = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260809010000_manual_client_service_creation/migration.sql'), 'utf8');

  it('defines idempotent entity-level operational services', () => {
    expect(schema).toContain('enum ClientServiceStatus');
    expect(schema).toContain('enum ServiceAgreementActivationStatus');
    expect(schema).toContain('model ClientService');
    expect(schema).toContain('model ClientServiceFeeLine');
    expect(schema).toContain('@@unique([agreementItemId, companyId])');
    expect(schema).toContain('activationStatus');
    expect(schema).toContain('ServiceAgreementActivationStatus');
    expect(schema).toContain('activationClaimToken');
  });

  it('keeps queue indexes partial and migration-managed', () => {
    expect(schema).not.toContain('@@index([activationStatus, activationAvailableAt])');
    expect(schema).not.toContain('@@index([activationStatus, activationLeaseExpiresAt])');
    expect(migration).toContain('CREATE INDEX "service_agreements_activation_available_claim_idx" ON "service_agreements"("activation_available_at", "id") WHERE "activation_status" IN (\'PENDING\', \'FAILED_RETRYABLE\');');
    expect(migration).toContain('CREATE INDEX "service_agreements_activation_expired_lease_idx" ON "service_agreements"("activation_lease_expires_at", "id") WHERE "activation_status" = \'PROCESSING\';');
  });

  it('adds an immutable client service source with nullable agreement lineage', () => {
    expect(schema).toContain('enum ClientServiceSource');
    expect(schema).toMatch(/^\s*source\s+ClientServiceSource\s+@default\(AGREEMENT\)(?:\s+@map\("[^"]+"\))?\s*$/m);
    expect(schema).toMatch(/^\s*agreementId\s+String\?(?:\s+@map\("[^"]+"\))?\s*$/m);
    expect(schema).toMatch(/^\s*agreementItemId\s+String\?(?:\s+@map\("[^"]+"\))?\s*$/m);
    expect(schema).toContain('@@index([tenantId, companyId, serviceVariantId, startDate, deletedAt])');
  });

  it('backfills source, relaxes agreement columns, and enforces source/reference consistency', () => {
    expect(sourceMigration).toContain('CHECK');
    expect(sourceMigration).toContain('source_reference_consistency');
    expect(sourceMigration).toContain('client_services_tenant_id_company_id_service_variant_id_start_date_deleted_at_idx');
    expect(sourceMigration).not.toContain('DROP INDEX "client_services_agreement_item_id_company_id_key"');
  });

  it('declares the exact source/reference invariant', () => {
    const normalized = sourceMigration.replace(/\s+/g, ' ');
    expect(normalized).toContain(
      '("source" = \'AGREEMENT\' AND "agreement_id" IS NOT NULL AND "agreement_item_id" IS NOT NULL)',
    );
    expect(normalized).toContain(
      '("source" = \'MANUAL\' AND "agreement_id" IS NULL AND "agreement_item_id" IS NULL)',
    );
  });
});
