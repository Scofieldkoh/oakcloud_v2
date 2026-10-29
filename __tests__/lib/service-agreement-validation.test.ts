import { describe, expect, it } from 'vitest';
import { serviceAgreementDraftSchema } from '@/lib/validations/service-agreement';

const primaryCompanyId = '11111111-1111-4111-8111-111111111111';
const secondCompanyId = '22222222-2222-4222-8222-222222222222';
const authorizedContactId = '33333333-3333-4333-8333-333333333333';
const secondAuthorizedContactId = '55555555-5555-4555-8555-555555555555';
const variantId = '44444444-4444-4444-8444-444444444444';

function validDraft(): any {
  return {
    primaryCompanyId,
    authorizedContactIds: [authorizedContactId, secondAuthorizedContactId],
    authorizedRepresentativeRoles: {
      [authorizedContactId]: 'Director',
      [secondAuthorizedContactId]: 'CEO',
    },
    signerContactIds: [authorizedContactId],
    entityIds: [primaryCompanyId, secondCompanyId],
    agreementDate: '2026-07-30',
    effectiveDate: '2026-07-30',
    termMonths: 12,
    items: [
      {
        clientKey: 'item-1',
        variantId,
        entityIds: [primaryCompanyId],
        startDate: '2026-07-30',
        endDate: null,
        fieldValues: {},
        displayOrder: 0,
        feeLines: [
          {
            clientKey: 'fee-1',
            companyId: primaryCompanyId,
            description: 'Annual fee',
            amount: '500.00',
            currency: 'SGD',
            billingFrequency: 'ANNUALLY' as const,
            displayOrder: 0,
          },
        ],
      },
    ],
  };
}

describe('serviceAgreementDraftSchema', () => {
  it('requires representatives and at least one signer selected from them', () => {
    const noRepresentatives = validDraft();
    noRepresentatives.authorizedContactIds = [];
    noRepresentatives.signerContactIds = [];
    expect(serviceAgreementDraftSchema.safeParse(noRepresentatives).success).toBe(false);

    const noSigners = validDraft();
    noSigners.signerContactIds = [];
    expect(serviceAgreementDraftSchema.safeParse(noSigners).success).toBe(false);

    const outsiderSigner = validDraft();
    outsiderSigner.signerContactIds = ['66666666-6666-4666-8666-666666666666'];
    expect(serviceAgreementDraftSchema.safeParse(outsiderSigner)).toMatchObject({
      success: false,
      error: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ['signerContactIds', 0],
            message: 'Every signer must be an authorised representative',
          }),
        ]),
      },
    });
  });

  it('rejects duplicate representatives and signers', () => {
    const duplicateRepresentatives = validDraft();
    duplicateRepresentatives.authorizedContactIds = [authorizedContactId, authorizedContactId];
    expect(serviceAgreementDraftSchema.safeParse(duplicateRepresentatives).success).toBe(false);

    const duplicateSigners = validDraft();
    duplicateSigners.signerContactIds = [authorizedContactId, authorizedContactId];
    expect(serviceAgreementDraftSchema.safeParse(duplicateSigners).success).toBe(false);
  });

  it('rejects appointment selections for contacts outside the representative list', () => {
    const input = validDraft();
    input.authorizedRepresentativeRoles['66666666-6666-4666-8666-666666666666'] = 'CEO';

    expect(serviceAgreementDraftSchema.safeParse(input)).toMatchObject({
      success: false,
      error: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ['authorizedRepresentativeRoles', '66666666-6666-4666-8666-666666666666'],
          }),
        ]),
      },
    });
  });

  it('rejects a fee for an entity not targeted by the service item', () => {
    const input = validDraft();
    input.items[0].feeLines[0].companyId = secondCompanyId;

    expect(serviceAgreementDraftSchema.safeParse(input).success).toBe(false);
  });

  it('requires the primary company in the unique agreement entity list', () => {
    const input = validDraft();
    input.entityIds = [secondCompanyId, secondCompanyId];

    expect(serviceAgreementDraftSchema.safeParse(input).success).toBe(false);
  });

  it('requires the primary company to be the first agreement entity', () => {
    const input = validDraft();
    input.entityIds = [secondCompanyId, primaryCompanyId];

    expect(serviceAgreementDraftSchema.safeParse(input)).toMatchObject({
      success: false,
      error: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ['entityIds', 0],
            message: 'The primary company must be the first agreement entity',
          }),
        ]),
      },
    });
  });

  it('rejects an end date before the item start date', () => {
    const input = validDraft();
    input.items[0].endDate = '2026-07-29';

    expect(serviceAgreementDraftSchema.safeParse(input).success).toBe(false);
  });

  it('requires custom frequency labels and removes them from standard frequencies', () => {
    const customInput = validDraft();
    customInput.items[0].feeLines[0].billingFrequency = 'CUSTOM';
    expect(serviceAgreementDraftSchema.safeParse(customInput).success).toBe(false);

    const standardInput = validDraft();
    Object.assign(standardInput.items[0].feeLines[0], {
      customFrequencyLabel: 'not applicable',
    });
    const parsed = serviceAgreementDraftSchema.parse(standardInput);
    expect(parsed.items[0].feeLines[0].customFrequencyLabel).toBeNull();
  });

  it('accepts only real calendar dates', () => {
    expect(serviceAgreementDraftSchema.safeParse({ ...validDraft(), agreementDate: '2026-02-30' }).success).toBe(false);
    expect(serviceAgreementDraftSchema.safeParse({ ...validDraft(), effectiveDate: '2026-13-01' }).success).toBe(false);
    expect(serviceAgreementDraftSchema.safeParse({ ...validDraft(), agreementDate: '2028-02-29' }).success).toBe(true);
    expect(serviceAgreementDraftSchema.safeParse({ ...validDraft(), effectiveDate: null }).success).toBe(true);
  });
});
