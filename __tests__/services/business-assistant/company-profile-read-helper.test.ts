import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorization: vi.fn(),
  companies: new Map<string, any>(),
}));

vi.mock('@/lib/fresh-authorization', () => ({
  evaluateFreshAuthorization: mocks.authorization,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    company: {
      findFirst: vi.fn(async ({ where, select }: any) => {
        const values = [...mocks.companies.values()].filter((company) => {
          if (where.id && company.id !== where.id) return false;
          if (where.tenantId && company.tenantId !== where.tenantId) return false;
          if (where.deletedAt === null && company.deletedAt) return false;
          return true;
        });
        const company = values[0] ?? null;
        if (!company) return null;
        if (!select) return company;
        return company;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        const rows = [...mocks.companies.values()].filter((company) => {
          if (where.tenantId && company.tenantId !== where.tenantId) return false;
          if (where.deletedAt === null && company.deletedAt) return false;
          if (!where.OR) return true;
          return where.OR.some((clause: any) => {
            if (clause.uen?.equals) return company.uen.toLowerCase() === clause.uen.equals.toLowerCase();
            if (clause.name?.equals) return company.name.toLowerCase() === clause.name.equals.toLowerCase();
            if (clause.displayAlias?.equals) return (company.displayAlias ?? '').toLowerCase() === clause.displayAlias.equals.toLowerCase();
            if (clause.name?.contains) return company.name.toLowerCase().includes(clause.name.contains.toLowerCase());
            if (clause.displayAlias?.contains) return (company.displayAlias ?? '').toLowerCase().includes(clause.displayAlias.contains.toLowerCase());
            return false;
          });
        });
        return rows.slice(0, 20);
      }),
    },
  },
}));

import {
  messageStronglyIdentifiesCompany,
  readAuthorizedCompanyAssistantProfile,
  resolveAuthorizedCompanyFromAssistantMessage,
} from '@/services/company/assistant-profile-read';

const actor = { tenantId: 'workspace-1', userId: 'user-1' };

function company(overrides: Record<string, unknown> = {}) {
  return {
    id: 'company-1',
    tenantId: 'workspace-1',
    deletedAt: null,
    name: 'Acme Pte. Ltd.',
    displayAlias: 'Acme',
    uen: '202612345A',
    entityType: 'LOCAL_COMPANY',
    status: 'LIVE',
    statusDate: new Date('2026-01-02T00:00:00.000Z'),
    incorporationDate: new Date('2020-03-04T00:00:00.000Z'),
    financialYearEndDay: 31,
    financialYearEndMonth: 12,
    isGstRegistered: true,
    gstRegistrationNumber: 'M91234567A',
    gstRegistrationDate: new Date('2022-05-06T00:00:00.000Z'),
    addresses: [{
      fullAddress: '1 Raffles Place Singapore 048616',
      effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
      identificationNumber: 'SHOULD-NOT-LEAK',
    }],
    officers: [
      { name: 'Alice Tan', role: 'DIRECTOR', appointmentDate: new Date('2020-03-04T00:00:00.000Z'), cessationDate: null, isCurrent: true, identificationNumber: 'S1234567A', address: 'Personal address' },
      { name: 'Bob Lim', role: 'SECRETARY', appointmentDate: new Date('2021-01-01T00:00:00.000Z'), cessationDate: null, isCurrent: true, identificationNumber: 'S7654321A', address: 'Personal address 2' },
      { name: 'Former Director', role: 'DIRECTOR', appointmentDate: new Date('2019-01-01T00:00:00.000Z'), cessationDate: new Date('2020-01-01T00:00:00.000Z'), isCurrent: false },
    ],
    shareholders: [
      { name: 'Carol Goh', shareholderType: 'INDIVIDUAL', shareClass: 'ORDINARY', numberOfShares: 100, percentageHeld: { toString: () => '100' }, currency: 'SGD', allotmentDate: new Date('2020-03-04T00:00:00.000Z'), isCurrent: true, identificationNumber: 'S9999999A', address: 'Private address' },
      { name: 'Former Holder', shareholderType: 'INDIVIDUAL', shareClass: 'ORDINARY', numberOfShares: 1, percentageHeld: { toString: () => '1' }, currency: 'SGD', allotmentDate: null, isCurrent: false },
    ],
    auditor: { name: 'Audit LLP', appointmentDate: new Date('2025-02-01T00:00:00.000Z'), address: 'Auditor address' },
    charges: [
      { chargeNumber: 'C1', chargeType: 'FIXED', chargeHolderName: 'Bank A', registrationDate: new Date('2025-01-01T00:00:00.000Z'), isFullyDischarged: false, description: 'Sensitive description' },
      { chargeNumber: 'C0', chargeType: 'FIXED', chargeHolderName: 'Bank B', registrationDate: new Date('2024-01-01T00:00:00.000Z'), isFullyDischarged: true },
    ],
    ...overrides,
  };
}

