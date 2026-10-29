import {
  classifyFieldValue,
  diagnoseFieldRegistryContract,
  loadLosslessStoredFieldDefinition,
  serializeLosslessStoredFieldDefinition,
  type FieldInputDescriptor,
  type FieldOwnerScope,
  type FieldParserDiagnostic,
  type LosslessStoredFieldDefinition,
  type TypedFieldValue,
} from '@/lib/template-field-contract';

export const FIELD_VALUE_PRECEDENCE_V1 = Object.freeze([
  'item-value',
  'accepted-prefixed-legacy-value',
  'document-override',
  'shared-master',
  'default',
] as const);

export type FieldValueSource = typeof FIELD_VALUE_PRECEDENCE_V1[number] | 'missing';

export interface StoredFieldRegistryResult {
  definitions: readonly LosslessStoredFieldDefinition[];
  diagnostics: readonly FieldParserDiagnostic[];
  preservedInvalidDefinitions: readonly Readonly<Record<string, unknown>>[];
}

function invalidDefinitionDiagnostic(
  scope: FieldOwnerScope,
  definition: Readonly<Record<string, unknown>>,
  message: string,
): FieldParserDiagnostic {
  const raw = JSON.stringify(definition);
  return {
    code: 'invalid-expression',
    severity: 'error',
    message,
    span: { start: 0, end: raw.length, raw },
    scope,
  };
}

export function loadStoredFieldRegistry(input: {
  scope: FieldOwnerScope;
  definitions: readonly Readonly<Record<string, unknown>>[];
}): StoredFieldRegistryResult {
  const definitions: LosslessStoredFieldDefinition[] = [];
  const diagnostics: FieldParserDiagnostic[] = [];
  const preservedInvalidDefinitions: Readonly<Record<string, unknown>>[] = [];

  for (const definition of input.definitions) {
    try {
      definitions.push(loadLosslessStoredFieldDefinition({
        scope: input.scope,
        definition,
      }));
    } catch (error) {
      preservedInvalidDefinitions.push(Object.freeze({ ...definition }));
      diagnostics.push(invalidDefinitionDiagnostic(
        input.scope,
        definition,
        error instanceof Error ? error.message : 'Invalid stored field definition.',
      ));
    }
  }

  diagnostics.push(...diagnoseFieldRegistryContract(definitions));
  return { definitions, diagnostics, preservedInvalidDefinitions };
}

export function serializeStoredFieldDefinition(
  definition: LosslessStoredFieldDefinition,
): Record<string, unknown> {
  return serializeLosslessStoredFieldDefinition(definition);
}

const CONTROL_BY_TYPE = Object.freeze({
  text: 'text',
  textarea: 'textarea',
  date: 'date',
  number: 'decimal',
  currency: 'currency',
  boolean: 'boolean',
} as const);

export function createFieldInputDescriptor(
  definition: LosslessStoredFieldDefinition,
  input: { description?: string; sourceLabel?: string } = {},
): FieldInputDescriptor {
  const control = definition.supportedType
    ? CONTROL_BY_TYPE[definition.supportedType]
    : 'read-only';
  return {
    identity: definition.identity,
    scope: definition.scope,
    key: definition.key,
    label: definition.label,
    ...(input.description ? { description: input.description } : {}),
    storedType: definition.storedType,
    control,
    required: definition.required ?? false,
    defaultValue: classifyFieldValue({
      storedType: definition.storedType,
      present: Object.prototype.hasOwnProperty.call(definition.original, 'defaultValue'),
      value: definition.defaultValue,
    }),
    ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
    ...(definition.supportedType === null
      ? { disabledReason: `Legacy field type "${definition.storedType}" is preserve-only.` }
      : {}),
  };
}

const EXACT_DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateTypedFieldValue(value: TypedFieldValue): boolean {
  switch (value.kind) {
    case 'missing':
    case 'empty':
      return true;
    case 'text':
    case 'multiline':
      return typeof value.value === 'string';
    case 'date':
      return DATE_ONLY_PATTERN.test(value.value);
    case 'number':
    case 'currency':
      return EXACT_DECIMAL_PATTERN.test(value.value);
    case 'boolean':
      return typeof value.value === 'boolean';
    case 'legacy':
      return true;
  }
}

export function typedFieldValueToLegacyPayloadValue(value: TypedFieldValue): unknown {
  switch (value.kind) {
    case 'missing':
      return undefined;
    case 'empty':
      return '';
    case 'legacy':
      return value.value;
    default:
      return value.value;
  }
}

export interface ResolveFieldValuePrecedenceInput {
  definition: LosslessStoredFieldDefinition;
  itemValues: Readonly<Record<string, unknown>>;
  documentOverrides: Readonly<Record<string, unknown>>;
  sharedMasterValues: Readonly<Record<string, unknown>>;
  aggregateKey?: string;
  acceptedPrefixedLegacyKey?: string;
}

export interface ResolvedTypedFieldValue {
  source: FieldValueSource;
  value: TypedFieldValue;
}

function readOwn(
  values: Readonly<Record<string, unknown>>,
  key: string | undefined,
): { present: boolean; value: unknown } {
  if (!key || !Object.prototype.hasOwnProperty.call(values, key)) {
    return { present: false, value: undefined };
  }
  return { present: true, value: values[key] };
}

export function resolveTypedFieldValueByPrecedence(
  input: ResolveFieldValuePrecedenceInput,
): ResolvedTypedFieldValue {
  const direct = readOwn(input.itemValues, input.definition.key.replace(/^custom\./, ''));
  if (direct.present) {
    return {
      source: 'item-value',
      value: classifyFieldValue({ storedType: input.definition.storedType, ...direct }),
    };
  }

  const prefixed = readOwn(input.itemValues, input.acceptedPrefixedLegacyKey);
  if (prefixed.present) {
    return {
      source: 'accepted-prefixed-legacy-value',
      value: classifyFieldValue({ storedType: input.definition.storedType, ...prefixed }),
    };
  }

  const aggregateKey = input.aggregateKey ?? input.definition.identity;
  const override = readOwn(input.documentOverrides, aggregateKey);
  if (override.present) {
    return {
      source: 'document-override',
      value: classifyFieldValue({ storedType: input.definition.storedType, ...override }),
    };
  }

  const master = readOwn(input.sharedMasterValues, aggregateKey);
  if (master.present) {
    return {
      source: 'shared-master',
      value: classifyFieldValue({ storedType: input.definition.storedType, ...master }),
    };
  }

  const present = Object.prototype.hasOwnProperty.call(input.definition.original, 'defaultValue');
  if (present) {
    return {
      source: 'default',
      value: classifyFieldValue({
        storedType: input.definition.storedType,
        present,
        value: input.definition.defaultValue,
      }),
    };
  }

  return { source: 'missing', value: { kind: 'missing' } };
}
