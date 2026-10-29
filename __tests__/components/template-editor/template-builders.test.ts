import { describe, expect, it } from 'vitest';

import {
  buildConditionBlock,
  buildEachBlock,
  buildSignatureBlock,
} from '@/components/documents/template-editor/template-builders';

describe('guided template builders', () => {
  it('builds one balanced directors loop with guided contact fields', () => {
    const result = buildEachBlock({
      collection: 'directors',
      fields: ['email', 'phone', 'letterAddress'],
      layout: 'paragraphs',
    });

    expect(result).toContain('{{this.email}}');
    expect(result).toContain('{{this.phone}}');
    expect(result).toContain('{{this.letterAddress}}');
    expect(result.match(/{{#each directors}}/g)).toHaveLength(1);
    expect(result.match(/{{\/each}}/g)).toHaveLength(1);
  });

  it('builds a balanced directors table loop', () => {
    const result = buildEachBlock({
      collection: 'directors',
      fields: ['name', 'identificationNumber'],
      layout: 'table',
    });

    expect(result).toContain('{{#each directors}}');
    expect(result).toContain('{{this.name}}');
    expect(result).toContain('{{this.identificationNumber}}');
    expect(result).toContain('{{/each}}');
  });

  it('uses fixed layouts and escapes condition values before insertion', () => {
    expect(buildEachBlock({
      collection: 'shareholders',
      fields: ['name'],
      layout: 'bullets',
    })).toContain('<ul><li>{{this.name}}</li></ul>');

    expect(buildConditionBlock({
      field: 'company.name',
      operator: 'equals',
      value: 'A "quoted" <company>',
      bodyHtml: '<p>Visible only for this company</p>',
    })).toBe(
      '{{#if company.name == "A &quot;quoted&quot; &lt;company&gt;"}}<p>Visible only for this company</p>{{/if}}',
    );
  });

  it('rejects unrecognised fields, incompatible collection fields, and unsafe condition input', () => {
    expect(() => buildEachBlock({
      collection: 'directors',
      fields: ['name', 'shareClass'],
      layout: 'paragraphs',
    })).toThrow('not available for directors');

    expect(() => buildEachBlock({
      collection: 'directors' as never,
      fields: ['name'],
      layout: 'script' as never,
    })).toThrow('Unsupported loop layout');

    expect(() => buildConditionBlock({
      field: 'company.name}}<script>',
      operator: 'truthy',
      bodyHtml: '<p>Unsafe</p>',
    })).toThrow('Unsupported condition field');
  });

  it('rejects custom-shaped condition fields that are not explicitly allowlisted', () => {
    expect(() => buildConditionBlock({
      field: 'custom.uncheckedFlag',
      operator: 'truthy',
      bodyHtml: '<p>Unsafe</p>',
    })).toThrow('Unsupported condition field');
  });

  it('rejects condition values that inject template tokens', () => {
    expect(() => buildConditionBlock({
      field: 'company.name',
      operator: 'equals',
      value: 'Acme"}}{{#each directors}}',
      bodyHtml: '<p>Unsafe</p>',
    })).toThrow('Condition value cannot contain template tokens');
  });

  it('builds a balanced keep-together signature block loop per signer', () => {
    const result = buildSignatureBlock({ collection: 'directors' });

    expect(result.match(/{{#each directors}}/g)).toHaveLength(1);
    expect(result.match(/{{\/each}}/g)).toHaveLength(1);
    expect(result.match(/data-flow-keep-together="true"/g)).toHaveLength(1);
    expect(result).toContain('<p>Sign on behalf of client</p>');
    expect(result).toContain('<p>{{this.name}}</p>');
    expect(result).toContain('<p>{{this.role}}</p>');
    expect(result).toContain('<p>{{system.currentDate}}</p>');
  });

  it('omits the designation line for shareholder signature blocks', () => {
    const result = buildSignatureBlock({ collection: 'shareholders' });

    expect(result).toContain('{{#each shareholders}}');
    expect(result).not.toContain('{{this.role}}');
  });
});
