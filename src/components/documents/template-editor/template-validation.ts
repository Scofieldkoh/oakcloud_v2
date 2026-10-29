import { parseTemplateFields } from '@/lib/template-field-parser';
import type { FieldDiagnosticCode, FieldGrammarNode } from '@/lib/template-field-contract';
import {
  findServiceAgreementSlotViolations,
  SERVICE_AGREEMENT_SLOTS,
  type ServiceAgreementSlotName,
} from '@/lib/service-agreement-template';

const LOOP_FIELD_KEYS = new Set([
  'name', 'detail', 'contactType', 'identificationNumber', 'nationality', 'role',
  'address', 'address.full', 'address.letter', 'shareClass', 'numberOfShares',
  'percentageHeld', 'email', 'phone',
]);

interface PendingIssue {
  position: number;
  severity: TemplateValidationIssue['severity'];
  code: TemplateValidationIssue['code'];
  diagnosticCode?: FieldDiagnosticCode;
  message: string;
}

export interface TemplateValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  code:
    | 'unmatched-block'
    | 'unknown-placeholder'
    | 'empty-loop'
    | 'unresolved-partial'
    | 'missing-agreement-slot'
    | 'duplicate-agreement-slot';
  /** Stable F1 parser diagnostic for CORE navigation. */
  diagnosticCode?: FieldDiagnosticCode;
  message: string;
  flowId?: string;
}

export { SERVICE_AGREEMENT_SLOTS };
export type { ServiceAgreementSlotName };

export function validateServiceAgreementSlots(content: string): TemplateValidationIssue[] {
  return findServiceAgreementSlotViolations(content).map((violation) => {
    const code = violation.kind === 'missing'
      ? 'missing-agreement-slot'
      : 'duplicate-agreement-slot';
    return {
      id: `agreement-${violation.slot}-${code}`,
      severity: 'error',
      code,
      message: violation.message,
    };
  });
}

export interface ValidateTemplateInput {
  compositionType: 'STANDARD' | 'SERVICE_AGREEMENT' | 'RESOLUTION';
  content: string;
  placeholders: Array<{ key: string }>;
}

export function validateTemplate(input: ValidateTemplateInput): TemplateValidationIssue[] {
  const knownKeys = new Set(input.placeholders.map((placeholder) => placeholder.key));
  const syntaxIssues = validateTemplateSyntax(input.content, knownKeys);
  if (input.compositionType !== 'SERVICE_AGREEMENT') return syntaxIssues;
  return [...syntaxIssues, ...validateServiceAgreementSlots(input.content)];
}

function issueCode(code: FieldDiagnosticCode): TemplateValidationIssue['code'] {
  if (code === 'unclosed-block' || code === 'mismatched-block') return 'unmatched-block';
  if (code === 'missing-partial' || code === 'circular-partial') return 'unresolved-partial';
  return 'unknown-placeholder';
}

function nodeAt(nodes: readonly FieldGrammarNode[], start: number) {
  return nodes.find((node) => node.span.start === start);
}

function isKnownEditorKey(path: string, knownKeys: ReadonlySet<string>): boolean {
  if (knownKeys.has(path)) return true;
  if (path.startsWith('custom.') && knownKeys.has(path.slice('custom.'.length))) return true;
  return false;
}

