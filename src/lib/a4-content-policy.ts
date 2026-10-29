/**
 * F1 production boundary for the frozen C06 content policy. It defines the
 * semantics sanitization adapters must share without activating F2 ordinary
 * field escaping.
 */

export const A4_CONTENT_POLICY_VERSION = 1 as const;

export const A4_CANONICAL_TAGS = Object.freeze([
  'p', 'br', 'div', 'span',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'hr',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'sup', 'sub',
  'img',
] as const);

export const A4_CANONICAL_ATTRIBUTES = Object.freeze([
  'href', 'target', 'rel',
  'style', 'class', 'id',
  'colspan', 'rowspan', 'scope',
  'start', 'align', 'valign', 'width', 'height',
  'src', 'alt',
  'data-break-type',
  'data-a4-break',
  'data-template-each',
] as const);

export const A4_EDITOR_DECORATION_ATTRIBUTES = Object.freeze([
  'data-flow-id',
  'data-flow-continuation',
  'data-flow-continuation-item',
  'data-flow-oversized',
  'data-flow-keep-together',
] as const);

export const A4_STRUCTURAL_ATTRIBUTES = Object.freeze([
  'data-break-type',
  'data-a4-break',
  'data-template-each',
] as const);

export const A4_SEMANTIC_PAGE_BREAK_HTML = '<span data-a4-break="page"></span>' as const;
export const A4_LEGACY_PRESERVE_ONLY_TAGS = Object.freeze(['img'] as const);
export const A4_ALWAYS_REJECTED_TAGS = Object.freeze([
  'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select',
] as const);

const CANONICAL_TAG_SET = new Set<string>(A4_CANONICAL_TAGS);
const CANONICAL_ATTRIBUTE_SET = new Set<string>(A4_CANONICAL_ATTRIBUTES);
const EDITOR_DECORATION_ATTRIBUTE_SET = new Set<string>(A4_EDITOR_DECORATION_ATTRIBUTES);
const ALWAYS_REJECTED_TAG_SET = new Set<string>(A4_ALWAYS_REJECTED_TAGS);

export function isA4CanonicalTag(tag: string): boolean {
  return CANONICAL_TAG_SET.has(tag.toLowerCase());
}

export function isA4AlwaysRejectedTag(tag: string): boolean {
  return ALWAYS_REJECTED_TAG_SET.has(tag.toLowerCase());
}

export function isA4CanonicalAttribute(attribute: string): boolean {
  return CANONICAL_ATTRIBUTE_SET.has(attribute.toLowerCase());
}

export function isA4ProjectionOnlyAttribute(attribute: string): boolean {
  const normalized = attribute.toLowerCase();
  return EDITOR_DECORATION_ATTRIBUTE_SET.has(normalized) || normalized.startsWith('data-flow-');
}

/** Shared data for browser/server sanitizer adapters; callers receive mutable copies. */
export function getA4SanitizerPolicy(): {
  allowedTags: string[];
  allowedAttributes: string[];
  rejectedTags: string[];
} {
  return {
    allowedTags: [...A4_CANONICAL_TAGS],
    allowedAttributes: [...A4_CANONICAL_ATTRIBUTES],
    rejectedTags: [...A4_ALWAYS_REJECTED_TAGS],
  };
}

export type TrustedRichOriginName =
  | 'template-partial'
  | 'canonical-builder'
  | 'service-composition';

const TRUSTED_RICH_ORIGIN_BRAND: unique symbol = Symbol('c06-trusted-rich-origin');

export interface TrustedRichOrigin {
  readonly name: TrustedRichOriginName;
  readonly [TRUSTED_RICH_ORIGIN_BRAND]: true;
}

function createTrustedRichOrigin(name: TrustedRichOriginName): TrustedRichOrigin {
  return Object.freeze({ name, [TRUSTED_RICH_ORIGIN_BRAND]: true as const });
}

