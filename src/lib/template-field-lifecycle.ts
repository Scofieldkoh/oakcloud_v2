import {
  loadLosslessStoredFieldDefinition,
  type FieldLifecycleIntent,
  type FieldLifecycleSnapshot,
  type FieldOwnerScope,
  type FieldParserDiagnostic,
  type LosslessStoredFieldDefinition,
} from '@/lib/template-field-contract';
import { parseTemplateFields } from '@/lib/template-field-parser';

/**
 * F2 owns pure field lifecycle semantics only. CORE supplies the editor/history
 * adapter and WORKFLOW persists the returned snapshot atomically.
 */

export interface InsertFieldReferenceIntent {
  kind: 'insert-reference';
  definition: LosslessStoredFieldDefinition;
  at: number;
  expression?: string;
}

export type SemanticFieldLifecycleIntent = FieldLifecycleIntent | InsertFieldReferenceIntent;

export interface FieldLifecycleMetadataChange {
  kind: SemanticFieldLifecycleIntent['kind'];
  identity: string;
  previousIdentity?: string;
  previousKey?: string;
  nextKey?: string;
  changedOccurrenceIds: readonly string[];
}

export type FieldLifecycleMetadataAdapter = (input: {
  metadata: Readonly<Record<string, unknown>>;
  change: FieldLifecycleMetadataChange;
}) => Readonly<Record<string, unknown>>;

export interface SemanticFieldTransaction {
  before: FieldLifecycleSnapshot;
  after: FieldLifecycleSnapshot;
  intent: SemanticFieldLifecycleIntent;
  changedOccurrenceIds: readonly string[];
  diagnostics: readonly FieldParserDiagnostic[];
}

export type ApplyFieldLifecycleTransactionResult =
  | { status: 'applied'; transaction: SemanticFieldTransaction }
  | {
      status: 'needs-confirmation';
      identity: string;
      usageCount: number;
      occurrenceIds: readonly string[];
      linkedFieldIdentities: readonly string[];
    }
  | { status: 'rejected'; code: string; message: string };

export interface ApplyFieldLifecycleTransactionInput {
  scope: FieldOwnerScope;
  snapshot: FieldLifecycleSnapshot;
  intent: SemanticFieldLifecycleIntent;
  confirmReferenceRemoval?: boolean;
  confirmDependentUnlink?: boolean;
  metadataAdapter?: FieldLifecycleMetadataAdapter;
}

