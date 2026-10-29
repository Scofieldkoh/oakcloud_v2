import { describe, expect, it } from 'vitest';
import { postpaidBillableYears } from '@/services/billing/postpaid';
import { filingBeforeEngagementStart } from '@/services/billing/postpaid-triggers';
import { deadlineWhereForSearch, isManagedExternally } from '@/services/deadline/service';
import { deadlineSearchSchema } from '@/lib/validations/deadline';
import { clientServiceFeeLineInputSchema } from '@/lib/validations/client-service';
import { serviceVariantFeeTemplateSchema } from '@/lib/validations/service-catalog';

const filed = (obligationCode: string, yearOfAssessment: number, completedAt: string) => ({
  obligationCode,
  yearOfAssessment,
  completedAt: new Date(completedAt),
});

describe('postpaidBillableYears', () => {
  const service = { startDate: new Date('2026-04-01T00:00:00.000Z'), engagementStartYearOfAssessment: 2026 };

  it('bills each YA once, on the day its first trigger filing was set to Filed (Singapore date)', () => {
    const years = postpaidBillableYears(service, 'SG_ECI_OR_FORM_C_FILED', [
      filed('SG_FORM_C', 2027, '2027-11-20T02:00:00.000Z'),
      // 23:30 UTC on 2 March is 3 March in Singapore.
      filed('SG_ECI', 2027, '2027-03-02T23:30:00.000Z'),
      filed('SG_FORM_C', 2026, '2026-11-10T02:00:00.000Z'),
    ]);
    expect([...years.entries()]).toEqual([[2027, '2027-03-03'], [2026, '2026-11-10']]);
  });

  it('only counts the trigger filing and YAs from the engagement start', () => {
    const years = postpaidBillableYears(service, 'SG_FORM_C_FILED', [
      filed('SG_ECI', 2027, '2027-03-01T02:00:00.000Z'),
      filed('SG_FORM_C', 2025, '2026-05-01T02:00:00.000Z'),
    ]);
    expect(years.size).toBe(0);
  });

  it('without an engagement start YA, bills filings made on or after the service start', () => {
    const years = postpaidBillableYears({ ...service, engagementStartYearOfAssessment: null }, 'SG_ECI_FILED', [
      filed('SG_ECI', 2026, '2026-03-20T02:00:00.000Z'),
      filed('SG_ECI', 2027, '2026-04-02T02:00:00.000Z'),
    ]);
    expect([...years.keys()]).toEqual([2027]);
  });

  it('ignores an unknown trigger', () => {
    expect(postpaidBillableYears(service, null, [filed('SG_ECI', 2027, '2027-03-01T02:00:00.000Z')]).size).toBe(0);
  });
});

describe('fee line billing basis validation', () => {
  const fee = { description: 'Tax filing', amount: '800.00', currency: 'SGD', billingFrequency: 'ONE_TIME', displayOrder: 0 };

  it('requires a trigger for a postpaid fee line', () => {
    expect(clientServiceFeeLineInputSchema.safeParse({ ...fee, billingTiming: 'POSTPAID' }).success).toBe(false);
    expect(clientServiceFeeLineInputSchema.safeParse({ ...fee, billingTiming: 'POSTPAID', postpaidTrigger: 'SG_ECI_OR_FORM_C_FILED' }).success).toBe(true);
    expect(clientServiceFeeLineInputSchema.safeParse(fee).success).toBe(true);
  });

  it('requires a trigger for a postpaid fee template', () => {
    const template = { description: 'Tax filing', currency: 'SGD', billingFrequency: 'ANNUALLY', displayOrder: 0 };
    expect(serviceVariantFeeTemplateSchema.safeParse({ ...template, billingTiming: 'POSTPAID' }).success).toBe(false);
    expect(serviceVariantFeeTemplateSchema.safeParse({ ...template, billingTiming: 'POSTPAID', postpaidTrigger: 'SG_FORM_C_FILED' }).success).toBe(true);
  });
});

describe('filingBeforeEngagementStart', () => {
  const base = { obligationCode: 'SG_ECI', yearOfAssessment: 2026, engagementStartYearOfAssessment: 2027 };

  it('flags a filing before the engagement start that a postpaid line bills on', () => {
    expect(filingBeforeEngagementStart({ ...base, postpaidTriggers: ['SG_ECI_OR_FORM_C_FILED'] })).toBe(true);
    expect(filingBeforeEngagementStart({ ...base, postpaidTriggers: [null, 'SG_ECI_FILED'] })).toBe(true);
  });

  it('ignores filings from the engagement start, other triggers, and services without a start YA', () => {
    expect(filingBeforeEngagementStart({ ...base, yearOfAssessment: 2027, postpaidTriggers: ['SG_ECI_FILED'] })).toBe(false);
    expect(filingBeforeEngagementStart({ ...base, postpaidTriggers: ['SG_FORM_C_FILED'] })).toBe(false);
    expect(filingBeforeEngagementStart({ ...base, engagementStartYearOfAssessment: null, postpaidTriggers: ['SG_ECI_FILED'] })).toBe(false);
    expect(filingBeforeEngagementStart({ ...base, postpaidTriggers: [] })).toBe(false);
  });
});

describe('Managed externally deadlines', () => {
  it('reads company rows filed by the client or another provider as managed externally', () => {
    expect(isManagedExternally({ ownershipScope: 'COMPANY', filingResponsibility: 'EXTERNAL_PROVIDER' })).toBe(true);
    expect(isManagedExternally({ ownershipScope: 'COMPANY', filingResponsibility: 'CLIENT' })).toBe(true);
    expect(isManagedExternally({ ownershipScope: 'COMPANY', filingResponsibility: 'OAKCLOUD' })).toBe(false);
    expect(isManagedExternally({ ownershipScope: 'SERVICE', filingResponsibility: null })).toBe(false);
  });

  it('filters them under Waived, not Open', () => {
    const scope = { tenantId: 'tenant-1' };
    const waived = deadlineWhereForSearch(deadlineSearchSchema.parse({ openOnly: false, statuses: ['WAIVED'] }), scope, '2026-09-28');
    expect(JSON.stringify(waived.AND)).toContain('"filingResponsibility":{"in":["EXTERNAL_PROVIDER","CLIENT"]}');
    const open = deadlineWhereForSearch(deadlineSearchSchema.parse({}), scope, '2026-09-28');
    expect(JSON.stringify(open.AND)).toContain('"filingResponsibility":{"notIn":["EXTERNAL_PROVIDER","CLIENT"]}');
  });
});

describe('describeUnbilledFilings', () => {
  it('names the company, filing, YA and the services whose engagement start is later', async () => {
    const { describeUnbilledFilings } = await import('@/components/services/deadlines/deadline-bulk-actions');
    const selected = [{
      id: 'row-1',
      company: { id: 'c1', name: 'Acme Pte. Ltd.', displayAlias: null, displayLabel: 'Acme' },
      obligation: { code: 'SG_FORM_C', yearOfAssessment: 2026 },
    }] as never;
    expect(describeUnbilledFilings(selected, {
      items: [
        { occurrenceId: 'row-1', services: [{ clientServiceId: 's1', serviceName: 'Corporate tax', engagementStartYearOfAssessment: 2027 }] },
        { occurrenceId: 'not-selected', services: [{ clientServiceId: 's1', serviceName: 'Corporate tax', engagementStartYearOfAssessment: 2027 }] },
      ],
    })).toEqual([{ id: 'row-1', company: 'Acme', filing: 'Form C YA 2026', services: 'Corporate tax starts from YA 2027' }]);
  });
});
