import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDraftEsigningEnvelope } from '@/services/esigning-envelope.service';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  delete: vi.fn(),
  deletePrefix: vi.fn(),
  captureTaskStageIds: vi.fn(),
  reconcileTaskStageIds: vi.fn(),
  createAuditLog: vi.fn(),
  resolveEsigningActorScope: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    esigningEnvelope: {
      findFirst: mocks.findFirst,
      delete: mocks.delete,
    },
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
    mocks.resolveEsigningActorScope.mockResolvedValue({ canDeleteAny: true });
    mocks.findFirst.mockResolvedValue({
      id: 'envelope-1',
      status: 'COMPLETED',
      createdById: 'user-1',
      title: 'Signed NDA',
      companyId: null,
    });
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
    mocks.resolveEsigningActorScope.mockResolvedValue({ canDeleteAny: false, canDeleteOwn: false });
    await expect(deleteDraftEsigningEnvelope(session, 'tenant-1', 'envelope-1')).rejects.toThrow('Forbidden');
    expect(mocks.delete).not.toHaveBeenCalled();
  });

});
