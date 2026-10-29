// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOaktreeServiceAgreementOakDoc } from '@/content/service-agreement/oaktree-service-agreement-oakdoc';
import type { ServiceAgreementDraftDto } from '@/services/service-agreement/types';

const master = buildOaktreeServiceAgreementOakDoc();
const templateRow = {
  id: 'template-1',
  name: 'Service Agreement',
  version: 2,
  compositionType: 'SERVICE_AGREEMENT',
  contentJson: {
    oakDoc: {
      schemaVersion: 1,
      storageKey: 'tenant-1/templates/oakdoc/assets/a.docx',
      fileName: 'agreement.docx',
      fileSize: master.byteLength,
      sha256: createHash('sha256').update(master).digest('hex'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fieldTags: [],
    },
  },
};

const getServiceAgreementDraftById = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { documentTemplate: { findFirst: vi.fn(async () => templateRow) } },
}));
vi.mock('@/services/company.service', () => ({
  getCompanyById: vi.fn(async () => ({
    id: 'company-1',
    name: 'Alpha Pte. Ltd.',
    uen: '11111111A',
    addresses: [],
    officers: [],
    shareholders: [],
  })),
}));
vi.mock('@/services/oakdoc-template.service', () => ({
  downloadOakDocTemplate: vi.fn(async () => ({
    buffer: Buffer.from(master),
    metadata: templateRow.contentJson.oakDoc,
  })),
}));
vi.mock('@/services/service-agreement/draft.service', () => ({
  getServiceAgreementDraftById: (...args: unknown[]) => getServiceAgreementDraftById(...args),
}));

const { generateOakDocBytes } = await import('@/services/oakdoc-generation.service');

function agreement(): ServiceAgreementDraftDto {
  return {
    id: 'agreement-1',
    generatedDocumentId: 'document-1',
    primaryCompanyId: 'company-1',
    authorizedContactIds: ['contact-1'],
    signerContactIds: ['contact-1'],
    authorizedRepresentativeSnapshots: [
      { id: 'contact-1', name: 'Alex Tan', role: 'Director', email: 'alex@example.com', phone: null },
    ],
    agreementDate: '2026-07-30',
    effectiveDate: '2026-08-01',
    termMonths: 12,
    status: 'DRAFT',
    entities: [
      { id: 'entity-1', companyId: 'company-1', nameSnapshot: 'Alpha Pte. Ltd.', uenSnapshot: '11111111A', displayOrder: 0 },
    ],
    items: [
      {
        id: 'item-1',
        serviceVariantId: 'variant-1',
        variantVersion: 3,
        familyNameSnapshot: 'Accounting',
        variantNameSnapshot: 'Monthly Accounting',
        serviceCadence: 'MONTHLY',
        customCadenceLabel: null,
        sowPartialId: 'partial-1',
        partialVersion: 7,
        partialContentSnapshot: '<p>Bookkeeping in {{service.fields.software}}</p>',
        partialPlaceholdersSnapshot: [{ key: 'service.fields.software', required: true }],
        partialDependencySnapshot: [],
        startDate: '2026-08-01',
        endDate: null,
        fieldValues: { software: 'Xero' },
        displayOrder: 0,
        entityIds: ['entity-1'],
        feeLines: [
          {
            id: 'fee-1',
            agreementEntityId: 'entity-1',
            companyId: 'company-1',
            description: 'Monthly accounting',
            amount: '200.00',
            currency: 'SGD',
            billingFrequency: 'MONTHLY',
            customFrequencyLabel: null,
            billingStartDate: '2026-08-01',
            displayOrder: 0,
          },
        ],
        staleVariantVersion: false,
        stalePartialVersion: false,
      },
    ],
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  } as ServiceAgreementDraftDto;
}

beforeEach(() => getServiceAgreementDraftById.mockReset());

describe('OakDoc Service Agreement generation', () => {
  it('composes services, fees and agreement fields into the native master', async () => {
    getServiceAgreementDraftById.mockResolvedValue(agreement());

    const result = await generateOakDocBytes({
      templateId: 'template-1',
      companyId: 'company-1',
      serviceAgreementId: 'agreement-1',
    }, { tenantId: 'tenant-1' });

    const xml = strFromU8(unzipSync(new Uint8Array(result.bytes))['word/document.xml']);
    expect(xml).toContain('Monthly Accounting');
    expect(xml).toContain('Bookkeeping in Xero');
    expect(xml).toContain('Alpha Pte. Ltd.');
    expect(result.values['selectedContact.name']).toBe('Alex Tan');
    expect(result.values['agreement.term']).toBe('1 year');
    expect(result.agreementHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(getServiceAgreementDraftById).toHaveBeenCalledWith('agreement-1', 'tenant-1');
  });

  it('blocks when the structured agreement is missing', async () => {
    const result = await generateOakDocBytes({
      templateId: 'template-1',
      companyId: 'company-1',
    }, { tenantId: 'tenant-1' });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OAKDOC_CONTEXT_MISSING', severity: 'error' }),
    ]));
    expect(getServiceAgreementDraftById).not.toHaveBeenCalled();
  });
});
