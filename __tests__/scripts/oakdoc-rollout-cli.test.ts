// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  $disconnect: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
const rollout = vi.hoisted(() => ({
  buildOakDocRolloutInventory: vi.fn(async () => ({ templates: { total: 0 } })),
  buildTemplateCutoverPlan: vi.fn(async (_tenantId: string, direction: string) => ({ direction, hash: 'p', items: [] })),
  applyTemplateCutover: vi.fn(async () => ({ direction: 'OAKDOC', manifestHash: 'p', results: [] })),
  buildA4LibraryRemovalPlan: vi.fn(async () => ({ hash: 'r', items: [] })),
  applyA4LibraryRemoval: vi.fn(async () => ({ manifestHash: 'r', results: [] })),
}));
vi.mock('@/services/oakdoc-rollout.service', () => rollout);
const templates = vi.hoisted(() => ({ migrateCanonicalOakDocTemplates: vi.fn() }));
vi.mock('@/services/oakdoc-consolidated-migration.service', () => templates);

import { runOakDocRollout } from '../../scripts/oakdoc-rollout';
import { runTemplateMigration } from '../../scripts/migrate-oakdoc-templates';

const workspace = '11111111-1111-4111-8111-111111111111';
const operator = '22222222-2222-4222-8222-222222222222';
const manifest = 'a'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findFirst.mockResolvedValue({ id: operator });
});

describe('OakDoc rollout CLI', () => {
  it('defaults to a dry run that writes nothing', async () => {
    const result = await runOakDocRollout(['--workspace', workspace]);
    expect(result.mode).toBe('dry-run');
    expect(rollout.buildOakDocRolloutInventory).toHaveBeenCalledWith(workspace);
    expect(rollout.applyTemplateCutover).not.toHaveBeenCalled();
    expect(rollout.applyA4LibraryRemoval).not.toHaveBeenCalled();
  });

  it('needs an explicit workspace', async () => {
    await expect(runOakDocRollout([])).rejects.toThrow('--workspace');
  });
});

describe('OakDoc template cutover CLI', () => {
  it('shows both cutover plans in the dry run', async () => {
    const result = await runOakDocRollout(['--workspace', workspace]);
    expect(result).toMatchObject({
      templateCutover: { direction: 'OAKDOC' },
      templateRollback: { direction: 'LEGACY' },
    });
    expect(rollout.applyTemplateCutover).not.toHaveBeenCalled();
  });

  it('applies a cutover or rollback only with an operator, a plan hash and a reason', async () => {
    await expect(runOakDocRollout(['--workspace', workspace, '--apply-template-cutover', '--operator', operator]))
      .rejects.toThrow('--manifest');
    await expect(runOakDocRollout([
      '--workspace', workspace, '--apply-template-cutover', '--apply-template-rollback',
      '--operator', operator, '--manifest', manifest,
    ])).rejects.toThrow('one apply step');

    await runOakDocRollout([
      '--workspace', workspace, '--apply-template-rollback', '--operator', operator,
      '--manifest', manifest, '--reason', 'Undo pilot',
    ]);
    expect(rollout.applyTemplateCutover).toHaveBeenCalledWith({
      tenantId: workspace, userId: operator, direction: 'LEGACY', manifestHash: manifest, reason: 'Undo pilot',
    });
  });
});

describe('A4 library removal CLI', () => {
  it('shows the removal plan in the dry run and removes only with an operator, a plan hash and a reason', async () => {
    const dryRun = await runOakDocRollout(['--workspace', workspace]);
    expect(dryRun).toMatchObject({ a4LibraryRemoval: { hash: 'r' } });
    expect(rollout.applyA4LibraryRemoval).not.toHaveBeenCalled();

    await expect(runOakDocRollout(['--workspace', workspace, '--remove-a4-library', '--operator', operator]))
      .rejects.toThrow('--manifest');
    await expect(runOakDocRollout([
      '--workspace', workspace, '--remove-a4-library', '--apply-template-cutover',
      '--operator', operator, '--manifest', manifest,
    ])).rejects.toThrow('one apply step');

    const run = await runOakDocRollout([
      '--workspace', workspace, '--remove-a4-library', '--operator', operator,
      '--manifest', manifest, '--reason', 'A4 retired',
    ]);
    expect(run.mode).toBe('remove-a4-library');
    expect(rollout.applyA4LibraryRemoval).toHaveBeenCalledWith({
      tenantId: workspace, userId: operator, manifestHash: manifest, reason: 'A4 retired',
    });
  });
});

describe('OakDoc template migration CLI', () => {
  it('requires an explicit workspace and active operator, and only writes with --apply', async () => {
    await expect(runTemplateMigration(['--workspace', workspace])).rejects.toThrow('--operator');

    const dryRun = await runTemplateMigration(['--workspace', workspace, '--operator', operator]);
    expect(dryRun.mode).toBe('dry-run');
    expect(templates.migrateCanonicalOakDocTemplates).not.toHaveBeenCalled();

    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    await expect(runTemplateMigration(['--workspace', workspace, '--operator', operator, '--apply']))
      .rejects.toThrow('operator');

    templates.migrateCanonicalOakDocTemplates.mockResolvedValue({ standard: {}, serviceAgreement: {} });
    const applied = await runTemplateMigration(['--workspace', workspace, '--operator', operator, '--apply']);
    expect(applied.mode).toBe('apply');
    expect(templates.migrateCanonicalOakDocTemplates).toHaveBeenCalledWith({ tenantId: workspace, userId: operator });
  });
});