function isContextualLoopField(node: FieldGrammarNode, nodes: readonly FieldGrammarNode[]): boolean {
  const path = node.path;
  if (!path) return false;
  const loopField = path.startsWith('this.') ? path.slice(5) : path;
  if (!LOOP_FIELD_KEYS.has(loopField)) return false;
  if (path.startsWith('this.')) return true;
  let depth = 0;
  for (const candidate of nodes) {
    if (candidate.span.start >= node.span.start) break;
    if (candidate.kind === 'block-open' && candidate.block === 'each') depth += 1;
    if (candidate.kind === 'block-close' && candidate.block === 'each') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

function addParserIssues(
  parsed: ReturnType<typeof parseTemplateFields>,
  knownKeys: ReadonlySet<string>,
  issues: PendingIssue[],
): void {
  for (const item of parsed.diagnostics) {
    const node = nodeAt(parsed.nodes, item.span.start);
    if (
      (item.code === 'unknown-root' || item.code === 'unknown-field')
      && node?.path
      && (isKnownEditorKey(node.path, knownKeys) || isContextualLoopField(node, parsed.nodes))
    ) {
      continue;
    }
    issues.push({
      position: item.span.start,
      severity: item.severity,
      code: issueCode(item.code),
      diagnosticCode: item.code,
      message: item.message,
    });
  }
}

function addUnknownCustomIssues(
  parsed: ReturnType<typeof parseTemplateFields>,
  knownKeys: ReadonlySet<string>,
  issues: PendingIssue[],
): void {
  for (const node of parsed.nodes) {
    if (!node.path || node.kind === 'attribute-each') continue;
    if (node.path.startsWith('custom.') && !isKnownEditorKey(node.path, knownKeys)) {
      issues.push({
        position: node.span.start,
        severity: 'error',
        code: 'unknown-placeholder',
        diagnosticCode: 'unknown-field',
        message: `Placeholder "${node.path}" is not available. Choose a listed field or create a custom placeholder.`,
      });
    }
  }
}

function addPartialAvailabilityIssues(
  nodes: readonly FieldGrammarNode[],
  knownKeys: ReadonlySet<string>,
  issues: PendingIssue[],
): void {
  for (const node of nodes) {
    if (node.kind !== 'partial' || !node.partialName) continue;
    const name = node.partialName;
    if (knownKeys.has(name) || knownKeys.has(`partial.${name}`)) continue;
    issues.push({
      position: node.span.start,
      severity: 'warning',
      code: 'unresolved-partial',
      diagnosticCode: 'missing-partial',
      message: `Partial "${name}" cannot be resolved. Link it or remove the reference.`,
    });
  }
}

function addEmptyLoopIssues(
  html: string,
  nodes: readonly FieldGrammarNode[],
  issues: PendingIssue[],
): void {
  const stack: FieldGrammarNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'block-open') {
      stack.push(node);
      continue;
    }
    if (node.kind !== 'block-close') continue;
    const opening = stack.at(-1);
    if (!opening || opening.block !== node.block) continue;
    stack.pop();
    if (opening.block !== 'each') continue;
    const body = html.slice(opening.span.end, node.span.start);
    if (isEmptyLoop(body)) {
      issues.push({
        position: opening.span.start,
        severity: 'warning',
        code: 'empty-loop',
        message: 'This loop has no content. Select one or more fields before inserting it.',
      });
    }
  }
}

/**
 * Editor validation consumes the F1 parser result. Legacy panel issue codes are
 * retained while diagnosticCode exposes stable parser codes to CORE navigation.
 */
export function validateTemplateSyntax(
  html: string,
  knownKeys: ReadonlySet<string>,
): TemplateValidationIssue[] {
  const issues: PendingIssue[] = [];
  const parsed = parseTemplateFields({
    content: html,
    scope: { kind: 'template', id: 'template-editor-validation' },
  });

  addParserIssues(parsed, knownKeys, issues);
  addUnknownCustomIssues(parsed, knownKeys, issues);
  addPartialAvailabilityIssues(parsed.nodes, knownKeys, issues);
  addEmptyLoopIssues(html, parsed.nodes, issues);

  const deduped = new Map<string, PendingIssue>();
  for (const item of issues) {
    const key = `${item.position}:${item.code}:${item.diagnosticCode ?? ''}:${item.message}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }

  return [...deduped.values()]
    .sort((left, right) => left.position - right.position || left.code.localeCompare(right.code))
    .map((item, index) => ({
      id: `issue-${index + 1}-${item.code}`,
      severity: item.severity,
      code: item.code,
      ...(item.diagnosticCode ? { diagnosticCode: item.diagnosticCode } : {}),
      message: item.message,
    }));
}

function isEmptyLoop(bodyHtml: string): boolean {
  return bodyHtml.replace(/<!--([\s\S]*?)-->|<[^>]*>/g, '').trim() === '';
}
