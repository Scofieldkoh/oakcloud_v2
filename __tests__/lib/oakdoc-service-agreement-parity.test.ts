// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createDocxFixture } from '../helpers/docx-fixture';

import {
  compareSemanticDocuments,
  runGenerationComparisonHarness,
} from '@/lib/document-editor/oakdoc-semantic-compare';
import {
  buildServiceAgreementSemanticRequirements,
  type ServiceAgreementParityContext,
} from '@/lib/document-editor/oakdoc-service-agreement-parity';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function docxFromLines(lines: readonly string[]): Uint8Array {
  const paragraphs = lines
    .map((line) => `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr/>
  </w:body>
</w:document>`;
  return createDocxFixture({
    '[Content_Types].xml': CONTENT_TYPES,
    'word/document.xml': documentXml,
  });
}

function htmlFromLines(lines: readonly string[]): string {
  return lines.map((line) => `<p>${line}</p>`).join('');
}

function businessLines(context: ServiceAgreementParityContext): string[] {
  return [
    ...(context.agreementDate ? [context.agreementDate] : []),
    ...(context.effectiveDate ? [context.effectiveDate] : []),
    ...context.entities.flatMap((entity) => [entity.name, ...(entity.uen ? [entity.uen] : [])]),
    ...context.services.flatMap((service) => [service.name, ...(service.entityNames ?? [])]),
    ...context.feeLines.flatMap((fee) => [
      fee.description,
      fee.semanticAmount,
      ...(fee.entityName ? [fee.entityName] : []),
    ]),
    ...context.authorizedRepresentatives.flatMap((representative) => [
      representative.name,
      ...(representative.role ? [representative.role] : []),
      ...(representative.email ? [representative.email] : []),
    ]),
    ...context.signers,
    ...(context.criticalHeadings ?? []),
    ...(context.criticalClauses ?? []),
  ];
}

const BASE = {
  agreementDate: '25 September 2026',
  effectiveDate: '1 October 2026',
  criticalHeadings: ['Services', 'Fees', 'Authorised Representatives', 'Signatures'],
  criticalClauses: ['The client shall pay the fees set out in this agreement.'],
} satisfies Partial<ServiceAgreementParityContext>;

const scenarios: Array<{ name: string; context: ServiceAgreementParityContext }> = [
  {
    name: 'one entity / one service',
    context: {
      ...BASE,
      entities: [{ name: 'Alpha Pte. Ltd.', uen: '202600001A' }],
      services: [{ name: 'Corporate Secretarial Services', entityNames: ['Alpha Pte. Ltd.'] }],
      feeLines: [{ description: 'Annual corporate secretarial fee', semanticAmount: 'S$1,800.00 per year', entityName: 'Alpha Pte. Ltd.' }],
      authorizedRepresentatives: [{ name: 'Alice Tan', role: 'Director', email: 'alice@example.test' }],
      signers: ['Alice Tan'],
    },
  },
  {
    name: 'one entity / multiple services',
    context: {
      ...BASE,
      entities: [{ name: 'Bravo Pte. Ltd.', uen: '202600002B' }],
      services: [
        { name: 'Corporate Secretarial Services', entityNames: ['Bravo Pte. Ltd.'] },
        { name: 'Corporate Income Tax Services', entityNames: ['Bravo Pte. Ltd.'] },
      ],
      feeLines: [
        { description: 'Corporate secretarial fee', semanticAmount: 'S$1,800.00 per year', entityName: 'Bravo Pte. Ltd.' },
        { description: 'Corporate tax fee', semanticAmount: 'S$1,200.00 per year', entityName: 'Bravo Pte. Ltd.' },
      ],
      authorizedRepresentatives: [{ name: 'Ben Lim', role: 'Director', email: 'ben@example.test' }],
      signers: ['Ben Lim'],
    },
  },
  {
    name: 'multiple entities / different services',
    context: {
      ...BASE,
      entities: [
        { name: 'Charlie Holdings Pte. Ltd.', uen: '202600003C' },
        { name: 'Delta Trading Pte. Ltd.', uen: '202600004D' },
      ],
      services: [
        { name: 'Accounting Services', entityNames: ['Charlie Holdings Pte. Ltd.'] },
        { name: 'Payroll Services', entityNames: ['Delta Trading Pte. Ltd.'] },
      ],
      feeLines: [
        { description: 'Monthly accounting fee', semanticAmount: 'S$800.00 per month', entityName: 'Charlie Holdings Pte. Ltd.' },
        { description: 'Monthly payroll fee', semanticAmount: 'S$300.00 per month', entityName: 'Delta Trading Pte. Ltd.' },
      ],
      authorizedRepresentatives: [
        { name: 'Carol Ng', role: 'Director', email: 'carol@example.test' },
        { name: 'David Goh', role: 'Director', email: 'david@example.test' },
      ],
      signers: ['Carol Ng', 'David Goh'],
    },
  },
  {
    name: 'multiple fee lines, authorised representatives and multiple signers',
    context: {
      ...BASE,
      entities: [{ name: 'Echo Ventures Pte. Ltd.', uen: '202600005E' }],
      services: [
        { name: 'Finance Operations Support', entityNames: ['Echo Ventures Pte. Ltd.'] },
      ],
      feeLines: [
        { description: 'Monthly bookkeeping fee', semanticAmount: 'S$1,000.00 per month', entityName: 'Echo Ventures Pte. Ltd.' },
        { description: 'Quarterly GST filing fee', semanticAmount: 'S$300.00 per quarter', entityName: 'Echo Ventures Pte. Ltd.' },
        { description: 'Annual corporate tax fee', semanticAmount: 'S$1,200.00 per year', entityName: 'Echo Ventures Pte. Ltd.' },
      ],
      authorizedRepresentatives: [
        { name: 'Eleanor Wong', role: 'Director', email: 'eleanor@example.test' },
        { name: 'Farid Rahman', role: 'CEO', email: 'farid@example.test' },
      ],
      signers: ['Eleanor Wong', 'Farid Rahman'],
    },
  },
];

describe('Service Agreement migration semantic parity', () => {
  for (const scenario of scenarios) {
    it(`passes representative scenario: ${scenario.name}`, async () => {
      const lines = businessLines(scenario.context);
      const report = await runGenerationComparisonHarness({
        context: scenario.context,
        legacyGenerator: (context) => ({
          kind: 'html' as const,
          content: htmlFromLines(businessLines(context)),
        }),
        oakDocGenerator: (context) => ({
          kind: 'docx' as const,
          bytes: docxFromLines(businessLines(context)),
        }),
        requirements: buildServiceAgreementSemanticRequirements,
      });

      expect(lines.length).toBeGreaterThan(0);
      expect(report.passed).toBe(true);
      expect(report.issues).toEqual([]);
      expect(report.requirements.every((requirement) =>
        requirement.legacyMatched !== false && requirement.oakDocMatched !== false,
      )).toBe(true);
    });
  }

  it('fails when OakDoc omits a critical fee line or leaves a legacy placeholder', () => {
    const context = scenarios[3].context;
    const oakDocLines = businessLines(context)
      .filter((line) => line !== 'Quarterly GST filing fee')
      .concat('{{client.signer}}');

    const report = compareSemanticDocuments({
      legacy: { kind: 'html', content: htmlFromLines(businessLines(context)) },
      oakDoc: { kind: 'docx', bytes: docxFromLines(oakDocLines) },
      requirements: buildServiceAgreementSemanticRequirements(context),
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'OAKDOC_REQUIRED_SEMANTIC_MISSING',
        key: 'fee-lines',
      }),
      expect.objectContaining({
        code: 'OAKDOC_UNRESOLVED_LEGACY_PLACEHOLDER',
      }),
    ]));
  });
});
