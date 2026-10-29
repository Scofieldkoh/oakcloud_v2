// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { createDocxFixture } from '../helpers/docx-fixture';
import { resolveOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import {
  encodeOakDocSowSnapshot,
  expandOakDocPartials,
  readOakDocSowSnapshot,
} from '@/lib/document-editor/oakdoc-partials';
import {
  renderServiceAgreementOakDoc,
  type ServiceAgreementDraftDto,
  type ServiceAgreementOakDocFieldResolutionAdapter,
} from '@/services/service-agreement';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function textControl(tag: string, id: number, value = `{{${tag}}}`): string {
  return [
    '<w:sdt>',
    '<w:sdtPr>',
    `<w:alias w:val="${tag}"/>`,
    `<w:tag w:val="${tag}"/>`,
    `<w:id w:val="${id}"/>`,
    '</w:sdtPr>',
    '<w:sdtContent><w:r><w:t>',
    value,
    '</w:t></w:r></w:sdtContent>',
    '</w:sdt>',
  ].join('');
}

function blockControl(tag: string, id: number): string {
  return [
    '<w:sdt>',
    '<w:sdtPr>',
    `<w:alias w:val="${tag}"/>`,
    `<w:tag w:val="${tag}"/>`,
    `<w:id w:val="${id}"/>`,
    '</w:sdtPr>',
    '<w:sdtContent><w:p><w:r><w:t>',
    tag,
    '</w:t></w:r></w:p></w:sdtContent>',
    '</w:sdt>',
  ].join('');
}

function masterDocx(extraBody = ''): Uint8Array {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:document xmlns:w="${WORD_NS}">`,
    '<w:body>',
    '<w:p><w:r><w:t>Agreement date: </w:t></w:r>',
    textControl('agreement.date', 10),
    '</w:p>',
    extraBody,
    blockControl('agreement.serviceSections', 100),
    blockControl('agreement.feeTable', 101),
    blockControl('agreement.entityAppendix', 102),
    '<w:p><w:r><w:t>Signature: </w:t></w:r>',
    textControl('signature.client.acceptance', 103, 'Sign here'),
    '</w:p>',
    '<w:sectPr/>',
    '</w:body>',
    '</w:document>',
  ].join('');

  return createDocxFixture({
    'word/document.xml': xml,
  });
}

function documentXml(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  return strFromU8(files['word/document.xml']);
}

function agreementFixture(): ServiceAgreementDraftDto {
  return {
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
        partialContentSnapshot: [
          '<h2>{{service.variantName}}</h2>',
          '<p>Software: <strong>{{service.fields.software}}</strong></p>',
          '{{#each service.entities}}<p>{{name}} (UEN: {{uen}})</p>{{/each}}',
        ].join(''),
        partialPlaceholdersSnapshot: [
          { key: 'service.fields.software', required: true },
        ],
        partialDependencySnapshot: [
          {
            id: 'dependency-1',
            name: 'shared-accounting-terms',
            version: 4,
            updatedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
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
}

describe('OakDoc-native Service Agreement renderer', () => {
  it('renders one service into native Word structures without mutating the master DOCX', () => {
    const agreement = agreementFixture();
    agreement.entities[0].nameSnapshot = 'Alpha & <Holdings> Pte. Ltd.';
    const master = masterDocx();
    const masterBefore = new Uint8Array(master);

    const result = renderServiceAgreementOakDoc({
      masterDocxBytes: master,
      agreement,
      fieldContext: {
        values: {
          'agreement.date': '30 Jul 2026',
          'signature.client.acceptance': 'Sign here',
        },
      },
      expectedGeneratedDocumentId: 'document-1',
    });
    const output = documentXml(result.bytes);

    expect(master).toEqual(masterBefore);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(result.resolvedServices).toEqual([
      expect.objectContaining({
        itemId: 'item-1',
        serviceVariantId: 'variant-1',
        variantVersion: 3,
        sowPartialId: 'partial-1',
        partialVersion: 7,
        missingRequiredPlaceholders: [],
      }),
    ]);
    expect(output).toContain('Monthly Accounting');
    expect(output).toContain('Software: ');
    expect(output).toContain('Xero');
    expect(output).toContain('Alpha &amp; &lt;Holdings&gt; Pte. Ltd.');
    expect(output).toContain('agreement.service.item:item-1');
    expect(output).toContain('variant v3 | SOW v7');
    expect(output).not.toContain('<h2>');
    expect(output).not.toContain('agreement.serviceSections');
    expect(output).toContain('<w:tbl');
    expect(result.signatureMarkers.markers).toEqual([
      expect.objectContaining({ tag: 'signature.client.acceptance' }),
    ]);
    expect(result.agreementMetadata.generatedDocumentId).toBe('document-1');
    expect(result.agreementMetadata.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('renders multiple services in display order and starts later services on a new page', () => {
    const agreement = agreementFixture();
    agreement.items.push({
      ...structuredClone(agreement.items[0]),
      id: 'item-2',
      serviceVariantId: 'variant-2',
      variantNameSnapshot: 'Corporate Secretarial',
      familyNameSnapshot: 'Corporate Services',
      sowPartialId: 'partial-2',
      partialVersion: 2,
      partialContentSnapshot: '<h2>{{service.variantName}}</h2><p>Second service wording</p>',
      partialPlaceholdersSnapshot: [],
      partialDependencySnapshot: [],
      fieldValues: {},
      displayOrder: 1,
      feeLines: [],
    });

    const result = renderServiceAgreementOakDoc({
      masterDocxBytes: masterDocx(),
      agreement,
      fieldContext: { values: {} },
    });
    const output = documentXml(result.bytes);

    expect(output.indexOf('Monthly Accounting')).toBeLessThan(
      output.indexOf('Corporate Secretarial'),
    );
    expect(output).toContain('Second service wording');
    expect(output).toContain('<w:pageBreakBefore');
    expect(result.resolvedServices.map((service) => service.itemId)).toEqual([
      'item-1',
      'item-2',
    ]);
  });

  it('renders multiple agreement entities and preserves entity targeting in SOW metadata/content', () => {
    const agreement = agreementFixture();
    agreement.entities.push({
      id: 'entity-2',
      companyId: 'company-2',
      nameSnapshot: 'Beta Holdings Pte. Ltd.',
      uenSnapshot: '22222222B',
      displayOrder: 1,
    });
    agreement.items[0].entityIds.push('entity-2');

    const result = renderServiceAgreementOakDoc({
      masterDocxBytes: masterDocx(),
      agreement,
      fieldContext: { values: {} },
    });
    const output = documentXml(result.bytes);

    expect(output).toContain('Alpha Pte. Ltd. (UEN: 11111111A)');
    expect(output).toContain('Beta Holdings Pte. Ltd. (UEN: 22222222B)');
    expect(result.resolvedServices[0].entityIds).toEqual(['entity-1', 'entity-2']);
    expect(result.agreementMetadata.entityCount).toBe(2);
  });

  it('renders native fee rows for multiple currencies and standard/custom frequencies', () => {
    const agreement = agreementFixture();
    agreement.items[0].feeLines.push({
      id: 'fee-2',
      agreementEntityId: 'entity-1',
      companyId: 'company-1',
      description: 'Implementation project',
      amount: '1250.50',
      currency: 'USD',
      billingFrequency: 'CUSTOM',
      customFrequencyLabel: 'per implementation',
      billingStartDate: '2026-08-01',
      displayOrder: 1,
    });

    const result = renderServiceAgreementOakDoc({
      masterDocxBytes: masterDocx(),
      agreement,
      fieldContext: { values: {} },
    });
    const output = documentXml(result.bytes);

    expect(output).toContain('S$200.00 per month');
    expect(output).toContain('1,250.50 per implementation');
    expect(output).toContain('Implementation project');
    expect(output).toContain('<w:tblHeader');
    expect(output).toContain('<w:cantSplit');
    expect(result.agreementMetadata.feeLineCount).toBe(2);
  });

  it('passes multiple signers and authorised representatives through the generic Stage 4 adapter seam', () => {
    const agreement = agreementFixture();
    const extraFields = [
      '<w:p>',
      textControl('signer.one.name', 20),
      '<w:r><w:t> / </w:t></w:r>',
      textControl('signer.two.name', 21),
      '</w:p>',
      '<w:p>',
      textControl('authorized.one.name', 22),
      '<w:r><w:t> / </w:t></w:r>',
      textControl('authorized.two.name', 23),
      '</w:p>',
    ].join('');

    let seenSignerCount = 0;
    let seenRepresentativeCount = 0;
    const adapter: ServiceAgreementOakDocFieldResolutionAdapter = {
      resolve(input) {
        seenSignerCount = input.signers.length;
        seenRepresentativeCount = input.authorizedRepresentatives.length;
        const resolved = resolveOakDocFields(input.docxBytes, {
          ...input.values,
          'signer.one.name': input.signers[0]?.name ?? '',
          'signer.two.name': input.signers[1]?.name ?? '',
          'authorized.one.name': input.authorizedRepresentatives[0]?.name ?? '',
          'authorized.two.name': input.authorizedRepresentatives[1]?.name ?? '',
        });
        return {
          bytes: resolved.bytes,
          updated: resolved.updated,
          unresolvedTags: resolved.unresolvedTags.filter(
            (tag) => !tag.startsWith('agreement.service.item:'),
          ),
          repeatersResolved: 2,
          signaturesResolved: 2,
        };
      },
    };

    const result = renderServiceAgreementOakDoc({
      masterDocxBytes: masterDocx(extraFields),
      agreement,
      fieldContext: {
        values: {},
        signers: [
          { contactId: 'contact-1', name: 'Alex Tan', role: 'Director' },
          { contactId: 'contact-2', name: 'Bea Lim', role: 'Manager' },
        ],
        authorizedRepresentatives: [
          { contactId: 'contact-1', name: 'Alex Tan', role: 'Director' },
          { contactId: 'contact-2', name: 'Bea Lim', role: 'Manager' },
        ],
      },
      fieldResolver: adapter,
    });
    const output = documentXml(result.bytes);

    expect(seenSignerCount).toBe(2);
    expect(seenRepresentativeCount).toBe(2);
    expect(output).toContain('Alex Tan');
    expect(output).toContain('Bea Lim');
    expect(result.fieldResolution).toEqual(
      expect.objectContaining({
        repeatersResolved: 2,
        signaturesResolved: 2,
      }),
    );
    expect(result.signatureMarkers.providedSignerCount).toBe(2);
    expect(result.signatureMarkers.signerContactIds).toEqual([
      'contact-1',
      'contact-2',
    ]);
  });

  it('reports missing required service fields without replacing the pinned snapshot model', () => {
    const agreement = agreementFixture();
    agreement.items[0].fieldValues = {};

    const result = renderServiceAgreementOakDoc({
      masterDocxBytes: masterDocx(),
      agreement,
      fieldContext: { values: {} },
    });
    const output = documentXml(result.bytes);

    expect(result.unresolved.serviceItems).toEqual([
      {
        itemId: 'item-1',
        placeholders: ['service.fields.software'],
      },
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'MISSING_REQUIRED_SERVICE_FIELD',
        severity: 'error',
        itemId: 'item-1',
      }),
    );
    expect(output).toContain('{{service.fields.software}}');
  });

  it('renders a valid native fee table when there are no fee lines', () => {
    const agreement = agreementFixture();
    agreement.items[0].feeLines = [];

    const result = renderServiceAgreementOakDoc({
      masterDocxBytes: masterDocx(),
      agreement,
      fieldContext: { values: {} },
    });
    const output = documentXml(result.bytes);

    expect(result.agreementMetadata.feeLineCount).toBe(0);
    expect(output).toContain('Description');
    expect(output).toContain('Fee');
    expect(output.match(/<w:tr(?:\s|>)/g)).toHaveLength(1);
  });

  it('keeps stale SOW wording pinned while surfacing stale-version diagnostics', () => {
    const agreement = agreementFixture();
    agreement.items[0].partialContentSnapshot = '<p>Pinned historical SOW wording</p>';
    agreement.items[0].partialPlaceholdersSnapshot = [];
    agreement.items[0].fieldValues = {};
    agreement.items[0].stalePartialVersion = true;
    agreement.items[0].staleVariantVersion = true;

    const result = renderServiceAgreementOakDoc({
      masterDocxBytes: masterDocx(),
      agreement,
      fieldContext: { values: {} },
    });
    const output = documentXml(result.bytes);

    expect(output).toContain('Pinned historical SOW wording');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STALE_SERVICE_WORDING',
          severity: 'warning',
          itemId: 'item-1',
        }),
        expect.objectContaining({
          code: 'STALE_SERVICE_VARIANT',
          severity: 'warning',
          itemId: 'item-1',
        }),
      ]),
    );
  });

  it('refuses to render across generated-document or canonical-hash version mismatches', () => {
    const agreement = agreementFixture();
    const master = masterDocx();

    const result = renderServiceAgreementOakDoc({
      masterDocxBytes: master,
      agreement,
      fieldContext: { values: {} },
      expectedGeneratedDocumentId: 'other-document',
      expectedCanonicalHash: '0'.repeat(64),
    });

    expect(result.bytes).toBe(master);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GENERATED_DOCUMENT_MISMATCH' }),
        expect.objectContaining({ code: 'CANONICAL_HASH_MISMATCH' }),
      ]),
    );
  });

  it('places a Word scope-of-work partial by its pin and expands it from pinned bytes', () => {
    const partialId = '33333333-3333-4333-8333-333333333333';
    const pin = {
      partialId,
      version: 4,
      sha256: 'a'.repeat(64),
      storageKey: `tenant-1/template-partials/${partialId}/oakdoc/${'a'.repeat(64)}.docx`,
      nested: [],
    };
    const agreement = agreementFixture();
    agreement.items[0].partialContentSnapshot = encodeOakDocSowSnapshot({ pin, fieldTags: ['company.name'] });

    expect(readOakDocSowSnapshot(agreement.items[0].partialContentSnapshot)).toEqual({ pin, fieldTags: ['company.name'] });
    expect(agreement.items[0].partialContentSnapshot).toContain('appears in the OakDoc version');

    const master = createDocxFixture({
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      'word/document.xml': documentXml(masterDocx()),
    });
    const result = renderServiceAgreementOakDoc({
      masterDocxBytes: master,
      agreement,
      fieldContext: { values: {} },
    });
    const rendered = documentXml(result.bytes);
    expect(result.sowPartialPins).toEqual([pin]);
    expect(rendered).toContain(`oakdoc.partial:${partialId}`);
    expect(rendered).not.toContain('appears in the OakDoc version');

    const fragment = createDocxFixture({
      'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:r><w:t>Word scope of work</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    });
    const expanded = expandOakDocPartials({
      docxBytes: result.bytes,
      fragments: new Map([[partialId, fragment]]),
    });
    const output = documentXml(expanded.bytes);
    expect(expanded.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(output).toContain('Word scope of work');
    expect(output).toContain('agreement.service.item:item-1');
    expect(output).not.toContain(`oakdoc.partial:${partialId}`);
  });

  it('rejects a damaged Word scope-of-work snapshot', () => {
    expect(() => readOakDocSowSnapshot('<div data-oakdoc-sow="%7Bbad">x</div>')).toThrow(/damaged/);
    expect(readOakDocSowSnapshot('<p>HTML wording</p>')).toBeNull();
  });
});
