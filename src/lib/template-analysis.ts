import {
  extractTemplateFieldPaths,
  extractTemplatePartialNames,
  parseTemplateFields,
  type TemplateFieldPartialSource,
} from '@/lib/template-field-parser';
import { loadStoredFieldRegistry } from '@/lib/template-field-registry';
import {
  editorPlaceholdersToStorage,
  storagePlaceholdersToEditor,
} from '@/lib/template-placeholder-storage';
import type { FieldOwnerScope } from '@/lib/template-field-contract';
import type { CustomPlaceholderDefinition, MergedPlaceholder } from '@/types/placeholders';

export interface TemplatePartialLike {
  id?: string;
  name: string;
  displayName?: string | null;
  content?: string | null;
  placeholders?: unknown;
  updatedAt?: string | Date | null;
  version?: number | null;
  deletedAt?: string | Date | null;
}

export interface StoredPlaceholderLike extends Record<string, unknown> {
  id?: string;
  key?: string;
  label?: string;
  type?: string;
  source?: string;
  category?: string;
  path?: string;
  defaultValue?: unknown;
  required?: boolean;
  linkedTo?: string;
  sourcePartial?: string;
  options?: unknown;
  format?: unknown;
}

export interface PartialDependency {
  name: string;
  found: boolean;
  nestedReferences: string[];
  updatedAt?: string | null;
  version?: number | null;
}

export interface TemplateDiagnostics {
  syntaxErrors: string[];
  partialReferences: string[];
  missingPartials: string[];
  circularPartials: string[];
  unknownPlaceholders: string[];
  duplicateCustomKeys: string[];
  unusedCustomFields: string[];
  dependencies: PartialDependency[];
}

export const PARTIAL_REFERENCE_PATTERN =
  String.raw`\{\{(?:>|&gt;|&#62;|&#x3[eE];)\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}`;

/** Compatibility replacement regex; discovery is owned by the F1 parser. */
export const PARTIAL_REFERENCE_REGEX = new RegExp(PARTIAL_REFERENCE_PATTERN, 'g');

const LOOP_ONLY_PLACEHOLDERS = new Set([
  'this.name', 'this.identificationNumber', 'this.nationality', 'this.address',
  'this.role', 'this.shareClass', 'this.numberOfShares', 'this.percentageHeld',
  'this.appointmentDate', 'this.cessationDate', 'this.email', 'this.phone',
  'this.letterAddress', 'name', 'identificationNumber', 'nationality', 'address',
  'role', 'shareClass', 'numberOfShares', 'percentageHeld', 'appointmentDate',
  'cessationDate', 'email', 'phone',
]);

const ANALYSIS_SCOPE: FieldOwnerScope = Object.freeze({
  kind: 'template',
  id: 'template-analysis',
});

function stablePartialOwnerId(partial: TemplatePartialLike): string {
  return partial.id?.trim() || `legacy-partial:${partial.name}`;
}

function toParserPartials(partials: readonly TemplatePartialLike[]): TemplateFieldPartialSource[] {
  return partials.map((partial) => ({
    id: stablePartialOwnerId(partial),
    name: partial.name,
    content: partial.content ?? '',
  }));
}

export function extractPartialReferences(content: string): string[] {
  return extractTemplatePartialNames(parseTemplateFields({
    content,
    scope: ANALYSIS_SCOPE,
  }));
}

export function hasPartialReferences(content: string): boolean {
  return extractPartialReferences(content).length > 0;
}

export function normalizePlaceholderKey(key: string | undefined): string {
  return (key || '').replace(/^custom\./, '').trim();
}

export function toCustomPlaceholderKey(key: string | undefined): string {
  const normalized = normalizePlaceholderKey(key);
  return normalized ? `custom.${normalized}` : '';
}

export function isCustomPlaceholder(value: StoredPlaceholderLike): boolean {
  return (
    value.category === 'custom'
    || value.category === 'Custom'
    || value.source === 'custom'
    || Boolean(value.key?.startsWith('custom.'))
  );
}

