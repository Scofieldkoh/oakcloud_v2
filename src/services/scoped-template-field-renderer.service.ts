import { randomUUID } from 'node:crypto';
import {
  C06_TRUSTED_RICH_ORIGINS,
  createTrustedRichContentFragment,
} from '@/lib/a4-content-policy';
import type {
  FieldOwnerScope,
  LosslessStoredFieldDefinition,
} from '@/lib/template-field-contract';
import { parseTemplateFields } from '@/lib/template-field-parser';
import { loadStoredFieldRegistry } from '@/lib/template-field-registry';
import {
  adaptLegacyFlattenedFieldValues,
  renderResolvedFieldFragment,
  resolveScopedTemplateFieldSource,
  type ScopedFieldResolutionDiagnostic,
  type ScopedFieldValueBinding,
  type ScopedFieldValueContext,
} from '@/lib/template-field-resolution';
import {
  normalizeStoredFieldDefinitionInput,
} from '@/lib/document-editor/template-field-workflow';
import {
  resolvePlaceholders,
  type PlaceholderContext,
} from '@/lib/placeholder-resolver';
import { sanitizeTrustedA4RichContent } from '@/services/a4-content-sanitizer.service';

export const W3_FIELD_RESOLUTION_POLICY = 'scoped-escaped-v1' as const;

export interface ScopedTemplatePartialInput {
  id: string;
  name: string;
  displayName?: string | null;
  content: string;
  placeholders?: unknown;
}

export interface RenderScopedTemplateFieldsInput {
  templateScope: FieldOwnerScope;
  content: string;
  templatePlaceholders?: unknown;
  partials: readonly ScopedTemplatePartialInput[];
  customData: Readonly<Record<string, unknown>>;
  context: PlaceholderContext;
  valueContext?: Pick<ScopedFieldValueContext, 'kind' | 'id'>;
  missingPlaceholder?: 'keep' | 'blank' | 'highlight';
}

export interface RenderScopedTemplateFieldsResult {
  resolved: string;
  missing: string[];
  missingPartials: string[];
  fieldDiagnostics: readonly ScopedFieldResolutionDiagnostic[];
  fieldParserDiagnostics: readonly ReturnType<typeof parseTemplateFields>['diagnostics'][number][];
  fieldPolicy: typeof W3_FIELD_RESOLUTION_POLICY;
}

interface ScopedSource {
  scope: FieldOwnerScope;
  content: string;
  definitions: readonly LosslessStoredFieldDefinition[];
  partialName?: string;
}

interface ProtectedFragmentRegistry {
  nonce: string;
  next: number;
  byToken: Map<string, string>;
}

function customDefinitions(
  scope: FieldOwnerScope,
  rawDefinitions: unknown,
): readonly LosslessStoredFieldDefinition[] {
  const loaded = loadStoredFieldRegistry({
    scope,
    definitions: normalizeStoredFieldDefinitionInput(rawDefinitions),
  });
  return loaded.definitions.filter((definition) => (
    definition.source === 'custom'
    || definition.key.startsWith('custom.')
    || definition.resolverPath.startsWith('custom.')
  ));
}

