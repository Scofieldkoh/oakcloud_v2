// @vitest-environment jsdom
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  CONSTITUTION_OPTIONS,
  FIRST_BOARD_RESOLUTION_PARTIALS,
  buildFirstBoardResolutionOakDocMaster,
} from '@/content/resolution/first-board-resolution-oakdoc';
import { buildBoardResolutionOakDocMaster } from '@/content/resolution/board-resolution-oakdoc';
import {
  buildOakDocResolutionDates,
  buildOakDocResolutionValues,
  type OakDocCompanyDetail,
} from '@/lib/document-editor/oakdoc-context';
import { resolveOakDocConditions, inspectOakDocConditions } from '@/lib/document-editor/oakdoc-conditions';
import { deriveOakDocTemplateFieldTags } from '@/lib/document-editor/oakdoc-field-manifest';
import { diagnoseOakDocTags } from '@/lib/document-editor/oakdoc-field-registry';
import { resolveOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import { expandOakDocPartials, validateOakDocPartialPackage } from '@/lib/document-editor/oakdoc-partials';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';
import { resolveOakDocRepeaters } from '@/lib/document-editor/oakdoc-repeaters';
import { composeOakDocResolutions, OAKDOC_RESOLUTION_HEADING_STYLE } from '@/lib/document-editor/oakdoc-resolutions';
import type { ResolutionComposition } from '@/lib/resolution-composition';

function documentXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

function plainText(bytes: Uint8Array): string {
  return documentXml(bytes)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');
}

const PARTIAL_IDS = FIRST_BOARD_RESOLUTION_PARTIALS.map((_, index) => `5555555${index}-5555-4555-8555-555555555555`);

const PRESET: ResolutionComposition = {
  subject: '',
  sections: FIRST_BOARD_RESOLUTION_PARTIALS.map((partial, index) => ({
    id: `preset-${index + 1}`,
    kind: 'PARTIAL' as const,
    heading: partial.header,
    partialId: PARTIAL_IDS[index],
  })),
};

const BORDEUS: OakDocCompanyDetail = {
  id: 'company-1',
  name: 'BORDEUS PTE. LTD.',
  uen: '202645711K',
  incorporationDate: '2026-10-03T00:00:00.000Z',
  primarySsicCode: '46900',
  primarySsicDescription: 'Wholesale trade of a variety of goods without a dominant product',
  secondarySsicCode: '720201',
  secondarySsicDescription: 'Management Consultancy Services',
  financialYearEndDay: 31,
  financialYearEndMonth: 12,
  paidUpCapitalAmount: '10000',
  paidUpCapitalCurrency: 'SGD',
  registeredAddress: '21 BUKIT BATOK CRESCENT, #25-72, WCEGA TOWER, SINGAPORE 658065',
  officers: [
    { id: 'd1', name: 'Yuly Mirawati', role: 'DIRECTOR', identificationNumber: 'S8078571B', isCurrent: true },
    { id: 'd2', name: 'Liang Joo Heong', role: 'DIRECTOR', identificationNumber: 'S2039870A', isCurrent: true },
    { id: 's1', name: 'Tan Wei Jie', role: 'SECRETARY', identificationNumber: 'S9101817I', isCurrent: true },
  ],
  shareholders: [
    { id: 'h1', name: 'Engterprise Holdings Pte. Ltd.', numberOfShares: 3500, isCurrent: true },
    { id: 'h2', name: 'Liang Joo Heong', numberOfShares: 3500, isCurrent: true },
  ],
};

/** The generation steps that matter here, in the generation service's order. */
function generate(company: OakDocCompanyDetail, selectedOfficerIds: string[]): string {
  const composed = composeOakDocResolutions(buildFirstBoardResolutionOakDocMaster(), PRESET);
  expect(composed.diagnostics).toEqual([]);
  const fragments = new Map(FIRST_BOARD_RESOLUTION_PARTIALS.map((partial, index) => [PARTIAL_IDS[index], partial.build()]));
  const expanded = expandOakDocPartials({ docxBytes: composed.bytes, fragments });
  expect(expanded.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  const fieldTags = deriveOakDocTemplateFieldTags(expanded.bytes);
  const input = { company, fieldTags, resolution: { date: '2026-10-03' } };
  const values = {
    ...buildOakDocResolutionValues(input),
    'custom.notice_of_incorporation_no': 'T261308696',
    'custom.constitution': CONSTITUTION_OPTIONS[1],
  };
  const conditioned = resolveOakDocConditions({
    docxBytes: expanded.bytes,
    values,
    allowedFields: new Set(fieldTags),
  });
  expect(conditioned.unresolvedFields).toEqual([]);
  const repeated = resolveOakDocRepeaters({ docxBytes: conditioned.bytes, company, selectedOfficerIds });
  const resolved = resolveOakDocFields(repeated.bytes, values, { dates: buildOakDocResolutionDates(input) });
  expect(resolved.unresolvedTags).toEqual([]);
  return plainText(resolved.bytes);
}

describe('First Board Resolution starter', () => {
  it('builds a master and partials OakDoc accepts, using only known fields', () => {
    const master = buildFirstBoardResolutionOakDocMaster();
    expect(() => inspectOakDocPackage(master, 'master')).not.toThrow();
    expect(documentXml(master)).not.toContain('Times New Roman');
    expect(documentXml(master)).not.toContain('w:val="22"');
    expect(diagnoseOakDocTags(deriveOakDocTemplateFieldTags(master), 'render')).toEqual([]);
    expect(inspectOakDocConditions(master).fieldTags).toEqual(['company.secondaryActivity']);
    for (const partial of FIRST_BOARD_RESOLUTION_PARTIALS) {
      const bytes = partial.build();
      expect(validateOakDocPartialPackage(bytes).filter((entry) => entry.severity === 'error')).toEqual([]);
      expect(diagnoseOakDocTags(deriveOakDocTemplateFieldTags(bytes), 'render')).toEqual([]);
      expect(partial.name).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
      expect(partial.displayName).toMatch(/^First Resolution - /);
      // Arial 10 throughout, ending with an empty line before the next resolution.
      const xml = documentXml(bytes);
      expect(xml).not.toContain('Times New Roman');
      expect(xml).not.toContain('w:val="22"');
      // Capitals come from the field's text case, not Word's All caps.
      expect(xml).not.toContain('<w:caps/>');
      expect(xml).toMatch(/<w:p><w:pPr>(?:(?!<w:r>)[^])*<\/w:pPr><\/w:p>\s*<w:sectPr>/);
    }
  });

  it('prints the reference resolution from company data and the preset partials', () => {
    const text = generate(BORDEUS, ['s1']);
    expect(text).toContain('the Company was duly incorporated on 3 October 2026; and');
    expect(text).toContain('the Notice of Incorporation No. T261308696 was issued');
    expect(text).toContain('Primary Activity - 46900 | Wholesale trade of a variety of goods without a dominant product');
    expect(text).toContain('Secondary Activity - 720201 | Management Consultancy Services');
    expect(text).toContain('•\tYuly Mirawati (S8078571B)');
    expect(text).toContain('•\tLiang Joo Heong (S2039870A)');
    expect(text).not.toContain('•\tTan Wei Jie');
    expect(text).toContain('1.\tADOPTION OF CONSTITUTION');
    expect(text).toContain('RESOLVED that the Company shall adopt the model constitution in force from time to time.');
    expect(text).toContain('7.\tNOTIFICATION AND LODGEMENT');
    expect(text).toContain('situated at 21 BUKIT BATOK CRESCENT, #25-72, WCEGA TOWER, SINGAPORE 658065 since');
    expect(text).toContain('fixed on 31 December with its first financial year end to be 31 December 2026.');
    // The secretary's name field is set to print in UPPERCASE.
    expect(text).toContain('the appointment of TAN WEI JIE (S9101817I) as Secretary');
    expect(text).toContain('OAKTREE ACCOUNTING & CORPORATE SOLUTIONS PTE. LTD. (202437906H)');
    expect(text).toContain('total consideration of SGD 10,000.00 by virtue of Section 63');
    expect(text).toContain('Engterprise Holdings Pte. Ltd.\n3,500');
    expect(text).toContain('Dated this 3 day of October, 2026');
  });

  it('asks for the constitution as a dropdown on the constitution partial', () => {
    const [constitution] = FIRST_BOARD_RESOLUTION_PARTIALS;
    expect(constitution.placeholders).toEqual([expect.objectContaining({
      key: 'custom.constitution',
      options: CONSTITUTION_OPTIONS,
    })]);
    expect(deriveOakDocTemplateFieldTags(constitution.build())).toContain('custom.constitution');
  });

  it('leaves out the secondary activity line when the company has none', () => {
    const text = generate({ ...BORDEUS, secondarySsicCode: null, secondarySsicDescription: null }, []);
    expect(text).toContain('Primary Activity - 46900');
    expect(text).not.toContain('Secondary Activity');
  });

  it('underlines numbered headings only in masters that define the heading style', () => {
    const styled = documentXml(composeOakDocResolutions(buildFirstBoardResolutionOakDocMaster(), PRESET).bytes);
    expect(styled).toMatch(new RegExp(`>1\\.</w:t><w:tab/></w:r><w:r><w:rPr><w:rStyle w:val="${OAKDOC_RESOLUTION_HEADING_STYLE}"/>[^]*?ADOPTION OF CONSTITUTION<`));
    const plain = documentXml(composeOakDocResolutions(buildBoardResolutionOakDocMaster(), PRESET).bytes);
    expect(plain).not.toContain(OAKDOC_RESOLUTION_HEADING_STYLE);
    expect(plain).toContain('>1.</w:t><w:tab/><w:t xml:space="preserve">ADOPTION OF CONSTITUTION<');
  });
});

describe('company fields for resolutions', () => {
  it('derives the first financial year end when no first period is confirmed', () => {
    const values = (company: Partial<OakDocCompanyDetail>) => buildOakDocResolutionValues({
      company: { ...BORDEUS, ...company },
      fieldTags: ['company.firstFinancialYearEnd', 'company.financialYearEnd', 'company.paidUpCapital'],
    });
    expect(values({})).toMatchObject({
      'company.firstFinancialYearEnd': '31 Dec 2026',
      'company.financialYearEnd': '31 December',
      'company.paidUpCapital': 'SGD 10,000.00',
    });
    expect(values({ financialYearEndDay: 30, financialYearEndMonth: 6 })['company.firstFinancialYearEnd']).toBe('30 Jun 2027');
    expect(values({ financialYearEndDay: 31, financialYearEndMonth: 2 })['company.firstFinancialYearEnd']).toBe('28 Feb 2027');
    expect(values({ financialPeriods: [{ periodEnd: '2027-12-31T00:00:00.000Z' }] })['company.firstFinancialYearEnd']).toBe('31 Dec 2027');
    expect(values({ financialYearEndDay: null, financialYearEndMonth: null })).toMatchObject({
      'company.firstFinancialYearEnd': '',
      'company.financialYearEnd': '',
    });
    expect(values({ paidUpCapitalAmount: null, issuedCapitalAmount: '250.5', issuedCapitalCurrency: 'USD' })['company.paidUpCapital']).toBe('USD 250.50');
  });
});
