import {
  loadStoredFieldRegistry,
  type StoredFieldRegistryResult,
} from '@/lib/template-field-registry';
import type { FieldOwnerScope } from '@/lib/template-field-contract';
import type {
  CustomPlaceholderDefinition,
  PlaceholderSource,
  PlaceholderValueType,
} from '@/types/placeholders';

export interface StoredEditorPlaceholder extends Record<string, unknown> {
  id?: string;
  key: string;
  label: string;
  type: string;
  source?: PlaceholderSource | string;
  category?: string;
  path?: string;
  required?: boolean;
  defaultValue?: unknown;
  format?: unknown;
  options?: unknown;
  linkedTo?: string;
  sourcePartial?: string;
}

export interface StoragePlaceholderAdapterOptions {
  scope?: FieldOwnerScope;
}

export interface StoragePlaceholdersToEditorResult {
  placeholders: CustomPlaceholderDefinition[];
  diagnostics: StoredFieldRegistryResult['diagnostics'];
  preservedInvalidDefinitions: StoredFieldRegistryResult['preservedInvalidDefinitions'];
}

const DEFAULT_LEGACY_SCOPE: FieldOwnerScope = Object.freeze({
  kind: 'template',
  id: 'legacy-template-editor',
});

const SUPPORTED_EDITOR_TYPES = new Set<PlaceholderValueType>([
  'text',
  'textarea',
  'date',
  'number',
  'currency',
  'boolean',
]);

function editorType(type: string | undefined): PlaceholderValueType {
  return SUPPORTED_EDITOR_TYPES.has(type as PlaceholderValueType)
    ? type as PlaceholderValueType
    : 'text';
}

function normalizeSource(source: string | undefined): PlaceholderSource | undefined {
  if (
    source === 'company'
    || source === 'contact'
    || source === 'officer'
    || source === 'shareholder'
    || source === 'service'
    || source === 'custom'
    || source === 'system'
  ) {
    return source;
  }
  return undefined;
}

function stripCustomPrefix(key: string): string {
  return key.replace(/^custom\./, '');
}

function ensureCustomPrefix(key: string): string {
  const normalized = stripCustomPrefix(key);
  return normalized ? `custom.${normalized}` : '';
}

function hasOwn(value: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function storagePlaceholdersToEditorResult(
  placeholders: readonly Readonly<Record<string, unknown>>[],
  options: StoragePlaceholderAdapterOptions = {},
): StoragePlaceholdersToEditorResult {
  const scope = options.scope ?? DEFAULT_LEGACY_SCOPE;
  const registry = loadStoredFieldRegistry({ scope, definitions: placeholders });

  return {
    placeholders: registry.definitions.map((definition) => {
      const source = normalizeSource(definition.source);
      const key = source === 'custom' || definition.key.startsWith('custom.')
        ? stripCustomPrefix(definition.key)
        : definition.key;
      return {
        id: definition.identity,
        fieldIdentity: definition.identity,
        ownerScope: definition.scope,
        storagePersistedId: definition.persistedId,
        key,
        label: definition.label,
        type: definition.supportedType ?? 'text',
        storedType: definition.storedType,
        preserveOnly: definition.supportedType === null,
        required: definition.required ?? false,
        storageRequiredWasExplicit: definition.requiredWasExplicit,
        ...(typeof definition.defaultValue === 'string'
          ? { defaultValue: definition.defaultValue }
          : {}),
        ...(definition.linkedTo ? { linkedTo: definition.linkedTo } : {}),
        ...(definition.sourcePartial ? { sourcePartial: definition.sourcePartial } : {}),
        ...(source ? { storageSource: source } : {}),
        ...(definition.source ? { storageRawSource: definition.source } : {}),
        ...(definition.path ? { storagePath: definition.path } : {}),
        ...(definition.category ? { storageCategory: definition.category } : {}),
        storageDefinition: { ...definition.original },
      };
    }),
    diagnostics: registry.diagnostics,
    preservedInvalidDefinitions: registry.preservedInvalidDefinitions,
  };
}

export function storagePlaceholdersToEditor(
  placeholders: readonly Readonly<Record<string, unknown>>[],
  options: StoragePlaceholderAdapterOptions = {},
): CustomPlaceholderDefinition[] {
  return storagePlaceholdersToEditorResult(placeholders, options).placeholders;
}

function serializeEditorPlaceholder(
  placeholder: CustomPlaceholderDefinition,
): StoredEditorPlaceholder {
  const original = placeholder.storageDefinition ? { ...placeholder.storageDefinition } : {};
  const originalType = typeof original.type === 'string' ? original.type : undefined;
  const originalEditorType = editorType(originalType);
  const preserveOriginalType = Boolean(
    originalType && (placeholder.preserveOnly || placeholder.type === originalEditorType),
  );
  const type = preserveOriginalType
    ? originalType!
    : (placeholder.storedType && placeholder.preserveOnly
      ? placeholder.storedType
      : placeholder.type);

  const source = placeholder.storageRawSource
    ?? placeholder.storageSource
    ?? (typeof original.source === 'string' ? original.source : undefined)
    ?? 'custom';
  const storedKey = source === 'custom'
    ? ensureCustomPrefix(placeholder.key)
    : placeholder.key;
  const path = placeholder.storagePath
    ?? (typeof original.path === 'string' ? original.path : undefined)
    ?? storedKey;
  const category = placeholder.storageCategory
    ?? (typeof original.category === 'string' ? original.category : undefined)
    ?? (source === 'custom' ? 'custom' : source);

  const result: Record<string, unknown> = {
    ...original,
    key: storedKey,
    label: placeholder.label,
    type,
    source,
    category,
    path,
  };

  const requiredWasExplicit = placeholder.storageRequiredWasExplicit
    ?? hasOwn(original, 'required');
  const originalRequiredWasMalformed = requiredWasExplicit
    && hasOwn(original, 'required')
    && typeof original.required !== 'boolean';
  if (originalRequiredWasMalformed) {
    result.required = original.required;
  } else if (requiredWasExplicit || placeholder.required) {
    result.required = placeholder.required;
  } else {
    delete result.required;
  }

  if (placeholder.defaultValue !== undefined) {
    result.defaultValue = placeholder.defaultValue;
  } else if (typeof original.defaultValue === 'string') {
    delete result.defaultValue;
  }

  if (placeholder.linkedTo !== undefined) {
    result.linkedTo = placeholder.linkedTo;
  } else if (typeof original.linkedTo === 'string') {
    delete result.linkedTo;
  }

  if (placeholder.sourcePartial !== undefined) {
    result.sourcePartial = placeholder.sourcePartial;
  } else if (typeof original.sourcePartial === 'string') {
    delete result.sourcePartial;
  }

  return result as StoredEditorPlaceholder;
}

export function editorPlaceholdersToStorage(
  placeholders: readonly CustomPlaceholderDefinition[],
): StoredEditorPlaceholder[] {
  return placeholders.map(serializeEditorPlaceholder);
}
