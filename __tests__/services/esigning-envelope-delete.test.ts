import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDraftEsigningEnvelope } from '@/services/esigning-envelope.service';
import { makeEsigningScope } from '../helpers/esigning-scope';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  delete: vi.fn(),
  deletePrefix: vi.fn(),
  captureTaskStageIds: vi.fn(),
  reconcileTaskStageIds: vi.fn(),
  createAuditLog: vi.fn(),
  resolveEsigningActorScope: vi.fn(),
  lockRow: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    esigningEnvelope: {
      findFirst: mocks.findFirst,
      delete: mocks.delete,
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        $queryRaw: mocks.lockRow,
        esigningEnvelope: { delete: mocks.delete },
      }),
  },
}));

vi.mock('@/lib/storage', () => ({
  storage: { deletePrefix: mocks.deletePrefix },
  StorageKeys: {
    esigningEnvelopePrefix: (tenantId: string, envelopeId: string) =>
      `esigning/${tenantId}/${envelopeId}/`,
  },
}));

vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.createAuditLog }));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/services/tasks/integration.service', () => ({
  safelyCaptureEsigningTaskStageIds: mocks.captureTaskStageIds,
  safelyReconcileTaskStageIds: mocks.reconcileTaskStageIds,
  safelyReconcileEsigningEnvelopeTaskOutcomes: vi.fn(),
}));

vi.mock('@/services/esigning-envelope.lib', async () => {
  const actual = await vi.importActual<typeof import('@/services/esigning-envelope.lib')>(
    '@/services/esigning-envelope.lib'
  );
  return {
    ...actual,
    resolveEsigningActorScope: mocks.resolveEsigningActorScope,
  };
});

const session = {
  id: 'user-1',
  tenantId: 'tenant-1',
} as never;

describe('e-signing envelope deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveEsigningActorScope.mockResolvedValue(makeEsigningScope({ admin: true }));
    mocks.findFirst.mockResolvedValue({
      id: 'envelope-1',
      status: 'COMPLETED',
      createdById: 'user-1',
      title: 'Signed NDA',
      companyId: null,
    });
    // The locked row is the committed state; by default it is what the first read saw.
    mocks.lockRow.mockImplementation(async () => [
      { tenantId: 'tenant-1', companyId: null, ...(await mocks.findFirst()) },
    ]);
    mocks.captureTaskStageIds.mockResolvedValue(['stage-1']);
    mocks.delete.mockResolvedValue(undefined);
    mocks.deletePrefix.mockResolvedValue(undefined);
    mocks.reconcileTaskStageIds.mockResolvedValue(undefined);
    mocks.createAuditLog.mockResolvedValue(undefined);
  });

  it.each(['DRAFT', 'COMPLETED', 'DECLINED', 'VOIDED'])('permanently deletes %s envelopes and their storage', async (status) => {
    mocks.findFirst.mockResolvedValue({ id: 'envelope-1', status, createdById: 'user-1', title: 'Signed NDA', companyId: null });
    await deleteDraftEsigningEnvelope(session, 'tenant-1', 'envelope-1');

    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: 'envelope-1' } });
    expect(mocks.deletePrefix).toHaveBeenCalledWith('esigning/tenant-1/envelope-1/');
    expect(mocks.reconcileTaskStageIds).toHaveBeenCalledWith(
      'tenant-1',
      ['stage-1'],
      'user-1'
    );
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE',
      entityId: 'envelope-1',
      summary: `Deleted ${status.toLowerCase()} e-signing envelope "Signed NDA"`,
    }));
  });
  it.each(['SENT', 'IN_PROGRESS'])('rejects deletion of %s envelopes', async (status) => {
    mocks.findFirst.mockResolvedValue({ id: 'envelope-1', status, createdById: 'user-1' });
    await expect(deleteDraftEsigningEnvelope(session, 'tenant-1', 'envelope-1')).rejects.toThrow('Only draft, completed, declined or voided');
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it.each(['DECLINED', 'VOIDED'])('preserves delete permissions for %s envelopes', async (status) => {
    mocks.findFirst.mockResolvedValue({ id: 'envelope-1', status, createdById: 'user-2' });
    mocks.resolveEsigningActorScope.mockResolvedValue(makeEsigningScope({ tenantWide: { read: true } }));
    await expect(deleteDraftEsigningEnvelope(session, 'tenant-1', 'envelope-1')).rejects.toThrow('Forbidden');
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('re-checks access on the locked row and deletes nothing when the envelope moved', async () => {
    // The actor may delete in company-a; by the time the row is locked it is in company-b.
    mocks.resolveEsigningActorScope.mockResolvedValue(
      makeEsigningScope({ companies: { 'company-a': { read: true, delete: true } } })
    );
    mocks.findFirst.mockResolvedValue({
      id: 'envelope-1', status: 'DRAFT', createdById: 'user-2', title: 'Moved', companyId: 'company-a',
    });
    mocks.lockRow.mockResolvedValue([
      { id: 'envelope-1', tenantId: 'tenant-1', status: 'DRAFT', createdById: 'user-2', companyId: 'company-b' },
    ]);

    await expect(deleteDraftEsigningEnvelope(session, 'tenant-1', 'envelope-1')).rejects.toThrow('Forbidden');
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.deletePrefix).not.toHaveBeenCalled();
  });
});
