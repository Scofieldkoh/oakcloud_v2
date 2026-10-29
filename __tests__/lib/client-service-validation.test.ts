import { describe, expect, it } from 'vitest';
import {
  clientServiceDeadlineImpactSchema,
  createManualClientServiceSchema,
  markServiceAgreementEffectiveSchema,
  searchClientServicesSchema,
  updateClientServiceSchema,
} from '@/lib/validations/client-service';

const variantId = '11111111-1111-4111-8111-111111111111';
const ruleId = '22222222-2222-4222-8222-222222222222';

const fourMonthlyEntries = [1, 8, 15, 22].map((day, index) => ({
  key: `entry-${index + 1}`,
  label: `Run ${index + 1}`,
  expression: { kind: 'DAY_OF_MONTH' as const, day },
  businessDayAdjustment: 'NONE' as const,
}));

describe('client service validation', () => {
  const billingSchedule = {
    schemaVersion: 1 as const,
    cadence: 'MONTHLY' as const,
    startDate: '2026-08-01',
    customInterval: { unit: 'MONTH' as const, count: 1 },
    scheduleEntries: [
      { key: 'deposit', label: 'Deposit', expression: { kind: 'DAY_OF_MONTH' as const, day: 1 }, businessDayAdjustment: 'NEXT' as const },
      { key: 'balance', label: 'Balance', expression: { kind: 'DAY_OF_MONTH' as const, day: 15 }, businessDayAdjustment: 'NEXT' as const },
    ],
  };

  const configuredBillingInput = {
    serviceVariantId: variantId,
    serviceCadence: 'MONTHLY' as const,
    startDate: '2026-08-01',
    billingDisposition: 'CONFIGURED' as const,
    feeLines: [{
      description: 'Monthly service fee', amount: '100.00', currency: 'SGD', billingFrequency: 'MONTHLY' as const,
      billingStartDate: '2026-08-01',
      scheduleConfig: billingSchedule,
    }],
  };

  it('requires an active fee line when billing is configured', () => {
    expect(createManualClientServiceSchema.safeParse({
      ...configuredBillingInput,
      feeLines: [],
    }).success).toBe(false);
    expect(createManualClientServiceSchema.safeParse({
      ...configuredBillingInput,
      feeLines: [{ ...configuredBillingInput.feeLines[0], isActive: false }],
    }).success).toBe(false);
  });

  it('allows not-required billing without fee lines and optional reason', () => {
    expect(createManualClientServiceSchema.safeParse({
      ...configuredBillingInput,
      billingDisposition: 'NOT_REQUIRED',
      billingNotRequiredReason: null,
      feeLines: [],
    }).success).toBe(true);
    expect(createManualClientServiceSchema.safeParse({
      ...configuredBillingInput,
      billingDisposition: 'NOT_REQUIRED',
      billingNotRequiredReason: 'Included elsewhere',
      feeLines: configuredBillingInput.feeLines,
    }).success).toBe(false);
  });

  it('requires configured fee schedules to have a start date and stable entry', () => {
    expect(createManualClientServiceSchema.safeParse({
      ...configuredBillingInput,
      feeLines: [{
        ...configuredBillingInput.feeLines[0],
        scheduleConfig: { ...billingSchedule, startDate: null, scheduleEntries: [] },
      }],
    }).success).toBe(false);

    expect(createManualClientServiceSchema.safeParse({
      ...configuredBillingInput,
      feeLines: [{ ...configuredBillingInput.feeLines[0], scheduleConfig: undefined }],
    }).success).toBe(true);
  });

  it('cross-validates structured cadence and compatibility start date fields', () => {
    expect(createManualClientServiceSchema.safeParse({
      ...configuredBillingInput,
      feeLines: [{
        ...configuredBillingInput.feeLines[0],
        billingFrequency: 'ANNUALLY',
      }],
    }).success).toBe(false);
    expect(updateClientServiceSchema.safeParse({
      expectedUpdatedAt: '2026-07-30T00:00:00.000Z',
      billingDisposition: 'CONFIGURED',
      feeLines: [{
        id: '33333333-3333-4333-8333-333333333333',
        description: 'Monthly service fee', amount: '100.00', currency: 'SGD', billingFrequency: 'MONTHLY',
        billingStartDate: '2026-09-01', scheduleConfig: billingSchedule, displayOrder: 0,
      }],
    }).success).toBe(false);
  });

  it('rejects caller-controlled manual fee lifecycle fields', () => {
    expect(createManualClientServiceSchema.safeParse({
      ...configuredBillingInput,
      feeLines: [{ ...configuredBillingInput.feeLines[0], isActive: false }],
    }).success).toBe(false);
  });

  it('accepts a structured schedule for any service family and normalizes the disposition', () => {
    const parsed = createManualClientServiceSchema.parse(configuredBillingInput);
    expect(parsed.billingDisposition).toBe('CONFIGURED');
    expect(parsed.feeLines[0]?.scheduleConfig?.scheduleEntries).toHaveLength(2);

    const legacy = createManualClientServiceSchema.parse({
      ...configuredBillingInput,
      billingDisposition: undefined,
      billingNotRequiredReason: undefined,
    });
    expect(legacy.billingDisposition).toBe('UNREVIEWED');
  });

  it('allows a configured update to carry the same structured schedule without a legacy updatedAt input', () => {
    const parsed = updateClientServiceSchema.parse({
      expectedUpdatedAt: '2026-07-30T00:00:00.000Z',
      billingDisposition: 'CONFIGURED',
      feeLines: [{
        id: '33333333-3333-4333-8333-333333333333',
        description: 'Monthly service fee', amount: '100.00', currency: 'SGD', billingFrequency: 'MONTHLY',
        scheduleConfig: billingSchedule, displayOrder: 0,
      }],
    });
    expect(parsed.billingDisposition).toBe('CONFIGURED');
    expect(parsed.expectedUpdatedAt).toBe('2026-07-30T00:00:00.000Z');
    expect('updatedAt' in parsed).toBe(false);
  });

  it('requires an optimistic timestamp and at least one mutation', () => {
    expect(updateClientServiceSchema.safeParse({ status: 'PAUSED' }).success).toBe(false);
    expect(updateClientServiceSchema.safeParse({ updatedAt: '2026-07-30T00:00:00.000Z' }).success).toBe(false);
    expect(updateClientServiceSchema.safeParse({ expectedUpdatedAt: '2026-07-30T00:00:00.000Z', status: 'PAUSED' }).success).toBe(true);
    expect(updateClientServiceSchema.parse({ updatedAt: '2026-07-30T00:00:00.000Z', status: 'PAUSED' })).toMatchObject({
      expectedUpdatedAt: '2026-07-30T00:00:00.000Z',
    });
    expect(updateClientServiceSchema.safeParse({
      updatedAt: '2026-07-30T00:00:00.000Z',
      expectedUpdatedAt: '2026-07-31T00:00:00.000Z',
      status: 'PAUSED',
    }).success).toBe(false);
  });

  it('accepts generic client deadline rules with stable repeatable schedule entries', () => {
    const parsed = createManualClientServiceSchema.parse({
      serviceVariantId: variantId,
      serviceCadence: 'MONTHLY',
      startDate: '2026-08-01',
      feeLines: [{ description: 'Monthly service fee', amount: '100.00', currency: 'SGD', billingFrequency: 'MONTHLY' }],
      deadlineRules: [{
        ruleId,
        enabled: true,
        parameterValues: {},
        parameterProvenance: {},
        scheduleEntries: fourMonthlyEntries,
      }],
    });

    expect(parsed.deadlineRules).toHaveLength(1);
    expect(parsed.deadlineRules?.[0]?.scheduleEntries).toHaveLength(4);
  });

  it('rejects invalid client rule provenance and more than 100 rules', () => {
    const base = {
      serviceVariantId: variantId,
      serviceCadence: 'MONTHLY' as const,
      startDate: '2026-08-01',
      feeLines: [{ description: 'Monthly service fee', amount: '100.00', currency: 'SGD', billingFrequency: 'MONTHLY' as const }],
    };
    expect(createManualClientServiceSchema.safeParse({
      ...base,
      deadlineRules: [{
        ruleId,
        enabled: true,
        parameterValues: { monthsAfterFye: 12 },
        parameterProvenance: { monthsAfterFye: 'UNKNOWN' },
        scheduleEntries: [],
      }],
    }).success).toBe(false);
    expect(createManualClientServiceSchema.safeParse({
      ...base,
      deadlineRules: Array.from({ length: 101 }, () => ({
        ruleId,
        enabled: true,
        parameterValues: {},
        parameterProvenance: {},
        scheduleEntries: [],
      })),
    }).success).toBe(false);
  });

  it('requires custom cadence labels and valid merged date input', () => {
    expect(updateClientServiceSchema.safeParse({
      serviceCadence: 'CUSTOM',
      customCadenceLabel: null,
    }).success).toBe(false);

    expect(updateClientServiceSchema.safeParse({
      startDate: '2026-08-01',
      endDate: '2026-07-31',
    }).success).toBe(false);
  });

  it('requires the complete schedule-affecting snapshot for impact previews', () => {
    const rules = [{
      ruleId,
      enabled: true,
      parameterValues: {},
      parameterProvenance: {},
      scheduleEntries: [],
    }];
    const expectedUpdatedAt = '2026-07-30T00:00:00.000Z';
    expect(clientServiceDeadlineImpactSchema.safeParse({ expectedUpdatedAt, deadlineRules: rules }).success).toBe(false);
    expect(clientServiceDeadlineImpactSchema.safeParse({
      expectedUpdatedAt,
      deadlineRules: rules,
      scheduleSnapshot: {
        status: 'ACTIVE',
        serviceCadence: 'MONTHLY',
        customCadenceLabel: null,
        startDate: '2026-08-01',
        endDate: null,
        fieldValues: { filingMonth: 'July' },
      },
    }).success).toBe(true);
  });

  it('requires an audit-quality reason for manual activation', () => {
    expect(markServiceAgreementEffectiveSchema.safeParse({
      signedAt: '2026-07-30T00:00:00.000Z',
      effectiveDate: '2026-07-30',
      reason: 'External',
    }).success).toBe(false);
  });

  it('normalizes list pagination and supports status filtering', () => {
    expect(searchClientServicesSchema.parse({ status: 'PAUSED', page: '2', limit: '25' }))
      .toEqual({ status: 'PAUSED', query: undefined, page: 2, limit: 25 });
  });

  describe('createManualClientServiceSchema', () => {
    const validInput = {
      serviceVariantId: variantId,
      serviceCadence: 'ANNUALLY',
      startDate: '2026-08-01',
      feeLines: [{ description: 'Annual service fee', amount: '1200.00', currency: 'sgd', billingFrequency: 'ANNUALLY' }],
    };

    it('applies server defaults and normalizes optional values', () => {
      expect(createManualClientServiceSchema.parse(validInput)).toMatchObject({
        status: 'ACTIVE',
        fieldValues: {},
        confirmDuplicate: false,
        customCadenceLabel: null,
        endDate: null,
        feeLines: [{ currency: 'SGD', customFrequencyLabel: null, billingStartDate: null }],
      });
    });

    it.each(['serviceVariantId', 'serviceCadence', 'startDate'])('requires %s', (field) => {
      const rest = Object.fromEntries(Object.entries(validInput).filter(([key]) => key !== field));
      expect(createManualClientServiceSchema.safeParse(rest).success).toBe(false);
    });

    it('rejects an end date before the start date and accepts equality', () => {
      expect(createManualClientServiceSchema.safeParse({ ...validInput, endDate: '2026-07-31' }).success).toBe(false);
      expect(createManualClientServiceSchema.safeParse({ ...validInput, endDate: '2026-08-01' }).success).toBe(true);
    });

    it('requires a custom cadence label and clears it for other cadences', () => {
      expect(createManualClientServiceSchema.safeParse({ ...validInput, serviceCadence: 'CUSTOM', customCadenceLabel: null }).success).toBe(false);
      expect(createManualClientServiceSchema.parse({ ...validInput, serviceCadence: 'CUSTOM', customCadenceLabel: 'Every 18 months' })).toMatchObject({ serviceCadence: 'CUSTOM', customCadenceLabel: 'Every 18 months' });
      expect(createManualClientServiceSchema.parse({ ...validInput, customCadenceLabel: 'Ignored' })).toMatchObject({ customCadenceLabel: null });
    });

    it('accepts missing and additional operational fields', () => {
      expect(createManualClientServiceSchema.safeParse(validInput).success).toBe(true);
      expect(createManualClientServiceSchema.parse({ ...validInput, fieldValues: { filingMonth: 'July', 'custom.flag': 'true' } }))
        .toMatchObject({ fieldValues: { filingMonth: 'July', 'custom.flag': 'true' } });
    });

    it('limits field keys to 100 and values to 10,000 characters', () => {
      const manyFields = Object.fromEntries(Array.from({ length: 101 }, (_entry, index) => [`key-${index}`, 'value']));
      expect(createManualClientServiceSchema.safeParse({ ...validInput, fieldValues: manyFields }).success).toBe(false);
      expect(createManualClientServiceSchema.safeParse({ ...validInput, fieldValues: { key: 'x'.repeat(10_001) } }).success).toBe(false);
      expect(createManualClientServiceSchema.safeParse({ ...validInput, fieldValues: { key: 'x'.repeat(10_000) } }).success).toBe(true);
    });

    it('requires between one and one hundred fee rows', () => {
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: [] }).success).toBe(false);
      const manyFees = Array.from({ length: 101 }, () => validInput.feeLines[0]);
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: manyFees }).success).toBe(false);
      const oneHundredFees = Array.from({ length: 100 }, () => validInput.feeLines[0]);
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: oneHundredFees }).success).toBe(true);
    });

    it('requires an explicit fee frequency and a label for custom frequency', () => {
      const { billingFrequency: _omitted, ...feeWithoutFrequency } = validInput.feeLines[0];
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: [feeWithoutFrequency] }).success).toBe(false);
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: [{ ...validInput.feeLines[0], billingFrequency: 'CUSTOM' }] }).success).toBe(false);
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: [{ ...validInput.feeLines[0], billingFrequency: 'CUSTOM', customFrequencyLabel: 'Every 18 months' }] }).success).toBe(true);
    });

    it('normalizes currencies and rejects malformed codes', () => {
      expect(createManualClientServiceSchema.parse(validInput).feeLines[0].currency).toBe('SGD');
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: [{ ...validInput.feeLines[0], currency: 'US' }] }).success).toBe(false);
    });

    it('rejects blank or negative amounts and accepts explicit zero', () => {
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: [{ ...validInput.feeLines[0], amount: '' }] }).success).toBe(false);
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: [{ ...validInput.feeLines[0], amount: '-1.00' }] }).success).toBe(false);
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: [{ ...validInput.feeLines[0], amount: '1.234' }] }).success).toBe(false);
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: [{ ...validInput.feeLines[0], amount: '0.00' }] }).success).toBe(true);
    });

    it.each(['source', 'agreementId', 'agreementItemId', 'familyName', 'serviceName'])('rejects client-owned %s', (field) => {
      expect(createManualClientServiceSchema.safeParse({ ...validInput, [field]: 'value' }).success).toBe(false);
    });

    it.each(['id', 'sourceAgreementFeeLineId', 'displayOrder'])('rejects client-owned fee %s', (field) => {
      expect(createManualClientServiceSchema.safeParse({ ...validInput, feeLines: [{ ...validInput.feeLines[0], [field]: field === 'displayOrder' ? 0 : 'fee-1' }] }).success).toBe(false);
    });
  });

  it('rejects immutable identity fields on updates instead of stripping them', () => {
    const base = { updatedAt: '2026-07-30T00:00:00.000Z', status: 'PAUSED' };
    expect(updateClientServiceSchema.safeParse(base).success).toBe(true);
    expect(updateClientServiceSchema.safeParse({ ...base, source: 'MANUAL' }).success).toBe(false);
    expect(updateClientServiceSchema.safeParse({ ...base, serviceVariantId: variantId }).success).toBe(false);
    expect(updateClientServiceSchema.safeParse({ ...base, agreementId: 'agreement-1' }).success).toBe(false);
    expect(updateClientServiceSchema.safeParse({ ...base, agreementItemId: 'item-1' }).success).toBe(false);
  });
});
