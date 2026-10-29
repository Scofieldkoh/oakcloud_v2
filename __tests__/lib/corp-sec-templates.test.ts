// @vitest-environment jsdom
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  CORP_SEC_DOCUMENTS,
  APPLICATION_FOR_SHARES,
  DIVIDEND_VOUCHER,
  MINUTES_OF_AGM,
  NOTICE_OF_AGM,
  INSTRUMENT_OF_TRANSFER,
  PROXY_FORM,
  SHARE_CERTIFICATE,
} from '@/content/secretarial/corp-sec-documents';
import {
  CORP_SEC_PARTIALS,
  CORP_SEC_RESOLUTION_TEMPLATES,
  APPLICANT_LIST,
  TRANSFEREE_LIST,
  TRANSFEROR_LIST,
  type CorpSecResolutionTemplate,
} from '@/content/secretarial/corp-sec-resolutions';
import { AGM_PARTIALS, AGM_RESOLUTION_TEMPLATES } from '@/content/secretarial/agm-resolutions';
import { AUDIT_EXEMPTION_OPTIONS, DORMANT_SINCE_OPTIONS, FS_OPTIONS, SOLVENCY_NOT_APPLICABLE } from '@/content/secretarial/corp-sec-fields';
import {
  buildOakDocResolutionDates,
  buildOakDocResolutionValues,
  type OakDocCompanyDetail,
  type OakDocContact,
} from '@/lib/document-editor/oakdoc-context';
import {
  inspectOakDocConditions,
  readOakDocConditionDefinitions,
  resolveOakDocConditions,
} from '@/lib/document-editor/oakdoc-conditions';
import { checkOakDocPersonFields, formatOakDocPersonValues } from '@/lib/document-editor/oakdoc-person-values';
import {
  buildOakDocCustomFieldValues,
  oakDocCustomFieldTypes,
  oakDocRepeaterSectionSummary,
  parseOakDocCustomFieldTag,
} from '@/lib/document-editor/oakdoc-custom-fields';
import { deriveOakDocTemplateFieldTags } from '@/lib/document-editor/oakdoc-field-manifest';
import {
  OAKDOC_REPEATER_ITEM_FIELD_TAGS,
  diagnoseOakDocTags,
  isOakDocRepeaterItemFieldTag,
} from '@/lib/document-editor/oakdoc-field-registry';
import { resolveOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import { expandOakDocPartials, validateOakDocPartialPackage } from '@/lib/document-editor/oakdoc-partials';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';
import { resolveOakDocRepeaters } from '@/lib/document-editor/oakdoc-repeaters';
import {
  OAKDOC_SHAREHOLDERS_REPEATER_TAG,
  oakDocContactListSlug,
  parseOakDocAmount,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import { composeOakDocResolutions } from '@/lib/document-editor/oakdoc-resolutions';
import { perPersonSelectionPatch } from '@/lib/document-generation-per-person';
import type { ResolutionComposition } from '@/lib/resolution-composition';
import type { PlaceholderDefinition } from '@/lib/validations/document-template';

function plainText(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml'])
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

const BORDEUS: OakDocCompanyDetail = {
  id: 'company-1',
  name: 'Bordeus Pte. Ltd.',
  uen: '202645711K',
  incorporationDate: '2026-10-03T00:00:00.000Z',
  primarySsicCode: '46900',
  primarySsicDescription: 'Wholesale trade of a variety of goods without a dominant product',
  financialYearEndDay: 31,
  financialYearEndMonth: 12,
  registeredAddress: '21 Bukit Batok Crescent, #25-72, WCEGA Tower, Singapore 658065',
  auditor: { name: 'Sample & Co. PAC', address: '1 Sample Road' },
  officers: [
    { id: 'd1', name: 'Yuly Mirawati', role: 'DIRECTOR', identificationNumber: 'S8078571B', isCurrent: true },
    { id: 'd2', name: 'Liang Joo Heong', role: 'NOMINEE_DIRECTOR', identificationNumber: 'S2039870A', isCurrent: true },
    { id: 's1', name: 'Tan Wei Jie', role: 'SECRETARY', identificationNumber: 'S9101817I', isCurrent: true },
  ],
  shareholders: [
    { id: 'h1', name: 'Engterprise Holdings Pte. Ltd.', shareholderType: 'CORPORATE', identificationNumber: '202624322D', numberOfShares: 3500, shareClass: 'Ordinary', address: '21 Bukit Batok Crescent', isCurrent: true },
    { id: 'h2', name: 'Liang Joo Heong', identificationNumber: 'S2039870A', numberOfShares: 6500, shareClass: 'Ordinary', isCurrent: true },
  ],
};

const ENGTERPRISE: OakDocContact = {
  id: 'c1',
  name: 'Engterprise Holdings Pte. Ltd.',
  contactType: 'CORPORATE',
  identificationType: 'UEN',
  identificationNumber: '202624322D',
  address: { full: '21 Bukit Batok Crescent, #25-72 Wcega Tower, Singapore 658065' },
};
const TAN: OakDocContact = { id: 'c2', name: 'Tan Wei Jie', identificationNumber: 'S9101817I', nationality: 'Singaporean', address: '1 Orchard Road' };

const slug = (name: string) => oakDocContactListSlug(name);
const listTag = (name: string) => `repeat.contacts.${slug(name)}`;

/** Custom keys a document prints, from its own field tags. */
function customKeys(bytes: Uint8Array): string[] {
  return deriveOakDocTemplateFieldTags(bytes).flatMap((tag) => {
    const parsed = parseOakDocCustomFieldTag(tag);
    return parsed ? [parsed.key] : [];
  });
}

function definedKeys(placeholders: readonly PlaceholderDefinition[]): string[] {
  return placeholders.flatMap((definition) => (definition.source === 'custom' ? [definition.key.replace(/^custom\./, '')] : []));
}

interface Generation {
  custom?: Record<string, unknown>;
  placeholders?: readonly PlaceholderDefinition[];
  repeaters?: Omit<Parameters<typeof resolveOakDocRepeaters>[0], 'docxBytes' | 'company' | 'personValues' | 'conditions'>;
  /** Per-person values as entered: tag, then person id, then key. */
  personValues?: Record<string, Record<string, Record<string, string>>>;
  selectedDirectorId?: string;
}

/** Generation as the generation service runs it: conditions, repeaters, then fields. */
function generate(bytes: Uint8Array, input: Generation = {}): string {
  const fieldTags = deriveOakDocTemplateFieldTags(bytes);
  const context = {
    company: BORDEUS,
    fieldTags,
    resolution: { date: '2026-10-03' },
    selectedDirectorId: input.selectedDirectorId,
    selectedDirectorIds: input.repeaters?.selectedDirectorIds,
    selectedShareholderIds: input.repeaters?.selectedShareholderIds,
  };
  const custom = buildOakDocCustomFieldValues({
    tags: fieldTags,
    data: input.custom ?? {},
    types: oakDocCustomFieldTypes(input.placeholders ?? []),
  });
  const values = { ...buildOakDocResolutionValues(context), ...custom.values };
  const conditioned = resolveOakDocConditions({
    docxBytes: bytes,
    values,
    allowedFields: new Set(fieldTags),
    deferField: isOakDocRepeaterItemFieldTag,
  });
  expect(conditioned.unresolvedFields).toEqual([]);
  const personFields = oakDocRepeaterSectionSummary(input.placeholders ?? []).personFields ?? {};
  const repeated = resolveOakDocRepeaters({
    docxBytes: conditioned.bytes,
    company: BORDEUS,
    dividendPerShare: parseOakDocAmount(input.custom?.dividend_per_share),
    ...input.repeaters,
    personValues: formatOakDocPersonValues(personFields, input.personValues ?? {}),
    conditions: readOakDocConditionDefinitions(conditioned.bytes),
  });
  // Conditions in sections that printed nobody.
  const leftover = resolveOakDocConditions({ docxBytes: repeated.bytes, values: {}, allowedFields: OAKDOC_REPEATER_ITEM_FIELD_TAGS });
  const resolved = resolveOakDocFields(leftover.bytes, values, { dates: { ...buildOakDocResolutionDates(context), ...custom.dates } });
  expect(resolved.unresolvedTags).toEqual([]);
  return plainText(resolved.bytes);
}

function composeTemplate(template: CorpSecResolutionTemplate): { bytes: Uint8Array; placeholders: PlaceholderDefinition[] } {
  const ids = template.partials.map((_, index) => `6666666${index}-6666-4666-8666-666666666666`);
  const preset: ResolutionComposition = {
    subject: template.heading ?? '',
    sections: template.partials.map((partial, index) => ({
      id: `preset-${index + 1}`,
      kind: 'PARTIAL' as const,
      heading: partial.header,
      partialId: ids[index],
    })),
  };
  const composed = composeOakDocResolutions(template.build(), preset);
  expect(composed.diagnostics).toEqual([]);
  const fragments = new Map(template.partials.map((partial, index) => [ids[index], partial.build().bytes]));
  const expanded = expandOakDocPartials({ docxBytes: composed.bytes, fragments });
  expect(expanded.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  return {
    bytes: expanded.bytes,
    placeholders: [...template.placeholders, ...template.partials.flatMap((partial) => partial.build().placeholders)],
  };
}

describe('corporate secretarial starters', () => {
  it('names every partial and template once', () => {
    const partialNames = CORP_SEC_PARTIALS.map((partial) => partial.name);
    expect(new Set(partialNames).size).toBe(partialNames.length);
    for (const name of partialNames) expect(name).toMatch(/^resolution-[a-z0-9-]+$/);
    const templateNames = [...CORP_SEC_RESOLUTION_TEMPLATES, ...CORP_SEC_DOCUMENTS].map((template) => template.name);
    expect(new Set(templateNames).size).toBe(templateNames.length);
    for (const template of CORP_SEC_RESOLUTION_TEMPLATES) {
      for (const partial of template.partials) expect(CORP_SEC_PARTIALS).toContain(partial);
    }
  });

  it.each(CORP_SEC_PARTIALS.map((partial) => [partial.displayName, partial] as const))('partial %s is valid and defines its custom fields', (_, partial) => {
    const { bytes, placeholders } = partial.build();
    expect(validateOakDocPartialPackage(bytes).filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(diagnoseOakDocTags(deriveOakDocTemplateFieldTags(bytes), 'render')).toEqual([]);
    expect(definedKeys(placeholders).sort()).toEqual([...new Set(customKeys(bytes))].sort());
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).not.toContain('Times New Roman');
  });

  it.each(CORP_SEC_DOCUMENTS.map((document) => [document.name, document] as const))('%s is a valid template that defines its custom fields', (_, document) => {
    const { bytes, placeholders } = document.build();
    expect(() => inspectOakDocPackage(bytes, 'master')).not.toThrow();
    expect(diagnoseOakDocTags(deriveOakDocTemplateFieldTags(bytes), 'render')).toEqual([]);
    expect(definedKeys(placeholders).sort()).toEqual([...new Set(customKeys(bytes))].sort());
  });

  it.each(CORP_SEC_RESOLUTION_TEMPLATES.map((template) => [template.name, template] as const))('%s composes its preset resolutions', (_, template) => {
    expect(() => inspectOakDocPackage(template.build(), 'master')).not.toThrow();
    const { bytes } = composeTemplate(template);
    expect(diagnoseOakDocTags(deriveOakDocTemplateFieldTags(bytes), 'render')).toEqual([]);
  });
});

describe('corporate secretarial generation', () => {
  it('prints the Application for Shares like the Bordeus reference, worded for a company or a person', () => {
    const { bytes, placeholders } = APPLICATION_FOR_SHARES.build();
    const tag = listTag(APPLICANT_LIST);
    expect(oakDocRepeaterSectionSummary(placeholders).perPersonTag).toBe(tag);
    const selection = perPersonSelectionPatch(tag, 'c1', {});
    expect(selection.selectedContactListIds).toEqual({ [slug(APPLICANT_LIST)]: ['c1'] });
    const custom = { issue_price: '1', application_date: '2026-10-03' };
    const personValues = { [tag]: { c1: { shares: '3500', amount: '3500', authorised_signatory: 'Yuly Mirawati' }, c2: { shares: '100', amount: '100' } } };
    const text = generate(bytes, { custom, placeholders, personValues, repeaters: { contactLists: { [slug(APPLICANT_LIST)]: [ENGTERPRISE] } } });
    expect(text).toContain('APPLICATION FOR SHARES');
    expect(text).toContain('To:\tThe Board of Directors\nBORDEUS PTE. LTD.');
    expect(text).toContain('We, the undersigned, hereby apply for 3,500 Ordinary Shares at S$1.00 per share for cash, to be issued by BORDEUS PTE. LTD. (the ‘Company’) and request that you allot us that number of shares.');
    expect(text).toContain('A sum of S$3,500.00 being full payment');
    expect(text).toContain('enter our name in the Register of Members');
    expect(text).toContain('Dated this 3rd day of October, 2026');
    expect(text).toContain('Name: Engterprise Holdings Pte. Ltd.');
    expect(text).toContain('Authorised Signature: Yuly Mirawati');
    expect(text).toContain('UEN\n:\n202624322D');
    expect(text).not.toContain('I, the undersigned');

    const individual = generate(bytes, { custom, placeholders, personValues, repeaters: { contactLists: { [slug(APPLICANT_LIST)]: [TAN] } } });
    expect(individual).toContain('I, the undersigned, hereby apply for 100 Ordinary Shares');
    expect(individual).toContain('allot me that number of shares');
    expect(individual).not.toContain('Authorised Signature');
    expect(individual).toContain('Name: Tan Wei Jie');
    expect(individual).toContain('NRIC No.\n:\nS9101817I');
  });

  it('leaves directors’ fees out of the AGM notice and minutes when none are entered', () => {
    for (const document of [NOTICE_OF_AGM, MINUTES_OF_AGM]) {
      const { bytes, placeholders } = document.build();
      expect(new Set(inspectOakDocConditions(bytes).fieldTags)).toEqual(new Set(['custom.directors_fees']));
      const custom = { fs_documents: FS_OPTIONS[1], fs_period_end: '2026-12-31', agm_date: '2027-06-30', agm_time: '10.00 a.m.', agm_venue: 'the registered office', agm_auditor_item: 'To note the audit exemption.', notice_date: '2027-06-01' };
      const repeaters = { selectedDirectorIds: ['d1'], selectedOfficerIds: ['s1'] };
      const withFees = generate(bytes, { custom: { ...custom, directors_fees: '1000' }, placeholders, repeaters, selectedDirectorId: 'd1' });
      expect(withFees).toContain('Directors’ fees of S$1,000.00 for the financial year ended 31 December 2026');
      expect(withFees).toContain('YULY MIRAWATI');
      expect(withFees).not.toContain('LIANG JOO HEONG\n');
      const without = generate(bytes, { custom: { ...custom, directors_fees: '' }, placeholders, repeaters, selectedDirectorId: 'd1' });
      expect(without).not.toContain('Directors’ fees');
    }
  });

  it('works out each shareholder’s dividend on the voucher', () => {
    const { bytes, placeholders } = DIVIDEND_VOUCHER.build();
    const custom = { dividend_per_share: '0.10', dividend_period_end: '2026-12-31', dividend_payment_date: '2026-12-15' };
    const text = generate(bytes, { custom, placeholders, repeaters: { selectedShareholderIds: ['h2'] } });
    expect(text).toContain('Dividend per share\nS$0.10');
    expect(text).toContain('Amount payable\nS$650.00');
    expect(text).not.toContain('ENGTERPRISE');
  });

  it('prints each party’s shares on the instrument of transfer, with a signature for each', () => {
    const { bytes, placeholders } = INSTRUMENT_OF_TRANSFER.build();
    const personValues: Record<string, Record<string, Record<string, string>>> = {
      [listTag(TRANSFEROR_LIST)]: { c1: { shares: '1000', consideration: '1000', certificate_no: '1' } },
      [listTag(TRANSFEREE_LIST)]: { c2: { shares: '600' }, c3: { shares: '400' } },
    };
    const SECOND: OakDocContact = { id: 'c3', name: 'Lim Mei Ling', identificationNumber: 'G1234567X', nationality: 'Malaysian', address: '2 Orchard Road' };
    const text = generate(bytes, {
      custom: { transfer_shares: '1000', transfer_consideration: '1000', transfer_date: '2026-10-03' },
      placeholders,
      personValues,
      repeaters: { contactLists: { [slug(TRANSFEROR_LIST)]: [ENGTERPRISE], [slug(TRANSFEREE_LIST)]: [TAN, SECOND] } },
    });
    expect(text).toMatch(/TRANSFEROR\(S\)\nName\n:\nENGTERPRISE HOLDINGS PTE\. LTD\.\nUEN\n:\n202624322D\nAddress/);
    expect(text).toContain('Shares\n:\n1,000 ordinary shares, for a consideration of S$1,000.00 (share certificate no. 1)');
    expect(text).toMatch(/TRANSFEREE\(S\)\nName\n:\nTAN WEI JIE\nNRIC No\.\n:\nS9101817I\nNationality\n:\nSingaporean/);
    expect(text).toContain('LIM MEI LING\nFIN\n:\nG1234567X');
    expect(text).toContain('Shares\n:\n600 ordinary shares');
    expect(text).toContain('Shares\n:\n400 ordinary shares');
    expect(text).toContain('in consideration of the total sum of S$1,000.00 paid by the Transferee(s)');
    expect(text).toContain('Signed by the Transferor\nFor and on behalf of\nENGTERPRISE HOLDINGS PTE. LTD.');
    expect(text).toContain('Signed by the Transferee\n……………………………………..\nTAN WEI JIE\nTransferee');
    expect(text).toContain('LIM MEI LING\nTransferee');
  });

  it('lists each transferor’s and transferee’s shares in the transfer resolution and checks they tally', () => {
    const template = CORP_SEC_RESOLUTION_TEMPLATES.find((entry) => entry.name === 'Board Resolution - Transfer of Shares')!;
    const { bytes, placeholders } = composeTemplate(template);
    const personFields = oakDocRepeaterSectionSummary(placeholders).personFields ?? {};
    expect(personFields[listTag(TRANSFEROR_LIST)]?.map((field) => [field.key, field.totalOf])).toEqual([
      ['shares', 'transfer_shares'],
      ['consideration', 'transfer_consideration'],
      ['certificate_no', undefined],
    ]);
    expect(personFields[listTag(TRANSFEREE_LIST)]?.map((field) => [field.key, field.totalOf])).toEqual([['shares', 'transfer_shares']]);

    const people = {
      [listTag(TRANSFEROR_LIST)]: [{ id: 'c1', name: 'Engterprise Holdings Pte. Ltd.' }],
      [listTag(TRANSFEREE_LIST)]: [{ id: 'c2', name: 'Tan Wei Jie' }, { id: 'c3', name: 'Lim Mei Ling' }],
    };
    const customData = { transfer_shares: '1000', transfer_consideration: '1000' };
    const short = checkOakDocPersonFields({
      personFields,
      people,
      values: { [listTag(TRANSFEROR_LIST)]: { c1: { certificate_no: '1' } }, [listTag(TRANSFEREE_LIST)]: { c2: { shares: '600' }, c3: { shares: '300' } } } as Record<string, Record<string, Record<string, string>>>,
      customData,
      sectionName: (tag) => (tag === listTag(TRANSFEREE_LIST) ? 'Transferee' : 'Transferor'),
    });
    expect(short.issues.map((issue) => issue.message)).toEqual([
      'Shares received for Transferee adds up to 900, but Transfer shares is 1,000.',
    ]);
    // The only transferor's shares and consideration default to the totals.
    expect(short.values[listTag(TRANSFEROR_LIST)].c1).toEqual({ shares: '1000', consideration: '1000', certificate_no: '1' });

    const values: Record<string, Record<string, Record<string, string>>> = {
      [listTag(TRANSFEROR_LIST)]: { c1: { certificate_no: '1' } },
      [listTag(TRANSFEREE_LIST)]: { c2: { shares: '600' }, c3: { shares: '400' } },
    };
    const checked = checkOakDocPersonFields({ personFields, people, values, customData });
    expect(checked.issues).toEqual([]);
    const SECOND: OakDocContact = { id: 'c3', name: 'Lim Mei Ling', identificationNumber: 'G1234567X' };
    const text = generate(bytes, {
      custom: { ...customData, resolution_date: '2026-10-03' },
      placeholders,
      personValues: checked.values,
      repeaters: { contactLists: { [slug(TRANSFEROR_LIST)]: [ENGTERPRISE], [slug(TRANSFEREE_LIST)]: [TAN, SECOND] } },
    });
    expect(text).toContain('Transferor(s)\n•\tENGTERPRISE HOLDINGS PTE. LTD. (UEN 202624322D): 1,000 shares, for S$1,000.00 (share certificate no. 1)');
    expect(text).toContain('Transferee(s)\n•\tTAN WEI JIE (NRIC No. S9101817I): 600 shares\n•\tLIM MEI LING (FIN G1234567X): 400 shares');
  });

  it('allots each applicant’s shares and prints each shareholder’s own certificate', () => {
    const template = CORP_SEC_RESOLUTION_TEMPLATES.find((entry) => entry.name === 'Board Resolution - Allotment of Shares')!;
    const { bytes, placeholders } = composeTemplate(template);
    const text = generate(bytes, {
      custom: { allotment_shares: '3600', issue_price: '1', allotment_consideration: '3600' },
      placeholders,
      personValues: { [listTag(APPLICANT_LIST)]: { c1: { shares: '3500', amount: '3500' }, c2: { shares: '100', amount: '100' } } },
      repeaters: { contactLists: { [slug(APPLICANT_LIST)]: [ENGTERPRISE, TAN] } },
    });
    expect(text).toContain('•\tENGTERPRISE HOLDINGS PTE. LTD. (UEN 202624322D): 3,500 shares for S$3,500.00\n•\tTAN WEI JIE (NRIC No. S9101817I): 100 shares for S$100.00');

    const certificate = SHARE_CERTIFICATE.build();
    const printed = generate(certificate.bytes, {
      custom: { certificate_date: '2026-10-03' },
      placeholders: certificate.placeholders,
      personValues: { [OAKDOC_SHAREHOLDERS_REPEATER_TAG]: { h1: { certificate_no: '2', certificate_shares: '3500' } } },
      repeaters: { selectedShareholderIds: ['h1'] },
    });
    expect(printed).toContain('Certificate No. 2');
    expect(printed).toContain('THIS IS TO CERTIFY THAT ENGTERPRISE HOLDINGS PTE. LTD. (UEN 202624322D) of 21 Bukit Batok Crescent is the registered holder of 3,500 fully paid Ordinary shares');
  });

  it('words the proxy form for a corporate member and has it sign through a signatory', () => {
    const { bytes, placeholders } = PROXY_FORM.build();
    const custom = { agm_date: '2027-06-30', agm_time: '10.00 a.m.', agm_venue: 'the registered office' };
    const personValues = { [OAKDOC_SHAREHOLDERS_REPEATER_TAG]: { h1: { proxy_name: 'Yuly Mirawati', proxy_id: 'S8078571B', proxy_address: '1 Orchard Road' } } };
    const text = generate(bytes, { custom, placeholders, personValues, repeaters: { selectedShareholderIds: ['h1'] } });
    expect(text).toContain('We, ENGTERPRISE HOLDINGS PTE. LTD. (UEN 202624322D) of 21 Bukit Batok Crescent, a corporation which is a member of the Company holding 3,500 shares, hereby appoint YULY MIRAWATI (S8078571B)');
    expect(text).toContain('as our proxy to attend and vote for us');
    expect(text).toContain('For and on behalf of\nENGTERPRISE HOLDINGS PTE. LTD.\n……………………………………..\nName:\nAuthorised Signatory');
    expect(text).not.toContain('my proxy');
  });

  it('composes the members’ resolutions in lieu of an AGM with company data', () => {
    const template = CORP_SEC_RESOLUTION_TEMPLATES.find((entry) => entry.name === 'Members Resolution - In Lieu of AGM')!;
    const { bytes, placeholders } = composeTemplate(template);
    const text = generate(bytes, {
      custom: { fs_documents: FS_OPTIONS[1], fs_period_end: '2026-12-31', audit_exemption_basis: 'a small company', directors_fees: '0' },
      placeholders,
      repeaters: { selectedDirectorIds: ['d1'] },
    });
    expect(text).toContain('MEMBERS’ RESOLUTIONS IN WRITING');
    expect(text).toContain('1.\tFINANCIAL STATEMENTS');
    expect(text).toContain('RESOLVED AS AN ORDINARY RESOLUTION THAT the unaudited financial statements of the Company together with the Directors’ Statement for the financial year ended 31 December 2026 be received, and are hereby approved and adopted by the members of the Company.');
    expect(text).toContain('YULY MIRAWATI (NRIC No. S8078571B), who retires');
    expect(text).not.toContain('LIANG JOO HEONG (NRIC No. S2039870A), who retires');
    expect(text).toContain('5.\tAUTHORITY TO ALLOT AND ISSUE SHARES');
    // A corporate member signs through its authorised signatory; a person as a member.
    expect(text).toContain('For and on behalf of\nEngterprise Holdings Pte. Ltd.\n___________________________\nName:\nAuthorised Signatory');
    expect(text).toContain('___________________________\nLiang Joo Heong\nMember');
  });

  it('lists the auditors on record and changes SSIC from the company’s current activity', () => {
    const auditors = CORP_SEC_RESOLUTION_TEMPLATES.find((entry) => entry.name === 'Board Resolution - Resignation of Auditors')!;
    const resignation = composeTemplate(auditors);
    expect(generate(resignation.bytes, { custom: { auditor_cessation_date: '2026-10-31' }, placeholders: resignation.placeholders }))
      .toContain('the resignation of Sample & Co. PAC as auditors of the Company with effect from 31 October 2026 be accepted.');

    const ssic = composeTemplate(CORP_SEC_RESOLUTION_TEMPLATES.find((entry) => entry.name === 'Board Resolution - Change of Business Activities (SSIC)')!);
    const text = generate(ssic.bytes, {
      custom: { new_primary_activity: '62011 | Software development', new_secondary_activity: '70201 | Management consultancy services' },
      placeholders: ssic.placeholders,
    });
    expect(text).toContain('the primary activity of the Company be changed to 62011 | Software development, in place of 46900 | Wholesale trade of a variety of goods without a dominant product.');
    expect(text).toContain('3.\tNOTIFICATION AND LODGEMENT');
  });

  it('accepts the resignation of the director ticked, from any kind of director', () => {
    const { bytes, placeholders } = composeTemplate(CORP_SEC_RESOLUTION_TEMPLATES.find((entry) => entry.name === 'Board Resolution - Resignation of Director')!);
    const text = generate(bytes, { custom: { cessation_date: '2026-10-31' }, placeholders, repeaters: { selectedOfficerIds: ['d2'] } });
    expect(text).toContain('the resignation of LIANG JOO HEONG (NRIC No. S2039870A) as a Director of the Company with effect from 31 October 2026 be accepted');
    expect(text).toContain('Liang Joo Heong\nNominee Director');
  });
});

describe('resolutions for a year without an AGM', () => {
  it('adds partials of their own and presets only partials they add or the corporate secretarial seed has', () => {
    const corpSecNames = new Set(CORP_SEC_PARTIALS.map((partial) => partial.name));
    for (const partial of AGM_PARTIALS) {
      expect(partial.name).toMatch(/^resolution-[a-z0-9-]+$/);
      expect(corpSecNames.has(partial.name)).toBe(false);
      const { bytes, placeholders } = partial.build();
      expect(validateOakDocPartialPackage(bytes).filter((entry) => entry.severity === 'error')).toEqual([]);
      expect(diagnoseOakDocTags(deriveOakDocTemplateFieldTags(bytes), 'render')).toEqual([]);
      expect(definedKeys(placeholders).sort()).toEqual([...new Set(customKeys(bytes))].sort());
    }
    const templateNames = new Set([...CORP_SEC_RESOLUTION_TEMPLATES, ...CORP_SEC_DOCUMENTS].map((template) => template.name));
    for (const template of AGM_RESOLUTION_TEMPLATES) {
      expect(templateNames.has(template.name)).toBe(false);
      for (const partial of template.partials) expect([...AGM_PARTIALS, ...CORP_SEC_PARTIALS]).toContain(partial);
      const { bytes } = composeTemplate(template);
      expect(diagnoseOakDocTags(deriveOakDocTemplateFieldTags(bytes), 'render')).toEqual([]);
    }
  });

  const agmTemplate = (name: string) => AGM_RESOLUTION_TEMPLATES.find((entry) => entry.name === `Members Resolution - ${name}`)!;

  it('dispenses with AGMs, adopts the accounts and names each director re-elected', () => {
    const { bytes, placeholders } = composeTemplate(agmTemplate('Dispense with AGM'));
    const text = generate(bytes, {
      custom: { fs_documents: FS_OPTIONS[1], fs_period_end: '2025-10-31', audit_exemption_basis: AUDIT_EXEMPTION_OPTIONS[0] },
      placeholders,
    });
    expect(text).toContain('1.\tDISPENSATION WITH ANNUAL GENERAL MEETING\nRESOLVED THAT pursuant to Section 175A of the Companies Act 1967, the Company dispense with the holding of an annual general meeting for the financial year ended 31 October 2025, and that the matters which would otherwise be dealt with at that meeting be dealt with by these written resolutions');
    expect(text).not.toContain('subsequent years');
    expect(text).toContain('2.\tFINANCIAL STATEMENTS AND DIRECTORS’ STATEMENT\nRESOLVED AS AN ORDINARY RESOLUTION THAT the unaudited financial statements of the Company together with the Directors’ Statement for the financial year ended 31 October 2025 be received, and are hereby approved and adopted by the members of the Company.');
    expect(text).toContain('3.\tAUDIT EXEMPTION');
    expect(text).toContain('4.\tRE-ELECTION OF DIRECTORS');
    expect(text).toContain('THAT the following Directors, retiring from office whether pursuant to the Constitution of the Company or voluntarily, and being eligible and having offered themselves for re-election, be re-elected as Directors of the Company:\n•\tYULY MIRAWATI (NRIC No. S8078571B)\n•\tLIANG JOO HEONG (NRIC No. S2039870A)');
    expect(text).toContain('5.\tFILING OF ANNUAL RETURN\nRESOLVED THAT the Company Secretary and/or OAKTREE ACCOUNTING & CORPORATE SOLUTIONS PTE. LTD. be authorised to lodge the annual return of the Company for the financial year ended 31 October 2025');
    expect(text).toContain('For and on behalf of\nEngterprise Holdings Pte. Ltd.');
  });

  it('records when the financial statements were sent', () => {
    const { bytes, placeholders } = composeTemplate(agmTemplate('Financial Statements Sent (No AGM)'));
    const text = generate(bytes, {
      custom: { fs_documents: FS_OPTIONS[1], fs_period_end: '2025-10-31', fs_sent_date: '2025-12-12', audit_exemption_basis: AUDIT_EXEMPTION_OPTIONS[0] },
      placeholders,
      repeaters: { selectedDirectorIds: ['d1'] },
    });
    expect(text).toContain('2.\tNO ANNUAL GENERAL MEETING\nIT IS NOTED THAT the unaudited financial statements of the Company together with the Directors’ Statement for the financial year ended 31 October 2025 were sent to all members of the Company on 12 December 2025');
    expect(text).toContain('as Section 175A(1)(b) of the Companies Act 1967 permits');
    expect(text).not.toContain('LIANG JOO HEONG (NRIC');
    // One director ticked: "Director", not "Directors".
    expect(text).toContain('THAT the following Director, retiring from office whether pursuant to the Constitution of the Company or voluntarily, and being eligible and having offered to be re-elected, be re-elected as a Director of the Company:\n•\tYULY MIRAWATI (NRIC No. S8078571B)');
    expect(text).not.toContain('following Directors');
  });

  it('records the dormant company exemptions without asking for accounts', () => {
    const { bytes, placeholders } = composeTemplate(agmTemplate('Dormant Company'));
    expect(definedKeys(placeholders)).not.toContain('fs_documents');
    const text = generate(bytes, { custom: { fs_period_end: '2025-12-31' }, placeholders, repeaters: { selectedDirectorIds: ['d1'] } });
    expect(text).toContain('1.\tDORMANT RELEVANT COMPANY\nIT IS NOTED THAT the Directors have confirmed that the Company satisfies the requirements of a dormant relevant company under the Companies Act 1967 (the “Act”) for the financial year ended 31 December 2025 (the “Financial Year”), including the applicable dormancy and asset criteria');
    expect(text).toContain('IT IS FURTHER NOTED THAT, subject to compliance with the applicable statutory requirements:\n(a)\tthe Directors are exempt from preparing financial statements for the Financial Year under Section 201A of the Act;\n(b)\tthe Company is exempt from audit requirements for the Financial Year under Section 205B of the Act; and\n(c)\tthe Company, being a private company and a dormant relevant company, is not required to hold an Annual General Meeting');
    expect(text).toContain('2.\tRE-ELECTION OF DIRECTORS\nRESOLVED AS AN ORDINARY RESOLUTION THAT the following Director, retiring from office in accordance with the Constitution of the Company, and being eligible and having offered to be re-elected, be re-elected as a Director of the Company:\n•\tYULY MIRAWATI (NRIC No. S8078571B)');
    expect(text).toContain('3.\tFILING OF ANNUAL RETURN');
    expect(text).not.toContain('solvent');
  });

  const boardDormant = AGM_RESOLUTION_TEMPLATES.find((entry) => entry.name === 'Board Resolution - Dormant Company')!;

  it('records the directors’ dormancy confirmations for a company dormant since incorporation', () => {
    const { bytes, placeholders } = composeTemplate(boardDormant);
    expect(definedKeys(placeholders).sort()).toEqual(['dormant_since', 'fs_period_end', 'parent_company', 'previous_fs_period_end', 'resolution_date', 'solvency']);
    const text = generate(bytes, {
      custom: { fs_period_end: '2025-12-31', dormant_since: DORMANT_SINCE_OPTIONS[0], parent_company: 'No', solvency: 'is able' },
      placeholders,
    });
    expect(text).toContain('DORMANT RELEVANT COMPANY\n1.\tDORMANCY\nCONFIRMED THAT the Company has been dormant from the time of its incorporation, and that no accounting transactions have occurred during the financial year ended 31 December 2025 (the “Financial Year”), other than transactions disregarded for the purpose of determining dormancy under the Companies Act 1967 (the “Act”).');
    expect(text).toContain('2.\tRELEVANT COMPANY STATUS\nCONFIRMED THAT the Company satisfies the requirements of a “relevant company” under the Act, in that:\n(a)\tthe Company is neither a listed company nor a subsidiary of a listed company; and\n(b)\tthe total assets of the Company did not exceed S$500,000 at any time during the Financial Year.\n3.');
    expect(text).toContain('3.\tDIRECTORS’ DECLARATION\nCONFIRMED THAT:\n(a)\tthe Company has remained dormant throughout the Financial Year;');
    expect(text).toContain('(c)\tno notice has been received requiring the Company to obtain an audit of its accounts for the Financial Year;\n(d)\tthe accounting and other records required to be kept by the Company have been properly maintained in accordance with the Act; and\n(e)\tfor the purpose of the Annual Return solvency declaration, the Company is able to pay its debts as and when they fall due.');
    expect(text).toContain('4.\tSTATUTORY EXEMPTIONS\nNOTED THAT, based on the foregoing confirmations:\n(a)\tthe Directors are entitled to exemption');
    expect(text).toContain('5.\tAPPROVAL OF STATUTORY DECLARATIONS AND FILING OF ANNUAL RETURN\nRESOLVED THAT the statutory statements and declarations by the Directors reflecting the confirmations set out in paragraph 3');
    expect(text).toContain('FURTHER RESOLVED THAT any one Director, the Company Secretary, or OAKTREE ACCOUNTING & CORPORATE SOLUTIONS PTE. LTD. be and is hereby authorised to prepare and lodge');
  });

  it('dates dormancy from the previous year end, adds the group test and leaves out the solvency declaration', () => {
    const { bytes, placeholders } = composeTemplate(boardDormant);
    const text = generate(bytes, {
      custom: { fs_period_end: '2025-12-31', dormant_since: DORMANT_SINCE_OPTIONS[1], previous_fs_period_end: '2024-12-31', parent_company: 'Yes', solvency: SOLVENCY_NOT_APPLICABLE },
      placeholders,
    });
    expect(text).toContain('CONFIRMED THAT the Company has been dormant since the end of the previous financial year ended 31 December 2024, and that no accounting transactions');
    expect(text).not.toContain('from the time of its incorporation');
    expect(text).toContain('(a)\tthe Company is neither a listed company nor a subsidiary of a listed company;\n(b)\tthe total assets of the Company did not exceed S$500,000 at any time during the Financial Year; and\n(c)\twhere the Company is a parent company which is not itself a subsidiary of another corporation, the consolidated total assets of its group did not exceed S$500,000');
    expect(text).toContain('(c)\tno notice has been received requiring the Company to obtain an audit of its accounts for the Financial Year; and\n(d)\tthe accounting and other records required to be kept by the Company have been properly maintained in accordance with the Act.\n4.');
    expect(text).not.toContain('solvency declaration');
  });
});

describe('customer due diligence form', () => {
  it('builds questions the form builder accepts, with unique keys', async () => {
    const { buildSgCustomerDueDiligenceFields } = await import('@/lib/form-templates/sg-customer-due-diligence');
    const { saveFormFieldsSchema } = await import('@/lib/validations/form-builder');
    const fields = buildSgCustomerDueDiligenceFields({ firmName: 'Oaktree', nationalityPresetId: '11111111-1111-4111-8111-111111111111', countryPresetId: '22222222-2222-4222-8222-222222222222' });
    expect(() => saveFormFieldsSchema.parse({ fields })).not.toThrow();
    const keys = fields.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    const keySet = new Set(keys);
    for (const field of fields) {
      const condition = field.condition as { fieldKey?: string } | null | undefined;
      if (condition?.fieldKey) expect(keySet.has(condition.fieldKey)).toBe(true);
    }
  });
});
