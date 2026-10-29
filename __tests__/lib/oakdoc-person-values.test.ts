// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  checkOakDocPersonFields,
  formatOakDocPersonValues,
} from '@/lib/document-editor/oakdoc-person-values';
import {
  oakDocRepeaterSectionSummary,
  writeOakDocRepeaterSections,
  type OakDocPersonField,
} from '@/lib/document-editor/oakdoc-custom-fields';
import { addOakDocConditionDefinitions, readOakDocConditionDefinitions } from '@/lib/document-editor/oakdoc-conditions';
import { expandOakDocPartials, oakDocPartialTag } from '@/lib/document-editor/oakdoc-partials';
import { resolveOakDocGenericRepeaters } from '@/lib/document-editor/oakdoc-generic-repeaters';
import { oakDocContactsRepeaterTag } from '@/lib/document-editor/oakdoc-repeater-definitions';
import { ControlIds, conditionalBlock, packageOakDoc, seededConditionId } from '@/content/resolution/resolution-oakdoc-xml';
import { DocumentWriter, field, personField, custom, t, whenBlank, whenSet } from '@/content/secretarial/corp-sec-oakdoc-kit';

const TRANSFEREES = oakDocContactsRepeaterTag('transferee');
const SHARES: OakDocPersonField = { key: 'shares', label: 'Shares received', type: 'number', required: true, totalOf: 'transfer_shares' };
const NOTE: OakDocPersonField = { key: 'note', label: 'Note', type: 'text', required: false };

