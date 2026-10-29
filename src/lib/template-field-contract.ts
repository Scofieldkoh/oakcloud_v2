import type { PlaceholderValueType } from '@/types/placeholders';

/**
 * F0 contract proof for C05. This module is intentionally not wired into the
 * editor or resolver yet: G0 must freeze the interfaces before F1 enables a
 * shared parser/registry implementation.
 */

export type FieldScopeKind = 'template' | 'partial';

export interface FieldOwnerScope {
  kind: FieldScopeKind;
  /** Stable template/partial ID, never a display name. */
  id: string;
  /** Optional display-only source name. */
  label?: string;
}

export interface FieldSourceSpan {
  start: number;
  end: number;
  raw: string;
}

/**
 * Storage/editor compatibility classification only. It is deliberately not an
 * HTML trust capability: there is no `trusted-rich` stored mode. A stored
 * definition, client value or pasted token cannot mint C06 trusted-rich output.
 */
export type StoredFieldRenderMode = 'text' | 'legacy-preserve-only';

export const LOSSLESS_FIELD_SCHEMA_KEYS_V1 = Object.freeze([
  'id',
  'key',
  'label',
  'type',
  'source',
  'category',
  'path',
  'required',
  'defaultValue',
  'format',
  'options',
  'linkedTo',
  'sourcePartial',
] as const);

const LOSSLESS_FIELD_SCHEMA_KEY_SET = new Set<string>(LOSSLESS_FIELD_SCHEMA_KEYS_V1);
const SUPPORTED_STORED_TYPES = new Set<PlaceholderValueType>([
  'text',
  'textarea',
  'date',
  'number',
  'currency',
  'boolean',
]);

export interface LosslessStoredFieldDefinition {
  identity: string;
  scope: FieldOwnerScope;
  persistedId?: string;
  key: string;
  label: string;
  /** Preserve the stored type even when this client cannot author it. */
  storedType: string;
  supportedType: PlaceholderValueType | null;
  /** Effective lookup path for contract consumers; the stored `path` remains separate. */
  resolverPath: string;
  /** Exact stored path when one was declared. */
  path?: string;
  source?: string;
  category?: string;
  /** Exact stored required value; omitted remains undefined. */
  required?: boolean;
  requiredWasExplicit: boolean;
  defaultValue?: unknown;
  format?: unknown;
  options?: unknown;
  linkedTo?: string;
  sourcePartial?: string;
  /**
   * Declarative compatibility mode only. This value never grants trusted HTML.
   * Runtime rich fragments require a canonical C06 TrustedRichOrigin capability.
   */
  renderMode: StoredFieldRenderMode;
  /** Unknown top-level properties retained verbatim for forward compatibility. */
  unknownMetadata: Readonly<Record<string, unknown>>;
  /** Complete original object used by the F0 no-change serialization proof. */
  original: Readonly<Record<string, unknown>>;
}

