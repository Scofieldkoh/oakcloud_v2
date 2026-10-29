import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('e-signing completion and delivery schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260811010000_esigning_completion_delivery_state/migration.sql'
    ),
    'utf8'
  );

  it('defines durable post-completion and per-target delivery state', () => {
    expect(schema).toMatch(/@@unique\(\[envelopeId, kind, targetKey\]\)/);
    expect(schema).toMatch(/@@index\(\[status, availableAt\]\)/);
    expect(schema).toMatch(/emailDeliveries\s+EsigningEmailDelivery\[\]/);
    expect(schema).toMatch(/deliveryAttempts\s+EsigningEmailDeliveryAttempt\[\]/);

    expect(schema).toContain('enum EsigningPostCompletionStatus');
    expect(schema).toContain('enum EsigningEmailDeliveryKind');
    expect(schema).toContain('enum EsigningEmailDeliveryAudience');
    expect(schema).toMatch(/enum EsigningEmailDeliveryAudience\s+\{[\s\S]*COPY/);
    expect(schema).toContain('enum EsigningEmailDeliveryStatus');
    expect(schema).toContain('model EsigningEmailDelivery');
    expect(schema).toContain('model EsigningEmailDeliveryAttempt');
    expect(schema).toMatch(/autoFilingStatus\s+EsigningPostCompletionStatus\s+@default\(NOT_REQUIRED\)/);
    expect(schema).toMatch(/autoFilingAttempts\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/autoFilingAvailableAt\s+DateTime\?/);
    expect(schema).toMatch(/autoFilingClaimedAt\s+DateTime\?/);
    expect(schema).toMatch(/autoFilingLeaseExpiresAt\s+DateTime\?/);
    expect(schema).toMatch(/autoFilingError\s+String\?/);
  });

  it('supports optional manual-link emails and completion copy addresses', () => {
    expect(schema).toMatch(/email\s+String\?/);
    expect(schema).toMatch(/completionCopyEmails\s+String\[\]/);
  });

  it('does not backfill completion deliveries for artifact-complete envelopes', () => {
    expect(migration).toContain('CREATE TABLE "esigning_email_deliveries"');
    expect(migration).toContain('CREATE TABLE "esigning_email_delivery_attempts"');
    expect(migration).toMatch(
      /env\."pdfGenerationStatus" IS DISTINCT FROM 'COMPLETED'/g
    );
  });
});
