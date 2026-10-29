import {
  diagnoseOakDocPackage,
  extractDocxSemanticText,
  type OakDocPackageDiagnosticOptions,
  type OakDocPackageDiagnosticResult,
} from '@/lib/document-editor/oakdoc-package-diagnostics';

export type SemanticDocumentSource =
  | { kind: 'html'; content: string }
  | { kind: 'text'; content: string }
  | {
      kind: 'docx';
      bytes: Uint8Array;
      diagnostics?: OakDocPackageDiagnosticOptions;
    };

export type SemanticRequirementTarget = 'both' | 'legacy' | 'oakdoc';
export type SemanticRequirementMatch = 'all' | 'any';

export interface SemanticRequirement {
  key: string;
  label: string;
  values: readonly string[];
  target?: SemanticRequirementTarget;
  match?: SemanticRequirementMatch;
}

export interface SemanticRequirementResult {
  key: string;
  label: string;
  target: SemanticRequirementTarget;
  match: SemanticRequirementMatch;
  values: string[];
  legacyMatched: boolean | null;
  oakDocMatched: boolean | null;
}

export interface SemanticComparisonIssue {
  code: string;
  side: 'legacy' | 'oakdoc' | 'comparison';
  key?: string;
  message: string;
}

export interface SemanticDocumentSnapshot {
  text: string;
  normalizedText: string;
  unresolvedLegacyPlaceholders: string[];
  oakDocDiagnostics: OakDocPackageDiagnosticResult | null;
}

export interface SemanticComparisonReport {
  passed: boolean;
  requirements: SemanticRequirementResult[];
  issues: SemanticComparisonIssue[];
  legacy: SemanticDocumentSnapshot;
  oakDoc: SemanticDocumentSnapshot;
}

export interface GenerationComparisonHarnessInput<TContext> {
  context: TContext;
  legacyGenerator: (context: TContext) => Promise<SemanticDocumentSource> | SemanticDocumentSource;
  oakDocGenerator: (context: TContext) => Promise<SemanticDocumentSource> | SemanticDocumentSource;
  requirements:
    | readonly SemanticRequirement[]
    | ((context: TContext) => readonly SemanticRequirement[]);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

export function extractHtmlSemanticText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(?:p|div|section|article|header|footer|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

export function normalizeSemanticText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-SG');
}

function unresolvedLegacyPlaceholders(text: string): string[] {
  return Array.from(new Set(text.match(/\{\{[^{}\n]{1,200}\}\}/g) ?? []))
    .map((value) => value.trim())
    .sort();
}

export function snapshotSemanticDocument(
  source: SemanticDocumentSource,
): SemanticDocumentSnapshot {
  if (source.kind === 'docx') {
    const text = extractDocxSemanticText(source.bytes);
    return {
      text,
      normalizedText: normalizeSemanticText(text),
      unresolvedLegacyPlaceholders: unresolvedLegacyPlaceholders(text),
      oakDocDiagnostics: diagnoseOakDocPackage(source.bytes, source.diagnostics),
    };
  }

  const text = source.kind === 'html'
    ? extractHtmlSemanticText(source.content)
    : source.content;

  return {
    text,
    normalizedText: normalizeSemanticText(text),
    unresolvedLegacyPlaceholders: unresolvedLegacyPlaceholders(text),
    oakDocDiagnostics: null,
  };
}

function requirementMatches(
  normalizedText: string,
  values: readonly string[],
  match: SemanticRequirementMatch,
): boolean {
  const normalizedValues = values
    .map(normalizeSemanticText)
    .filter(Boolean);
  if (normalizedValues.length === 0) return true;
  if (match === 'any') {
    return normalizedValues.some((value) => normalizedText.includes(value));
  }
  return normalizedValues.every((value) => normalizedText.includes(value));
}

export function compareSemanticDocuments(input: {
  legacy: SemanticDocumentSource;
  oakDoc: SemanticDocumentSource;
  requirements: readonly SemanticRequirement[];
}): SemanticComparisonReport {
  const legacy = snapshotSemanticDocument(input.legacy);
  const oakDoc = snapshotSemanticDocument(input.oakDoc);
  const issues: SemanticComparisonIssue[] = [];
  const requirements: SemanticRequirementResult[] = [];

  for (const requirement of input.requirements) {
    const target = requirement.target ?? 'both';
    const match = requirement.match ?? 'all';
    const legacyRequired = target === 'both' || target === 'legacy';
    const oakDocRequired = target === 'both' || target === 'oakdoc';
    const legacyMatched = legacyRequired
      ? requirementMatches(legacy.normalizedText, requirement.values, match)
      : null;
    const oakDocMatched = oakDocRequired
      ? requirementMatches(oakDoc.normalizedText, requirement.values, match)
      : null;

    requirements.push({
      key: requirement.key,
      label: requirement.label,
      target,
      match,
      values: [...requirement.values],
      legacyMatched,
      oakDocMatched,
    });

    if (legacyRequired && !legacyMatched) {
      issues.push({
        code: 'LEGACY_REQUIRED_SEMANTIC_MISSING',
        side: 'legacy',
        key: requirement.key,
        message: `Legacy output is missing required semantic content: ${requirement.label}.`,
      });
    }
    if (oakDocRequired && !oakDocMatched) {
      issues.push({
        code: 'OAKDOC_REQUIRED_SEMANTIC_MISSING',
        side: 'oakdoc',
        key: requirement.key,
        message: `OakDoc output is missing required semantic content: ${requirement.label}.`,
      });
    }
  }

  for (const placeholder of legacy.unresolvedLegacyPlaceholders) {
    issues.push({
      code: 'LEGACY_UNRESOLVED_PLACEHOLDER',
      side: 'legacy',
      message: `Legacy output contains unresolved placeholder ${placeholder}.`,
    });
  }
  for (const placeholder of oakDoc.unresolvedLegacyPlaceholders) {
    issues.push({
      code: 'OAKDOC_UNRESOLVED_LEGACY_PLACEHOLDER',
      side: 'oakdoc',
      message: `OakDoc output contains unresolved legacy placeholder ${placeholder}.`,
    });
  }

  for (const diagnostic of oakDoc.oakDocDiagnostics?.issues ?? []) {
    if (diagnostic.severity !== 'error') continue;
    issues.push({
      code: `OAKDOC_${diagnostic.code}`,
      side: 'oakdoc',
      message: diagnostic.message,
    });
  }

  return {
    passed: issues.length === 0,
    requirements,
    issues,
    legacy,
    oakDoc,
  };
}

export async function runGenerationComparisonHarness<TContext>(
  input: GenerationComparisonHarnessInput<TContext>,
): Promise<SemanticComparisonReport> {
  const [legacy, oakDoc] = await Promise.all([
    input.legacyGenerator(input.context),
    input.oakDocGenerator(input.context),
  ]);
  const requirements = typeof input.requirements === 'function'
    ? input.requirements(input.context)
    : input.requirements;

  return compareSemanticDocuments({ legacy, oakDoc, requirements });
}

export function semanticRequirement(
  key: string,
  label: string,
  values: readonly (string | null | undefined)[],
  options: {
    target?: SemanticRequirementTarget;
    match?: SemanticRequirementMatch;
  } = {},
): SemanticRequirement {
  return {
    key,
    label,
    values: values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
    ...(options.target ? { target: options.target } : {}),
    ...(options.match ? { match: options.match } : {}),
  };
}
