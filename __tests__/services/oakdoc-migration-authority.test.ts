// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCorpSecAppointmentOakDocMaster,
} from '@/lib/document-editor/oakdoc-standard-template-migrations';
import {
  getOakDocMigrationReadiness,
  mergeOakDocMigrationMetadata,
  readOakDocMigrationMetadata,
} from '@/lib/document-editor/oakdoc-migration';
import { OAKDOC_MIME_TYPE } from '@/lib/document-editor/oakdoc-template';

type Row = {
  id: string;
  tenantId: string;
  name: string;
  version: number;
  content: string;
  placeholders: unknown;
  contentJson: Record<string, unknown> | null;
  isActive: boolean;
  deletedAt: Date | null;
};

const store = new Map<string, Row>();
const docxBytes = buildCorpSecAppointmentOakDocMaster();
const downloadOakDocTemplate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    documentTemplate: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
        Array.from(store.values()).filter((row) => (
          row.tenantId === where.tenantId
          && (!('deletedAt' in where) || row.deletedAt === where.deletedAt)
          && (!where.id || row.id !== (where.id as { not: string }).not)
        ))
      )),
    },
  },
}));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn(async () => undefined) }));
vi.mock('@/services/oakdoc-template.service', () => ({
  downloadOakDocTemplate: (...args: unknown[]) => downloadOakDocTemplate(...args),
}));
vi.mock('@/services/document-template.service', () => ({
  getDocumentTemplateById: vi.fn(async (id: string, tenantId: string) => {
    const row = store.get(id);
    return row && row.tenantId === tenantId && row.deletedAt === null ? { ...row } : null;
  }),
  updateDocumentTemplate: vi.fn(async (input: { id: string; expectedRevision: number; contentJson?: Record<string, unknown>; content?: string }) => {
    const row = store.get(input.id)!;
    if (row.version !== input.expectedRevision) throw new Error('stale revision');
    const next = {
      ...row,
      version: row.version + 1,
      ...(input.contentJson ? { contentJson: input.contentJson } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
    };
    store.set(row.id, next);
    return { ...next };
  }),
}));

const {
  hashTemplateDefinition,
  linkOakDocMigration,
  resolvePreferredMigratedTemplate,
  resolveTemplateIdsForNewRun,
  runOakDocMigrationValidation,
  setOakDocMigrationPreference,
} = await import('@/services/oakdoc-migration.service');

const params = { tenantId: 'tenant-1', userId: 'user-1' };

function oakDocAsset(fieldTags: string[]) {
  return {
    schemaVersion: 1,
    storageKey: 'tenant-1/templates/oakdoc/assets/a.docx',
    fileName: 'a.docx',
    fileSize: docxBytes.byteLength,
    sha256: createHash('sha256').update(docxBytes).digest('hex'),
    mimeType: OAKDOC_MIME_TYPE,
    fieldTags,
  };
}

function seed() {
  store.clear();
  store.set('legacy-1', {
    id: 'legacy-1',
    tenantId: 'tenant-1',
    name: 'Resolution',
    version: 3,
    content: '<p>{{company.name}}</p>',
    placeholders: [],
    contentJson: null,
    isActive: true,
    deletedAt: null,
  });
  store.set('oak-1', {
    id: 'oak-1',
    tenantId: 'tenant-1',
    name: 'Resolution (OakDoc)',
    version: 1,
    content: '',
    placeholders: [],
    contentJson: { oakDoc: oakDocAsset(['company.name', 'company.uen']) },
    isActive: true,
    deletedAt: null,
  });
}

async function linkAndRun() {
  await linkOakDocMigration({
    oakDocTemplateId: 'oak-1',
    legacyTemplateId: 'legacy-1',
    expectedRevision: 1,
    reason: 'pair',
  }, params);
  return runOakDocMigrationValidation({ oakDocTemplateId: 'oak-1', expectedRevision: 2 }, params);
}

beforeEach(() => {
  seed();
  downloadOakDocTemplate.mockReset();
  downloadOakDocTemplate.mockResolvedValue({ buffer: Buffer.from(docxBytes), metadata: {} });
});

describe('OakDoc migration authority (M1)', () => {
  it('records server evidence bound to both definition hashes', async () => {
    const { validation, template } = await linkAndRun();

    expect(validation).toMatchObject({
      passed: true,
      issueCodes: [],
      authority: 'server',
      renderCheck: 'pending',
      legacyDefinitionHash: hashTemplateDefinition(store.get('legacy-1')!),
      oakDocDefinitionHash: hashTemplateDefinition(store.get('oak-1')!),
    });
    expect(readOakDocMigrationMetadata(template.contentJson)?.validation?.runId).toBe(validation.runId);
  });

  it('keeps a stale pass stale through LEGACY/OAKDOC toggles until the check is rerun', async () => {
    await linkAndRun();
    // Edit the target definition after validation.
    const row = store.get('oak-1')!;
    store.set('oak-1', {
      ...row,
      version: row.version + 1,
      contentJson: { ...row.contentJson, oakDoc: oakDocAsset(['company.name']) },
    });

    await setOakDocMigrationPreference({
      oakDocTemplateId: 'oak-1',
      expectedRevision: store.get('oak-1')!.version,
      preference: 'LEGACY',
      reason: 'toggle',
    }, params);

    await expect(setOakDocMigrationPreference({
      oakDocTemplateId: 'oak-1',
      expectedRevision: store.get('oak-1')!.version,
      preference: 'OAKDOC',
      reason: 'promote',
    }, params)).rejects.toThrow(/server parity validation/);

    await runOakDocMigrationValidation({
      oakDocTemplateId: 'oak-1',
      expectedRevision: store.get('oak-1')!.version,
    }, params);
    const promoted = await setOakDocMigrationPreference({
      oakDocTemplateId: 'oak-1',
      expectedRevision: store.get('oak-1')!.version,
      preference: 'OAKDOC',
      reason: 'promote',
    }, params);
    expect(readOakDocMigrationMetadata(promoted.contentJson)?.preference).toBe('OAKDOC');
    await expect(resolvePreferredMigratedTemplate('legacy-1', 'tenant-1'))
      .resolves.toMatchObject({ id: 'oak-1' });
    // New runs (tasks, batches) switch to the preferred replacement; other
    // IDs pass through unchanged.
    await expect(resolveTemplateIdsForNewRun(['legacy-1', 'oak-1', 'missing'], 'tenant-1'))
      .resolves.toEqual(['oak-1', 'oak-1', 'missing']);
  });

  it('keeps a new run on the A4 template until its replacement is preferred', async () => {
    await linkAndRun();
    await expect(resolveTemplateIdsForNewRun(['legacy-1'], 'tenant-1')).resolves.toEqual(['legacy-1']);
  });

  it('sends a new run on a removed A4 template to its linked Word template', async () => {
    await linkAndRun();
    const legacy = store.get('legacy-1')!;
    store.set('legacy-1', { ...legacy, version: legacy.version + 1, isActive: false, deletedAt: new Date() });
    await expect(resolveTemplateIdsForNewRun(['legacy-1'], 'tenant-1')).resolves.toEqual(['oak-1']);
  });

  it('invalidates evidence when the legacy source changes', async () => {
    await linkAndRun();
    const legacy = store.get('legacy-1')!;
    store.set('legacy-1', { ...legacy, version: 4, content: '<p>{{company.uen}}</p>' });

    await expect(setOakDocMigrationPreference({
      oakDocTemplateId: 'oak-1',
      expectedRevision: store.get('oak-1')!.version,
      preference: 'OAKDOC',
      reason: 'promote',
    }, params)).rejects.toThrow(/server parity validation/);
  });

  it('never promotes on a self-reported (forged) pass', async () => {
    await linkOakDocMigration({
      oakDocTemplateId: 'oak-1',
      legacyTemplateId: 'legacy-1',
      expectedRevision: 1,
      reason: 'pair',
    }, params);
    const row = store.get('oak-1')!;
    const metadata = readOakDocMigrationMetadata(row.contentJson)!;
    store.set('oak-1', {
      ...row,
      contentJson: mergeOakDocMigrationMetadata(row.contentJson, {
        ...metadata,
        validation: {
          checkedAt: new Date().toISOString(),
          passed: true,
          legacyTemplateVersion: 3,
          oakDocTemplateVersion: row.version,
          issueCodes: [],
        },
      }),
    });

    await expect(setOakDocMigrationPreference({
      oakDocTemplateId: 'oak-1',
      expectedRevision: row.version,
      preference: 'OAKDOC',
      reason: 'promote',
    }, params)).rejects.toThrow(/server parity validation/);
  });

  it('fails the check for inactive, empty-coverage or corrupted targets', async () => {
    store.set('oak-1', {
      ...store.get('oak-1')!,
      isActive: false,
      contentJson: { oakDoc: oakDocAsset([]) },
    });
    downloadOakDocTemplate.mockRejectedValueOnce(new Error('integrity'));

    const { validation } = await linkAndRun();
    expect(validation.passed).toBe(false);
    expect(validation.issueCodes).toEqual(expect.arrayContaining(['TARGET_ASSET_INTEGRITY', 'TARGET_INACTIVE']));

    const { validation: second } = await runOakDocMigrationValidation({
      oakDocTemplateId: 'oak-1',
      expectedRevision: store.get('oak-1')!.version,
    }, params);
    expect(second.issueCodes).toEqual(expect.arrayContaining(['FIELD_COVERAGE_EMPTY', 'TARGET_INACTIVE']));
  });

  it('treats a missing or foreign-tenant source as a blocker', async () => {
    await linkOakDocMigration({
      oakDocTemplateId: 'oak-1',
      legacyTemplateId: 'legacy-1',
      expectedRevision: 1,
      reason: 'pair',
    }, params);
    store.set('legacy-1', { ...store.get('legacy-1')!, deletedAt: new Date() });

    await expect(runOakDocMigrationValidation({ oakDocTemplateId: 'oak-1', expectedRevision: 2 }, params))
      .rejects.toThrow(/no longer exists/);

    store.set('legacy-1', { ...store.get('legacy-1')!, deletedAt: null, tenantId: 'tenant-2' });
    await expect(runOakDocMigrationValidation({ oakDocTemplateId: 'oak-1', expectedRevision: 2 }, params))
      .rejects.toThrow(/no longer exists/);
  });

  it('rejects a second OakDoc link and fails closed on ambiguous mappings', async () => {
    await linkAndRun();
    store.set('oak-2', {
      ...store.get('oak-1')!,
      id: 'oak-2',
      version: 1,
      contentJson: { oakDoc: oakDocAsset(['company.name']) },
    });
    await expect(linkOakDocMigration({
      oakDocTemplateId: 'oak-2',
      legacyTemplateId: 'legacy-1',
      expectedRevision: 1,
      reason: 'pair',
    }, params)).rejects.toThrow(/already linked/);

    // A duplicate written around the guard (e.g. copied metadata).
    const oak1 = store.get('oak-1')!;
    store.set('oak-2', { ...store.get('oak-2')!, contentJson: { ...oak1.contentJson } });
    await expect(resolvePreferredMigratedTemplate('legacy-1', 'tenant-1'))
      .resolves.toMatchObject({ id: 'legacy-1' });
    const { validation } = await runOakDocMigrationValidation({
      oakDocTemplateId: 'oak-1',
      expectedRevision: store.get('oak-1')!.version,
    }, params);
    expect(validation.issueCodes).toContain('DUPLICATE_MAPPING');
  });

  it('refuses a run against a stale revision and a source edited mid-run', async () => {
    await linkOakDocMigration({
      oakDocTemplateId: 'oak-1',
      legacyTemplateId: 'legacy-1',
      expectedRevision: 1,
      reason: 'pair',
    }, params);
    await expect(runOakDocMigrationValidation({ oakDocTemplateId: 'oak-1', expectedRevision: 1 }, params))
      .rejects.toThrow(/changed/);

    downloadOakDocTemplate.mockImplementationOnce(async () => {
      const legacy = store.get('legacy-1')!;
      store.set('legacy-1', { ...legacy, content: '<p>edited</p>', version: legacy.version + 1 });
      return { buffer: Buffer.from(docxBytes), metadata: {} };
    });
    await expect(runOakDocMigrationValidation({ oakDocTemplateId: 'oak-1', expectedRevision: 2 }, params))
      .rejects.toThrow(/changed during the check/);
  });

  it('metadata-only revisions keep valid server evidence', async () => {
    await linkAndRun();
    await setOakDocMigrationPreference({
      oakDocTemplateId: 'oak-1',
      expectedRevision: store.get('oak-1')!.version,
      preference: 'LEGACY',
      reason: 'hold',
    }, params);
    const legacy = store.get('legacy-1')!;
    const oakDoc = store.get('oak-1')!;
    expect(getOakDocMigrationReadiness({
      metadata: readOakDocMigrationMetadata(oakDoc.contentJson),
      legacyTemplateVersion: legacy.version,
      oakDocTemplateVersion: oakDoc.version,
      definitionHashes: {
        legacyDefinitionHash: hashTemplateDefinition(legacy),
        oakDocDefinitionHash: hashTemplateDefinition(oakDoc),
      },
    })).toBe('READY_FOR_SWITCHOVER');
  });
});
