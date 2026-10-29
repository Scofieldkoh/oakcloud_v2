import { describe, expect, it } from 'vitest';

import {
  analyzeTemplateContent,
  extractTemplatePlaceholderKeys,
  getRequiredLegacyContactSelection,
  getRequiredPartySelections,
  getTemplatePartyCollections,
  isCustomPlaceholder,
} from '@/lib/template-analysis';

describe('template-analysis', () => {
  it('detects singular party requirements in templates and partials', () => {
    expect(getRequiredPartySelections(
      '<p>{{selectedDirector.name}}</p>{{>signature}}',
      [{
        name: 'signature',
        content: '{{selectedContact.email}}{{selectedShareholder.phone}}',
      }],
    )).toEqual({
      director: true,
      shareholder: true,
      contact: true,
    });
  });

  it('recognises singular party roots and excludes guided letter addresses from loop requirements', () => {
    expect(analyzeTemplateContent({
      content: '{{selectedDirector.email}}{{selectedShareholder.phone}}{{selectedContact.name}}',
    }).unknownPlaceholders).toEqual([]);

    expect(extractTemplatePlaceholderKeys(
      '{{#each directors}}{{this.letterAddress}}{{/each}}',
    )).toEqual(['directors']);
  });

  it('recognises Service Agreement representative and signer collections', () => {
    expect(analyzeTemplateContent({
      content: [
        '{{#each authorizedRepresentatives}}{{this.email}}{{/each}}',
        '{{#each signers}}{{this.name}}{{/each}}',
      ].join(''),
    }).unknownPlaceholders).toEqual([]);
  });

  it('extracts keys from external modifiers wrapped in inline HTML', () => {
    expect(extractTemplatePlaceholderKeys(
      '<p>PCASE(<span style="color: rgb(0, 0, 0);">{{selectedContact.detail}}</span>)</p>',
    )).toEqual(['selectedContact.detail']);

    expect(getRequiredPartySelections(
      '<p>PCASE(<span>{{selectedContact.name}}</span>)</p>',
    ).contact).toBe(true);
  });

  it('preserves legacy contact placeholders without requiring a singular contact selection', () => {
    expect(getRequiredPartySelections(
      '{{contact.fullName}}{{#each contacts}}{{this.email}}{{/each}}',
    )).toEqual({
      director: false,
      shareholder: false,
      contact: false,
    });

    expect(getRequiredPartySelections('{{selectedContact.email}}').contact).toBe(true);
  });

  it('detects legacy contact roots without treating selectedContact as legacy', () => {
    expect(getRequiredLegacyContactSelection('{{contact.name}}')).toBe(true);
    expect(getRequiredLegacyContactSelection('{{#each contacts}}{{name}}{{/each}}')).toBe(true);
    expect(getRequiredLegacyContactSelection('{{selectedContact.name}}')).toBe(false);
  });

  it('detects legacy contact roots through nested partials', () => {
    expect(getRequiredLegacyContactSelection('{{> outer}}', [
      { name: 'outer', content: '{{> inner}}' },
      { name: 'inner', content: '{{contact.email}}' },
    ])).toBe(true);
  });

  it('detects director and shareholder collection loops separately from singular party selections', () => {
    expect(getTemplatePartyCollections(
      '{{#each directors}}{{this.name}}{{/each}}{{#each shareholders}}{{this.name}}{{/each}}',
    )).toEqual({ directors: true, shareholders: true });
    expect(getTemplatePartyCollections('{{selectedDirector.name}}')).toEqual({
      directors: false,
      shareholders: false,
    });
  });

  describe('isCustomPlaceholder', () => {
    it('returns false for a non-custom placeholder without a key', () => {
      expect(isCustomPlaceholder({ category: 'system', source: 'system' })).toBe(false);
    });
  });
});