function definitionPaths(definition: LosslessStoredFieldDefinition): readonly string[] {
  return [...new Set([
    definition.resolverPath,
    definition.key,
    definition.path,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function baseKey(definition: LosslessStoredFieldDefinition): string {
  return definition.key.replace(/^custom\./, '');
}

function replaceSpans(
  source: string,
  replacements: readonly { start: number; end: number; value: string }[],
): string {
  let output = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
  }
  return output;
}

function newProtectedToken(registry: ProtectedFragmentRegistry): string {
  const token = `__OAK_A4_W3_${registry.nonce}_${registry.next++}__`;
  return token;
}

function protectResolvedMarker(
  content: string,
  startMarker: string,
  endMarker: string,
  fragments: ProtectedFragmentRegistry,
): string {
  const start = content.indexOf(startMarker);
  if (start < 0) return content;
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return content;
  const token = newProtectedToken(fragments);
  const fragment = content.slice(start + startMarker.length, end);
  fragments.byToken.set(token, fragment);
  return `${content.slice(0, start)}${token}${content.slice(end + endMarker.length)}`;
}

function restoreProtectedFragments(
  content: string,
  fragments: ProtectedFragmentRegistry,
): string {
  let output = content;
  for (const [token, fragment] of fragments.byToken) {
    output = output.split(token).join(fragment);
  }
  return output;
}

function renderTrustedPartialSource(content: string): string {
  const rendered = renderResolvedFieldFragment(
    createTrustedRichContentFragment({
      html: content,
      origin: C06_TRUSTED_RICH_ORIGINS.templatePartial,
    }),
    { sanitizeTrustedRich: sanitizeTrustedA4RichContent },
  );
  if (rendered.status === 'blocked') throw new Error(rendered.diagnostic.message);
  return rendered.html;
}

function findDefinition(
  definitions: readonly LosslessStoredFieldDefinition[],
  candidate: string,
): LosslessStoredFieldDefinition | undefined {
  return definitions.find((definition) => (
    definition.identity === candidate
    || definition.key === candidate
    || definition.resolverPath === candidate
    || baseKey(definition) === candidate.replace(/^custom\./, '')
  ));
}

function buildCompatibilityMaps(input: {
  templateRawDefinitions: readonly Readonly<Record<string, unknown>>[];
  templateDefinitions: readonly LosslessStoredFieldDefinition[];
  partials: readonly ScopedTemplatePartialInput[];
  partialDefinitions: ReadonlyMap<string, readonly LosslessStoredFieldDefinition[]>;
}): {
  explicitLegacyBindings: Record<string, string>;
  bindings: ScopedFieldValueBinding[];
} {
  const explicitLegacyBindings: Record<string, string> = {};
  const bindings: ScopedFieldValueBinding[] = [];

  for (const definition of input.templateDefinitions) {
    explicitLegacyBindings[baseKey(definition)] = definition.identity;
    explicitLegacyBindings[definition.key] = definition.identity;
  }
  for (const partial of input.partials) {
    for (const definition of input.partialDefinitions.get(partial.id) ?? []) {
      explicitLegacyBindings[`${partial.name}_${baseKey(definition)}`] = definition.identity;
    }
  }

  const partialByName = new Map(input.partials.map((partial) => [partial.name, partial]));
  const bindingKeys = new Set<string>();
  const addBinding = (
    target: LosslessStoredFieldDefinition | undefined,
    linkedTo: unknown,
  ) => {
    if (!target || typeof linkedTo !== 'string' || linkedTo.length === 0) return;
    const source = findDefinition(input.templateDefinitions, linkedTo);
    if (!source) return;
    const key = `${target.identity}\u0000${source.identity}`;
    if (bindingKeys.has(key)) return;
    bindingKeys.add(key);
    bindings.push({ targetIdentity: target.identity, sourceIdentity: source.identity });
  };

  // Existing template-carried partial linking metadata remains compatibility
  // input only. It is converted into explicit structured identity bindings and
  // never used as flattened identity itself. Older editor snapshots may have
  // renamed a colliding copied key (for example child_note) while preserving
  // the canonical partial id/path. Prefer those stable identities first so an
  // intentional link is not lost merely because the display key was renamed.
  for (const raw of input.templateRawDefinitions) {
    if (typeof raw.sourcePartial !== 'string') continue;
    const partial = partialByName.get(raw.sourcePartial);
    if (!partial) continue;
    const definitions = input.partialDefinitions.get(partial.id) ?? [];
    const stableCandidates = [raw.id, raw.path, raw.key]
      .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
    let target: LosslessStoredFieldDefinition | undefined;
    for (const candidate of stableCandidates) {
      target = findDefinition(definitions, candidate);
      if (target) break;
    }
    if (!target && typeof raw.key === 'string') {
      const rawKey = raw.key.replace(/^custom\./, '');
      const legacyPrefix = `${partial.name}_`;
      if (rawKey.startsWith(legacyPrefix)) {
        target = findDefinition(definitions, rawKey.slice(legacyPrefix.length));
      }
    }
    addBinding(target, raw.linkedTo);
  }

  // A canonical partial may also carry an intentional link itself.
  for (const partial of input.partials) {
    const definitions = input.partialDefinitions.get(partial.id) ?? [];
    for (const definition of definitions) addBinding(definition, definition.original.linkedTo);
  }

  return { explicitLegacyBindings, bindings };
}

export function resolveScopedFieldValueContext(input: {
  templateScope: FieldOwnerScope;
  templatePlaceholders?: unknown;
  partials: readonly ScopedTemplatePartialInput[];
  customData: Readonly<Record<string, unknown>>;
  valueContext?: Pick<ScopedFieldValueContext, 'kind' | 'id'>;
}): {
  templateDefinitions: readonly LosslessStoredFieldDefinition[];
  partialDefinitions: ReadonlyMap<string, readonly LosslessStoredFieldDefinition[]>;
  allDefinitions: readonly LosslessStoredFieldDefinition[];
  context: ScopedFieldValueContext;
  bindings: readonly ScopedFieldValueBinding[];
  diagnostics: readonly ScopedFieldResolutionDiagnostic[];
} {
  const templateRawDefinitions = normalizeStoredFieldDefinitionInput(input.templatePlaceholders);
  const templateDefinitions = customDefinitions(input.templateScope, templateRawDefinitions)
    .filter((definition) => typeof definition.original.sourcePartial !== 'string');
  const partialDefinitions = new Map<string, readonly LosslessStoredFieldDefinition[]>();
  for (const partial of input.partials) {
    partialDefinitions.set(partial.id, customDefinitions({
      kind: 'partial',
      id: partial.id,
      label: partial.displayName ?? partial.name,
    }, partial.placeholders));
  }
  const allDefinitions = [
    ...templateDefinitions,
    ...Array.from(partialDefinitions.values()).flat(),
  ];
  const compatibility = buildCompatibilityMaps({
    templateRawDefinitions,
    templateDefinitions,
    partials: input.partials,
    partialDefinitions,
  });
  const legacy = adaptLegacyFlattenedFieldValues({
    definitions: allDefinitions,
    values: input.customData,
    explicitBindings: compatibility.explicitLegacyBindings,
  });
  return {
    templateDefinitions,
    partialDefinitions,
    allDefinitions,
    context: {
      kind: input.valueContext?.kind ?? 'global',
      ...(input.valueContext?.id ? { id: input.valueContext.id } : {}),
      valuesByIdentity: legacy.valuesByIdentity,
    },
    bindings: compatibility.bindings,
    diagnostics: legacy.diagnostics,
  };
}

/**
 * W3 integration boundary for F2 scoped fields and recursive partials.
 *
 * Custom field values are resolved by F2 and immediately hidden behind inert
 * sentinels. Trusted partial template HTML is sanitized and composed while the
 * sentinels are still protected. The legacy resolver then processes only the
 * remaining built-in/company/loop grammar once. User field output is restored
 * afterwards, so braces or markup inside ordinary field values can never be
 * interpreted as a second template pass.
 */
export function renderScopedTemplateFields(
  input: RenderScopedTemplateFieldsInput,
): RenderScopedTemplateFieldsResult {
  const fieldState = resolveScopedFieldValueContext(input);
  const partialByName = new Map(input.partials.map((partial) => [partial.name, partial]));
  const fragments: ProtectedFragmentRegistry = {
    nonce: randomUUID().replace(/-/g, ''),
    next: 0,
    byToken: new Map(),
  };
  const fieldDiagnostics: ScopedFieldResolutionDiagnostic[] = [...fieldState.diagnostics];
  const fieldParserDiagnostics: ReturnType<typeof parseTemplateFields>['diagnostics'][number][] = [];

  const protectSource = (source: ScopedSource, stack: readonly string[]): string => {
    const parsed = parseTemplateFields({
      content: source.content,
      scope: source.scope,
      registry: source.definitions,
      partials: input.partials.map((partial) => ({
        id: partial.id,
        name: partial.name,
        content: partial.content,
      })),
    });
    fieldParserDiagnostics.push(...parsed.diagnostics);
    const ownPaths = new Set(source.definitions.flatMap(definitionPaths));
    const fieldMarkers: Array<{ startMarker: string; endMarker: string }> = [];
    const replacements: Array<{ start: number; end: number; value: string }> = [];

    for (const node of parsed.nodes) {
      if (node.kind === 'partial' && node.partialName) {
        const partial = partialByName.get(node.partialName);
        if (!partial || stack.includes(partial.id)) continue;
        const definitions = fieldState.partialDefinitions.get(partial.id) ?? [];
        const partialContent = renderTrustedPartialSource(partial.content);
        replacements.push({
          start: node.span.start,
          end: node.span.end,
          value: protectSource({
            scope: {
              kind: 'partial',
              id: partial.id,
              label: partial.displayName ?? partial.name,
            },
            content: partialContent,
            definitions,
            partialName: partial.name,
          }, [...stack, partial.id]),
        });
        continue;
      }

      if (
        (node.kind === 'reference' || node.kind === 'modifier')
        && node.path
        && ownPaths.has(node.path)
      ) {
        const index = fieldMarkers.length;
        const startMarker = `__OAK_A4_FIELD_START_${fragments.nonce}_${index}__`;
        const endMarker = `__OAK_A4_FIELD_END_${fragments.nonce}_${index}__`;
        fieldMarkers.push({ startMarker, endMarker });
        replacements.push({
          start: node.span.start,
          end: node.span.end,
          value: `${startMarker}${node.span.raw}${endMarker}`,
        });
      }
    }

    const composed = replaceSpans(source.content, replacements);
    const scoped = resolveScopedTemplateFieldSource({
      source: { scope: source.scope, content: composed, definitions: source.definitions },
      allDefinitions: fieldState.allDefinitions,
      context: fieldState.context,
      bindings: fieldState.bindings,
      missingValue: input.missingPlaceholder === 'blank' ? 'blank' : 'keep',
    });
    fieldDiagnostics.push(...scoped.diagnostics);
    fieldParserDiagnostics.push(...scoped.parserDiagnostics);

    let protectedContent = scoped.resolved;
    for (const marker of fieldMarkers) {
      protectedContent = protectResolvedMarker(
        protectedContent,
        marker.startMarker,
        marker.endMarker,
        fragments,
      );
    }
    return protectedContent;
  };

  const protectedTemplate = protectSource({
    scope: input.templateScope,
    content: input.content,
    definitions: fieldState.templateDefinitions,
  }, []);
  const legacy = resolvePlaceholders(protectedTemplate, input.context, {
    missingPlaceholder: input.missingPlaceholder ?? 'highlight',
    partialsMap: new Map(),
  });
  const resolved = restoreProtectedFragments(legacy.resolved, fragments);
  const scopedMissing = fieldDiagnostics
    .filter((diagnostic) => (
      diagnostic.code === 'missing-scoped-value'
      || diagnostic.code === 'required-scoped-value-missing'
    ))
    .map((diagnostic) => diagnostic.fieldIdentity ?? diagnostic.message);

  return {
    resolved,
    missing: [...new Set([...legacy.missing, ...scopedMissing])],
    missingPartials: legacy.missingPartials,
    fieldDiagnostics,
    fieldParserDiagnostics,
    fieldPolicy: W3_FIELD_RESOLUTION_POLICY,
  };
}
