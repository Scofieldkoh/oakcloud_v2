import { describe, expect, it } from 'vitest';
import {
  deriveMasterFieldCatalogue,
  resolveEffectiveCustomData,
  templateFieldsFromStorage,
} from '@/lib/document-generation-master-fields';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';

function templateFields(
  templateId: string,
  fields: Array<Partial<CustomPlaceholderDefinition> & { key: string }>,
) {
  return templateFieldsFromStorage(
    templateId,
    fields.map((field) => ({
      key: field.key.startsWith('custom.') ? field.key : `custom.${field.key}`,
      label: field.label ?? field.key,
      type: field.type ?? 'text',
      source: 'custom',
      category: 'custom',
      required: field.required ?? false,
      defaultValue: field.defaultValue,
    })),
  );
}

const definitions: CustomPlaceholderDefinition[] = [
  {
    id: 'engagement_date',
    key: 'engagement_date',
    label: 'Engagement date',
    type: 'date',
    required: true,
  },
  {
    id: 'client_name',
    key: 'client_name',
    label: 'Client legal name',
    type: 'text',
    required: true,
    defaultValue: 'Default client',
  },
];

describe('document generation master fields', () => {
  it('groups only matching normalized key and canonical type', () => {
    const catalogue = deriveMasterFieldCatalogue([
      templateFields('template-a', [{ key: 'custom.engagement_date', type: 'date', label: 'Date' }]),
      templateFields('template-b', [{ key: 'engagement_date', type: 'date', label: 'Engagement date' }]),
      templateFields('template-c', [{ key: 'engagement_date', type: 'text', label: 'Date text' }]),
    ]);

    expect(catalogue.fields).toEqual([
      expect.objectContaining({
        id: 'engagement_date::date',
        templateIds: ['template-a', 'template-b'],
      }),
    ]);
    expect(catalogue.conflicts).toEqual([
      { key: 'engagement_date', types: ['date', 'text'] },
    ]);
  });

  it('shares a field between two copies of the same template, but not within one document', () => {
    const resolution = templateFields('resolution', [
      { key: 'resolution_date', type: 'date', label: 'Resolution date', required: true },
    ]);
    expect(deriveMasterFieldCatalogue([resolution]).fields).toEqual([]);
    expect(deriveMasterFieldCatalogue([
      templateFields('resolution', [
        { key: 'resolution_date', type: 'date' },
        { key: 'custom.resolution_date', type: 'date' },
      ]),
    ]).fields).toEqual([]);
    expect(deriveMasterFieldCatalogue([resolution, resolution]).fields).toEqual([
      expect.objectContaining({
        id: 'resolution_date::date',
        templateIds: ['resolution'],
        requiredTemplateIds: ['resolution'],
      }),
    ]);
  });

  it('excludes built-in company/contact context and structured service fields', () => {
    const catalogue = deriveMasterFieldCatalogue([
      templateFields('template-a', [
        { key: 'company.name', type: 'text' },
        { key: 'service.fields.fee', type: 'text' },
        { key: 'shared_reference', type: 'text' },
      ]),
      templateFields('template-b', [
        { key: 'company.name', type: 'text' },
        { key: 'shared_reference', type: 'text' },
      ]),
    ]);

    expect(catalogue.fields.map((field) => field.key)).toEqual(['shared_reference']);
  });

  it('tracks required consumers and per-template defaults', () => {
    const catalogue = deriveMasterFieldCatalogue([
      templateFields('template-a', [
        { key: 'client_name', required: true },
      ]),
      templateFields('template-b', [
        { key: 'client_name', required: false, defaultValue: 'Template B default' },
      ]),
    ]);

    expect(catalogue.fields[0]).toMatchObject({
      key: 'client_name',
      requiredTemplateIds: ['template-a'],
      defaultsByTemplateId: { 'template-b': 'Template B default' },
    });
  });

  it('resolves override, master value, template default, then unresolved', () => {
    const effective = resolveEffectiveCustomData({
      templateFields: definitions,
      templateId: 'template-a',
      masterValues: { 'engagement_date::date': '2026-08-12' },
      overrides: { 'engagement_date::date': '' },
      itemValues: {},
    });
    expect(effective.engagement_date).toBe('');

    const masterOnly = resolveEffectiveCustomData({
      templateFields: definitions,
      templateId: 'template-a',
      masterValues: { 'engagement_date::date': '2026-08-12' },
      overrides: {},
      itemValues: {},
    });
    expect(masterOnly.engagement_date).toBe('2026-08-12');

    const defaulted = resolveEffectiveCustomData({
      templateFields: definitions,
      templateId: 'template-a',
      masterValues: {},
      overrides: {},
      itemValues: {},
    });
    expect(defaulted.client_name).toBe('Default client');

    const unresolved = resolveEffectiveCustomData({
      templateFields: definitions,
      templateId: 'template-a',
      masterValues: {},
      overrides: {},
      itemValues: {},
    });
    expect(unresolved.engagement_date).toBe('');
  });

  it('preserves item-only values alongside effective master values', () => {
    const effective = resolveEffectiveCustomData({
      templateFields: definitions,
      templateId: 'template-a',
      masterValues: { 'engagement_date::date': '2026-08-12' },
      overrides: {},
      itemValues: { internal_reference: 'REF-1' },
    });
    expect(effective).toEqual({
      internal_reference: 'REF-1',
      engagement_date: '2026-08-12',
      client_name: 'Default client',
    });
  });

  it('keeps populated document-specific fields in the effective data', () => {
    const effective = resolveEffectiveCustomData({
      templateFields: definitions,
      templateId: 'template-a',
      masterValues: {},
      overrides: {},
      itemValues: { engagement_date: '2026-09-01' },
    });

    expect(effective.engagement_date).toBe('2026-09-01');
  });

  it('normalizes namespaced legacy item values', () => {
    const effective = resolveEffectiveCustomData({
      templateFields: definitions,
      templateId: 'template-a',
      masterValues: {},
      overrides: {},
      itemValues: { 'custom.engagement_date': '2026-09-01' },
    });

    expect(effective.engagement_date).toBe('2026-09-01');
  });
});
