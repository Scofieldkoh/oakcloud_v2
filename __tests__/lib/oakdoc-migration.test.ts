import { describe, expect, it } from 'vitest';

import {
  assertOakDocCanBecomePrimary,
  buildOakDocMigrationInventory,
  createOakDocMigrationMetadata,
  getOakDocMigrationReadiness,
  mergeOakDocMigrationMetadata,
  readOakDocMigrationMetadata,
} from '@/lib/document-editor/oakdoc-migration';

const OAKDOC_ASSET = {
  schemaVersion: 1,
  storageKey: 'tenant/templates/oakdoc/assets/asset-id',
  fileName: 'template.docx',
  fileSize: 123,
  sha256: '0'.repeat(64),
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  fieldTags: ['company.name'],
};

function migrationMetadata(overrides: Record<string, unknown> = {}) {
  return {
    ...createOakDocMigrationMetadata({
      legacyTemplateId: 'legacy-1',
      legacyTemplateVersion: 3,
      linkedAt: '2026-09-25T00:00:00.000Z',
    }),
    ...overrides,
  };
}

function oakDocContentJson(metadata?: ReturnType<typeof migrationMetadata>) {
  return {
    oakDoc: OAKDOC_ASSET,
    ...(metadata ? mergeOakDocMigrationMetadata({}, metadata) : {}),
  };
}

describe('OakDoc migration metadata and readiness', () => {
  it('round-trips stable migration linkage independently of template names', () => {
    const metadata = migrationMetadata();
    const json = mergeOakDocMigrationMetadata({ oakDoc: OAKDOC_ASSET }, metadata);

    expect(readOakDocMigrationMetadata(json)).toEqual(metadata);
  });

  it('requires current-version passing parity before OakDoc is primary', () => {
    const metadata = migrationMetadata({
      validation: {
        checkedAt: '2026-09-25T01:00:00.000Z',
        passed: true,
        legacyTemplateVersion: 3,
        oakDocTemplateVersion: 7,
        issueCodes: [],
      },
    });

    expect(getOakDocMigrationReadiness({
      metadata,
      legacyTemplateVersion: 3,
      oakDocTemplateVersion: 7,
    })).toBe('READY_FOR_SWITCHOVER');

    expect(getOakDocMigrationReadiness({
      metadata,
      legacyTemplateVersion: 4,
      oakDocTemplateVersion: 7,
    })).toBe('OAKDOC_DRAFT');

    expect(() => assertOakDocCanBecomePrimary({
      metadata,
      legacyTemplateVersion: 4,
      oakDocTemplateVersion: 7,
    })).toThrow(/current legacy and OakDoc versions/i);
  });

  it('reports failed parity and an explicitly preferred validated OakDoc', () => {
    const failed = migrationMetadata({
      validation: {
        checkedAt: '2026-09-25T01:00:00.000Z',
        passed: false,
        legacyTemplateVersion: 3,
        oakDocTemplateVersion: 7,
        issueCodes: ['OAKDOC_REQUIRED_SEMANTIC_MISSING'],
      },
    });
    expect(getOakDocMigrationReadiness({
      metadata: failed,
      legacyTemplateVersion: 3,
      oakDocTemplateVersion: 7,
    })).toBe('PARITY_CHECK_FAILED');

    const preferred = {
      ...failed,
      preference: 'OAKDOC' as const,
      validation: { ...failed.validation!, passed: true, issueCodes: [] },
    };
    expect(getOakDocMigrationReadiness({
      metadata: preferred,
      legacyTemplateVersion: 3,
      oakDocTemplateVersion: 7,
    })).toBe('OAKDOC_PRIMARY');
  });
});

describe('OakDoc migration inventory', () => {
  it('classifies A4-only, OakDoc-only, pending, failed and validated pairs by stable IDs', () => {
    const readyMetadata = migrationMetadata({
      validation: {
        checkedAt: '2026-09-25T01:00:00.000Z',
        passed: true,
        legacyTemplateVersion: 3,
        oakDocTemplateVersion: 7,
        issueCodes: [],
      },
    });
    const failedMetadata = {
      ...migrationMetadata({
        legacyTemplateId: 'legacy-failed',
        legacyTemplateVersion: 1,
      }),
      validation: {
        checkedAt: '2026-09-25T01:00:00.000Z',
        passed: false,
        legacyTemplateVersion: 1,
        oakDocTemplateVersion: 2,
        issueCodes: ['SEMANTIC_MISMATCH'],
      },
    };
    const pendingMetadata = migrationMetadata({
      legacyTemplateId: 'legacy-pending',
      legacyTemplateVersion: 2,
    });

    const inventory = buildOakDocMigrationInventory([
      { id: 'a4-only', name: 'A4 Only', version: 1, contentJson: null },
      { id: 'legacy-1', name: 'Legacy Source Renamed', version: 3, contentJson: null },
      { id: 'oak-ready', name: 'Completely Different OakDoc Name', version: 7, contentJson: oakDocContentJson(readyMetadata) },
      { id: 'oak-only', name: 'OakDoc Only', version: 1, contentJson: oakDocContentJson() },
      { id: 'legacy-pending', name: 'Pending Source', version: 2, contentJson: null },
      { id: 'oak-pending', name: 'Pending Target', version: 4, contentJson: oakDocContentJson(pendingMetadata) },
      { id: 'legacy-failed', name: 'Failed Source', version: 1, contentJson: null },
      { id: 'oak-failed', name: 'Failed Target', version: 2, contentJson: oakDocContentJson(failedMetadata) },
    ]);

    expect(inventory.map((item) => item.status).sort()).toEqual([
      'A4_ONLY',
      'MIGRATED_PAIR',
      'MIGRATION_PENDING',
      'MIGRATION_VALIDATION_FAILED',
      'OAKDOC_ONLY',
    ].sort());

    const ready = inventory.find((item) => item.oakDocTemplate?.id === 'oak-ready');
    expect(ready).toMatchObject({
      status: 'MIGRATED_PAIR',
      readiness: 'READY_FOR_SWITCHOVER',
      legacyTemplate: { id: 'legacy-1', name: 'Legacy Source Renamed' },
    });
  });
});
