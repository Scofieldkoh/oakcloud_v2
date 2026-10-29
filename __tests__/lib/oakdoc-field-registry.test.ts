import { describe, expect, it } from 'vitest';
import {
  classifyOakDocTag,
  diagnoseOakDocTags,
  oakDocFieldContext,
  OAKDOC_CONDITION_FIELD_TAGS,
  OAKDOC_EDITOR_FIELD_CATEGORIES,
  OAKDOC_FIELD_BY_TAG,
  OAKDOC_FIELD_TAGS,
} from '@/lib/document-editor/oakdoc-field-registry';

describe('OakDoc field registry', () => {
  it('classifies every supported tag family', () => {
    expect(classifyOakDocTag('company.name')).toBe('field');
    expect(classifyOakDocTag('selectedContact.email')).toBe('field');
    expect(classifyOakDocTag('agreement.termMonths')).toBe('field');
    expect(classifyOakDocTag('resolution.date')).toBe('field');
    expect(classifyOakDocTag('director.name')).toBe('repeater-item');
    expect(classifyOakDocTag('repeat.directors')).toBe('repeater');
    expect(classifyOakDocTag('oakdoc.signature.v1.provider')).toBe('signature');
    expect(classifyOakDocTag('oakdoc.condition.v1.abc')).toBe('condition');
    expect(classifyOakDocTag('custom.anything')).toBe('field');
    expect(classifyOakDocTag('custom.')).toBe('unknown');
    expect(classifyOakDocTag('custom.1st')).toBe('unknown');
    expect(classifyOakDocTag('contact.email')).toBe('repeater-item');
    expect(classifyOakDocTag('repeat.contacts')).toBe('repeater');
    expect(classifyOakDocTag('repeat.contacts.corporate-secretary-to-be-appointed')).toBe('repeater');
    expect(classifyOakDocTag('repeat.contacts.Not_A_Slug')).toBe('unknown');
    expect(classifyOakDocTag('repeat.officers.secretary')).toBe('repeater');
    expect(classifyOakDocTag('repeat.officers.secretary+ceo')).toBe('repeater');
    expect(classifyOakDocTag('repeat.officers.treasurer')).toBe('unknown');
    expect(classifyOakDocTag('repeat.officers.ceo+secretary')).toBe('unknown');
    expect(classifyOakDocTag('mystery.field')).toBe('unknown');
  });

  it('records the generation context each scalar field needs', () => {
    expect(oakDocFieldContext('company.uen')).toBe('company');
    expect(oakDocFieldContext('selectedDirector.name')).toBe('selectedDirector');
    expect(oakDocFieldContext('selectedContact.name')).toBe('selectedContact');
    expect(oakDocFieldContext('agreement.agreementDate')).toBe('agreement');
    expect(oakDocFieldContext('director.name')).toBeNull();
    expect(oakDocFieldContext('custom.fee')).toBe('custom');
  });

  it('keeps field, label and condition sets consistent', () => {
    for (const tag of OAKDOC_CONDITION_FIELD_TAGS) {
      expect(OAKDOC_FIELD_TAGS.has(tag)).toBe(true);
      expect(OAKDOC_FIELD_BY_TAG.get(tag)?.label).toBeTruthy();
    }
    expect(OAKDOC_CONDITION_FIELD_TAGS.has('director.name')).toBe(false);
    expect(OAKDOC_FIELD_TAGS.has('custom.fee')).toBe(true);
    expect(OAKDOC_CONDITION_FIELD_TAGS.has('custom.fee')).toBe(true);
  });

  it('offers the contact fields in the editor field picker', () => {
    const contact = OAKDOC_EDITOR_FIELD_CATEGORIES.find((category) => category.label === 'Contact');
    expect(contact?.fields.map((field) => field.key)).toContain('selectedContact.email');
    expect(OAKDOC_EDITOR_FIELD_CATEGORIES.at(-1)?.key).toBe('system');
  });

  it('reports unsupported tags as blocking diagnostics', () => {
    expect(diagnoseOakDocTags(['company.name', 'custom.fee', 'mystery.fee', 'mystery.fee', ''], 'render')).toEqual([
      {
        code: 'OAKDOC_UNSUPPORTED_FIELD',
        severity: 'error',
        stage: 'render',
        message: 'The field "mystery.fee" is not a supported OakDoc field.',
        controlTag: 'mystery.fee',
      },
    ]);
  });
});
