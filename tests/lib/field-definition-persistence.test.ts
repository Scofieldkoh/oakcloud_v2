import { describe, expect, it } from 'vitest';
import {
  preserveStoredFieldDefinitions,
} from '@/lib/document-editor/template-field-workflow';
import { loadStoredFieldRegistry } from '@/lib/template-field-registry';
import {
  createDocumentTemplateSchema,
  updateDocumentTemplateSchema,
} from '@/lib/validations/document-template';
import { createTemplatePartialSchema } from '@/lib/validations/template-partial';

describe('field definition persistence', () => {
  const field = {
    id: 'field-stable-1',
    key: 'custom.note',
    label: 'Note',
    type: 'future-preserve-only-type',
    source: 'custom',
    category: 'custom',
    path: 'custom.note',
    defaultValue: 0,
    format: { pattern: 'future' },
    options: [{ value: 'A', metadata: { rank: 1 } }],
    linkedTo: 'includeNote',
    sourcePartial: 'scope-a',
    futureMetadata: { nested: ['keep', false, 0] },
  } as const;

  it('preserves field metadata and omitted required through template request schemas', () => {
    const created = createDocumentTemplateSchema.parse({
      name: 'Lossless',
      content: '<p>{{custom.note}}</p>',
      placeholders: [field],
    });
    const stored = created.placeholders[0] as Record<string, unknown>;
    expect(stored).toEqual(field);
    expect(Object.prototype.hasOwnProperty.call(stored, 'required')).toBe(false);

    const updated = updateDocumentTemplateSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      placeholders: [stored],
    });
    expect(updated.placeholders?.[0]).toEqual(field);
  });

  it('preserves the same lossless contract through TemplatePartial validation', () => {
    const parsed = createTemplatePartialSchema.parse({
      name: 'scope-a',
      displayName: 'Scope A',
      content: '<p>{{custom.note}}</p>',
      placeholders: [field],
    });
    expect(parsed.placeholders[0]).toEqual(field);
    expect(Object.prototype.hasOwnProperty.call(parsed.placeholders[0], 'required')).toBe(false);
  });

  it('round-trips unknown metadata through the F1 registry serializer', () => {
    const scope = { kind: 'template', id: 'template-1' } as const;
    expect(preserveStoredFieldDefinitions([field], scope)).toEqual([field]);
    const registry = loadStoredFieldRegistry({ scope, definitions: [field] });
    expect(registry.definitions[0]).toMatchObject({
      persistedId: 'field-stable-1',
      storedType: 'future-preserve-only-type',
      supportedType: null,
      requiredWasExplicit: false,
    });
    expect(registry.definitions[0]?.unknownMetadata).toEqual({
      futureMetadata: field.futureMetadata,
    });
  });

  it('keeps colliding partial field keys distinct by stable owner scope', () => {
    const a = loadStoredFieldRegistry({
      scope: { kind: 'partial', id: 'partial-a' },
      definitions: [{ ...field, id: undefined, type: 'text' }],
    }).definitions[0];
    const b = loadStoredFieldRegistry({
      scope: { kind: 'partial', id: 'partial-b' },
      definitions: [{ ...field, id: undefined, type: 'text' }],
    }).definitions[0];
    expect(a?.key).toBe('custom.note');
    expect(b?.key).toBe('custom.note');
    expect(a?.scope.id).toBe('partial-a');
    expect(b?.scope.id).toBe('partial-b');
    expect(a?.identity).not.toBe(b?.identity);
  });
});