function sameScope(left: FieldOwnerScope, right: FieldOwnerScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function definitionPaths(definition: LosslessStoredFieldDefinition): readonly string[] {
  return [...new Set([
    definition.key,
    definition.resolverPath,
    definition.path,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function parseSnapshot(
  scope: FieldOwnerScope,
  snapshot: FieldLifecycleSnapshot,
): ReturnType<typeof parseTemplateFields> {
  const sameScopeDefinitions = snapshot.definitions.filter((definition) => sameScope(definition.scope, scope));
  return parseTemplateFields({
    content: snapshot.content,
    scope,
    registry: sameScopeDefinitions,
    knownPaths: sameScopeDefinitions.flatMap((definition) => definitionPaths(definition)),
  });
}

function findDefinition(
  snapshot: FieldLifecycleSnapshot,
  identity: string,
): LosslessStoredFieldDefinition | undefined {
  return snapshot.definitions.find((definition) => definition.identity === identity);
}

function replaceSpans(
  content: string,
  replacements: readonly { start: number; end: number; value: string }[],
): string {
  let next = content;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    next = `${next.slice(0, replacement.start)}${replacement.value}${next.slice(replacement.end)}`;
  }
  return next;
}

function replacePathInRaw(raw: string, previousPath: string, nextPath: string): string {
  const index = raw.indexOf(previousPath);
  if (index < 0) return raw;
  return `${raw.slice(0, index)}${nextPath}${raw.slice(index + previousPath.length)}`;
}

function replaceDefinition(
  definitions: readonly LosslessStoredFieldDefinition[],
  identity: string,
  replacement: LosslessStoredFieldDefinition,
): readonly LosslessStoredFieldDefinition[] {
  return definitions.map((definition) => definition.identity === identity ? replacement : definition);
}

function migrateLinkedDefinitions(
  definitions: readonly LosslessStoredFieldDefinition[],
  previous: LosslessStoredFieldDefinition,
  next: LosslessStoredFieldDefinition,
): readonly LosslessStoredFieldDefinition[] {
  const scopedLinkMigration = new Map<string, string>([
    [previous.key, next.key],
    [previous.resolverPath, next.resolverPath],
  ]);

  return definitions.map((definition) => {
    if (definition.identity === previous.identity) return next;
    if (!definition.linkedTo) return definition;

    const linkedTo = definition.linkedTo === previous.identity
      ? next.identity
      : sameScope(definition.scope, previous.scope)
        ? scopedLinkMigration.get(definition.linkedTo)
        : undefined;
    if (!linkedTo || linkedTo === definition.linkedTo) return definition;

    return loadLosslessStoredFieldDefinition({
      scope: definition.scope,
      definition: { ...definition.original, linkedTo },
    });
  });
}

function linkedDependentsForDefinition(
  definitions: readonly LosslessStoredFieldDefinition[],
  target: LosslessStoredFieldDefinition,
): readonly LosslessStoredFieldDefinition[] {
  const scopedLinks = new Set([target.key, target.resolverPath]);
  return definitions.filter((definition) => definition.identity !== target.identity
    && definition.linkedTo != null
    && (definition.linkedTo === target.identity
      || (sameScope(definition.scope, target.scope) && scopedLinks.has(definition.linkedTo))));
}

function unlinkDefinition(
  definition: LosslessStoredFieldDefinition,
): LosslessStoredFieldDefinition {
  const original: Record<string, unknown> = { ...definition.original };
  delete original.linkedTo;
  return loadLosslessStoredFieldDefinition({ scope: definition.scope, definition: original });
}

function applyMetadataAdapter(
  snapshot: FieldLifecycleSnapshot,
  adapter: FieldLifecycleMetadataAdapter | undefined,
  change: FieldLifecycleMetadataChange,
): Readonly<Record<string, unknown>> {
  return adapter ? adapter({ metadata: snapshot.dependentMetadata, change }) : snapshot.dependentMetadata;
}

function applied(
  before: FieldLifecycleSnapshot,
  after: FieldLifecycleSnapshot,
  intent: SemanticFieldLifecycleIntent,
  changedOccurrenceIds: readonly string[],
  diagnostics: readonly FieldParserDiagnostic[],
): ApplyFieldLifecycleTransactionResult {
  return {
    status: 'applied',
    transaction: { before, after, intent, changedOccurrenceIds, diagnostics },
  };
}

function validateCreate(
  scope: FieldOwnerScope,
  snapshot: FieldLifecycleSnapshot,
  definition: LosslessStoredFieldDefinition,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!sameScope(scope, definition.scope)) {
    return {
      ok: false,
      code: 'field-scope-mismatch',
      message: 'A field can only be created inside its declared owner scope.',
    };
  }
  if (snapshot.definitions.some((candidate) => candidate.identity === definition.identity)) {
    return {
      ok: false,
      code: 'duplicate-field-identity',
      message: `Field identity already exists: ${definition.identity}`,
    };
  }
  const duplicateKey = snapshot.definitions.some(
    (candidate) => sameScope(candidate.scope, scope) && candidate.key === definition.key,
  );
  if (duplicateKey) {
    return {
      ok: false,
      code: 'duplicate-field-key-in-scope',
      message: `Field key already exists in this scope: ${definition.key}`,
    };
  }
  return { ok: true };
}

function applyCreate(
  input: ApplyFieldLifecycleTransactionInput,
  definition: LosslessStoredFieldDefinition,
): ApplyFieldLifecycleTransactionResult {
  const valid = validateCreate(input.scope, input.snapshot, definition);
  if (!valid.ok) return { status: 'rejected', code: valid.code, message: valid.message };

  const after: FieldLifecycleSnapshot = {
    ...input.snapshot,
    definitions: [...input.snapshot.definitions, definition],
    dependentMetadata: applyMetadataAdapter(input.snapshot, input.metadataAdapter, {
      kind: 'create',
      identity: definition.identity,
      changedOccurrenceIds: [],
    }),
  };
  return applied(input.snapshot, after, input.intent, [], []);
}

function applyRelabel(
  input: ApplyFieldLifecycleTransactionInput,
  identity: string,
  label: string,
): ApplyFieldLifecycleTransactionResult {
  const definition = findDefinition(input.snapshot, identity);
  if (!definition) {
    return { status: 'rejected', code: 'field-not-found', message: `Unknown field identity: ${identity}` };
  }
  if (!sameScope(input.scope, definition.scope)) {
    return { status: 'rejected', code: 'field-scope-mismatch', message: 'Field is owned by another scope.' };
  }
  const next = loadLosslessStoredFieldDefinition({
    scope: definition.scope,
    definition: { ...definition.original, label },
  });
  if (next.identity !== definition.identity) {
    return { status: 'rejected', code: 'identity-instability', message: 'Relabel must preserve field identity.' };
  }

  const after: FieldLifecycleSnapshot = {
    ...input.snapshot,
    definitions: replaceDefinition(input.snapshot.definitions, identity, next),
    dependentMetadata: applyMetadataAdapter(input.snapshot, input.metadataAdapter, {
      kind: 'relabel', identity, changedOccurrenceIds: [],
    }),
  };
  return applied(input.snapshot, after, input.intent, [], []);
}

function applyDefinitionPatch(
  input: ApplyFieldLifecycleTransactionInput,
  identity: string,
  patch: Readonly<Record<string, unknown>>,
): ApplyFieldLifecycleTransactionResult {
  const definition = findDefinition(input.snapshot, identity);
  if (!definition) {
    return { status: 'rejected', code: 'field-not-found', message: `Unknown field identity: ${identity}` };
  }
  if (!sameScope(input.scope, definition.scope)) {
    return { status: 'rejected', code: 'field-scope-mismatch', message: 'Field is owned by another scope.' };
  }
  const structuralKeys = ['id', 'key', 'path'];
  const forbidden = structuralKeys.find((key) => Object.prototype.hasOwnProperty.call(patch, key));
  if (forbidden) {
    return {
      status: 'rejected',
      code: 'structural-field-patch-requires-migration',
      message: `Definition patch cannot change ${forbidden}; use the explicit key/path migration transaction.`,
    };
  }

  let next: LosslessStoredFieldDefinition;
  try {
    next = loadLosslessStoredFieldDefinition({
      scope: definition.scope,
      definition: { ...definition.original, ...patch },
    });
  } catch (error) {
    return {
      status: 'rejected',
      code: 'invalid-field-definition',
      message: error instanceof Error ? error.message : 'Invalid field definition patch.',
    };
  }
  if (next.identity !== definition.identity) {
    return { status: 'rejected', code: 'identity-instability', message: 'Definition patch must preserve field identity.' };
  }

  const after: FieldLifecycleSnapshot = {
    ...input.snapshot,
    definitions: replaceDefinition(input.snapshot.definitions, identity, next),
    dependentMetadata: applyMetadataAdapter(input.snapshot, input.metadataAdapter, {
      kind: 'change-definition', identity, changedOccurrenceIds: [],
    }),
  };
  return applied(input.snapshot, after, input.intent, [], []);
}

function applyKeyMigration(
  input: ApplyFieldLifecycleTransactionInput,
  identity: string,
  nextKey: string,
): ApplyFieldLifecycleTransactionResult {
  const definition = findDefinition(input.snapshot, identity);
  if (!definition) {
    return { status: 'rejected', code: 'field-not-found', message: `Unknown field identity: ${identity}` };
  }
  if (!sameScope(input.scope, definition.scope)) {
    return { status: 'rejected', code: 'field-scope-mismatch', message: 'Field is owned by another scope.' };
  }
  const normalizedKey = nextKey.trim();
  if (!normalizedKey) {
    return { status: 'rejected', code: 'invalid-field-key', message: 'Field key cannot be empty.' };
  }
  if (input.snapshot.definitions.some(
    (candidate) => candidate.identity !== identity
      && sameScope(candidate.scope, definition.scope)
      && candidate.key === normalizedKey,
  )) {
    return {
      status: 'rejected',
      code: 'duplicate-field-key-in-scope',
      message: `Field key already exists in this scope: ${normalizedKey}`,
    };
  }

  const original: Record<string, unknown> = { ...definition.original, key: normalizedKey };
  if (definition.path === definition.key) original.path = normalizedKey;

  let next: LosslessStoredFieldDefinition;
  try {
    next = loadLosslessStoredFieldDefinition({ scope: definition.scope, definition: original });
  } catch (error) {
    return {
      status: 'rejected',
      code: 'invalid-field-definition',
      message: error instanceof Error ? error.message : 'Invalid key migration.',
    };
  }

  const parsed = parseSnapshot(input.scope, input.snapshot);
  const oldPaths = new Set(definitionPaths(definition));
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const changedOccurrenceIds: string[] = [];
  for (const node of parsed.nodes) {
    if (!node.path || !oldPaths.has(node.path)) continue;
    let replacementPath = node.path;
    if (node.path === definition.key) replacementPath = normalizedKey;
    if (definition.path === definition.key && node.path === definition.path) replacementPath = normalizedKey;
    if (replacementPath === node.path) continue;
    replacements.push({
      start: node.span.start,
      end: node.span.end,
      value: replacePathInRaw(node.span.raw, node.path, replacementPath),
    });
    changedOccurrenceIds.push(node.occurrenceId);
  }

  const afterDefinitions = migrateLinkedDefinitions(input.snapshot.definitions, definition, next);
  const after: FieldLifecycleSnapshot = {
    content: replaceSpans(input.snapshot.content, replacements),
    definitions: afterDefinitions,
    dependentMetadata: applyMetadataAdapter(input.snapshot, input.metadataAdapter, {
      kind: 'migrate-key',
      identity: next.identity,
      previousIdentity: definition.identity,
      previousKey: definition.key,
      nextKey: normalizedKey,
      changedOccurrenceIds,
    }),
  };

  return applied(input.snapshot, after, input.intent, changedOccurrenceIds, parsed.diagnostics);
}

function applyDelete(
  input: ApplyFieldLifecycleTransactionInput,
  identity: string,
  referenceAction: 'remove-references' | 'keep-unresolved',
): ApplyFieldLifecycleTransactionResult {
  const definition = findDefinition(input.snapshot, identity);
  if (!definition) {
    return { status: 'rejected', code: 'field-not-found', message: `Unknown field identity: ${identity}` };
  }
  if (!sameScope(input.scope, definition.scope)) {
    return { status: 'rejected', code: 'field-scope-mismatch', message: 'Field is owned by another scope.' };
  }

  const parsed = parseSnapshot(input.scope, input.snapshot);
  const paths = new Set(definitionPaths(definition));
  const usages = parsed.nodes.filter((node) => Boolean(node.path && paths.has(node.path)));
  const occurrenceIds = usages.map((node) => node.occurrenceId);
  const linkedDependents = linkedDependentsForDefinition(input.snapshot.definitions, definition);
  const referenceConfirmationRequired = referenceAction === 'remove-references'
    && usages.length > 0
    && !input.confirmReferenceRemoval;
  const dependentUnlinkConfirmationRequired = linkedDependents.length > 0
    && !input.confirmDependentUnlink;

  if (referenceConfirmationRequired || dependentUnlinkConfirmationRequired) {
    return {
      status: 'needs-confirmation',
      identity,
      usageCount: usages.length,
      occurrenceIds,
      linkedFieldIdentities: linkedDependents.map((candidate) => candidate.identity),
    };
  }

  const linkedIdentities = new Set(linkedDependents.map((candidate) => candidate.identity));
  const content = referenceAction === 'remove-references'
    ? replaceSpans(input.snapshot.content, usages.map((node) => ({
        start: node.span.start,
        end: node.span.end,
        value: '',
      })))
    : input.snapshot.content;
  const after: FieldLifecycleSnapshot = {
    content,
    definitions: input.snapshot.definitions
      .filter((candidate) => candidate.identity !== identity)
      .map((candidate) => linkedIdentities.has(candidate.identity) ? unlinkDefinition(candidate) : candidate),
    dependentMetadata: applyMetadataAdapter(input.snapshot, input.metadataAdapter, {
      kind: 'delete', identity, changedOccurrenceIds: occurrenceIds,
    }),
  };

  return applied(input.snapshot, after, input.intent, occurrenceIds, parsed.diagnostics);
}

function applyInsertReference(
  input: ApplyFieldLifecycleTransactionInput,
  intent: InsertFieldReferenceIntent,
): ApplyFieldLifecycleTransactionResult {
  if (!Number.isInteger(intent.at) || intent.at < 0 || intent.at > input.snapshot.content.length) {
    return { status: 'rejected', code: 'invalid-insert-position', message: 'Field insertion offset is outside canonical content.' };
  }
  if (!sameScope(input.scope, intent.definition.scope)) {
    return { status: 'rejected', code: 'field-scope-mismatch', message: 'Inserted field is owned by another scope.' };
  }

  const existing = findDefinition(input.snapshot, intent.definition.identity);
  if (!existing) {
    const valid = validateCreate(input.scope, input.snapshot, intent.definition);
    if (!valid.ok) return { status: 'rejected', code: valid.code, message: valid.message };
  } else if (existing.key !== intent.definition.key || existing.storedType !== intent.definition.storedType) {
    return {
      status: 'rejected',
      code: 'field-definition-conflict',
      message: 'Existing scoped field identity does not match the inserted definition.',
    };
  }

  const expression = intent.expression ?? `{{${intent.definition.resolverPath}}}`;
  const probe = parseTemplateFields({
    content: expression,
    scope: input.scope,
    registry: [intent.definition],
    knownPaths: definitionPaths(intent.definition),
  });
  const referenceNodes = probe.nodes.filter(
    (node) => (node.kind === 'reference' || node.kind === 'modifier')
      && node.path != null
      && definitionPaths(intent.definition).includes(node.path),
  );
  if (probe.diagnostics.some((diagnostic) => diagnostic.severity === 'error') || referenceNodes.length !== 1) {
    return {
      status: 'rejected',
      code: 'invalid-field-reference-expression',
      message: 'Inserted expression must contain exactly one valid reference to the scoped field.',
    };
  }

  const nextContent = `${input.snapshot.content.slice(0, intent.at)}${expression}${input.snapshot.content.slice(intent.at)}`;
  const definitions = existing
    ? input.snapshot.definitions
    : [...input.snapshot.definitions, intent.definition];
  const nextSnapshot: FieldLifecycleSnapshot = {
    content: nextContent,
    definitions,
    dependentMetadata: input.snapshot.dependentMetadata,
  };
  const parsed = parseSnapshot(input.scope, nextSnapshot);
  const inserted = parsed.nodes.find(
    (node) => node.span.start === intent.at
      && node.path != null
      && definitionPaths(intent.definition).includes(node.path),
  );
  const changedOccurrenceIds = inserted ? [inserted.occurrenceId] : [];
  const after: FieldLifecycleSnapshot = {
    ...nextSnapshot,
    dependentMetadata: applyMetadataAdapter(input.snapshot, input.metadataAdapter, {
      kind: 'insert-reference',
      identity: intent.definition.identity,
      changedOccurrenceIds,
    }),
  };

  return applied(input.snapshot, after, input.intent, changedOccurrenceIds, parsed.diagnostics);
}

/**
 * Pure, all-or-nothing lifecycle operation. Rejected/confirmation results carry
 * no mutated snapshot; CORE can therefore put only an applied transaction into
 * the editor undo stack, and WORKFLOW can persist the returned `after` snapshot
 * in one compare-and-swap write.
 */
export function applyFieldLifecycleTransaction(
  input: ApplyFieldLifecycleTransactionInput,
): ApplyFieldLifecycleTransactionResult {
  switch (input.intent.kind) {
    case 'create':
      return applyCreate(input, input.intent.definition);
    case 'relabel':
      return applyRelabel(input, input.intent.identity, input.intent.label);
    case 'migrate-key':
      return applyKeyMigration(input, input.intent.identity, input.intent.nextKey);
    case 'change-definition':
      return applyDefinitionPatch(input, input.intent.identity, input.intent.patch);
    case 'delete':
      return applyDelete(input, input.intent.identity, input.intent.referenceAction);
    case 'insert-reference':
      return applyInsertReference(input, input.intent);
  }
}
