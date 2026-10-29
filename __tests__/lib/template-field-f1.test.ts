import { describe, expect, it } from 'vitest';

import {
  extractTemplateFieldPaths,
  normalizeTemplateFieldSyntax,
  parseTemplateFields,
} from '@/lib/template-field-parser';
import {
  createFieldInputDescriptor,
  loadStoredFieldRegistry,
  resolveTypedFieldValueByPrecedence,
  validateTypedFieldValue,
} from '@/lib/template-field-registry';
import {
  editorPlaceholdersToStorage,
  storagePlaceholdersToEditor,
} from '@/lib/template-placeholder-storage';

const TEMPLATE_SCOPE = { kind: 'template' as const, id: 'template-42' };

describe('FIELDS F1 parser, registry and lossless adapter', () => {
  it('parses the frozen grammar through one HTML-aware front end', () => {
    const source = [
      '<strong>{{ custom.note }}</strong>',
      'PCASE(<span>{{ company.name }}</span>)',
      '{{#each directors}}{{this.name}} {{@number}}{{/each}}',
      '{{#if custom.enabled == "yes"}}Y{{else}}N{{/if}}',
      '{{#unless custom.disabled}}Y{{/unless}}',
      '{{#with selectedDirector}}{{name}}{{/with}}',
      '{{&gt; terms}}',
      '<tbody data-template-each="service.entities"><tr><td>{{this.name}}</td></tr></tbody>',
      '{{service.familyName}}{{service.fields.software}}',
    ].join('');

    const parsed = parseTemplateFields({ content: source, scope: TEMPLATE_SCOPE });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining([
      'reference', 'modifier', 'block-open', 'block-close', 'else',
      'loop-variable', 'partial', 'attribute-each',
    ]));
    expect(extractTemplateFieldPaths(parsed)).toEqual(expect.arrayContaining([
      'custom.note', 'company.name', 'directors', 'this.name', 'custom.enabled',
      'custom.disabled', 'selectedDirector', 'service.entities', 'service.familyName',
      'service.fields.software',
    ]));

    const note = parsed.nodes.find((node) => node.path === 'custom.note');
    expect(note?.span.raw).toBe('{{ custom.note }}');
    expect(note?.expression).toBe('{{custom.note}}');
    expect(source.slice(note!.span.start, note!.span.end)).toBe(note!.span.raw);
    expect(note?.occurrenceId).toContain('field-occurrence:v1:template:template-42:');
  });

  it('keeps malformed source recoverable and never guesses replacement keys', () => {
    const source = '<p>{{custom.<b>note</b>}}</p><p>{{custom.missing</p>';
    const parsed = parseTemplateFields({ content: source, scope: TEMPLATE_SCOPE });
    expect(parsed.diagnostics.map((item) => item.code)).toEqual([
      'formatted-expression',
      'dangling-expression',
    ]);
    expect(normalizeTemplateFieldSyntax(source, parsed)).toBe(source);
  });

  it('normalizes only accepted syntax, including formatting around an external modifier', () => {
    const source = '<p>{{ custom.note }}</p><p>PCASE(<span>{{ company.name }}</span>)</p>';
    expect(normalizeTemplateFieldSyntax(source)).toBe(
      '<p>{{custom.note}}</p><p>PCASE(<span>{{company.name}}</span>)</p>',
    );
  });

  it('reports unknown roots/keys, duplicate scoped keys and ambiguous legacy bindings', () => {
    const registry = loadStoredFieldRegistry({
      scope: TEMPLATE_SCOPE,
      definitions: [
        { key: 'custom.note', label: 'Note A', type: 'text' },
        { key: 'custom.note', label: 'Note B', type: 'text' },
      ],
    });
    expect(registry.diagnostics.map((item) => item.code)).toContain('duplicate-key-in-scope');

    const parsed = parseTemplateFields({
      content: '{{custom.unknown}}{{mystery.value}}{{custom.note}}',
      scope: TEMPLATE_SCOPE,
      registry: registry.definitions,
      legacyBindings: [{ path: 'custom.note', fieldIdentities: ['field-a', 'field-b'] }],
    });
    expect(parsed.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'unknown-field', 'unknown-root', 'ambiguous-legacy-binding',
    ]));
  });

  it('reports missing and circular partials with the owning source scope', () => {
    const parsed = parseTemplateFields({
      content: '{{> outer}}{{> missing}}',
      scope: TEMPLATE_SCOPE,
      partials: [
        { id: 'partial-outer', name: 'outer', content: '{{> inner}}' },
        { id: 'partial-inner', name: 'inner', content: '{{> outer}}' },
      ],
    });
    const missing = parsed.diagnostics.find((item) => item.code === 'missing-partial');
    const circular = parsed.diagnostics.find((item) => item.code === 'circular-partial');
    expect(missing?.scope).toEqual(TEMPLATE_SCOPE);
    expect(circular?.scope).toEqual(expect.objectContaining({ kind: 'partial', id: 'partial-inner' }));
  });

  it('keeps identities stable across relabel/reload and scopes equal logical keys independently', () => {
    const stored = [{ id: 'field-9', key: 'custom.note', label: 'Old', type: 'text' }];
    const [first] = storagePlaceholdersToEditor(stored, { scope: TEMPLATE_SCOPE });
    const [second] = storagePlaceholdersToEditor(
      [{ ...stored[0], label: 'Relabelled' }],
      { scope: TEMPLATE_SCOPE },
    );
    const [otherScope] = storagePlaceholdersToEditor(stored, {
      scope: { kind: 'partial', id: 'partial-9' },
    });
    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe(otherScope.id);
  });

  it('round-trips unsupported legacy types, omitted required and unknown metadata losslessly', () => {
    const stored = [{
      id: 'legacy-1', key: 'custom.items', label: 'Items', type: 'list', source: 'custom',
      category: 'custom', path: 'custom.items', options: ['A', 'B'],
      format: { mode: 'legacy' }, futureSetting: { rows: 4 },
    }];
    const [editor] = storagePlaceholdersToEditor(stored, { scope: TEMPLATE_SCOPE });
    expect(editor).toMatchObject({ storedType: 'list', preserveOnly: true, required: false });
    expect(editorPlaceholdersToStorage([editor])).toEqual(stored);
  });

  it('exports typed descriptors without appearance coercion', () => {
    const registry = loadStoredFieldRegistry({
      scope: TEMPLATE_SCOPE,
      definitions: [
        { key: 'custom.reference', label: 'Reference', type: 'text', defaultValue: '2026-09-11' },
        { key: 'custom.total', label: 'Total', type: 'currency', defaultValue: '0.00' },
        { key: 'custom.legacy', label: 'Legacy', type: 'conditional', defaultValue: { when: true } },
      ],
    });
    const descriptors = registry.definitions.map((definition) => createFieldInputDescriptor(definition));
    expect(descriptors[0].defaultValue).toEqual({ kind: 'text', value: '2026-09-11' });
    expect(descriptors[1].defaultValue).toEqual({ kind: 'currency', value: '0.00' });
    expect(descriptors[2]).toMatchObject({ control: 'read-only', storedType: 'conditional' });
    expect(validateTypedFieldValue({ kind: 'number', value: '0' })).toBe(true);
    expect(validateTypedFieldValue({ kind: 'currency', value: '001.2300' })).toBe(true);
    expect(validateTypedFieldValue({ kind: 'number', value: '1,000' })).toBe(false);
  });

  it('preserves item > prefixed legacy > override > master > default precedence', () => {
    const registry = loadStoredFieldRegistry({
      scope: TEMPLATE_SCOPE,
      definitions: [{ key: 'custom.note', label: 'Note', type: 'text', defaultValue: 'default' }],
    });
    const definition = registry.definitions[0];
    const common = {
      definition,
      aggregateKey: 'note::text',
      acceptedPrefixedLegacyKey: 'custom.note',
      documentOverrides: { 'note::text': 'override' },
      sharedMasterValues: { 'note::text': 'master' },
    };
    expect(resolveTypedFieldValueByPrecedence({ ...common, itemValues: { note: '' } })).toEqual({
      source: 'item-value', value: { kind: 'empty' },
    });
    expect(resolveTypedFieldValueByPrecedence({ ...common, itemValues: { 'custom.note': 'legacy' } })).toEqual({
      source: 'accepted-prefixed-legacy-value', value: { kind: 'text', value: 'legacy' },
    });
    expect(resolveTypedFieldValueByPrecedence({ ...common, itemValues: {} }).source).toBe('document-override');
  });
});
