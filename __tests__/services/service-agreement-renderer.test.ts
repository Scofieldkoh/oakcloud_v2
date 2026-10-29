import { describe, expect, it } from 'vitest';
import {
  assembleServiceAgreementTemplate,
  canonicalServiceAgreementData,
} from '@/services/service-agreement';
import type { ServiceAgreementDraftDto } from '@/services/service-agreement';
import { resolvePlaceholders } from '@/lib/placeholder-resolver';
import { OAKTREE_SERVICE_AGREEMENT_V1 } from '@/content/service-agreement/oaktree-service-agreement-v1';

const agreement: ServiceAgreementDraftDto = {
  id: 'agreement-1',
  generatedDocumentId: 'document-1',
  primaryCompanyId: 'company-1',
  authorizedContactIds: ['contact-1', 'contact-2'],
  signerContactIds: ['contact-1', 'contact-2'],
  authorizedRepresentativeSnapshots: [
    {
      id: 'contact-1',
      name: 'Alex Tan',
      role: 'Director',
      email: 'alex@example.com',
      phone: '61234567',
    },
    {
      id: 'contact-2',
      name: 'Bea Lim',
      role: 'Manager',
      email: 'bea@example.com',
      phone: null,
    },
  ],
  agreementDate: '2026-07-30',
  effectiveDate: '2026-08-01',
  termMonths: 12,
  status: 'DRAFT',
  entities: [
    {
      id: 'entity-1',
      companyId: 'company-1',
      nameSnapshot: 'Alpha Pte. Ltd.',
      uenSnapshot: '11111111A',
      displayOrder: 0,
    },
    {
      id: 'entity-2',
      companyId: 'company-2',
      nameSnapshot: 'Beta <Holdings>',
      uenSnapshot: '22222222B',
      displayOrder: 1,
    },
  ],
  items: [
    {
      id: 'item-2',
      serviceVariantId: 'variant-2',
      variantVersion: 1,
      familyNameSnapshot: 'Corporate Services',
      variantNameSnapshot: 'Corporate Secretarial',
      serviceCadence: 'ANNUALLY',
      customCadenceLabel: null,
      sowPartialId: 'partial-2',
      partialVersion: 1,
      partialContentSnapshot:
        '<h2>Statement of Work – {{service.variantName}}</h2>{{#each service.entities}}<p>{{name}} (UEN: {{uen}})</p>{{/each}}',
      partialPlaceholdersSnapshot: [],
      partialDependencySnapshot: [],
      startDate: '2026-08-01',
      endDate: null,
      fieldValues: {},
      displayOrder: 1,
      entityIds: ['entity-1', 'entity-2'],
      feeLines: [
        {
          id: 'fee-2',
          agreementEntityId: 'entity-2',
          companyId: 'company-2',
          description: 'Annual corporate secretarial',
          amount: '500.00',
          currency: 'SGD',
          billingFrequency: 'ANNUALLY',
          customFrequencyLabel: null,
          billingStartDate: '2026-08-01',
          displayOrder: 0,
        },
      ],
      staleVariantVersion: false,
      stalePartialVersion: false,
    },
    {
      id: 'item-1',
      serviceVariantId: 'variant-1',
      variantVersion: 1,
      familyNameSnapshot: 'Accounting',
      variantNameSnapshot: 'Monthly Accounting',
      serviceCadence: 'MONTHLY',
      customCadenceLabel: null,
      sowPartialId: 'partial-1',
      partialVersion: 1,
      partialContentSnapshot: '<h2>{{service.variantName}}</h2><p>{{service.fields.software}}</p>',
      partialPlaceholdersSnapshot: [
        { key: 'service.fields.software', required: true },
      ],
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
};

const templateContent = [
  '<p>Cover {{company.name}}</p>',
  '{{@agreement.serviceSections}}',
  '{{@agreement.feeTable}}',
  '{{@agreement.entityAppendix}}',
].join('');

describe('service agreement renderer', () => {
  it('renders every representative in the instructions table and every signer in both client signing sections', () => {
    const assembled = assembleServiceAgreementTemplate({
      templateContent: OAKTREE_SERVICE_AGREEMENT_V1.template.content,
      agreement,
    });
    const representatives = agreement.authorizedRepresentativeSnapshots.map((representative) => ({
      ...representative,
      contactId: representative.id,
      detail: representative.role,
      address: { full: null, letter: null },
    }));
    const result = resolvePlaceholders(assembled.content, {
      company: { id: 'company-1', name: 'Alpha Pte. Ltd.', uen: '11111111A' },
      selectedContact: representatives[0],
      authorizedRepresentatives: representatives,
      signers: representatives,
      custom: {
        agreementDate: agreement.agreementDate,
        effectiveDate: agreement.effectiveDate,
        termMonths: agreement.termMonths,
      },
    }, { missingPlaceholder: 'blank' });

    const representativeTable = result.resolved.match(
      /<table data-authorised-representative="true">[\s\S]*?<\/table>/,
    )?.[0] ?? '';
    expect(representativeTable).toContain('Alex Tan');
    expect(representativeTable).toContain('Bea Lim');
    expect(result.resolved.match(/data-signature-placeholder="client-acceptance"/g)).toHaveLength(2);
    expect(result.resolved.match(/data-signature-placeholder="client-sow"/g)).toHaveLength(2);
    expect(result.resolved.match(/data-flow-keep-together="true"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('assembles ordered local SOWs, entity fees, and the entity appendix', () => {
    const result = assembleServiceAgreementTemplate({ templateContent, agreement });

    expect(result.content).toContain('Statement of Work – Corporate Secretarial');
    expect(result.content).toContain('Alpha Pte. Ltd. (UEN: 11111111A)');
    expect(result.content).toContain('Beta &lt;Holdings&gt;');
    expect(result.content).toContain('S$500.00 per year');
    expect(result.content.indexOf('Monthly Accounting')).toBeLessThan(
      result.content.indexOf('Corporate Secretarial'),
    );
    expect(result.content).not.toContain('{{@agreement.');
    expect(result.itemDiagnostics).toEqual([]);
  });

  it('groups fee lines under underlined entity headers with description and fee columns', () => {
    const result = assembleServiceAgreementTemplate({ templateContent, agreement });
    const feeTable =
      result.content.match(
        /<table data-service-agreement-fees="true">[\s\S]*?<\/table>/,
      )?.[0] ?? '';

    expect(feeTable).toContain(
      '<th style="width: 70%;">Description</th><th style="width: 30%;">Fee</th>',
    );
    expect(feeTable).not.toContain('<th>Service</th>');
    expect(feeTable).not.toContain('<th>Entity</th>');
    expect(feeTable).toContain(
      '<tr><td colspan="2" style="text-decoration: underline;">Alpha Pte. Ltd.</td></tr>',
    );
    expect(feeTable).toContain(
      '<tr><td colspan="2" style="text-decoration: underline;">Beta &lt;Holdings&gt;</td></tr>',
    );
    expect(
      feeTable.indexOf('Alpha Pte. Ltd.</td>'),
    ).toBeLessThan(feeTable.indexOf('Beta &lt;Holdings&gt;</td>'));
    expect(feeTable).toContain(
      '<tr><td>Monthly accounting</td><td>S$200.00 per month</td></tr>',
    );
    expect(feeTable).toContain(
      '<tr><td>Annual corporate secretarial</td><td>S$500.00 per year</td></tr>',
    );
    expect(
      feeTable.indexOf('Monthly accounting'),
    ).toBeLessThan(feeTable.indexOf('Beta &lt;Holdings&gt;'));
    expect(
      feeTable.indexOf('Annual corporate secretarial'),
    ).toBeGreaterThan(feeTable.indexOf('Beta &lt;Holdings&gt;'));
  });

  it('preserves fee lines whose entity is no longer part of the agreement', () => {
    const orphanAgreement = structuredClone(agreement);
    orphanAgreement.items[1].feeLines[0].agreementEntityId = 'entity-missing';

    const result = assembleServiceAgreementTemplate({
      templateContent,
      agreement: orphanAgreement,
    });

    expect(result.content).toContain(
      '<tr><td>Monthly accounting</td><td>S$200.00 per month</td></tr>',
    );
    expect(result.content).not.toContain('style="text-decoration: underline;">Alpha Pte. Ltd.');
  });

  it('strips baked-in typography styles but preserves list indent and formatting', () => {
    const styledAgreement = structuredClone(agreement);
    styledAgreement.items[1].partialContentSnapshot = [
      '<h2 style="font-size: 18pt; font-family: Georgia, serif; color: rgb(0, 0, 0); text-align: center;">',
      '{{service.variantName}}</h2>',
      '<p style="font-size: 14.6667px; font-family: Arial, Helvetica, sans-serif; white-space: pre-wrap;',
      ' line-height: 1.8; margin-left: 2em; display: inline !important;">',
      '{{service.fields.software}}</p>',
      '<ul class="list-alpha"><li style="margin-left: 2em; font-size: 10pt;">',
      '<b>Bold</b> <u>Underline</u></li></ul>',
    ].join('');

    const result = assembleServiceAgreementTemplate({
      templateContent,
      agreement: styledAgreement,
    });
    const section =
      result.content.match(
        /<section[^>]*data-service-agreement-item-id="item-1"[\s\S]*?<\/section>/,
      )?.[0] ?? '';

    expect(section).toContain('Monthly Accounting');
    expect(section).toContain('Xero');
    expect(section).toContain('text-align: center');
    expect(section).toContain('<b>Bold</b>');
    expect(section).toContain('<u>Underline</u>');
    expect(section).toContain('class="list-alpha"');
    expect(section).toContain('margin-left: 2em');
    expect(section).toContain('white-space: pre-wrap');
    expect(section).toContain('display: inline !important');
    expect(section).toContain('font-size: 18pt');
    expect(section).toContain('font-size: 10pt');
    expect(section).not.toContain('font-size: 14.6667px');
    expect(section).not.toContain('font-family');
    expect(section).not.toContain('line-height');
  });

  it('normalizes only the baked-in default font size and keeps deliberate sizes', () => {
    const styledAgreement = structuredClone(agreement);
    styledAgreement.items[1].partialContentSnapshot = [
      '<p style="font-size: 11pt;">Body at editor default</p>',
      '<p style="font-size: 14.6667px;">Word-pasted body at 11pt</p>',
      '<p style="font-size: 9pt;">Footnote</p>',
      '<p style="font-size: 12pt;">Deliberately larger body</p>',
    ].join('');

    const result = assembleServiceAgreementTemplate({
      templateContent,
      agreement: styledAgreement,
    });
    const section =
      result.content.match(
        /<section[^>]*data-service-agreement-item-id="item-1"[\s\S]*?<\/section>/,
      )?.[0] ?? '';

    expect(section).toContain('Body at editor default');
    expect(section).toContain('Word-pasted body at 11pt');
    expect(section).toContain('Footnote');
    expect(section).toContain('Deliberately larger body');
    expect(section).toContain('font-size: 9pt');
    expect(section).toContain('font-size: 12pt');
    expect(section).not.toContain('font-size: 11pt');
    expect(section).not.toContain('font-size: 14.6667px');
  });

  it('leaves plain partial wording untouched when it has no inline layout styles', () => {
    const result = assembleServiceAgreementTemplate({ templateContent, agreement });
    const section =
      result.content.match(
        /<section[^>]*data-service-agreement-item-id="item-1"[\s\S]*?<\/section>/,
      )?.[0] ?? '';

    expect(section).toContain('Monthly Accounting');
    expect(section).toContain('Xero');
    expect(section).not.toContain('style=');
  });

  it('rejects a missing or duplicate reserved slot', () => {
    expect(() =>
      assembleServiceAgreementTemplate({
        templateContent: templateContent.replace('{{@agreement.feeTable}}', ''),
        agreement,
      }),
    ).toThrow('exactly one feeTable slot');
    expect(() =>
      assembleServiceAgreementTemplate({
        templateContent: `${templateContent}{{@agreement.feeTable}}`,
        agreement,
      }),
    ).toThrow('exactly one feeTable slot');
  });

  it('reports missing required service values by item', () => {
    const missingAgreement = structuredClone(agreement);
    missingAgreement.items[1].fieldValues = {};

    expect(
      assembleServiceAgreementTemplate({
        templateContent,
        agreement: missingAgreement,
      }).itemDiagnostics,
    ).toEqual([
      {
        itemId: 'item-1',
        missingPlaceholders: ['service.fields.software'],
      },
    ]);
  });

  it('canonicalizes only pinned persisted data in defined display order', () => {
    const permuted = structuredClone(agreement);
    permuted.entities.reverse();
    permuted.items.reverse();
    permuted.items[0].entityIds.reverse();
    permuted.items[0].feeLines.reverse();
    permuted.items.forEach((item) => {
      item.staleVariantVersion = !item.staleVariantVersion;
      item.stalePartialVersion = !item.stalePartialVersion;
    });
    const replacementEntityIds = new Map(
      permuted.entities.map((entity) => [entity.id, `replacement-${entity.companyId}`]),
    );
    permuted.entities.forEach((entity) => {
      entity.id = replacementEntityIds.get(entity.id)!;
    });
    permuted.items.forEach((item) => {
      item.entityIds = item.entityIds.map((id) => replacementEntityIds.get(id)!);
      item.feeLines.forEach((fee, index) => {
        fee.id = `replacement-fee-${index}-${item.id}`;
        fee.agreementEntityId = replacementEntityIds.get(fee.agreementEntityId)!;
      });
    });
    permuted.createdAt = '2030-01-01T00:00:00.000Z';
    permuted.updatedAt = '2030-01-01T00:00:00.000Z';

    expect(canonicalServiceAgreementData(permuted)).toEqual(
      canonicalServiceAgreementData(agreement),
    );
  });
});
