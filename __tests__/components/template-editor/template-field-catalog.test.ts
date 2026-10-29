import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_FIELD_CATEGORIES,
  inferLegacyCustomPlaceholders,
  standardTemplateKeys,
} from '@/components/documents/template-editor/template-field-catalog';
import { validateTemplateSyntax } from '@/components/documents/template-editor/template-validation';

describe('template field catalog', () => {
  it('accepts every ordinary field offered by the Fields panel', () => {
    const keys = standardTemplateKeys();
    const insertableKeys = TEMPLATE_FIELD_CATEGORIES.flatMap(
      (category) => category.fields,
    )
      .filter((field) => !field.builder && !field.key.includes('{{'))
      .map((field) => field.key);

    for (const key of insertableKeys) {
      expect(validateTemplateSyntax(`<p>{{${key}}}</p>`, keys)).toEqual([]);
    }
  });

  it('infers missing custom definitions from an existing template', () => {
    const inferred = inferLegacyCustomPlaceholders(
      '<p>{{custom.agreementDate}}</p><p>{{custom.termMonths}}</p>',
      [],
    );
    expect(inferred.map((field) => field.key)).toEqual([
      'agreementDate',
      'termMonths',
    ]);
    expect(inferred.every((field) => field.type === 'text')).toBe(true);
    expect(inferred[0].description).toContain('Recovered');
  });

  it('preserves stored definitions and only appends missing legacy keys', () => {
    const existing = [
      {
        id: 'stored-1',
        key: 'agreementDate',
        label: 'Agreement date',
        type: 'date' as const,
        required: true,
      },
    ];
    const inferred = inferLegacyCustomPlaceholders(
      '<p>{{custom.agreementDate}}</p><p>{{custom.termMonths}}</p>',
      existing,
    );
    expect(inferred).toHaveLength(2);
    expect(inferred[0]).toEqual(existing[0]);
    expect(inferred[1].key).toBe('termMonths');
    expect(inferred[1].id).toBe('legacy-custom-termMonths');
  });
});
