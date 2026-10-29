import { describe, expect, it } from 'vitest';
import { resolvePlaceholders } from '@/lib/placeholder-resolver';
import {
  createDocumentTemplateSchema,
  placeholderDefinitionSchema,
  updateDocumentTemplateSchema,
} from '@/lib/validations/document-template';
import {
  createTemplatePartialSchema,
  updateTemplatePartialSchema,
} from '@/lib/validations/template-partial';

const TEMPLATE_ID = '00000000-0000-4000-8000-000000000001';
const PARTIAL_ID = '00000000-0000-4000-8000-000000000002';

const completeDefinition = {
  id: 'field-canonical-001',
  key: 'custom.primary_use',
  label: 'Primary use',
  type: 'text',
  source: 'custom',
  category: 'property',
  path: 'custom.primary_use',
  required: true,
  defaultValue: 'Residential',
  format: 'sentence-case',
  options: ['Residential', 'Commercial'],
  linkedTo: 'include_primary_use',
  sourcePartial: 'property-details',
  futureMetadata: {
    editorHint: 'keep-on-round-trip',
    formatLevel: 2,
  },
} as const;

const omittedRequiredDefinition = {
  id: 'field-canonical-002',
  key: 'custom.optional_note',
  label: 'Optional note',
  type: 'text',
  source: 'custom',
  category: 'custom',
  path: 'custom.optional_note',
  defaultValue: '',
  format: 'plain',
  options: ['A', 'B'],
  linkedTo: 'include_optional_note',
  sourcePartial: 'property-details',
  futureMetadata: { presenceProbe: 'required-omitted' },
} as const;

const fieldTypes = [
  'text',
  'textarea',
  'date',
  'number',
  'currency',
  'boolean',
  'list',
  'conditional',
] as const;

function expectLosslessDefinition(value: unknown) {
  expect(value).toEqual(completeDefinition);
}

describe('template field server-boundary compatibility', () => {
  it('W-FIELD-01A preserves the full F1 definition at placeholderDefinitionSchema', () => {
    expectLosslessDefinition(placeholderDefinitionSchema.parse(completeDefinition));
  });

  it('W-FIELD-01B preserves F1 definitions through DocumentTemplate create/update request schemas', () => {
    const created = createDocumentTemplateSchema.parse({
      name: 'W1 field carrier template',
      content: '<p>{{custom.primary_use}}</p>',
      placeholders: [completeDefinition],
    });
    const updated = updateDocumentTemplateSchema.parse({
      id: TEMPLATE_ID,
      placeholders: [completeDefinition],
    });

    expectLosslessDefinition(created.placeholders[0]);
    expectLosslessDefinition(updated.placeholders?.[0]);
  });

  it('W-FIELD-01C preserves F1 definitions through TemplatePartial create/update request schemas', () => {
    const created = createTemplatePartialSchema.parse({
      name: 'w1-field-carrier',
      displayName: 'W1 field carrier partial',
      content: '<p>{{custom.primary_use}}</p>',
      placeholders: [completeDefinition],
    });
    const updated = updateTemplatePartialSchema.parse({
      id: PARTIAL_ID,
      placeholders: [completeDefinition],
    });

    expectLosslessDefinition(created.placeholders[0]);
    expectLosslessDefinition(updated.placeholders?.[0]);
  });

  it('W-FIELD-01D preserves required presence: explicit true survives and omission stays omitted', () => {
    const explicit = placeholderDefinitionSchema.parse(completeDefinition);
    const omitted = placeholderDefinitionSchema.parse(omittedRequiredDefinition);

    expect(explicit.required).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(explicit, 'required')).toBe(true);
    expect(omitted.required).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(omitted, 'required')).toBe(false);
  });

  it('W-FIELD-01E recognizes current and preserve-only future placeholder types', () => {
    for (const type of [...fieldTypes, 'future-preserve-only-type']) {
      const parsed = placeholderDefinitionSchema.safeParse({
        key: `custom.type_${type}`,
        label: `Type ${type}`,
        type,
        source: 'custom',
      });
      expect(parsed.success, `expected ${type} to remain storable`).toBe(true);
    }

    expect(fieldTypes).toContain('list');
    expect(fieldTypes).toContain('conditional');
  });

  it('W-FIELD-01F preserves stable id, options and unknown forward metadata', () => {
    const parsed = placeholderDefinitionSchema.parse(completeDefinition);
    expect(parsed).toEqual(completeDefinition);
  });

  it('W-FIELD-01G preserves omission of required instead of materializing a default', () => {
    const parsed = placeholderDefinitionSchema.parse(omittedRequiredDefinition);
    expect(Object.prototype.hasOwnProperty.call(parsed, 'required')).toBe(false);
  });

  it('W-FIELD-05A retains current resolver behavior until F2 escaping is authorized', () => {
    const resolved = resolvePlaceholders(
      '<p>{{custom.note}}</p><p>{{custom.missing}}</p>',
      { custom: { note: '<b>not trusted markup</b>' } },
      { missingPlaceholder: 'highlight' },
    );

    expect(resolved.resolved).toContain('<b>not trusted markup</b>');
    expect(resolved.missing).toContain('custom.missing');
    expect(resolved.resolved).toContain('placeholder-missing');
  });

  it.fails('W-FIELD-05B future C06 contract escapes ordinary values at the interpolation boundary once F2/W integration is authorized', () => {
    const resolved = resolvePlaceholders(
      '<p>{{custom.note}}</p>',
      { custom: { note: '<b>not trusted markup</b>' } },
      { missingPlaceholder: 'highlight' },
    );

    expect(resolved.resolved).toContain('&lt;b&gt;not trusted markup&lt;/b&gt;');
    expect(resolved.resolved).not.toContain('<b>not trusted markup</b>');
  });
});
