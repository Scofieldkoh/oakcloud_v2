// @vitest-environment jsdom
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  CORPORATE_SECRETARY_LIST_NAME,
  FORM_45B_TEMPLATE,
  FORM_45_TEMPLATE,
} from '@/content/secretarial/consent-forms-oakdoc';
import { buildOakDocCustomFieldValues, oakDocRepeaterSectionSummary } from '@/lib/document-editor/oakdoc-custom-fields';
import type { OakDocCompanyDetail, OakDocContact } from '@/lib/document-editor/oakdoc-context';
import { deriveOakDocTemplateFieldTags } from '@/lib/document-editor/oakdoc-field-manifest';
import { diagnoseOakDocTags } from '@/lib/document-editor/oakdoc-field-registry';
import { resolveOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';
import { resolveOakDocRepeaters } from '@/lib/document-editor/oakdoc-repeaters';
import { oakDocContactListSlug } from '@/lib/document-editor/oakdoc-repeater-definitions';
import { perPersonSelectionPatch } from '@/lib/document-generation-per-person';

function plainText(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml'])
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');
}

const BORDEUS: OakDocCompanyDetail = {
  id: 'company-1',
  name: 'Bordeus Pte. Ltd.',
  uen: '202645711K',
  officers: [
    { id: 'd1', name: 'Yuly Mirawati', role: 'DIRECTOR', identificationNumber: 'S8078571B', nationality: 'Indonesian', address: '1 Orchard Road, Singapore 238824', isCurrent: true },
    { id: 'd2', name: 'Liang Joo Heong', role: 'DIRECTOR', identificationNumber: 'S2039870A', nationality: 'Singaporean', address: '113 Pending Road, #12-94, Singapore 670113', isCurrent: true },
  ],
  shareholders: [],
};

const TAN_WEI_JIE: OakDocContact = {
  id: 'c1',
  name: 'Tan Wei Jie',
  identificationNumber: 'S9101817I',
  nationality: 'Singaporean',
  address: { full: '21 Bukit Batok Crescent, #25-72, WCEGA Tower, Singapore 658065' },
};

const SECRETARY_SLUG = oakDocContactListSlug(CORPORATE_SECRETARY_LIST_NAME);

/** Generation of one per-person document, as the generation service runs it. */
function generate(bytes: Uint8Array, data: Omit<Parameters<typeof resolveOakDocRepeaters>[0], 'docxBytes'>): string {
  const tags = deriveOakDocTemplateFieldTags(bytes);
  const custom = buildOakDocCustomFieldValues({
    tags,
    data: { appointment_date: '2026-10-03' },
    types: { appointment_date: 'date' },
  });
  const repeated = resolveOakDocRepeaters({ docxBytes: bytes, ...data });
  const resolved = resolveOakDocFields(repeated.bytes, {
    'company.name': data.company.name,
    'company.uen': data.company.uen ?? '',
    ...custom.values,
  }, { dates: custom.dates });
  expect(resolved.unresolvedTags).toEqual([]);
  return plainText(resolved.bytes);
}

describe('consent form starters', () => {
  it.each([FORM_45_TEMPLATE, FORM_45B_TEMPLATE])('$name is an OakDoc template using only known fields', (starter) => {
    const bytes = starter.build();
    expect(() => inspectOakDocPackage(bytes, 'master')).not.toThrow();
    expect(diagnoseOakDocTags(deriveOakDocTemplateFieldTags(bytes), 'render')).toEqual([]);
  });

  it('makes Form 45 one document per director and Form 45B one per secretary contact', () => {
    expect(oakDocRepeaterSectionSummary(FORM_45_TEMPLATE.placeholders).perPersonTag).toBe('repeat.directors');
    const secretary = oakDocRepeaterSectionSummary(FORM_45B_TEMPLATE.placeholders);
    expect(secretary.perPersonTag).toBe(`repeat.contacts.${SECRETARY_SLUG}`);
    expect(secretary.names[`repeat.contacts.${SECRETARY_SLUG}`]).toEqual([CORPORATE_SECRETARY_LIST_NAME]);
  });

  it('prints Form 45 for the one director the document is for', () => {
    const selection = perPersonSelectionPatch('repeat.directors', 'd2', {});
    const text = generate(FORM_45_TEMPLATE.build(), { company: BORDEUS, selectedDirectorIds: selection.selectedDirectorIds });
    expect(text).toContain('FORM 45\n');
    expect(text).toContain('Name of Company: Bordeus Pte. Ltd.');
    expect(text).toContain('Company No: 202645711K');
    expect(text).toContain('hereby consent to act as a director of the abovenamed company with effect from 3rd October 2026 and declare that:');
    expect(text).toContain('Liang Joo Heong');
    expect(text).toContain('113 Pending Road, #12-94, Singapore 670113');
    expect(text).toContain('S2039870A');
    expect(text).not.toContain('Yuly Mirawati');
    expect(text).toContain('Dated this 3rd day of October, 2026');
  });

  it('prints Form 45B for the one contact on the secretary list', () => {
    const selection = perPersonSelectionPatch(`repeat.contacts.${SECRETARY_SLUG}`, 'c1', {});
    expect(selection.selectedContactListIds).toEqual({ [SECRETARY_SLUG]: ['c1'] });
    const text = generate(FORM_45B_TEMPLATE.build(), {
      company: BORDEUS,
      contactLists: { [SECRETARY_SLUG]: [TAN_WEI_JIE] },
    });
    expect(text).toContain('FORM 45B\n');
    expect(text).toContain('1.\tI, the undermentioned person, hereby consent to act as a secretary of the abovenamed company with effect from 03 October 2026.');
    expect(text).toContain('*(iiia)\ta member of the Institute of Singapore Chartered Accountants');
    expect(text).toContain('Tan Wei Jie');
    expect(text).toContain('21 Bukit Batok Crescent, #25-72, WCEGA Tower, Singapore 658065');
    expect(text).toContain('S9101817I');
    expect(text).toContain('Dated this 3rd day of October, 2026');
  });
});
