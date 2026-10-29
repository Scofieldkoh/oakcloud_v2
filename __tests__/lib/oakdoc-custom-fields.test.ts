import { describe, expect, it } from 'vitest';
import {
  appendOakDocPartialCustomFields,
  buildOakDocCustomFieldValues,
  formatOakDocCustomFieldValue,
  isOakDocCustomFieldTag,
  mergeOakDocPartialCustomFields,
  mergeOakDocRepeaterSectionSummaries,
  oakDocRepeaterSectionSummary,
  readOakDocRepeaterSections,
  writeOakDocRepeaterSections,
  oakDocPickerKeyOfTag,
  oakDocPickerKeysInUse,
  oakDocContactShortlist,
  oakDocCustomContactFields,
  oakDocCustomFieldKeyFromLabel,
  oakDocCustomFieldTypes,
  readOakDocContactShortlist,
  readOakDocCustomFields,
  readOakDocPartialCustomFields,
  writeOakDocContactShortlist,
  writeOakDocCustomFields,
} from '@/lib/document-editor/oakdoc-custom-fields';

describe('OakDoc custom fields', () => {
  it('recognises custom field tags', () => {
    expect(isOakDocCustomFieldTag('custom.fee_amount')).toBe(true);
    expect(isOakDocCustomFieldTag('custom.')).toBe(false);
    expect(isOakDocCustomFieldTag('custom.2fee')).toBe(false);
    expect(isOakDocCustomFieldTag('custom.fee.amount')).toBe(false);
    expect(isOakDocCustomFieldTag('custom.secretary.identificationNumber')).toBe(true);
    expect(isOakDocCustomFieldTag('custom.secretary.address.full')).toBe(true);
    expect(isOakDocCustomFieldTag('company.name')).toBe(false);
  });

  it('makes a unique key from a label', () => {
    expect(oakDocCustomFieldKeyFromLabel('Fee amount (S$)', new Set())).toBe('fee_amount_s');
    expect(oakDocCustomFieldKeyFromLabel('Fee amount', new Set(['fee_amount']))).toBe('fee_amount_2');
    expect(oakDocCustomFieldKeyFromLabel('2026 AGM date', new Set())).toBe('field_2026_agm_date');
    expect(oakDocCustomFieldKeyFromLabel('***', new Set())).toBe('field');
  });

  it('reads custom fields, including dropdowns, and skips everything else', () => {
    const stored = [
      { key: 'custom.fee', label: 'Fee', type: 'currency', source: 'custom', required: true },
      { key: 'custom.basis', label: 'Basis', type: 'text', options: ['Annual', ' Monthly ', 'Annual'] },
      { key: 'company.name', label: 'Company', type: 'text', source: 'company' },
      { key: 'custom.notes', label: 'Notes', type: 'textarea', oakDocPartialId: 'p1' },
    ];
    expect(readOakDocCustomFields(stored)).toEqual([
      { key: 'fee', label: 'Fee', type: 'currency', required: true },
      { key: 'basis', label: 'Basis', type: 'dropdown', required: false, options: ['Annual', 'Monthly'] },
    ]);
    expect(readOakDocPartialCustomFields(stored)).toEqual([
      { key: 'notes', label: 'Notes', type: 'textarea', required: false, partialId: 'p1' },
    ]);
  });

  it('replaces only its own custom fields and keeps stored identity and other definitions', () => {
    const stored = [
      { id: 'keep-id', key: 'custom.fee', label: 'Fee', type: 'currency', source: 'custom', extra: 1 },
      { key: 'custom.old', label: 'Old', type: 'text', source: 'custom' },
      { key: 'company.name', label: 'Company', type: 'text', source: 'company' },
      { key: 'custom.notes', label: 'Notes', type: 'text', oakDocPartialId: 'p1' },
    ];
    const written = writeOakDocCustomFields(stored, [
      { key: 'fee', label: 'Annual fee', type: 'currency', required: true },
      { key: 'basis', label: 'Basis', type: 'dropdown', required: false, options: ['Annual', 'Monthly'] },
    ]);
    expect(written).toEqual([
      {
        id: 'keep-id',
        key: 'custom.fee',
        path: 'custom.fee',
        label: 'Annual fee',
        type: 'currency',
        source: 'custom',
        category: 'custom',
        required: true,
        extra: 1,
      },
      {
        key: 'custom.basis',
        path: 'custom.basis',
        label: 'Basis',
        type: 'text',
        source: 'custom',
        category: 'custom',
        required: false,
        options: ['Annual', 'Monthly'],
      },
      { key: 'company.name', label: 'Company', type: 'text', source: 'company' },
      { key: 'custom.notes', label: 'Notes', type: 'text', oakDocPartialId: 'p1' },
    ]);
  });

  it('copies custom fields of inserted partials, letting the template win', () => {
    const merged = mergeOakDocPartialCustomFields(
      [
        { key: 'custom.fee', label: 'Fee', type: 'currency', source: 'custom' },
        { key: 'custom.stale', label: 'Stale', type: 'text', oakDocPartialId: 'gone' },
      ],
      [
        { id: 'p1', placeholders: [
          { key: 'custom.fee', label: 'Partial fee', type: 'text', source: 'custom' },
          { key: 'custom.meeting_date', label: 'Meeting date', type: 'date', source: 'custom', required: true },
        ] },
      ],
    );
    expect(merged.map((definition) => [definition.key, definition.oakDocPartialId])).toEqual([
      ['custom.fee', undefined],
      ['custom.meeting_date', 'p1'],
    ]);
    expect(oakDocCustomFieldTypes(merged)).toEqual({ fee: 'currency', meeting_date: 'date' });
  });

  it('formats values by type', () => {
    expect(formatOakDocCustomFieldValue('2026-10-01', 'date')).toBe('1 Oct 2026');
    expect(formatOakDocCustomFieldValue('1234567.5', 'currency')).toBe('1,234,567.50');
    expect(formatOakDocCustomFieldValue('-1200', 'number')).toBe('-1,200');
    expect(formatOakDocCustomFieldValue('about 5', 'number')).toBe('about 5');
    expect(formatOakDocCustomFieldValue(true, 'boolean')).toBe('Yes');
    expect(formatOakDocCustomFieldValue('', 'text')).toBe('');
    expect(formatOakDocCustomFieldValue(undefined, 'text')).toBe('');
  });

  it('builds the values and dates for custom field controls', () => {
    expect(buildOakDocCustomFieldValues({
      tags: ['custom.fee', 'custom.meeting_date', 'custom.missing', 'company.name'],
      data: { fee: '2500', meeting_date: '2026-11-03' },
      types: { fee: 'currency', meeting_date: 'date' },
    })).toEqual({
      values: {
        'custom.fee': '2,500.00',
        'custom.meeting_date': '3 Nov 2026',
        'custom.missing': '',
      },
      dates: { 'custom.meeting_date': '2026-11-03' },
    });
  });

  it('stores a Contact field with its shortlist and reads it back', () => {
    const stored = writeOakDocCustomFields([], [{
      key: 'secretary',
      label: 'Secretary',
      type: 'contact',
      required: true,
      contacts: [{ id: 'c-1', name: 'Tan Wei Jie' }, { id: 'c-2', name: 'Lim Mei Ling' }],
    }]);

    expect(stored[0]).toMatchObject({
      key: 'custom.secretary',
      type: 'text',
      fieldKind: 'contact',
      options: [{ value: 'c-1', label: 'Tan Wei Jie' }, { value: 'c-2', label: 'Lim Mei Ling' }],
    });
    expect(readOakDocCustomFields(stored)).toEqual([{
      key: 'secretary',
      label: 'Secretary',
      type: 'contact',
      required: true,
      contacts: [{ id: 'c-1', name: 'Tan Wei Jie' }, { id: 'c-2', name: 'Lim Mei Ling' }],
    }]);
    expect(oakDocCustomContactFields(stored)).toEqual({ secretary: ['c-1', 'c-2'] });
    expect(oakDocCustomFieldTypes(stored)).toEqual({ secretary: 'text' });
  });

  it('prints the chosen contact for a Contact field and its details', () => {
    expect(buildOakDocCustomFieldValues({
      tags: ['custom.secretary', 'custom.secretary.identificationNumber', 'custom.secretary.address.full', 'custom.other'],
      data: { secretary: 'c-2', other: 'c-1' },
      types: { secretary: 'text', other: 'text' },
      contacts: {
        secretary: { name: 'Lim Mei Ling', identificationNumber: 'S7654321B', address: { full: '1 Raffles Place' } },
        other: undefined,
      },
    }).values).toEqual({
      'custom.secretary': 'Lim Mei Ling',
      'custom.secretary.identificationNumber': 'S7654321B',
      'custom.secretary.address.full': '1 Raffles Place',
      'custom.other': '',
    });
  });

  it('stores the contacts repeater shortlist apart from the custom fields', () => {
    const fee = { key: 'custom.fee', label: 'Fee', type: 'currency', source: 'custom', category: 'custom' };
    const stored = writeOakDocContactShortlist([fee], [
      { id: 'c1', name: 'Alex Lim' },
      { id: 'c2', name: 'Bea Tan' },
      { id: 'c1', name: 'Alex Lim' },
    ]);
    expect(stored).toEqual([fee, {
      key: 'repeat.contacts',
      path: 'repeat.contacts',
      label: 'Contacts shortlist',
      type: 'text',
      source: 'repeater',
      category: 'repeater',
      fieldKind: 'contactShortlist',
      required: false,
      options: [{ value: 'c1', label: 'Alex Lim' }, { value: 'c2', label: 'Bea Tan' }],
    }]);
    expect(readOakDocContactShortlist(stored)).toEqual([{ id: 'c1', name: 'Alex Lim' }, { id: 'c2', name: 'Bea Tan' }]);
    // Not a custom field, so Configure does not ask for it as a value.
    expect(readOakDocCustomFields(stored).map((field) => field.key)).toEqual(['fee']);
    expect(Object.keys(oakDocCustomFieldTypes(stored))).toEqual(['fee']);
    // Saving the custom fields keeps it; an empty shortlist removes it.
    expect(readOakDocContactShortlist(writeOakDocCustomFields(stored, []))).toHaveLength(2);
    expect(writeOakDocContactShortlist(stored, [])).toEqual([fee]);
    expect(oakDocContactShortlist([fee])).toBeNull();
  });

  it('offers the shortlists of a template and its partials together', () => {
    const template = writeOakDocContactShortlist([], [{ id: 'c1', name: 'Alex Lim' }]);
    const partial = { id: 'p1', placeholders: writeOakDocContactShortlist([], [{ id: 'c2', name: 'Bea Tan' }, { id: 'c1', name: 'Alex Lim' }]) };
    const merged = mergeOakDocPartialCustomFields(template, [partial, { id: 'p2', placeholders: [] }]);
    expect(readOakDocContactShortlist(merged)).toEqual([{ id: 'c1', name: 'Alex Lim' }]);
    expect(oakDocContactShortlist(merged)).toEqual([{ id: 'c1', name: 'Alex Lim' }, { id: 'c2', name: 'Bea Tan' }]);
    // Copies are recomputed: a partial no longer inserted drops out.
    expect(oakDocContactShortlist(mergeOakDocPartialCustomFields(merged, []))).toEqual([{ id: 'c1', name: 'Alex Lim' }]);
    // A resolution's chosen partials add theirs to whatever the template has.
    expect(oakDocContactShortlist(appendOakDocPartialCustomFields([], [partial])))
      .toEqual([{ id: 'c2', name: 'Bea Tan' }, { id: 'c1', name: 'Alex Lim' }]);
  });

  describe('named repeating sections', () => {
    const fee = { key: 'custom.fee', label: 'Fee', type: 'currency', source: 'custom', category: 'custom' };

    it('stores section names and named contacts lists by repeater tag', () => {
      const stored = writeOakDocRepeaterSections([fee], {
        names: {
          'repeat.directors': '  Signers for   the resolution(s) ',
          'repeat.officers.secretary': 'Outgoing secretary',
          'repeat.contacts.corp-sec': 'Corporate secretary to be appointed',
          'repeat.contacts.empty': '',
          'repeat.shareholders': 'Not in the document',
        },
        shortlists: {
          'repeat.contacts': [{ id: 'c1', name: 'Alex Lim' }],
          'repeat.contacts.corp-sec': [{ id: 'c2', name: 'Bea Tan' }, { id: 'c2', name: 'Bea Tan' }],
        },
      }, [
        'repeat.directors',
        'repeat.officers.secretary',
        'repeat.contacts',
        'repeat.contacts.corp-sec',
        'repeat.contacts.empty',
        'repeat.directors',
      ]);
      expect(stored).toEqual([
        fee,
        {
          key: 'repeat.directors',
          path: 'repeat.directors',
          label: 'Signers for the resolution(s)',
          type: 'text',
          source: 'repeater',
          category: 'repeater',
          fieldKind: 'repeaterName',
          required: false,
        },
        expect.objectContaining({ key: 'repeat.officers.secretary', label: 'Outgoing secretary', fieldKind: 'repeaterName' }),
        expect.objectContaining({ key: 'repeat.contacts', label: 'Contacts shortlist', fieldKind: 'contactShortlist' }),
        expect.objectContaining({
          key: 'repeat.contacts.corp-sec',
          path: 'repeat.contacts.corp-sec',
          label: 'Corporate secretary to be appointed',
          fieldKind: 'contactShortlist',
          options: [{ value: 'c2', label: 'Bea Tan' }],
        }),
        // A named list keeps its name with no shortlist; the name comes from the slug if blank.
        expect.objectContaining({ key: 'repeat.contacts.empty', label: 'Empty', options: [] }),
      ]);
      expect(readOakDocRepeaterSections(stored)).toEqual({
        names: {
          'repeat.directors': 'Signers for the resolution(s)',
          'repeat.officers.secretary': 'Outgoing secretary',
          'repeat.contacts.corp-sec': 'Corporate secretary to be appointed',
          'repeat.contacts.empty': 'Empty',
        },
        shortlists: {
          'repeat.contacts': [{ id: 'c1', name: 'Alex Lim' }],
          'repeat.contacts.corp-sec': [{ id: 'c2', name: 'Bea Tan' }],
          'repeat.contacts.empty': [],
        },
      });
      // Neither names nor lists are custom fields, and the unnamed shortlist reads as before.
      expect(readOakDocCustomFields(stored).map((field) => field.key)).toEqual(['fee']);
      expect(oakDocContactShortlist(stored)).toEqual([{ id: 'c1', name: 'Alex Lim' }]);
      // Rewriting replaces them; sections no longer in the document drop out.
      expect(writeOakDocRepeaterSections(stored, readOakDocRepeaterSections(stored), ['repeat.directors']))
        .toEqual([fee, expect.objectContaining({ key: 'repeat.directors' })]);
    });

    it('stores the Configure name of a single-person picker while its fields are in the document', () => {
      const stored = writeOakDocRepeaterSections([fee], {
        names: { selectedDirector: ' Signer of the resolution(s) ', selectedContact: 'Unused', 'company.name': 'Not a picker' },
        shortlists: {},
      }, ['selectedDirector', 'company.name']);
      expect(stored).toEqual([
        fee,
        expect.objectContaining({ key: 'selectedDirector', label: 'Signer of the resolution(s)', fieldKind: 'repeaterName' }),
      ]);
      expect(readOakDocRepeaterSections(stored).names).toEqual({ selectedDirector: 'Signer of the resolution(s)' });
      expect(oakDocRepeaterSectionSummary(stored).names).toEqual({ selectedDirector: ['Signer of the resolution(s)'] });
      expect(readOakDocCustomFields(stored).map((field) => field.key)).toEqual(['fee']);
    });

    it('knows which pickers a document uses from its field tags', () => {
      expect(oakDocPickerKeyOfTag('selectedShareholder.name')).toBe('selectedShareholder');
      expect(oakDocPickerKeyOfTag('company.name')).toBeNull();
      expect(oakDocPickerKeysInUse(['company.name', 'selectedContact.email', 'selectedDirector.name']))
        .toEqual(['selectedDirector', 'selectedContact']);
    });

    it("brings partials' names and lists onto the template, a list per name", () => {
      const template = writeOakDocRepeaterSections([], {
        names: { 'repeat.directors': 'Signers', 'repeat.contacts.corp-sec': 'Corp sec' },
        shortlists: { 'repeat.contacts.corp-sec': [{ id: 'c1', name: 'Alex Lim' }] },
      }, ['repeat.directors', 'repeat.contacts.corp-sec']);
      const partial = {
        id: 'p1',
        placeholders: writeOakDocRepeaterSections([], {
          names: {
            'repeat.directors': 'Approving directors',
            'repeat.contacts.corp-sec': 'Corp sec',
            'repeat.contacts.auditor': 'Auditor to be appointed',
          },
          shortlists: {
            'repeat.contacts.corp-sec': [{ id: 'c2', name: 'Bea Tan' }],
            'repeat.contacts.auditor': [{ id: 'c3', name: 'Cal Ong' }],
          },
        }, ['repeat.directors', 'repeat.contacts.corp-sec', 'repeat.contacts.auditor']),
      };
      const merged = mergeOakDocPartialCustomFields(template, [partial]);
      // The template edits only its own.
      expect(readOakDocRepeaterSections(merged).names).toEqual({ 'repeat.directors': 'Signers', 'repeat.contacts.corp-sec': 'Corp sec' });
      expect(oakDocRepeaterSectionSummary(merged)).toEqual({
        names: {
          'repeat.directors': ['Signers', 'Approving directors'],
          'repeat.contacts.corp-sec': ['Corp sec'],
          'repeat.contacts.auditor': ['Auditor to be appointed'],
        },
        shortlists: {
          'repeat.contacts.corp-sec': [{ id: 'c1', name: 'Alex Lim' }, { id: 'c2', name: 'Bea Tan' }],
          'repeat.contacts.auditor': [{ id: 'c3', name: 'Cal Ong' }],
        },
      });
      // A resolution's chosen partials add theirs per document.
      const own = oakDocRepeaterSectionSummary(template);
      const chosen = oakDocRepeaterSectionSummary(appendOakDocPartialCustomFields([], [partial]));
      expect(mergeOakDocRepeaterSectionSummaries(own, chosen)).toEqual(oakDocRepeaterSectionSummary(merged));
      expect(oakDocRepeaterSectionSummary(mergeOakDocPartialCustomFields(merged, []))).toEqual(own);
    });
  });

  describe('one document per person', () => {
    it('stores the template section that splits documents, while that section is present', () => {
      const sections = { names: {}, shortlists: {}, perPersonTag: 'repeat.directors' };
      const stored = writeOakDocRepeaterSections([], sections, ['repeat.directors']);
      expect(stored).toEqual([expect.objectContaining({ key: 'repeat.directors', fieldKind: 'documentPerPerson' })]);
      expect(readOakDocRepeaterSections(stored).perPersonTag).toBe('repeat.directors');
      expect(oakDocRepeaterSectionSummary(stored).perPersonTag).toBe('repeat.directors');
      // Gone with its section, and never for a section that cannot split (signers).
      expect(writeOakDocRepeaterSections(stored, sections, [])).toEqual([]);
      expect(writeOakDocRepeaterSections([], { ...sections, perPersonTag: 'repeat.signers' }, ['repeat.signers'])).toEqual([]);
    });

    it('is not copied from partials', () => {
      const partial = {
        id: 'partial-1',
        placeholders: writeOakDocRepeaterSections([], { names: {}, shortlists: {}, perPersonTag: 'repeat.directors' }, ['repeat.directors']),
      };
      const merged = mergeOakDocPartialCustomFields([], [partial]);
      expect(oakDocRepeaterSectionSummary(merged).perPersonTag).toBeUndefined();
    });
  });
});