export const C06_TRUSTED_RICH_ORIGINS = Object.freeze({
  templatePartial: createTrustedRichOrigin('template-partial'),
  canonicalBuilder: createTrustedRichOrigin('canonical-builder'),
  serviceComposition: createTrustedRichOrigin('service-composition'),
});

const TRUSTED_RICH_ORIGIN_SET = new Set<TrustedRichOrigin>(
  Object.values(C06_TRUSTED_RICH_ORIGINS),
);

export function isCanonicalTrustedRichOrigin(value: unknown): value is TrustedRichOrigin {
  return TRUSTED_RICH_ORIGIN_SET.has(value as TrustedRichOrigin);
}

export type TextContentFragment = {
  kind: 'text';
  value: string;
  multiline: boolean;
};

export type TrustedRichContentFragment = {
  kind: 'trusted-rich';
  html: string;
  origin: TrustedRichOrigin;
};

export type ResolvedContentFragment =
  | TextContentFragment
  | TrustedRichContentFragment
  | { kind: 'legacy-rich'; html: string; compatibilityBinding: string };

export interface DeclarativeFieldContentInput {
  value: string;
  multiline?: boolean;
  renderMode?: unknown;
  clientMetadata?: Readonly<Record<string, unknown>>;
  tokenMetadata?: Readonly<Record<string, unknown>>;
}

export function createDeclarativeFieldContentFragment(
  input: DeclarativeFieldContentInput,
): TextContentFragment {
  return {
    kind: 'text',
    value: input.value,
    multiline: input.multiline ?? false,
  };
}

export function createTrustedRichContentFragment(input: {
  html: string;
  origin: TrustedRichOrigin;
}): TrustedRichContentFragment {
  if (!isCanonicalTrustedRichOrigin(input.origin)) {
    throw new TypeError('Trusted rich content requires a canonical C06 origin capability');
  }
  return { kind: 'trusted-rich', html: input.html, origin: input.origin };
}

export interface A4ContentPolicyContract {
  version: typeof A4_CONTENT_POLICY_VERSION;
  canonicalTags: typeof A4_CANONICAL_TAGS;
  canonicalAttributes: typeof A4_CANONICAL_ATTRIBUTES;
  editorDecorationAttributes: typeof A4_EDITOR_DECORATION_ATTRIBUTES;
  structuralAttributes: typeof A4_STRUCTURAL_ATTRIBUTES;
  legacyPreserveOnlyTags: typeof A4_LEGACY_PRESERVE_ONLY_TAGS;
  alwaysRejectedTags: typeof A4_ALWAYS_REJECTED_TAGS;
  semanticPageBreakHtml: typeof A4_SEMANTIC_PAGE_BREAK_HTML;
  plainTextResolution: 'escape-at-interpolation-boundary';
  multilineResolution: 'single-canonical-newline-conversion';
  unknownLegacyRichValue: 'preserve-source-and-block-conversion';
  declarativeRenderModeAuthority: 'none';
  trustedRichAuthority: 'canonical-origin-capability-only';
}

export const A4_CONTENT_POLICY_CONTRACT: A4ContentPolicyContract = Object.freeze({
  version: A4_CONTENT_POLICY_VERSION,
  canonicalTags: A4_CANONICAL_TAGS,
  canonicalAttributes: A4_CANONICAL_ATTRIBUTES,
  editorDecorationAttributes: A4_EDITOR_DECORATION_ATTRIBUTES,
  structuralAttributes: A4_STRUCTURAL_ATTRIBUTES,
  legacyPreserveOnlyTags: A4_LEGACY_PRESERVE_ONLY_TAGS,
  alwaysRejectedTags: A4_ALWAYS_REJECTED_TAGS,
  semanticPageBreakHtml: A4_SEMANTIC_PAGE_BREAK_HTML,
  plainTextResolution: 'escape-at-interpolation-boundary',
  multilineResolution: 'single-canonical-newline-conversion',
  unknownLegacyRichValue: 'preserve-source-and-block-conversion',
  declarativeRenderModeAuthority: 'none',
  trustedRichAuthority: 'canonical-origin-capability-only',
});