describe('company assistant read helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.companies.clear();
    mocks.companies.set('company-1', company());
    mocks.authorization.mockImplementation(async ({ workspaceId, resource }: any) => ({
      allowed: workspaceId === 'workspace-1' && resource?.id === 'company-1',
    }));
  });

  it('reads only current, minimized company profile facts after fresh authorization', async () => {
    const result = await readAuthorizedCompanyAssistantProfile(actor, 'company-1');
    expect(result.kind).toBe('FOUND');
    if (result.kind !== 'FOUND') return;
    expect(result.company.officers.map((item) => item.name)).toEqual(['Alice Tan', 'Bob Lim']);
    expect(result.company.shareholders.map((item) => item.name)).toEqual(['Carol Goh']);
    expect(result.company.activeCharges).toHaveLength(1);
    const serialized = JSON.stringify(result.company);
    expect(serialized).not.toContain('S1234567A');
    expect(serialized).not.toContain('S7654321A');
    expect(serialized).not.toContain('S9999999A');
    expect(serialized).not.toContain('Personal address');
    expect(serialized).not.toContain('Private address');
    expect(mocks.authorization).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      permission: { resource: 'company', action: 'read' },
      resource: { kind: 'company', id: 'company-1' },
    }));
  });

  it('fails closed when company access has been revoked', async () => {
    mocks.authorization.mockResolvedValue({ allowed: false });
    await expect(readAuthorizedCompanyAssistantProfile(actor, 'company-1')).resolves.toEqual({ kind: 'UNAVAILABLE' });
  });

  it('does not cross workspace boundaries', async () => {
    mocks.companies.set('company-2', company({ id: 'company-2', tenantId: 'workspace-2', uen: '202699999Z' }));
    mocks.authorization.mockResolvedValue({ allowed: false });
    await expect(readAuthorizedCompanyAssistantProfile(actor, 'company-2')).resolves.toEqual({ kind: 'UNAVAILABLE' });
  });

  it('treats deleted companies as unavailable', async () => {
    mocks.companies.set('company-1', company({ deletedAt: new Date('2026-01-01T00:00:00.000Z') }));
    await expect(readAuthorizedCompanyAssistantProfile(actor, 'company-1')).resolves.toEqual({ kind: 'UNAVAILABLE' });
  });

  it('resolves an exact UEN from the message', async () => {
    const result = await resolveAuthorizedCompanyFromAssistantMessage(actor, 'What is the FYE for 202612345A?');
    expect(result).toMatchObject({ kind: 'FOUND', company: { id: 'company-1' } });
  });

  it('returns ambiguity rather than guessing on a non-unique name', async () => {
    mocks.companies.set('company-2', company({ id: 'company-2', name: 'Acme Holdings Pte. Ltd.', displayAlias: 'Acme', uen: '202612346B' }));
    mocks.authorization.mockResolvedValue({ allowed: true });
    const result = await resolveAuthorizedCompanyFromAssistantMessage(actor, 'Who are the directors of Acme?');
    expect(result.kind).toBe('AMBIGUOUS');
  });

  it('can strongly disambiguate attached companies by exact name, alias, or UEN', () => {
    const identity = { id: 'company-1', name: 'Acme Pte. Ltd.', displayAlias: 'Acme', uen: '202612345A' };
    expect(messageStronglyIdentifiesCompany('Tell me about Acme Pte. Ltd.', identity)).toBe(true);
    expect(messageStronglyIdentifiesCompany('GST for 202612345A', identity)).toBe(true);
    expect(messageStronglyIdentifiesCompany('What is the status?', identity)).toBe(false);
  });
});
