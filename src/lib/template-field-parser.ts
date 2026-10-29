import {
  FIELD_CONTEXT_ROOTS_V1,
  diagnoseFieldReferenceContract,
  parseFieldAttributeExpressionContract,
  parseFieldExpressionContract,
  type FieldGrammarNode,
  type FieldOwnerScope,
  type FieldParserDiagnostic,
  type FieldSourceSpan,
  type LosslessStoredFieldDefinition,
  type ParsedTemplateFieldSyntax,
} from '@/lib/template-field-contract';

export interface TemplateFieldPartialSource {
  id: string;
  name: string;
  content: string;
}

export interface LegacyFieldBindingCandidate {
  path: string;
  fieldIdentities: readonly string[];
}

export interface ParseTemplateFieldsInput {
  content: string;
  scope: FieldOwnerScope;
  registry?: readonly LosslessStoredFieldDefinition[];
  knownPaths?: readonly string[];
  partials?: readonly TemplateFieldPartialSource[];
  legacyBindings?: readonly LegacyFieldBindingCandidate[];
}

const PATH = String.raw`[A-Za-z_][A-Za-z0-9_.\[\]]*`;
const FIELD_CONTEXT_ROOT_SET = new Set<string>(FIELD_CONTEXT_ROOTS_V1);
const EXTERNAL_MODIFIER_PATTERN = new RegExp(
  String.raw`([A-Z_]+)\(\s*(?:<[^>]*>\s*)*\{\{\s*(${PATH})\s*\}\}(?:\s*<[^>]*>)*\s*\)`,
  'g',
);
const ATTRIBUTE_EACH_PATTERN = /\bdata-template-each\s*=\s*(["'])([\s\S]*?)\1/gi;

interface ExternalModifierMatch {
  start: number;
  end: number;
  modifier: string;
  path: string;
  raw: string;
}

function sourceSpan(source: string, start: number, end: number): FieldSourceSpan {
  return { start, end, raw: source.slice(start, end) };
}

function occurrenceId(scope: FieldOwnerScope, node: Pick<FieldGrammarNode, 'kind' | 'span'>): string {
  return [
    'field-occurrence:v1',
    scope.kind,
    encodeURIComponent(scope.id),
    `${node.span.start}-${node.span.end}`,
    node.kind,
  ].join(':');
}

function diagnostic(
  code: FieldParserDiagnostic['code'],
  message: string,
  span: FieldSourceSpan,
  scope: FieldOwnerScope,
  severity: FieldParserDiagnostic['severity'] = 'error',
): FieldParserDiagnostic {
  return { code, severity, message, span, scope };
}

function decodePartialOperator(raw: string): string {
  return raw.replace(/^(\{\{\s*)(?:&gt;|&#62;|&#x3e;)/i, '$1>');
}

function findMustacheEnd(source: string, start: number): number | null {
  let depth = 1;
  let index = start + 2;
  while (index < source.length) {
    if (source.startsWith('{{', index)) {
      depth += 1;
      index += 2;
      continue;
    }
    if (source.startsWith('}}', index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }
  return null;
}

function collectExternalModifiers(source: string): ExternalModifierMatch[] {
  const matches: ExternalModifierMatch[] = [];
  const pattern = new RegExp(EXTERNAL_MODIFIER_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      modifier: match[1],
      path: match[2],
      raw: match[0],
    });
  }
  return matches;
}

function containingExternalModifier(
  offset: number,
  modifiers: readonly ExternalModifierMatch[],
): ExternalModifierMatch | undefined {
  return modifiers.find((candidate) => offset >= candidate.start && offset < candidate.end);
}

function createNode(
  scope: FieldOwnerScope,
  span: FieldSourceSpan,
  probe: Extract<ReturnType<typeof parseFieldExpressionContract>, { status: 'supported' }>,
): FieldGrammarNode {
  const node: FieldGrammarNode = {
    kind: probe.kind,
    span,
    expression: probe.normalized,
    scope,
    occurrenceId: '',
    ...(probe.path ? { path: probe.path } : {}),
    ...(probe.modifier ? { modifier: probe.modifier } : {}),
    ...(probe.partialName ? { partialName: probe.partialName } : {}),
    ...(probe.block ? { block: probe.block } : {}),
  };
  node.occurrenceId = occurrenceId(scope, node);
  return node;
}

function createExternalModifierNode(
  source: string,
  scope: FieldOwnerScope,
  match: ExternalModifierMatch,
): FieldGrammarNode {
  const span = sourceSpan(source, match.start, match.end);
  const node: FieldGrammarNode = {
    kind: 'modifier',
    span,
    expression: `${match.modifier}({{${match.path}}})`,
    path: match.path,
    modifier: match.modifier,
    scope,
    occurrenceId: '',
  };
  node.occurrenceId = occurrenceId(scope, node);
  return node;
}

function createAttributeEachNodes(source: string, scope: FieldOwnerScope): {
  nodes: FieldGrammarNode[];
  diagnostics: FieldParserDiagnostic[];
} {
  const nodes: FieldGrammarNode[] = [];
  const diagnostics: FieldParserDiagnostic[] = [];
  const pattern = new RegExp(ATTRIBUTE_EACH_PATTERN.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const probe = parseFieldAttributeExpressionContract('data-template-each', match[2]);
    const span = sourceSpan(source, match.index, match.index + match[0].length);
    if (probe.status === 'supported') {
      const node: FieldGrammarNode = {
        kind: 'attribute-each',
        span,
        expression: probe.normalized,
        path: probe.path,
        scope,
        occurrenceId: '',
      };
      node.occurrenceId = occurrenceId(scope, node);
      nodes.push(node);
    } else if (probe.status === 'malformed') {
      diagnostics.push(diagnostic(
        probe.code,
        `Invalid data-template-each expression: ${match[2]}`,
        span,
        scope,
      ));
    }
  }
  return { nodes, diagnostics };
}

function isContextualPath(path: string, blockStack: readonly FieldGrammarNode[]): boolean {
  if (path === 'this' || path.startsWith('this.')) return true;
  const root = path.split(/[.[]/, 1)[0];
  const insideContext = blockStack.some((node) => node.block === 'each' || node.block === 'with');
  return insideContext && !path.includes('.') && !path.includes('[') && root.length > 0;
}

function recoverMismatchedBlock(stack: FieldGrammarNode[], closing: FieldGrammarNode): void {
  const matchingIndex = stack.map((entry) => entry.block).lastIndexOf(closing.block);
  if (matchingIndex >= 0) {
    stack.splice(matchingIndex);
    return;
  }
  stack.pop();
}

function addBindingDiagnostics(
  nodes: readonly FieldGrammarNode[],
  diagnostics: FieldParserDiagnostic[],
  input: ParseTemplateFieldsInput,
): void {
  const blockStack: FieldGrammarNode[] = [];
  const legacyByPath = new Map(
    (input.legacyBindings ?? []).map((candidate) => [candidate.path, candidate.fieldIdentities]),
  );

  for (const node of nodes) {
    if (node.kind === 'block-close') {
      const opening = blockStack.at(-1);
      if (!opening) {
        diagnostics.push(diagnostic(
          'mismatched-block',
          `Found {{/${node.block}}} without a matching opener.`,
          node.span,
          input.scope,
        ));
      } else if (opening.block !== node.block) {
        diagnostics.push(diagnostic(
          'mismatched-block',
          `{{/${node.block}}} closes {{#${opening.block}}}; close {{/${opening.block}}} first.`,
          node.span,
          input.scope,
        ));
        recoverMismatchedBlock(blockStack, node);
      } else {
        blockStack.pop();
      }
      continue;
    }

    if (node.kind === 'else') {
      const opening = blockStack.at(-1);
      if (!opening || (opening.block !== 'if' && opening.block !== 'unless')) {
        diagnostics.push(diagnostic(
          'invalid-expression',
          '{{else}} is only valid inside an if/unless block.',
          node.span,
          input.scope,
        ));
      }
      continue;
    }

    if (node.path && !isContextualPath(node.path, blockStack)) {
      const root = node.path.split(/[.[]/, 1)[0];
      const explicitlyKnown = input.knownPaths?.includes(node.path) ?? false;
      if (!explicitlyKnown) {
        const knownPaths = root === 'custom' ? input.knownPaths : undefined;
        const referenceDiagnostic = diagnoseFieldReferenceContract({
          path: node.path,
          scope: input.scope,
          registry: input.registry,
          knownPaths,
        });
        if (!FIELD_CONTEXT_ROOT_SET.has(root) && referenceDiagnostic?.code !== 'unknown-root') {
          diagnostics.push(diagnostic(
            'unknown-root',
            `Unknown field root: ${root}`,
            node.span,
            input.scope,
          ));
        } else if (referenceDiagnostic) {
          diagnostics.push({ ...referenceDiagnostic, span: node.span });
        }
      }

      const identities = legacyByPath.get(node.path);
      if (identities && identities.length > 1) {
        diagnostics.push({
          code: 'ambiguous-legacy-binding',
          severity: 'error',
          message: `Legacy value ${node.path} matches multiple scoped fields; an explicit binding is required.`,
          span: node.span,
          scope: input.scope,
        });
      }
    }

    if (node.kind === 'block-open') blockStack.push(node);
  }

  for (const opening of blockStack) {
    diagnostics.push(diagnostic(
      'unclosed-block',
      `{{#${opening.block}}} is not closed. Add {{/${opening.block}}}.`,
      opening.span,
      input.scope,
    ));
  }
}

function parseOneSource(input: ParseTemplateFieldsInput): ParsedTemplateFieldSyntax {
  const nodes: FieldGrammarNode[] = [];
  const diagnostics: FieldParserDiagnostic[] = [];
  const externalModifiers = collectExternalModifiers(input.content);

  for (const match of externalModifiers) {
    nodes.push(createExternalModifierNode(input.content, input.scope, match));
  }

  let cursor = 0;
  while (cursor < input.content.length) {
    const start = input.content.indexOf('{{', cursor);
    if (start < 0) break;

    const containingModifier = containingExternalModifier(start, externalModifiers);
    if (containingModifier) {
      cursor = containingModifier.end;
      continue;
    }

    const end = findMustacheEnd(input.content, start);
    if (end === null) {
      const span = sourceSpan(input.content, start, input.content.length);
      diagnostics.push(diagnostic(
        'dangling-expression',
        'Field expression is missing its closing }}.',
        span,
        input.scope,
      ));
      break;
    }

    const span = sourceSpan(input.content, start, end);
    const probe = parseFieldExpressionContract(decodePartialOperator(span.raw));
    if (probe.status === 'supported') {
      nodes.push(createNode(input.scope, span, probe));
    } else if (probe.status === 'malformed') {
      diagnostics.push(diagnostic(
        probe.code,
        probe.code === 'formatted-expression'
          ? 'Field expression is split by HTML markup; formatting may surround a field but cannot break its key.'
          : 'Field expression is not valid supported template syntax.',
        span,
        input.scope,
      ));
    }
    cursor = end;
  }

  const attributeEach = createAttributeEachNodes(input.content, input.scope);
  nodes.push(...attributeEach.nodes);
  diagnostics.push(...attributeEach.diagnostics);
  nodes.sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end);
  addBindingDiagnostics(nodes, diagnostics, input);
  diagnostics.sort((left, right) => left.span.start - right.span.start || left.code.localeCompare(right.code));

  return {
    source: input.content,
    nodes,
    diagnostics,
  };
}

function collectPartialGraphDiagnostics(
  root: ParsedTemplateFieldSyntax,
  input: ParseTemplateFieldsInput,
): FieldParserDiagnostic[] {
  if (!input.partials) return [];
  const diagnostics: FieldParserDiagnostic[] = [];
  const partialByName = new Map(input.partials.map((partial) => [partial.name, partial]));
  const expanded = new Set<string>();

  const visit = (
    parsed: ParsedTemplateFieldSyntax,
    stack: readonly string[],
  ): void => {
    for (const node of parsed.nodes) {
      if (node.kind !== 'partial' || !node.partialName) continue;
      const partialName = node.partialName;
      if (stack.includes(partialName)) {
        diagnostics.push({
          code: 'circular-partial',
          severity: 'error',
          message: `Circular partial reference: ${[...stack, partialName].join(' -> ')}`,
          span: node.span,
          scope: node.scope,
        });
        continue;
      }

      const partial = partialByName.get(partialName);
      if (!partial) {
        diagnostics.push({
          code: 'missing-partial',
          severity: 'error',
          message: `Missing partial: ${partialName}`,
          span: node.span,
          scope: node.scope,
        });
        continue;
      }

      if (expanded.has(partial.id)) continue;
      expanded.add(partial.id);
      const partialScope: FieldOwnerScope = { kind: 'partial', id: partial.id, label: partial.name };
      const nested = parseOneSource({
        content: partial.content,
        scope: partialScope,
      });
      diagnostics.push(...nested.diagnostics);
      visit(nested, [...stack, partialName]);
    }
  };

  visit(root, []);
  return diagnostics;
}

/**
 * F1 canonical parser front end. It is source preserving: nodes point back to
 * exact source spans and malformed expressions remain untouched with stable
 * diagnostics rather than being guessed or rewritten.
 */
export function parseTemplateFields(input: ParseTemplateFieldsInput): ParsedTemplateFieldSyntax {
  const parsed = parseOneSource(input);
  const dependencyDiagnostics = collectPartialGraphDiagnostics(parsed, input);
  if (dependencyDiagnostics.length === 0) return parsed;
  return {
    ...parsed,
    diagnostics: [...parsed.diagnostics, ...dependencyDiagnostics].sort(
      (left, right) => left.scope.id.localeCompare(right.scope.id)
        || left.span.start - right.span.start
        || left.code.localeCompare(right.code),
    ),
  };
}

/**
 * Canonicalizes only expressions already accepted by parseTemplateFields.
 * Malformed/recoverable source is never rewritten. Attribute-driven each nodes
 * are already valid HTML and are left byte-for-byte unchanged.
 */
export function normalizeTemplateFieldSyntax(
  content: string,
  parsed: ParsedTemplateFieldSyntax = parseTemplateFields({
    content,
    scope: { kind: 'template', id: 'runtime-normalization' },
  }),
): string {
  let normalized = content;
  const replacements = parsed.nodes
    .filter((node) => node.kind !== 'attribute-each')
    .map((node) => {
      if (node.span.raw.startsWith('{{')) {
        return { node, replacement: node.expression };
      }
      if (node.kind === 'modifier' && node.path) {
        const replacement = node.span.raw.replace(
          /\{\{\s*[A-Za-z_][A-Za-z0-9_.\[\]]*\s*\}\}/,
          `{{${node.path}}}`,
        );
        return { node, replacement };
      }
      return { node, replacement: node.span.raw };
    })
    .filter(({ node, replacement }) => node.span.raw !== replacement)
    .sort((left, right) => right.node.span.start - left.node.span.start);

  for (const { node, replacement } of replacements) {
    normalized = `${normalized.slice(0, node.span.start)}${replacement}${normalized.slice(node.span.end)}`;
  }
  return normalized;
}

export function extractTemplateFieldPaths(parsed: ParsedTemplateFieldSyntax): string[] {
  const paths = new Set<string>();
  for (const node of parsed.nodes) {
    if (node.path) paths.add(node.path);
  }
  return [...paths];
}

export function extractTemplatePartialNames(parsed: ParsedTemplateFieldSyntax): string[] {
  const names = new Set<string>();
  for (const node of parsed.nodes) {
    if (node.kind === 'partial' && node.partialName) names.add(node.partialName);
  }
  return [...names];
}
