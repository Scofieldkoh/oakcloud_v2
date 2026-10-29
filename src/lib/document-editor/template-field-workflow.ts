import type {
  FieldInputDescriptor,
  FieldOwnerScope,
} from '@/lib/template-field-contract';
import {
  createFieldInputDescriptor,
  loadStoredFieldRegistry,
  resolveTypedFieldValueByPrecedence,
  serializeStoredFieldDefinition,
  typedFieldValueToLegacyPayloadValue,
} from '@/lib/template-field-registry';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Preserve request definitions through the F1 registry/serializer rather than
 * reconstructing an allow-listed subset. Invalid legacy objects are retained
 * byte-for-field (within JSON parsing) so a W1 no-op save cannot erase forward
 * metadata; request Zod validation handles new authoring safety separately.
 */
export function preserveStoredFieldDefinitions(
  definitions: readonly Readonly<Record<string, unknown>>[],
  scope: FieldOwnerScope,
): Record<string, unknown>[] {
  return definitions.map((definition) => {
    const registry = loadStoredFieldRegistry({ scope, definitions: [definition] });
    const loaded = registry.definitions[0];
    return loaded ? serializeStoredFieldDefinition(loaded) : { ...definition };
  });
}

export function normalizeStoredFieldDefinitionInput(value: unknown): Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function storedDefinitionForEditorField(field: CustomPlaceholderDefinition): Readonly<Record<string, unknown>> {
  if (field.storageDefinition) return { ...field.storageDefinition };
  return {
    ...(field.storagePersistedId || field.id ? { id: field.storagePersistedId ?? field.id } : {}),
    key: field.key,
    label: field.label,
    type: field.storedType ?? field.type,
    ...(field.storageRawSource || field.storageSource
      ? { source: field.storageRawSource ?? field.storageSource }
      : {}),
    ...(field.storageCategory ? { category: field.storageCategory } : {}),
    ...(field.storagePath ? { path: field.storagePath } : {}),
    ...(field.storageRequiredWasExplicit || field.required ? { required: field.required } : {}),
    ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
    ...(field.linkedTo ? { linkedTo: field.linkedTo } : {}),
    ...(field.sourcePartial ? { sourcePartial: field.sourcePartial } : {}),
  };
}

/**
 * W3 consumer adapter for F's frozen FieldInputDescriptor contract. The owner
 * scope comes from durable field metadata where available; the fallback scope
 * is used only for pre-F1 editor values that have not yet been reopened.
 */
export function createWorkflowFieldInputDescriptors(
  fields: readonly CustomPlaceholderDefinition[],
  fallbackScope: FieldOwnerScope,
): FieldInputDescriptor[] {
  return fields.flatMap((field) => {
    const scope: FieldOwnerScope = field.ownerScope
      ? { ...field.ownerScope }
      : { ...fallbackScope };
    const registry = loadStoredFieldRegistry({
      scope,
      definitions: [storedDefinitionForEditorField(field)],
    });
    const definition = registry.definitions[0];
    if (!definition) return [];
    return [createFieldInputDescriptor(definition, {
      ...(field.description ? { description: field.description } : {}),
      ...(field.sourcePartial || field.storageRawSource || field.storageSource
        ? { sourceLabel: field.sourcePartial ?? field.storageRawSource ?? field.storageSource }
        : {}),
    })];
  });
}

/**
 * Route-level form descriptor producer for unsaved template snapshots. It uses
 * the same lossless F registry as batch forms, so legacy field types remain
 * visible/read-only rather than being narrowed away by a route schema.
 */
export function createStoredWorkflowFieldInputDescriptors(
  definitions: readonly Readonly<Record<string, unknown>>[],
  scope: FieldOwnerScope,
): FieldInputDescriptor[] {
  const registry = loadStoredFieldRegistry({ scope, definitions });
  return registry.definitions.map((definition) => createFieldInputDescriptor(definition));
}

export function fieldInputDescriptorDefaultValue(descriptor: FieldInputDescriptor): unknown {
  return typedFieldValueToLegacyPayloadValue(descriptor.defaultValue);
}

/**
 * Normalize route callback values by declared control, never by appearance.
 * Exact decimal/currency/date/multiline strings stay strings; browser checkbox
 * legacy strings are converted to a real boolean. Preserve-only legacy fields
 * pass through unchanged for old snapshots/readers.
 */
export function normalizeWorkflowInputValues(
  descriptors: readonly FieldInputDescriptor[],
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...values };
  for (const descriptor of descriptors) {
    const key = descriptor.key.replace(/^custom\./, '');
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    const value = values[key];
    switch (descriptor.control) {
      case 'boolean':
        if (typeof value === 'boolean') output[key] = value;
        else if (value === 'true' || value === '1') output[key] = true;
        else if (value === 'false' || value === '0') output[key] = false;
        break;
      case 'date':
        output[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
        break;
      case 'decimal':
      case 'currency':
        output[key] = typeof value === 'number' ? String(value) : value;
        break;
      case 'text':
      case 'textarea':
      case 'read-only':
        output[key] = value;
        break;
    }
  }
  return output;
}

/**
 * Presence helper shared by W3 forms/completeness. Explicit false and exact zero
 * values are present; only missing/null and blank strings are absent.
 */
export function isWorkflowFieldValuePresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/**
 * F1 typed-value adapter for top-level template custom values. It retains the
 * legacy payload surface but derives values by declared type and frozen
 * precedence; appearance is never used to coerce text into date/number/boolean.
 * Scoped partial rebinding is handled by the W3 scoped renderer and never by
 * flattening or renaming field identities here.
 */
export function resolveTopLevelCustomValues(input: {
  definitions: readonly Readonly<Record<string, unknown>>[];
  scope: FieldOwnerScope;
  itemValues: Readonly<Record<string, unknown>>;
  documentOverrides?: Readonly<Record<string, unknown>>;
  sharedMasterValues?: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input.itemValues };
  const registry = loadStoredFieldRegistry({
    scope: input.scope,
    definitions: input.definitions,
  });

  for (const definition of registry.definitions) {
    if (typeof definition.original.sourcePartial === 'string') continue;
    if (definition.source !== 'custom' && !definition.key.startsWith('custom.')) continue;
    const resolved = resolveTypedFieldValueByPrecedence({
      definition,
      itemValues: input.itemValues,
      documentOverrides: input.documentOverrides ?? {},
      sharedMasterValues: input.sharedMasterValues ?? {},
    });
    if (resolved.source === 'missing') continue;
    const key = definition.key.replace(/^custom\./, '');
    const value = typedFieldValueToLegacyPayloadValue(resolved.value);
    if (value !== undefined) output[key] = value;
  }

  return output;
}