function text(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml'])
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

describe('per-person field values', () => {
  const people = { [TRANSFEREES]: [{ id: 'a', name: 'Tan' }, { id: 'b', name: 'Lim' }] };

  it('accepts values that add up to their total', () => {
    const result = checkOakDocPersonFields({
      personFields: { [TRANSFEREES]: [SHARES, NOTE] },
      people,
      values: { [TRANSFEREES]: { a: { shares: '600' }, b: { shares: '400', note: 'joint' } } },
      customData: { transfer_shares: '1,000' },
    });
    expect(result.issues).toEqual([]);
    expect(result.values[TRANSFEREES]).toEqual({ a: { shares: '600' }, b: { shares: '400', note: 'joint' } });
  });

  it('reports missing values, non-numbers and totals that do not tally', () => {
    const missing = checkOakDocPersonFields({
      personFields: { [TRANSFEREES]: [SHARES] },
      people,
      values: { [TRANSFEREES]: { a: { shares: 'many' } } },
      customData: { transfer_shares: '1000' },
      sectionName: () => 'Transferee',
    });
    expect(missing.issues.map((issue) => issue.message)).toEqual([
      'Shares received for Tan (Transferee) must be a number.',
      'Enter Shares received for Lim (Transferee).',
    ]);
    const short = checkOakDocPersonFields({
      personFields: { [TRANSFEREES]: [SHARES] },
      people,
      values: { [TRANSFEREES]: { a: { shares: '600' }, b: { shares: '300' } } },
      customData: { transfer_shares: '1000' },
      sectionName: () => 'Transferee',
      customLabel: () => 'Shares transferred',
    });
    expect(short.issues).toEqual([{
      tag: TRANSFEREES,
      key: 'shares',
      message: 'Shares received for Transferee adds up to 900, but Shares transferred is 1,000.',
    }]);
  });

  it('gives a single person the total and formats values as they print', () => {
    const result = checkOakDocPersonFields({
      personFields: { [TRANSFEREES]: [SHARES] },
      people: { [TRANSFEREES]: [{ id: 'a', name: 'Tan' }] },
      customData: { transfer_shares: '1000' },
    });
    expect(result.issues).toEqual([]);
    expect(formatOakDocPersonValues({ [TRANSFEREES]: [SHARES] }, result.values)).toEqual({
      [TRANSFEREES]: { a: { 'item.shares': '1,000' } },
    });
  });

  it('stores per-person fields with their section and reads them back', () => {
    const placeholders = writeOakDocRepeaterSections([], {
      names: { [TRANSFEREES]: 'Transferee' },
      shortlists: {},
      personFields: { [TRANSFEREES]: [SHARES, NOTE] },
    }, [TRANSFEREES]);
    expect(oakDocRepeaterSectionSummary(placeholders).personFields).toEqual({ [TRANSFEREES]: [SHARES, NOTE] });
    // A section that is gone takes its per-person fields with it.
    const removed = writeOakDocRepeaterSections(placeholders, { names: {}, shortlists: {}, personFields: { [TRANSFEREES]: [SHARES] } }, []);
    expect(oakDocRepeaterSectionSummary(removed).personFields).toBeUndefined();
  });
});

describe('per-person wording', () => {
  it('prints each person their own values and the wording for a company or a person', () => {
    const d = new DocumentWriter();
    const shares = personField('shares', 'Shares', 'number', '1', { totalOf: custom('transfer_shares', 'Shares transferred', 'number', '1') });
    const name = field('contact.name', 'Contact Name', 'NAME');
    const body = [d.contacts('Transferee', [
      d.p(t`${name}: ${shares} shares`),
      d.when(whenSet('contact.isCorporate'), d.p('For and on behalf of')),
      d.when(whenBlank('contact.isCorporate'), d.p('Signed personally')),
    ].join(''))];
    const bytes = d.package(body);
    const placeholders = d.placeholders();
    expect(oakDocRepeaterSectionSummary(placeholders).personFields?.[TRANSFEREES]?.[0]).toMatchObject({ key: 'shares', totalOf: 'transfer_shares' });

    const resolved = resolveOakDocGenericRepeaters({
      docxBytes: bytes,
      data: {
        company: { id: 'company-1', name: 'Bordeus Pte. Ltd.', uen: '202645711K' },
        contactLists: {
          transferee: [
            { id: 'c1', name: 'Acme Pte. Ltd.', contactType: 'CORPORATE' },
            { id: 'c2', name: 'Tan Wei Jie' },
          ],
        },
        personValues: { [TRANSFEREES]: { c1: { 'item.shares': '600' }, c2: { 'item.shares': '400' } } },
      },
      conditions: readOakDocConditionDefinitions(bytes),
    });
    expect(text(resolved.bytes)).toBe([
      'Acme Pte. Ltd.: 600 shares',
      'For and on behalf of',
      'Tan Wei Jie: 400 shares',
      'Signed personally',
    ].join('\n'));
  });

  it('keeps a partial’s conditions when it is placed in a template, renaming one that clashes', () => {
    const partial = new DocumentWriter();
    const fragment = partial.package([partial.when(whenSet('contact.isCorporate'), partial.p('Company wording'))]);
    const clashing = seededConditionId({ field: 'contact.isCorporate', operator: 'truthy' });

    const ids = new ControlIds(1);
    const partialId = '55555555-5555-4555-8555-555555555555';
    const reference = `<w:sdt><w:sdtPr><w:tag w:val="${oakDocPartialTag(partialId)}"/><w:id w:val="${ids.take()}"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>`;
    // The master already uses the same id for a different condition.
    const master = addOakDocConditionDefinitions(
      packageOakDoc([conditionalBlock(ids, clashing, '<w:p><w:r><w:t>Master wording</w:t></w:r></w:p>'), reference].join('')),
      new Map([[clashing, { field: 'custom.other', operator: 'truthy' as const }]]),
    );
    const expanded = expandOakDocPartials({ docxBytes: master, fragments: new Map([[partialId, fragment]]) });
    expect(expanded.diagnostics).toEqual([]);
    const definitions = readOakDocConditionDefinitions(expanded.bytes);
    expect(definitions.get(clashing)).toEqual({ field: 'custom.other', operator: 'truthy' });
    const renamed = [...definitions].find(([id]) => id !== clashing);
    expect(renamed?.[1]).toEqual({ field: 'contact.isCorporate', operator: 'truthy' });
    expect(strFromU8(unzipSync(expanded.bytes)['word/document.xml'])).toContain(`oakdoc.condition.${renamed?.[0]}`);
  });
});
