/**
 * Server-derived master fields and effective-value resolution.
 *
 * A custom field becomes a master field when the same canonical key and
 * canonical type appears in at least two documents of the batch, which can
 * be two copies of the same template. Built-in
 * company/contact context and structured Service Agreement fields never
 * become master fields.
 */

import {
  normalizePlaceholderKey,
  storageFormatToCustomPlaceholders,
  normalizeStoredPlaceholders,
} from '@/lib/template-analysis';
import type {
  CustomPlaceholderDefinition,
  PlaceholderValueType,
} from '@/types/placeholders';
import type {
  MasterFieldCatalogue,
  MasterFieldDefinition,
} from '@/types/document-generation-batch';
import {
  readPlaceholderChoices,
  readPlaceholderOptions,
} from '@/lib/document-editor/oakdoc-custom-fields';

/** Dropdown choices stored on a custom field definition. */
export function customFieldOptions(field: CustomPlaceholderDefinition): string[] {
  return readPlaceholderOptions(field.storageDefinition?.options);
}

/** Labels of stored choices that differ from their value (a Contact field's contacts). */
export function customFieldOptionLabels(field: CustomPlaceholderDefinition): Record<string, string> {
  return Object.fromEntries(
    readPlaceholderChoices(field.storageDefinition?.options)
      .filter((choice) => choice.label !== choice.value)
      .map((choice) => [choice.value, choice.label]),
  );
}

const BUILTIN_CONTEXT_ROOTS = new Set([
  'company',
  'contact',
  'contacts',
  'directors',
  'selectedContact',
  'selectedDirector',
  'selectedShareholder',
  'secretaries',
  'shareholders',
  'system',
  'service',
  'agreement',
]);

export function canonicalPlaceholderType(type: string | undefined): PlaceholderValueType {
  if (
    type === 'date'
    || type === 'number'
    || type === 'currency'
    || type === 'boolean'
    || type === 'textarea'
  ) {
    return type;
  }
  return 'text';
}

export function masterFieldId(key: string, type: PlaceholderValueType): string {
  return `${normalizePlaceholderKey(key)}::${type}`;
}

export interface TemplateFieldSource {
  templateId: string;
  fields: CustomPlaceholderDefinition[];
}

function isEligibleCustomField(field: CustomPlaceholderDefinition): boolean {
  const key = normalizePlaceholderKey(field.key);
  if (!key) return false;
  const root = key.split(/[.[\]]/)[0];
  if (BUILTIN_CONTEXT_ROOTS.has(root)) return false;
  if (key.startsWith('service.fields.')) return false;
  return true;
}

export function deriveMasterFieldCatalogue(
  sources: TemplateFieldSource[],
): MasterFieldCatalogue {
  const groups = new Map<string, {
    key: string;
    type: PlaceholderValueType;
    label: string;
    templateIds: Set<string>;
    /** Documents (sources) using the field; copies of one template count separately. */
    uses: number;
    requiredTemplateIds: Set<string>;
    defaultsByTemplateId: Record<string, string>;
    options: string[];
    optionLabels: Record<string, string>;
  }>();
  const conflicts = new Map<string, Set<PlaceholderValueType>>();

  for (const source of sources) {
    const seenInSource = new Set<string>();
    for (const rawField of source.fields) {
      if (!isEligibleCustomField(rawField)) continue;
      const key = normalizePlaceholderKey(rawField.key);
      const type = canonicalPlaceholderType(rawField.type);
      const id = masterFieldId(key, type);
      const firstInSource = !seenInSource.has(id);
      seenInSource.add(id);
      const existing = groups.get(id);
      if (existing) {
        existing.templateIds.add(source.templateId);
        if (firstInSource) existing.uses += 1;
        if (rawField.required) existing.requiredTemplateIds.add(source.templateId);
        if (rawField.defaultValue !== undefined) {
          existing.defaultsByTemplateId[source.templateId] = rawField.defaultValue;
        }
        if (existing.options.length === 0) {
          existing.options = customFieldOptions(rawField);
          existing.optionLabels = customFieldOptionLabels(rawField);
        }
      } else {
        groups.set(id, {
          key,
          type,
          label: rawField.label || key,
          templateIds: new Set([source.templateId]),
          uses: 1,
          requiredTemplateIds: rawField.required
            ? new Set([source.templateId])
            : new Set(),
          defaultsByTemplateId: rawField.defaultValue !== undefined
            ? { [source.templateId]: rawField.defaultValue }
            : {},
          options: customFieldOptions(rawField),
          optionLabels: customFieldOptionLabels(rawField),
        });
      }
      if (!conflicts.has(key)) conflicts.set(key, new Set());
      conflicts.get(key)!.add(type);
    }
  }

  const fields: MasterFieldDefinition[] = Array.from(groups.values())
    .filter((group) => group.uses >= 2)
    .sort((a, b) => a.key.localeCompare(b.key) || a.type.localeCompare(b.type))
    .map((group) => ({
      id: masterFieldId(group.key, group.type),
      key: group.key,
      type: group.type,
      label: group.label,
      templateIds: Array.from(group.templateIds).sort(),
      requiredTemplateIds: Array.from(group.requiredTemplateIds).sort(),
      defaultsByTemplateId: group.defaultsByTemplateId,
      ...(group.options.length > 0 ? { options: group.options } : {}),
      ...(Object.keys(group.optionLabels).length > 0 ? { optionLabels: group.optionLabels } : {}),
    }));

  const conflictEntries = Array.from(conflicts.entries())
    .filter(([, types]) => types.size > 1)
    .map(([key, types]) => ({
      key,
      types: Array.from(types).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { fields, conflicts: conflictEntries };
}

export interface ResolveEffectiveCustomDataParams {
  templateFields: CustomPlaceholderDefinition[];
  templateId: string;
  masterValues: Record<string, string>;
  overrides: Record<string, string>;
  itemValues: Record<string, string>;
}

/**
 * Effective resolution order: item override, batch master value, template
 * default, then unresolved (empty). Presence of an override key is
 * significant, so an explicit empty override remains distinguishable from no
 * override.
 */
export function resolveEffectiveCustomData(
  params: ResolveEffectiveCustomDataParams,
): Record<string, string> {
  const {
    templateFields,
    templateId,
    masterValues,
    overrides,
    itemValues,
  } = params;
  const effective: Record<string, string> = { ...itemValues };

  for (const field of templateFields) {
    const key = normalizePlaceholderKey(field.key);
    if (!key) continue;
    const id = masterFieldId(key, canonicalPlaceholderType(field.type));
    if (Object.prototype.hasOwnProperty.call(itemValues, key)) {
      effective[key] = itemValues[key];
    } else if (Object.prototype.hasOwnProperty.call(itemValues, `custom.${key}`)) {
      // Legacy generation sessions stored custom values with their namespace.
      effective[key] = itemValues[`custom.${key}`];
    } else if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      effective[key] = overrides[id];
    } else if (Object.prototype.hasOwnProperty.call(masterValues, id)) {
      effective[key] = masterValues[id];
    } else if (field.defaultValue !== undefined) {
      effective[key] = field.defaultValue;
    } else {
      effective[key] = '';
    }
  }
  void templateId;
  return effective;
}

export function templateFieldsFromStorage(
  templateId: string,
  storedPlaceholders: unknown,
): TemplateFieldSource {
  return {
    templateId,
    fields: storageFormatToCustomPlaceholders(
      normalizeStoredPlaceholders(storedPlaceholders),
    ),
  };
}
