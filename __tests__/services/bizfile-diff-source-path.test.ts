import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.fn();
vi.mock('@/lib/prisma', () => ({ prisma: { company: { findFirst } } }));

describe('BizFile diff source paths', () => {
  beforeEach(() => {
    findFirst.mockResolvedValue({
      id: 'company-1', name: 'Example', formerName: null,
      entityType: 'PRIVATE_LIMITED', status: 'LIVE', statusDate: null, incorporationDate: null,
      primarySsicCode: null, primarySsicDescription: null,
      secondarySsicCode: null, secondarySsicDescription: null,
      lastAgmDate: null, lastArFiledDate: null, accountsDueDate: null,
      financialYearEndDay: null, financialYearEndMonth: null,
      paidUpCapitalAmount: null, issuedCapitalAmount: null,
      addresses: [], officers: [], shareholders: [],
    });
  });

  it('preserves distinct source paths for duplicate officer and shareholder rows', async () => {
    const { generateBizFileDiff } = await import('@/services/bizfile/diff');
    const result = await generateBizFileDiff('company-1', {
      entityDetails: { uen: '1', name: 'Example', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
      officers: [
        { name: '王小明', role: 'DIRECTOR' },
        { name: '王小明', role: 'DIRECTOR' },
      ],
      shareholders: [
        { name: 'Same Owner', type: 'INDIVIDUAL', shareClass: 'ORDINARY', numberOfShares: 1 },
        { name: 'Same Owner', type: 'INDIVIDUAL', shareClass: 'PREFERENCE', numberOfShares: 2 },
      ],
    }, 'tenant-1');

    expect(result.officerDiffs.map((entry) => entry.sourceRecordId)).toEqual(['officers.0', 'officers.1']);
    expect(result.shareholderDiffs.map((entry) => entry.sourceRecordId)).toEqual(['shareholders.0', 'shareholders.1']);
  });

  it('surfaces changes from every normalized singleton and repeating section', async () => {
    const { generateBizFileDiff } = await import('@/services/bizfile/diff');
    const result = await generateBizFileDiff('company-1', {
      entityDetails: {
        uen: '1', name: 'Example', entityType: 'PRIVATE_LIMITED', status: 'LIVE',
        registrationDate: '2020-01-01',
        formerNames: [{ name: 'Old Example', effectiveFrom: '2019-01-01' }],
      },
      mailingAddress: { streetName: 'Mail Street', postalCode: '123456' },
      homeCurrency: 'USD',
      shareCapital: [{ shareClass: 'ORDINARY', currency: 'SGD', numberOfShares: 10, totalValue: 10, isPaidUp: true }],
      treasuryShares: { numberOfShares: 2, currency: 'SGD' },
      auditor: { name: 'Audit LLP' },
      compliance: { fyeAsAtLastAr: '2024-12-31' },
      charges: [{ chargeHolderName: 'Oak Bank', chargeNumber: 'C1' }],
    }, 'tenant-1');

    expect(result.differences.map((difference) => difference.field)).toEqual(expect.arrayContaining([
      'registrationDate', 'formerNames', 'mailingAddress', 'homeCurrency',
      'shareCapital', 'treasuryShares', 'auditor', 'fyeAsAtLastAr', 'charges',
    ]));
  });

  it('reports a nominee flag change for an existing shareholder', async () => {
    findFirst.mockResolvedValue({
      id: 'company-1', name: 'Example', formerName: null,
      entityType: 'PRIVATE_LIMITED', status: 'LIVE', statusDate: null, incorporationDate: null,
      primarySsicCode: null, primarySsicDescription: null,
      secondarySsicCode: null, secondarySsicDescription: null,
      lastAgmDate: null, lastArFiledDate: null, accountsDueDate: null,
      financialYearEndDay: null, financialYearEndMonth: null,
      paidUpCapitalAmount: null, issuedCapitalAmount: null,
      addresses: [], officers: [],
      shareholders: [{
        id: 's1', name: 'Same Owner', shareholderType: 'INDIVIDUAL', shareClass: 'ORDINARY',
        numberOfShares: 1, identificationType: null, identificationNumber: null,
        isCurrent: true, isNominee: false,
      }],
    });
    const { generateBizFileDiff } = await import('@/services/bizfile/diff');
    const result = await generateBizFileDiff('company-1', {
      entityDetails: { uen: '1', name: 'Example', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
      shareholders: [{
        name: 'Same Owner', type: 'INDIVIDUAL', shareClass: 'ORDINARY', numberOfShares: 1, isNominee: true,
      }],
    }, 'tenant-1');

    const updated = result.shareholderDiffs.find((entry) => entry.type === 'updated');
    expect(updated?.changes).toContainEqual(expect.objectContaining({ field: 'isNominee' }));
  });
});
