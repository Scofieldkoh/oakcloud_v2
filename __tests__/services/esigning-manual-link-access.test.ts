import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEsigningScope } from '../helpers/esigning-scope';

const mocks = vi.hoisted(() => ({
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
    resolveEsigningActorScope: mocks.resolveEsigningActorScope,
  };
});

import { getEsigningEnvelopeRecipientManualLink } from '@/services/esigning-envelope.service';

const session = {
  id: 'user-2',
  tenantId: 'tenant-1',
  isSuperAdmin: false,
  isWorkspaceAdmin: false,
  hasAllCompaniesAccess: false,
  companyIds: ['company-1'],
} as never;

function envelopeIn(companyId: string | null) {
  return {
    id: 'envelope-1',
    tenantId: 'tenant-1',
    title: 'Service Agreement',
    status: 'IN_PROGRESS',
    companyId,
    createdById: 'user-1',
    recipients: [{
      id: 'recipient-1',
      type: 'SIGNER',
      name: 'Alex Lim',
      email: 'alex@example.com',
      status: 'NOTIFIED',
      sessionVersion: 1,
    }],
  };
}

describe('e-signing manual link access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Update rights for company-1 only; nothing tenant-wide.
    mocks.resolveEsigningActorScope.mockResolvedValue(
      makeEsigningScope({ companies: { 'company-1': { read: true, update: true } } })
    );
    mocks.createEsigningAccessLinkToken.mockResolvedValue('token-1');
  });

  it('does not mint a bearer signing link for another company', async () => {
    mocks.findFirst.mockResolvedValue(envelopeIn('company-2'));

    await expect(getEsigningEnvelopeRecipientManualLink(
      session,
      'tenant-1',
      'envelope-1',
      'recipient-1',
    )).rejects.toThrow('Forbidden');

    expect(mocks.createEsigningAccessLinkToken).not.toHaveBeenCalled();
  });

  it('does not mint a link for a no-company envelope made by someone else', async () => {
    mocks.findFirst.mockResolvedValue(envelopeIn(null));

    await expect(getEsigningEnvelopeRecipientManualLink(
      session,
      'tenant-1',
      'envelope-1',
      'recipient-1',
    )).rejects.toThrow('Forbidden');

    expect(mocks.createEsigningAccessLinkToken).not.toHaveBeenCalled();
  });

  it('mints a link for an envelope in the actor\'s own company', async () => {
    mocks.findFirst.mockResolvedValue(envelopeIn('company-1'));

    await expect(getEsigningEnvelopeRecipientManualLink(
      session,
      'tenant-1',
      'envelope-1',
      'recipient-1',
    )).resolves.toBeDefined();

    expect(mocks.createEsigningAccessLinkToken).toHaveBeenCalledTimes(1);
  });
});
