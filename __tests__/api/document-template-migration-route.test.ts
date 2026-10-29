// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runOakDocMigrationValidation = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false })),
}));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn(async () => undefined) }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/services/document-template.service', () => ({
  getDocumentTemplateById: vi.fn(),
  updateDocumentTemplate: vi.fn(),
  deleteDocumentTemplate: vi.fn(),
  restoreDocumentTemplate: vi.fn(),
}));
vi.mock('@/services/oakdoc-template.service', () => ({
  downloadOakDocTemplate: vi.fn(),
  updateOakDocTemplate: vi.fn(),
}));
vi.mock('@/services/oakdoc-migration.service', () => ({
  linkOakDocMigration: vi.fn(),
  setOakDocMigrationPreference: vi.fn(),
  runOakDocMigrationValidation: (...args: unknown[]) => runOakDocMigrationValidation(...args),
}));

const { PATCH } = await import('@/app/api/document-templates/[id]/route');

function patch(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest('http://localhost/api/document-templates/oak-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'oak-1' }) },
  );
}

beforeEach(() => runOakDocMigrationValidation.mockReset());

describe('document template migration controls', () => {
  it('refuses a caller-submitted parity pass', async () => {
    const response = await patch({
      action: 'recordOakDocMigrationValidation',
      expectedRevision: 2,
      passed: true,
      issueCodes: [],
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { reason: 'OAKDOC_CALLER_VALIDATION_REJECTED' },
    });
    expect(runOakDocMigrationValidation).not.toHaveBeenCalled();
  });

  it('runs the server check with only the target and revision', async () => {
    runOakDocMigrationValidation.mockResolvedValue({
      template: { id: 'oak-1', version: 3 },
      validation: { passed: true, authority: 'server' },
    });
    const response = await patch({
      action: 'runOakDocMigrationValidation',
      expectedRevision: 2,
      passed: true,
    });
    expect(response.status).toBe(200);
    expect(runOakDocMigrationValidation).toHaveBeenCalledWith(
      { oakDocTemplateId: 'oak-1', expectedRevision: 2 },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );
    await expect(response.json()).resolves.toMatchObject({
      revision: 3,
      migrationValidation: { authority: 'server' },
    });
  });
});
