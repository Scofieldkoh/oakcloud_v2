import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canAccessCompany: vi.fn(),
  canMutateEnvelope: vi.fn(),
  createAuditLog: vi.fn(),
  createEsigningAccessLinkToken: vi.fn(),
  findFirst: vi.fn(),
  resolveEsigningActorScope: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    esigningEnvelope: { findFirst: mocks.findFirst },
  },
}));
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, canAccessCompany: mocks.canAccessCompany };
});
vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.createAuditLog }));
vi.mock('@/lib/esigning-session', () => ({
  buildEsigningSigningUrl: (token: string, baseUrl = 'https://app.example.com') => `${baseUrl}/sign/${token}`,
  createEsigningAccessLinkToken: mocks.createEsigningAccessLinkToken,
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/services/esigning-envelope.lib', async () => {
  const actual = await vi.importActual<typeof import('@/services/esigning-envelope.lib')>('@/services/esigning-envelope.lib');
  return {
    ...actual,
    canMutateEnvelope: mocks.canMutateEnvelope,
    resolveEsigningActorScope: mocks.resolveEsigningActorScope,
  };
});

import { getEsigningEnvelopeRecipientManualLink } from '@/services/esigning-envelope.service';

const session = {
  id: 'user-1',
  tenantId: 'tenant-1',
  isSuperAdmin: false,
  isWorkspaceAdmin: false,
  hasAllCompaniesAccess: false,
  companyIds: ['company-1'],
} as never;

describe('e-signing manual link access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveEsigningActorScope.mockResolvedValue({
      tenantId: 'tenant-1',
      canCreate: false,
      canReadAll: true,
      canUpdateAny: true,
      canDeleteAny: false,
      canManage: false,
    });
    mocks.canMutateEnvelope.mockReturnValue(true);
    mocks.canAccessCompany.mockResolvedValue(false);
    mocks.createEsigningAccessLinkToken.mockResolvedValue('token-1');
    mocks.findFirst.mockResolvedValue({
      id: 'envelope-1',
      tenantId: 'tenant-1',
      title: 'Service Agreement',
      status: 'IN_PROGRESS',
      companyId: 'company-2',
      createdById: 'user-1',
      recipients: [{
        id: 'recipient-1',
        type: 'SIGNER',
        name: 'Alex Lim',
        email: 'alex@example.com',
        status: 'NOTIFIED',
        sessionVersion: 1,
      }],
    });
  });

  it('does not mint a bearer signing link for an inaccessible company', async () => {
    await expect(getEsigningEnvelopeRecipientManualLink(
      session,
      'tenant-1',
      'envelope-1',
      'recipient-1',
    )).rejects.toThrow('Forbidden');

    expect(mocks.canAccessCompany).toHaveBeenCalledWith(session, 'company-2');
    expect(mocks.createEsigningAccessLinkToken).not.toHaveBeenCalled();
  });
});