function hasOwn(value: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireStoredString(
  definition: Readonly<Record<string, unknown>>,
  key: 'key' | 'label' | 'type',
): string {
  const value = definition[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Stored field ${key} must be a non-empty string`);
  }
  return value;
}

function optionalStoredString(
  definition: Readonly<Record<string, unknown>>,
  key: 'id' | 'source' | 'category' | 'path' | 'linkedTo' | 'sourcePartial',
): string | undefined {
  const value = definition[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * F0-only lossless loader proof. It derives safe typed views while retaining
 * the exact source object for a no-change serialize. It is not wired to current
 * persistence/editor adapters and therefore does not activate F1 behavior.
 */
export function loadLosslessStoredFieldDefinition(input: {
  scope: FieldOwnerScope;
  definition: Readonly<Record<string, unknown>>;
}): LosslessStoredFieldDefinition {
  const original = Object.freeze({ ...input.definition });
  const key = requireStoredString(original, 'key');
  const label = requireStoredString(original, 'label');
  const storedType = requireStoredString(original, 'type');
  const persistedId = optionalStoredString(original, 'id');
  const path = optionalStoredString(original, 'path');
  const supportedType = SUPPORTED_STORED_TYPES.has(storedType as PlaceholderValueType)
    ? storedType as PlaceholderValueType
    : null;
  const requiredWasExplicit = hasOwn(original, 'required');
  const required = requiredWasExplicit && typeof original.required === 'boolean'
    ? original.required
    : undefined;
  const unknownMetadata = Object.freeze(Object.fromEntries(
    Object.entries(original).filter(([metadataKey]) => !LOSSLESS_FIELD_SCHEMA_KEY_SET.has(metadataKey)),
  ));

  return {
    identity: createScopedFieldIdentity({ scope: input.scope, key, persistedId }),
    scope: Object.freeze({ ...input.scope }),
    persistedId,
    key,
    label,
    storedType,
    supportedType,
    resolverPath: path ?? key,
    path,
    source: optionalStoredString(original, 'source'),
    category: optionalStoredString(original, 'category'),
    required,
    requiredWasExplicit,
    defaultValue: original.defaultValue,
    format: original.format,
    options: original.options,
    linkedTo: optionalStoredString(original, 'linkedTo'),
    sourcePartial: optionalStoredString(original, 'sourcePartial'),
    renderMode: supportedType === null ? 'legacy-preserve-only' : 'text',
    unknownMetadata,
    original,
  };
}

/**
 * F0 no-change serializer. Mutation-aware merging belongs to F1/F2; until then
 * the only safe write proof is exact preservation of the loaded source object.
 */
export function serializeLosslessStoredFieldDefinition(
  definition: LosslessStoredFieldDefinition,
): Record<string, unknown> {
  return { ...definition.original };
}

export type TypedFieldValue =
  | { kind: 'missing' }
  | { kind: 'empty' }
  | { kind: 'text'; value: string }
  | { kind: 'multiline'; value: string }
  | { kind: 'date'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'currency'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'legacy'; declaredType: string; value: unknown };

export type FieldInputControl =
  | 'text'
  | 'textarea'
  | 'date'
  | 'decimal'
  | 'currency'
  | 'boolean'
  | 'read-only';

/** Contract consumed later by W-owned batch/template route forms. */
export interface FieldInputDescriptor {
  identity: string;
  scope: FieldOwnerScope;
  key: string;
  label: string;
  description?: string;
  storedType: string;
  control: FieldInputControl;
  required: boolean;
  defaultValue: TypedFieldValue;
  sourceLabel?: string;
  disabledReason?: string;
}

export type FieldGrammarNodeKind =
  | 'reference'
  | 'modifier'
  | 'partial'
  | 'block-open'
  | 'block-close'
  | 'else'
  | 'loop-variable'
  | 'attribute-each'
  | 'comment';

export interface FieldGrammarNode {
  kind: FieldGrammarNodeKind;
  span: FieldSourceSpan;
  expression: string;
  path?: string;
  modifier?: string;
  block?: 'each' | 'if' | 'unless' | 'with';
  partialName?: string;
  scope: FieldOwnerScope;
  /** Occurrence identity is source-local, not the field's durable identity. */
  occurrenceId: string;
}

export type FieldDiagnosticCode =
  | 'dangling-expression'
  | 'formatted-expression'
  | 'invalid-expression'
  | 'unknown-root'
  | 'unknown-field'
  | 'duplicate-key-in-scope'
  | 'ambiguous-legacy-binding'
  | 'unclosed-block'
  | 'mismatched-block'
  | 'missing-partial'
  | 'circular-partial';

export interface FieldParserDiagnostic {
  code: FieldDiagnosticCode;
  severity: 'error' | 'warning';
  message: string;
  span: FieldSourceSpan;
  scope: FieldOwnerScope;
  fieldIdentity?: string;
}

export interface ParsedTemplateFieldSyntax {
  source: string;
  nodes: readonly FieldGrammarNode[];
  diagnostics: readonly FieldParserDiagnostic[];
}

/**
 * C05 parser boundary proposed for F1. HTML-aware parsing must preserve the
 * original source and report formatting inserted *inside* an expression.
 */
export interface TemplateFieldParser {
  parse(input: {
    content: string;
    scope: FieldOwnerScope;
    registry?: readonly LosslessStoredFieldDefinition[];
  }): ParsedTemplateFieldSyntax;
}

export interface FieldLifecycleSnapshot {
  content: string;
  definitions: readonly LosslessStoredFieldDefinition[];
  dependentMetadata: Readonly<Record<string, unknown>>;
}

export type FieldLifecycleIntent =
  | { kind: 'create'; definition: LosslessStoredFieldDefinition }
  | { kind: 'relabel'; identity: string; label: string }
  | { kind: 'migrate-key'; identity: string; nextKey: string }
  | { kind: 'change-definition'; identity: string; patch: Readonly<Record<string, unknown>> }
  | { kind: 'delete'; identity: string; referenceAction: 'remove-references' | 'keep-unresolved' };

export type FieldLifecycleResult =
  | {
      status: 'applied';
      snapshot: FieldLifecycleSnapshot;
      changedOccurrenceIds: readonly string[];
      diagnostics: readonly FieldParserDiagnostic[];
    }
  | {
      status: 'needs-confirmation';
      identity: string;
      usageCount: number;
      occurrenceIds: readonly string[];
    }
  | { status: 'rejected'; code: string; message: string };

export const FIELD_GRAMMAR_V1 = Object.freeze({
  simpleWhitespace: 'normalize' as const,
  pathPattern: String.raw`[A-Za-z_][A-Za-z0-9_.\[\]]*`,
  attributeEachPathPattern: String.raw`[A-Za-z_][A-Za-z0-9_.]*`,
  partialNamePattern: String.raw`[A-Za-z][A-Za-z0-9_-]*`,
  blocks: ['each', 'if', 'unless', 'with'] as const,
  loopVariables: ['@index', '@number', '@first', '@last'] as const,
  /** Existing modifier names stay data-driven; the parser accepts A-Z/_ names. */
  modifierPattern: String.raw`[A-Z_]+`,
});

export const FIELD_CONTEXT_ROOTS_V1 = Object.freeze([
  'company',
  'contact',
  'custom',
  'system',
  'directors',
  'secretaries',
  'shareholders',
  'contacts',
  'authorizedRepresentatives',
  'signers',
  'selectedDirector',
  'selectedDirectors',
  'selectedShareholder',
  'selectedContact',
  'service',
  'this',
] as const);

const FIELD_CONTEXT_ROOT_SET = new Set<string>(FIELD_CONTEXT_ROOTS_V1);

function encodeIdentityPart(value: string): string {
  return encodeURIComponent(value.trim());
}

/**
 * Stable, structured field identity. It uses owner ID + stored identity/key,
 * never partial/display-name concatenation and never a random load-time UUID.
 */
export function createScopedFieldIdentity(input: {
  scope: FieldOwnerScope;
  key: string;
  persistedId?: string | null;
}): string {
  const scopeId = encodeIdentityPart(input.scope.id);
  const stablePart = input.persistedId?.trim()
    ? `id:${encodeIdentityPart(input.persistedId)}`
    : `key:${encodeIdentityPart(input.key)}`;
  return `field:v1:${input.scope.kind}:${scopeId}:${stablePart}`;
}

/**
 * Preserve value distinctions without appearance-based coercion. In particular
 * an ISO-looking text string stays text and string "false" is not boolean false.
 */
export function classifyFieldValue(input: {
  storedType: string;
  present: boolean;
  value: unknown;
}): TypedFieldValue {
  if (!input.present || input.value === undefined || input.value === null) {
    return { kind: 'missing' };
  }
  if (input.value === '') return { kind: 'empty' };

  switch (input.storedType) {
    case 'text':
      return typeof input.value === 'string'
        ? { kind: 'text', value: input.value }
        : { kind: 'legacy', declaredType: input.storedType, value: input.value };
    case 'textarea':
      return typeof input.value === 'string'
        ? { kind: 'multiline', value: input.value }
        : { kind: 'legacy', declaredType: input.storedType, value: input.value };
    case 'date':
      return typeof input.value === 'string'
        ? { kind: 'date', value: input.value }
        : { kind: 'legacy', declaredType: input.storedType, value: input.value };
    case 'number':
      return typeof input.value === 'string'
        ? { kind: 'number', value: input.value }
        : { kind: 'legacy', declaredType: input.storedType, value: input.value };
    case 'currency':
      return typeof input.value === 'string'
        ? { kind: 'currency', value: input.value }
        : { kind: 'legacy', declaredType: input.storedType, value: input.value };
    case 'boolean':
      return typeof input.value === 'boolean'
        ? { kind: 'boolean', value: input.value }
        : { kind: 'legacy', declaredType: input.storedType, value: input.value };
    default:
      return { kind: 'legacy', declaredType: input.storedType, value: input.value };
  }
}

export type FieldExpressionProbe =
  | {
      status: 'supported';
      kind: FieldGrammarNodeKind;
      normalized: string;
      path?: string;
      modifier?: string;
      partialName?: string;
      block?: 'each' | 'if' | 'unless' | 'with';
    }
  | { status: 'malformed'; code: 'dangling-expression' | 'formatted-expression' | 'invalid-expression' }
  | { status: 'literal' };

const PATH = String.raw`[A-Za-z_][A-Za-z0-9_.\[\]]*`;
const ATTRIBUTE_EACH_PATH = String.raw`[A-Za-z_][A-Za-z0-9_.]*`;
const MODIFIER = String.raw`[A-Z_]+`;

/**
 * F0 executable grammar probe for isolated expressions. F1 must replace the
 * multiple production regex entry points with an HTML-aware implementation of
 * TemplateFieldParser; this helper deliberately does not mutate/resolve HTML.
 */
export function parseFieldExpressionContract(raw: string): FieldExpressionProbe {
  const value = raw.trim();

  const externalModifier = value.match(new RegExp(`^(${MODIFIER})\\(\\s*\\{\\{\\s*(${PATH})\\s*\\}\\}\\s*\\)$`));
  if (externalModifier) {
    return {
      status: 'supported',
      kind: 'modifier',
      normalized: `${externalModifier[1]}({{${externalModifier[2]}}})`,
      modifier: externalModifier[1],
      path: externalModifier[2],
    };
  }

  if (!value.startsWith('{{') && !value.endsWith('}}')) return { status: 'literal' };
  if (!value.startsWith('{{') || !value.endsWith('}}')) {
    return { status: 'malformed', code: 'dangling-expression' };
  }

  const inner = value.slice(2, -2).trim();
  if (/<\/?[A-Za-z][^>]*>/.test(inner)) {
    return { status: 'malformed', code: 'formatted-expression' };
  }
  if (inner === 'else') return { status: 'supported', kind: 'else', normalized: '{{else}}' };
  if (inner.startsWith('!')) return { status: 'supported', kind: 'comment', normalized: `{{${inner}}}` };
  if (/^@(index|number|first|last)$/.test(inner)) {
    return { status: 'supported', kind: 'loop-variable', normalized: `{{${inner}}}` };
  }

  const partial = inner.match(/^>\s*([A-Za-z][A-Za-z0-9_-]*)$/);
  if (partial) {
    return { status: 'supported', kind: 'partial', normalized: `{{> ${partial[1]}}}`, partialName: partial[1] };
  }

  const close = inner.match(/^\/(each|if|unless|with)$/);
  if (close) {
    const block = close[1] as 'each' | 'if' | 'unless' | 'with';
    return { status: 'supported', kind: 'block-close', normalized: `{{/${block}}}`, block };
  }

  const open = inner.match(new RegExp(`^#(each|with)\\s+(${PATH})$`));
  if (open) {
    const block = open[1] as 'each' | 'with';
    return { status: 'supported', kind: 'block-open', normalized: `{{#${block} ${open[2]}}}`, block, path: open[2] };
  }

  const conditional = inner.match(new RegExp(`^#(if|unless)\\s+(${PATH})(?:\\s+(?:==|!=)\\s+.+)?$`));
  if (conditional) {
    const block = conditional[1] as 'if' | 'unless';
    return { status: 'supported', kind: 'block-open', normalized: `{{${inner.replace(/\\s+/g, ' ')}}}`, block, path: conditional[2] };
  }

  const nestedModifier = inner.match(new RegExp(`^(${MODIFIER})\\(\\s*\\{\\{\\s*(${PATH})\\s*\\}\\}\\s*\\)$`));
  if (nestedModifier) {
    return {
      status: 'supported',
      kind: 'modifier',
      normalized: `{{${nestedModifier[1]}({{${nestedModifier[2]}}})}}`,
      modifier: nestedModifier[1],
      path: nestedModifier[2],
    };
  }

  const modifier = inner.match(new RegExp(`^(${MODIFIER})\\(\\s*(${PATH})\\s*\\)$`));
  if (modifier) {
    return {
      status: 'supported',
      kind: 'modifier',
      normalized: `{{${modifier[1]}(${modifier[2]})}}`,
      modifier: modifier[1],
      path: modifier[2],
    };
  }

  if (new RegExp(`^${PATH}$`).test(inner)) {
    return { status: 'supported', kind: 'reference', normalized: `{{${inner}}}`, path: inner };
  }

  return { status: 'malformed', code: 'invalid-expression' };
}

/** F0 proof for the resolver's current attribute-driven each-builder grammar. */
export function parseFieldAttributeExpressionContract(
  attributeName: string,
  rawValue: string,
): FieldExpressionProbe {
  if (attributeName !== 'data-template-each') return { status: 'literal' };
  const value = rawValue.trim();
  if (!new RegExp(`^${ATTRIBUTE_EACH_PATH}$`).test(value)) {
    return { status: 'malformed', code: 'invalid-expression' };
  }
  return {
    status: 'supported',
    kind: 'attribute-each',
    normalized: `data-template-each="${value}"`,
    path: value,
  };
}

function diagnosticSpan(raw: string): FieldSourceSpan {
  return { start: 0, end: raw.length, raw };
}

/**
 * F0 registry-binding diagnostic proof. Built-in/service roots are grammar
 * context, while custom keys bind to the supplied scoped definition registry.
 */
export function diagnoseFieldReferenceContract(input: {
  path: string;
  scope: FieldOwnerScope;
  registry?: readonly LosslessStoredFieldDefinition[];
  knownPaths?: readonly string[];
}): FieldParserDiagnostic | null {
  const root = input.path.split(/[.[]/, 1)[0];
  if (!FIELD_CONTEXT_ROOT_SET.has(root)) {
    return {
      code: 'unknown-root',
      severity: 'error',
      message: `Unknown field root: ${root}`,
      span: diagnosticSpan(input.path),
      scope: input.scope,
    };
  }

  if (input.knownPaths !== undefined) {
    if (input.knownPaths.includes(input.path)) return null;
    return {
      code: 'unknown-field',
      severity: 'error',
      message: `Unknown field key in context: ${input.path}`,
      span: diagnosticSpan(input.path),
      scope: input.scope,
    };
  }

  if (root !== 'custom' || input.registry === undefined) return null;
  const match = input.registry.find((definition) => (
    definition.scope.kind === input.scope.kind
    && definition.scope.id === input.scope.id
    && (definition.resolverPath === input.path || definition.key === input.path)
  ));
  if (match) return null;

  return {
    code: 'unknown-field',
    severity: 'error',
    message: `Unknown field key in scope: ${input.path}`,
    span: diagnosticSpan(input.path),
    scope: input.scope,
  };
}

/** F0 duplicate-key diagnostic proof; scoped duplicates are invalid. */
export function diagnoseFieldRegistryContract(
  registry: readonly LosslessStoredFieldDefinition[],
): FieldParserDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: FieldParserDiagnostic[] = [];

  for (const definition of registry) {
    const normalizedKey = definition.key.trim();
    const scopedKey = `${definition.scope.kind}:${definition.scope.id}:${normalizedKey}`;
    if (!seen.has(scopedKey)) {
      seen.add(scopedKey);
      continue;
    }
    diagnostics.push({
      code: 'duplicate-key-in-scope',
      severity: 'error',
      message: `Duplicate field key in scope: ${normalizedKey}`,
      span: diagnosticSpan(normalizedKey),
      scope: definition.scope,
      fieldIdentity: definition.identity,
    });
  }

  return diagnostics;
}

export interface FieldPartialDependencyFixture {
  id: string;
  name: string;
  content: string;
}

const PARTIAL_DEPENDENCY_PATTERN = /\{\{\s*>\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g;

/**
 * F0 dependency diagnostic proof for nested/missing/circular partial fixtures.
 * It inspects dependency syntax only; it does not expand or resolve content.
 */
export function diagnosePartialDependenciesContract(input: {
  content: string;
  scope: FieldOwnerScope;
  partials: readonly FieldPartialDependencyFixture[];
}): FieldParserDiagnostic[] {
  const byName = new Map(input.partials.map((partial) => [partial.name, partial]));
  const diagnostics: FieldParserDiagnostic[] = [];

  const visit = (content: string, scope: FieldOwnerScope, stack: readonly string[]) => {
    const pattern = new RegExp(PARTIAL_DEPENDENCY_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const partialName = match[1];
      const span: FieldSourceSpan = {
        start: match.index,
        end: match.index + match[0].length,
        raw: match[0],
      };
      if (stack.includes(partialName)) {
        diagnostics.push({
          code: 'circular-partial',
          severity: 'error',
          message: `Circular partial reference: ${[...stack, partialName].join(' -> ')}`,
          span,
          scope,
        });
        continue;
      }

      const dependency = byName.get(partialName);
      if (!dependency) {
        diagnostics.push({
          code: 'missing-partial',
          severity: 'error',
          message: `Missing partial: ${partialName}`,
          span,
          scope,
        });
        continue;
      }

      visit(
        dependency.content,
        { kind: 'partial', id: dependency.id, label: dependency.name },
        [...stack, partialName],
      );
    }
  };

  visit(input.content, input.scope, []);
  return diagnostics;
}