export function normalizeStoredPlaceholders(value: unknown): StoredPlaceholderLike[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is StoredPlaceholderLike => Boolean(item && typeof item === 'object' && !Array.isArray(item)),
    );
  }
  if (typeof value === 'string') {
    try {
      return normalizeStoredPlaceholders(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

export function storageFormatToCustomPlaceholders(
  placeholders: StoredPlaceholderLike[],
  options: { scope?: FieldOwnerScope } = {},
): CustomPlaceholderDefinition[] {
  return storagePlaceholdersToEditor(
    placeholders.filter(isCustomPlaceholder),
    { scope: options.scope ?? ANALYSIS_SCOPE },
  ).filter((placeholder) => placeholder.key);
}

export function customPlaceholdersToStorageFormat(
  placeholders: CustomPlaceholderDefinition[],
): StoredPlaceholderLike[] {
  return editorPlaceholdersToStorage(placeholders) as StoredPlaceholderLike[];
}

export function mergeTemplateAndPartialPlaceholders(params: {
  templatePlaceholders: CustomPlaceholderDefinition[];
  templateContent: string;
  partials: TemplatePartialLike[];
  partialPlaceholderLinkings?: Record<string, string>;
}): MergedPlaceholder[] {
  const {
    templatePlaceholders,
    templateContent,
    partials,
    partialPlaceholderLinkings = {},
  } = params;
  const result: MergedPlaceholder[] = templatePlaceholders.map((placeholder) => ({
    ...placeholder,
    source: 'template' as const,
  }));
  const partialByName = new Map(partials.map((partial) => [partial.name, partial]));
  const expanded = new Set<string>();

  const visit = (content: string, stack: readonly string[]): void => {
    for (const partialName of extractPartialReferences(content)) {
      if (stack.includes(partialName)) continue;
      const partial = partialByName.get(partialName);
      if (!partial) continue;
      const ownerId = stablePartialOwnerId(partial);
      if (!expanded.has(ownerId)) {
        expanded.add(ownerId);
        const scope: FieldOwnerScope = {
          kind: 'partial',
          id: ownerId,
          label: partial.displayName || partial.name,
        };
        for (const placeholder of storageFormatToCustomPlaceholders(
          normalizeStoredPlaceholders(partial.placeholders),
          { scope },
        )) {
          const legacyAliasedKey = `${partialName}_${placeholder.key}`;
          result.push({
            ...placeholder,
            source: 'partial',
            sourceName: partialName,
            sourceDisplayName: partial.displayName || partialName,
            sourcePartial: partialName,
            linkedTo: partialPlaceholderLinkings[placeholder.fieldIdentity ?? placeholder.id]
              || partialPlaceholderLinkings[legacyAliasedKey]
              || partialPlaceholderLinkings[placeholder.key]
              || placeholder.linkedTo,
          });
        }
      }
      if (partial.content) visit(partial.content, [...stack, partialName]);
    }
  };

  visit(templateContent, []);
  return result;
}

export function extractTemplatePlaceholderKeys(content: string): string[] {
  const paths = extractTemplateFieldPaths(parseTemplateFields({
    content,
    scope: ANALYSIS_SCOPE,
  }));
  return paths.filter((path) => !LOOP_ONLY_PLACEHOLDERS.has(path));
}

export function validateTemplateSyntax(content: string): string[] {
  const parsed = parseTemplateFields({ content, scope: ANALYSIS_SCOPE });
  return parsed.diagnostics
    .filter((item) => (
      item.code === 'dangling-expression'
      || item.code === 'formatted-expression'
      || item.code === 'invalid-expression'
      || item.code === 'unclosed-block'
      || item.code === 'mismatched-block'
    ))
    .map((item) => `[${item.code}] ${item.message}`);
}

export function analyzeTemplateContent(params: {
  content: string;
  placeholders?: unknown;
  partials?: TemplatePartialLike[];
}): TemplateDiagnostics {
  const { content, placeholders, partials = [] } = params;
  const partialByName = new Map(partials.map((partial) => [partial.name, partial]));
  const partialReferences = extractPartialReferences(content);
  const dependencyNames = collectDependencyNames(content, partialByName);
  const placeholderDefinitions = normalizeStoredPlaceholders(placeholders);
  const registry = loadStoredFieldRegistry({
    scope: ANALYSIS_SCOPE,
    definitions: placeholderDefinitions.filter(isCustomPlaceholder),
  });
  const parsed = parseTemplateFields({
    content,
    scope: ANALYSIS_SCOPE,
    registry: registry.definitions,
    partials: toParserPartials(partials),
  });
  const missingPartials = parsed.diagnostics
    .filter((item) => item.code === 'missing-partial')
    .map((item) => item.message.replace(/^Missing partial:\s*/, ''));
  const circularPartials = parsed.diagnostics
    .filter((item) => item.code === 'circular-partial')
    .map((item) => item.message.replace(/^Circular partial reference:\s*/, ''));
  const duplicateCustomKeys = findDuplicateCustomKeys(placeholderDefinitions);
  const extractedPlaceholders = extractTemplatePlaceholderKeys(content);
  const definedCustomKeys = new Set(
    placeholderDefinitions.filter(isCustomPlaceholder).map((p) => normalizePlaceholderKey(p.key)),
  );
  const unknownPlaceholders = parsed.diagnostics
    .filter((item) => item.code === 'unknown-root' || item.code === 'unknown-field')
    .map((item) => item.span.raw.replace(/^\{\{\s*|\s*\}\}$/g, ''));
  const referencedCustomKeys = new Set(
    extractedPlaceholders
      .filter((key) => key.startsWith('custom.'))
      .map(normalizePlaceholderKey),
  );
  const unusedCustomFields = Array.from(definedCustomKeys)
    .filter((key) => key && !referencedCustomKeys.has(key));
  const syntaxErrors = parsed.diagnostics
    .filter((item) => (
      item.code === 'dangling-expression'
      || item.code === 'formatted-expression'
      || item.code === 'invalid-expression'
      || item.code === 'unclosed-block'
      || item.code === 'mismatched-block'
    ))
    .map((item) => `[${item.code}] ${item.message}`);

  return {
    syntaxErrors,
    partialReferences,
    missingPartials: Array.from(new Set(missingPartials)),
    circularPartials: Array.from(new Set(circularPartials)),
    unknownPlaceholders: Array.from(new Set(unknownPlaceholders)),
    duplicateCustomKeys,
    unusedCustomFields,
    dependencies: Array.from(new Set(dependencyNames)).map((name) => {
      const partial = partialByName.get(name);
      return {
        name,
        found: Boolean(partial),
        nestedReferences: partial?.content ? extractPartialReferences(partial.content) : [],
        updatedAt: partial?.updatedAt ? new Date(partial.updatedAt).toISOString() : null,
        version: partial?.version ?? null,
      };
    }),
  };
}

export interface RequiredPartySelections {
  director: boolean;
  shareholder: boolean;
  contact: boolean;
}

export function getRequiredPartySelections(
  content: string,
  partials: TemplatePartialLike[] = [],
): RequiredPartySelections {
  const byName = new Map(partials.map((partial) => [partial.name, partial]));
  const names = collectDependencyNames(content, byName);
  const combined = [content, ...names.map((name) => byName.get(name)?.content ?? '')].join('\n');
  const keys = extractTemplatePlaceholderKeys(combined);

  return {
    director: keys.some((key) => key === 'selectedDirector' || key.startsWith('selectedDirector.')),
    shareholder: keys.some((key) => key === 'selectedShareholder' || key.startsWith('selectedShareholder.')),
    contact: keys.some((key) => key === 'selectedContact' || key.startsWith('selectedContact.')),
  };
}

export interface TemplatePartyCollections {
  directors: boolean;
  shareholders: boolean;
}

export function getTemplatePartyCollections(
  content: string,
  partials: TemplatePartialLike[] = [],
): TemplatePartyCollections {
  const byName = new Map(partials.map((partial) => [partial.name, partial]));
  const names = collectDependencyNames(content, byName);
  const combined = [content, ...names.map((name) => byName.get(name)?.content ?? '')].join('\n');
  const parsed = parseTemplateFields({ content: combined, scope: ANALYSIS_SCOPE });
  const collections = new Set(
    parsed.nodes
      .filter((node) => node.kind === 'block-open' && node.block === 'each')
      .map((node) => node.path)
      .filter((path): path is string => path === 'directors' || path === 'shareholders'),
  );

  return {
    directors: collections.has('directors'),
    shareholders: collections.has('shareholders'),
  };
}

export function getRequiredLegacyContactSelection(
  content: string,
  partials: TemplatePartialLike[] = [],
): boolean {
  const byName = new Map(partials.map((partial) => [partial.name, partial]));
  const names = collectDependencyNames(content, byName);
  const combined = [content, ...names.map((name) => byName.get(name)?.content ?? '')].join('\n');
  const keys = extractTemplatePlaceholderKeys(combined);

  return keys.some((key) => key === 'contact' || key.startsWith('contact.') || key === 'contacts');
}

function collectDependencyNames(
  content: string,
  partialByName: Map<string, TemplatePartialLike>,
  seen = new Set<string>(),
): string[] {
  const names: string[] = [];
  for (const name of extractPartialReferences(content)) {
    names.push(name);
    if (seen.has(name)) continue;
    seen.add(name);
    const nestedContent = partialByName.get(name)?.content;
    if (nestedContent) names.push(...collectDependencyNames(nestedContent, partialByName, seen));
  }
  return names;
}

function findDuplicateCustomKeys(placeholders: StoredPlaceholderLike[]): string[] {
  const counts = new Map<string, number>();
  for (const placeholder of placeholders.filter(isCustomPlaceholder)) {
    const key = normalizePlaceholderKey(placeholder.key);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}
