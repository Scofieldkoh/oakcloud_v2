import { describe, expect, it } from 'vitest';
import {
  resolutionItemContactShortlist,
  resolutionItemFieldTags,
  resolutionItemFields,
  resolutionItemRepeaterSections,
} from '@/components/documents/generation-batch/resolution-item-fields';
import {
  appendOakDocPartialCustomFields,
  writeOakDocContactShortlist,
  writeOakDocRepeaterSections,
} from '@/lib/document-editor/oakdoc-custom-fields';
import { resolutionPartialIds, type ResolutionComposition } from '@/lib/resolution-composition';
import { normalizeStoredPlaceholders, storageFormatToCustomPlaceholders } from '@/lib/template-analysis';

const field = (key: string, type: string, extra: Record<string, unknown> = {}) => ({
  key: `custom.${key}`,
  path: `custom.${key}`,
  label: key,
  type,
  source: 'custom',
  category: 'custom',
  required: true,
  ...extra,
});

const partials = [
  { id: 'p-fee', placeholders: [field('fee', 'currency')] },
  { id: 'p-meeting', placeholders: [field('meeting_date', 'date'), field('fee', 'text')] },
  { id: 'p-unused', placeholders: [field('unused', 'text')] },
];

const composition: ResolutionComposition = {
  subject: '',
  sections: [
    { id: 's1', kind: 'PARTIAL', heading: 'FEE', partialId: 'p-fee' },
    { id: 's2', kind: 'PARTIAL', heading: 'MEETING', partialId: 'p-meeting' },
    { id: 's3', kind: 'PARTIAL', heading: 'EDITED', partialId: 'p-unused', body: 'Edited text' },
    { id: 's4', kind: 'CUSTOM', heading: 'OTHER', body: 'Text' },
    { id: 's5', kind: 'PARTIAL', heading: 'FEE AGAIN', partialId: 'p-fee' },
  ],
};

describe('resolution partial custom fields', () => {
  it('lists the partials whose saved wording prints, once each', () => {
    expect(resolutionPartialIds(composition)).toEqual(['p-fee', 'p-meeting']);
    expect(resolutionPartialIds(null)).toEqual([]);
  });

  it('keeps everything the template carries and adds new partial fields', () => {
    const template = [field('fee', 'number'), field('legacy', 'text', { oakDocPartialId: 'p-old' })];
    const merged = appendOakDocPartialCustomFields(template, partials.slice(0, 2));
    expect(merged.map((definition) => [definition.key, definition.type, definition.oakDocPartialId])).toEqual([
      ['custom.fee', 'number', undefined],
      ['custom.legacy', 'text', 'p-old'],
      ['custom.meeting_date', 'date', 'p-meeting'],
    ]);
  });

  it('asks a resolution document for the fields of its chosen partials', () => {
    const templateFields = storageFormatToCustomPlaceholders(normalizeStoredPlaceholders([field('board_date', 'date')]));
    const fields = resolutionItemFields(templateFields, composition, partials);
    expect(fields.map((item) => [item.key, item.type, item.required])).toEqual([
      ['board_date', 'date', true],
      ['fee', 'currency', true],
      ['meeting_date', 'date', true],
    ]);
    expect(resolutionItemFields(templateFields, null, partials)).toBe(templateFields);
  });

  it('adds the field tags of chosen partials, so their repeaters get pickers', () => {
    const tagged = [
      { id: 'p-fee', fieldTags: ['repeat.officers', 'officer.name'] },
      { id: 'p-meeting', fieldTags: ['company.name'] },
      { id: 'p-unused', fieldTags: ['repeat.directors'] },
    ];
    expect(resolutionItemFieldTags(['company.uen'], composition, tagged))
      .toEqual(['company.uen', 'repeat.officers', 'officer.name', 'company.name']);
    const template = ['company.uen'];
    expect(resolutionItemFieldTags(template, null, tagged)).toBe(template);
  });

  it('offers the contacts shortlists of the template and its chosen partials together', () => {
    const shortlisted = [
      { id: 'p-fee', placeholders: writeOakDocContactShortlist([], [{ id: 'c2', name: 'Bea Tan' }]) },
      { id: 'p-meeting', placeholders: [] },
      { id: 'p-unused', placeholders: writeOakDocContactShortlist([], [{ id: 'c3', name: 'Unused' }]) },
    ];
    const template = [{ id: 'c1', name: 'Alex Lim' }];
    expect(resolutionItemContactShortlist(template, composition, shortlisted))
      .toEqual([{ id: 'c1', name: 'Alex Lim' }, { id: 'c2', name: 'Bea Tan' }]);
    expect(resolutionItemContactShortlist(null, composition, shortlisted)).toEqual([{ id: 'c2', name: 'Bea Tan' }]);
    expect(resolutionItemContactShortlist(null, composition, partials)).toBeNull();
    expect(resolutionItemContactShortlist(template, null, shortlisted)).toEqual(template);
  });

  it("adds the chosen partials' section names and contacts lists per document", () => {
    const named = (tag: string, name: string, contacts: Array<{ id: string; name: string }> = []) =>
      writeOakDocRepeaterSections([], { names: { [tag]: name }, shortlists: { [tag]: contacts } }, [tag]);
    const withLists = [
      { id: 'p-fee', placeholders: named('repeat.contacts.corp-sec', 'Corporate secretary to be appointed', [{ id: 'c2', name: 'Bea Tan' }]) },
      { id: 'p-meeting', placeholders: named('repeat.directors', 'Signers for the resolution(s)') },
      { id: 'p-unused', placeholders: named('repeat.contacts.auditor', 'Auditor to be appointed') },
    ];
    const template = { names: { 'repeat.directors': ['Directors present'] }, shortlists: {} };
    expect(resolutionItemRepeaterSections(template, composition, withLists)).toEqual({
      names: {
        'repeat.directors': ['Directors present', 'Signers for the resolution(s)'],
        'repeat.contacts.corp-sec': ['Corporate secretary to be appointed'],
      },
      shortlists: { 'repeat.contacts.corp-sec': [{ id: 'c2', name: 'Bea Tan' }] },
    });
    expect(resolutionItemRepeaterSections(template, null, withLists)).toEqual(template);
  });
});
