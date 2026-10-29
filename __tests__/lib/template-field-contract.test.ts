import { describe, expect, it } from 'vitest';

import {
  classifyFieldValue,
  createScopedFieldIdentity,
  diagnoseFieldReferenceContract,
  diagnoseFieldRegistryContract,
  diagnosePartialDependenciesContract,
  loadLosslessStoredFieldDefinition,
  parseFieldAttributeExpressionContract,
  parseFieldExpressionContract,
  serializeLosslessStoredFieldDefinition,
} from '@/lib/template-field-contract';

const TEMPLATE_SCOPE = { kind: 'template' as const, id: 'template-fixture' };

function storedField(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'field-note-stable',
    key: 'custom.note',
    label: 'Note',
    type: 'text',
    source: 'custom',
    category: 'custom',
    path: 'custom.note',
    required: false,
    defaultValue: 'Default note',
    format: 'plain',
    options: ['A', 'B'],
    linkedTo: 'showNote',
    sourcePartial: 'terms',
    futureMetadata: {
      version: 2,
      policy: 'preserve-verbatim',
    },
    ...overrides,
  };
}

describe('C05 F0 field contract proof', () => {
  it.each([
    ['{{custom.note}}', 'reference', '{{custom.note}}', 'custom.note'],
    ['{{ custom.note }}', 'reference', '{{custom.note}}', 'custom.note'],
    ['{{PCASE(company.name)}}', 'modifier', '{{PCASE(company.name)}}', 'company.name'],
    ['PCASE({{company.name}})', 'modifier', 'PCASE({{company.name}})', 'company.name'],
    ['{{DESIGNATION({{selectedDirector.role}})}}', 'modifier', '{{DESIGNATION({{selectedDirector.role}})}}', 'selectedDirector.role'],
    ['{{> terms-and-conditions}}', 'partial', '{{> terms-and-conditions}}', undefined],
    ['{{#each directors}}', 'block-open', '{{#each directors}}', 'directors'],
    ['{{#with company}}', 'block-open', '{{#with company}}', 'company'],
    ['{{#if custom.enabled == "yes"}}', 'block-open', '{{#if custom.enabled == "yes"}}', 'custom.enabled'],
    ['{{#unless custom.disabled}}', 'block-open', '{{#unless custom.disabled}}', 'custom.disabled'],
    ['{{/each}}', 'block-close', '{{/each}}', undefined],
    ['{{else}}', 'else', '{{else}}', undefined],
    ['{{@number}}', 'loop-variable', '{{@number}}', undefined],
  ])('normalizes supported grammar %s', (source, kind, normalized, path) => {
    const result = parseFieldExpressionContract(source);
    expect(result).toMatchObject({ status: 'supported', kind, normalized });
    if (path) expect(result).toMatchObject({ path });
  });

  it.each([
    ['{{service.familyName}}', 'reference', 'service.familyName'],
    ['{{service.fields.engagementCode}}', 'reference', 'service.fields.engagementCode'],
    ['{{#each service.entities}}', 'block-open', 'service.entities'],
    ['{{this.name}}', 'reference', 'this.name'],
  ])('covers current service-context grammar %s', (source, kind, path) => {
    expect(parseFieldExpressionContract(source)).toMatchObject({
      status: 'supported',
      kind,
      path,
    });
  });

  it('covers the current data-template-each attribute-driven builder grammar', () => {
    expect(parseFieldAttributeExpressionContract('data-template-each', 'service.entities')).toEqual({
      status: 'supported',
      kind: 'attribute-each',
      normalized: 'data-template-each="service.entities"',
      path: 'service.entities',
    });
    expect(parseFieldAttributeExpressionContract('data-template-each', 'service.entities[0]')).toEqual({
      status: 'malformed',
      code: 'invalid-expression',
    });
    expect(parseFieldAttributeExpressionContract('data-other', 'service.entities')).toEqual({
      status: 'literal',
    });
  });

  it.each([
    ['{{custom.<b>note</b>}}', 'formatted-expression'],
    ['{{ custom note }}', 'invalid-expression'],
    ['{{custom.note', 'dangling-expression'],
  ])('keeps malformed syntax visible instead of guessing: %s', (source, code) => {
    expect(parseFieldExpressionContract(source)).toEqual({
      status: 'malformed',
      code,
    });
  });

  it('does not reinterpret ordinary literal text as a field', () => {
    expect(parseFieldExpressionContract('Meeting date')).toEqual({ status: 'literal' });
  });

  it('diagnoses unknown roots and unknown keys while retaining scoped/service context', () => {
    const registry = [loadLosslessStoredFieldDefinition({
      scope: TEMPLATE_SCOPE,
      definition: storedField(),
    })];

    expect(diagnoseFieldReferenceContract({
      path: 'mystery.note',
      scope: TEMPLATE_SCOPE,
      registry,
    })).toMatchObject({ code: 'unknown-root', severity: 'error' });

    expect(diagnoseFieldReferenceContract({
      path: 'custom.missing',
      scope: TEMPLATE_SCOPE,
      registry,
    })).toMatchObject({ code: 'unknown-field', severity: 'error' });

    expect(diagnoseFieldReferenceContract({
      path: 'service.missing',
      scope: TEMPLATE_SCOPE,
      knownPaths: ['service.familyName', 'service.fields.engagementCode'],
    })).toMatchObject({ code: 'unknown-field', severity: 'error' });

    expect(diagnoseFieldReferenceContract({
      path: 'custom.note',
      scope: TEMPLATE_SCOPE,
      registry,
    })).toBeNull();
    expect(diagnoseFieldReferenceContract({
      path: 'service.familyName',
      scope: TEMPLATE_SCOPE,
      knownPaths: ['service.familyName', 'service.fields.engagementCode'],
    })).toBeNull();
  });

  it('diagnoses duplicate normalized keys only inside the same owner scope', () => {
    const first = loadLosslessStoredFieldDefinition({
      scope: TEMPLATE_SCOPE,
      definition: storedField({ id: 'field-a' }),
    });
    const duplicate = loadLosslessStoredFieldDefinition({
      scope: TEMPLATE_SCOPE,
      definition: storedField({ id: 'field-b' }),
    });
    const otherScope = loadLosslessStoredFieldDefinition({
      scope: { kind: 'partial', id: 'partial-a' },
      definition: storedField({ id: 'field-c' }),
    });

    expect(diagnoseFieldRegistryContract([first, duplicate, otherScope])).toEqual([
      expect.objectContaining({
        code: 'duplicate-key-in-scope',
        scope: TEMPLATE_SCOPE,
        fieldIdentity: duplicate.identity,
      }),
    ]);
  });

  it('distinguishes nested, missing and circular partial dependency diagnostics', () => {
    const nestedPartials = [
      { id: 'partial-outer', name: 'outer', content: '{{> inner}}' },
      { id: 'partial-inner', name: 'inner', content: '<p>{{service.familyName}}</p>' },
    ];
    expect(diagnosePartialDependenciesContract({
      content: '{{> outer}}',
      scope: TEMPLATE_SCOPE,
      partials: nestedPartials,
    })).toEqual([]);

    expect(diagnosePartialDependenciesContract({
      content: '{{> missing}}',
      scope: TEMPLATE_SCOPE,
      partials: nestedPartials,
    })).toEqual([
      expect.objectContaining({ code: 'missing-partial', severity: 'error' }),
    ]);

    expect(diagnosePartialDependenciesContract({
      content: '{{> outer}}',
      scope: TEMPLATE_SCOPE,
      partials: [
        { id: 'partial-outer', name: 'outer', content: '{{> inner}}' },
        { id: 'partial-inner', name: 'inner', content: '{{> outer}}' },
      ],
    })).toEqual([
      expect.objectContaining({ code: 'circular-partial', severity: 'error' }),
    ]);
  });

  it.each([
    ['text', 'text'],
    ['textarea', 'textarea'],
    ['date', 'date'],
    ['number', 'number'],
    ['currency', 'currency'],
    ['boolean', 'boolean'],
    ['list', null],
    ['conditional', null],
  ] as const)('round-trips stored type %s and all lossless metadata without reinterpretation', (storedType, supportedType) => {
    const definition = storedField({
      id: `stable-${storedType}`,
      key: `custom.${storedType}`,
      label: `${storedType} fixture`,
      type: storedType,
      path: `custom.${storedType}`,
      format: storedType === 'conditional' ? 'yes-no' : `format-${storedType}`,
      options: storedType === 'list' ? ['Alpha', 'Beta'] : { future: true },
    });
    const loaded = loadLosslessStoredFieldDefinition({
      scope: TEMPLATE_SCOPE,
      definition,
    });

    expect(loaded).toMatchObject({
      persistedId: `stable-${storedType}`,
      key: `custom.${storedType}`,
      label: `${storedType} fixture`,
      storedType,
      supportedType,
      resolverPath: `custom.${storedType}`,
      path: `custom.${storedType}`,
      source: 'custom',
      category: 'custom',
      required: false,
      requiredWasExplicit: true,
      defaultValue: 'Default note',
      linkedTo: 'showNote',
      sourcePartial: 'terms',
    });
    expect(loaded.format).toEqual(definition.format);
    expect(loaded.options).toEqual(definition.options);
    expect(loaded.unknownMetadata).toEqual({
      futureMetadata: {
        version: 2,
        policy: 'preserve-verbatim',
      },
    });
    expect(loaded.renderMode).toBe(supportedType === null ? 'legacy-preserve-only' : 'text');
    expect(serializeLosslessStoredFieldDefinition(loaded)).toStrictEqual(definition);
  });

  it('preserves the difference between explicit and omitted required on no-change serialize', () => {
    const explicitDefinition = storedField({ required: false });
    const omittedDefinition = storedField();
    delete omittedDefinition.required;

    const explicit = loadLosslessStoredFieldDefinition({ scope: TEMPLATE_SCOPE, definition: explicitDefinition });
    const omitted = loadLosslessStoredFieldDefinition({ scope: TEMPLATE_SCOPE, definition: omittedDefinition });

    expect(explicit.requiredWasExplicit).toBe(true);
    expect(explicit.required).toBe(false);
    expect(omitted.requiredWasExplicit).toBe(false);
    expect(omitted.required).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(serializeLosslessStoredFieldDefinition(explicit), 'required')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(serializeLosslessStoredFieldDefinition(omitted), 'required')).toBe(false);
    expect(serializeLosslessStoredFieldDefinition(explicit)).toStrictEqual(explicitDefinition);
    expect(serializeLosslessStoredFieldDefinition(omitted)).toStrictEqual(omittedDefinition);
  });

  it('keeps persisted identity stable across repeated lossless loads', () => {
    const definition = storedField({ id: 'field-123', key: 'custom.old_key' });
    const first = loadLosslessStoredFieldDefinition({ scope: TEMPLATE_SCOPE, definition });
    const second = loadLosslessStoredFieldDefinition({ scope: TEMPLATE_SCOPE, definition });

    expect(first.identity).toBe(second.identity);
    expect(first.persistedId).toBe('field-123');
  });

  it('preserves a client-declared trusted-rich flag only as inert unknown metadata', () => {
    const definition = storedField({ renderMode: 'trusted-rich' });
    const loaded = loadLosslessStoredFieldDefinition({ scope: TEMPLATE_SCOPE, definition });

    expect(loaded.renderMode).toBe('text');
    expect(loaded.unknownMetadata).toMatchObject({ renderMode: 'trusted-rich' });
    expect(serializeLosslessStoredFieldDefinition(loaded)).toStrictEqual(definition);
  });

  it('uses owner IDs for deterministic scoped identity without display-name concatenation', () => {
    const parent = createScopedFieldIdentity({
      scope: { kind: 'template', id: 'template-1', label: 'Parent template' },
      key: 'custom.note',
    });
    const partialA = createScopedFieldIdentity({
      scope: { kind: 'partial', id: 'partial-a', label: 'Terms' },
      key: 'custom.note',
    });
    const partialB = createScopedFieldIdentity({
      scope: { kind: 'partial', id: 'partial-b', label: 'Terms copy' },
      key: 'custom.note',
    });

    expect(new Set([parent, partialA, partialB]).size).toBe(3);
    expect(partialA).toBe(createScopedFieldIdentity({
      scope: { kind: 'partial', id: 'partial-a', label: 'Renamed display label' },
      key: 'custom.note',
    }));
    expect(partialA).not.toContain('Terms');
  });

  it('prefers a persisted stable ID while retaining owner scope', () => {
    const before = createScopedFieldIdentity({
      scope: { kind: 'partial', id: 'partial-a' },
      key: 'custom.old_key',
      persistedId: 'field-123',
    });
    const afterLabelAndKeyEdit = createScopedFieldIdentity({
      scope: { kind: 'partial', id: 'partial-a' },
      key: 'custom.new_key',
      persistedId: 'field-123',
    });
    const otherScope = createScopedFieldIdentity({
      scope: { kind: 'partial', id: 'partial-b' },
      key: 'custom.new_key',
      persistedId: 'field-123',
    });

    expect(afterLabelAndKeyEdit).toBe(before);
    expect(otherScope).not.toBe(before);
  });

  it('keeps missing, empty, false, zero-like and ISO-looking text distinguishable', () => {
    expect(classifyFieldValue({ storedType: 'text', present: false, value: undefined })).toEqual({ kind: 'missing' });
    expect(classifyFieldValue({ storedType: 'text', present: true, value: '' })).toEqual({ kind: 'empty' });
    expect(classifyFieldValue({ storedType: 'boolean', present: true, value: false })).toEqual({ kind: 'boolean', value: false });
    expect(classifyFieldValue({ storedType: 'number', present: true, value: '0' })).toEqual({ kind: 'number', value: '0' });
    expect(classifyFieldValue({ storedType: 'text', present: true, value: '2026-09-11' })).toEqual({ kind: 'text', value: '2026-09-11' });
    expect(classifyFieldValue({ storedType: 'boolean', present: true, value: 'false' })).toEqual({
      kind: 'legacy',
      declaredType: 'boolean',
      value: 'false',
    });
  });

  it('preserves unsupported legacy values without pretending they are text', () => {
    expect(classifyFieldValue({ storedType: 'list', present: true, value: ['A', 'B'] })).toEqual({
      kind: 'legacy',
      declaredType: 'list',
      value: ['A', 'B'],
    });
  });
});
