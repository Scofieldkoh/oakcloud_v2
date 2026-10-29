import { WORD_NS, getWordVal, wordChild, wordChildren } from '@/lib/document-editor/oakdoc-blocks';

/**
 * Style resolution for native partials.
 *
 * A partial and its master often both define styles such as Normal or
 * ListParagraph, with different spacing, fonts or indents. When a partial is
 * merged, the master's same-named style would silently reformat the
 * partial's text. These helpers resolve what a paragraph or character style
 * actually looks like in its own package (document defaults plus its
 * basedOn chain), so a partial style that looks different from the master's
 * can be copied under its own ID and keep the partial's appearance.
 */

export type StyleKind = 'paragraph' | 'character';

export interface StyleSheet {
  styles: ReadonlyMap<string, Element>;
  docDefaults?: Element;
}

export interface ResolvedStyle {
  pPr?: Element;
  rPr?: Element;
}

// Word rejects property children out of schema order.
const PARAGRAPH_ORDER = [
  'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr',
  'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku',
  'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi',
  'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing',
  'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment',
  'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle',
];
const RUN_ORDER = [
  'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike',
  'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish',
  'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs',
  'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs',
  'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath',
];

/** Keep only style-level properties, in schema order. */
function normalizeProperties(properties: Element, order: readonly string[]): void {
  const children = wordChildren(properties);
  for (const child of children) properties.removeChild(child);
  children
    .filter((child) => order.includes(child.localName))
    .sort((left, right) => order.indexOf(left.localName) - order.indexOf(right.localName))
    .forEach((child) => properties.appendChild(child));
}

/**
 * Theme font references name the package's body or heading font; the
 * master's theme decides those, so they are dropped rather than copied.
 */
function dropThemeFonts(rPr: Element): void {
  const fonts = wordChild(rPr, 'rFonts');
  if (!fonts) return;
  for (const attribute of Array.from(fonts.attributes)) {
    if (/theme$/i.test(attribute.localName)) fonts.removeAttributeNode(attribute);
  }
  if (fonts.attributes.length === 0) rPr.removeChild(fonts);
}

function wordAttribute(element: Element, name: string): string {
  return element.getAttributeNS(WORD_NS, name) || element.getAttribute(`w:${name}`) || '';
}

export function readStyleSheet(styles: Document | null | undefined): StyleSheet {
  if (!styles) return { styles: new Map() };
  return {
    styles: new Map(
      Array.from(styles.getElementsByTagNameNS(WORD_NS, 'style'))
        .map((style) => [wordAttribute(style, 'styleId'), style]),
    ),
    docDefaults: styles.getElementsByTagNameNS(WORD_NS, 'docDefaults')[0],
  };
}

/** The style Word applies to a paragraph with no pStyle. */
export function defaultParagraphStyleId(sheet: StyleSheet): string | undefined {
  for (const [id, style] of sheet.styles) {
    if (wordAttribute(style, 'type') === 'paragraph' && ['1', 'true', 'on'].includes(wordAttribute(style, 'default'))) {
      return id;
    }
  }
  return sheet.styles.has('Normal') ? 'Normal' : undefined;
}

/**
 * Merge `source` properties over `target` (both pPr or both rPr). Children
 * with the same name merge attribute by attribute, so a later `w:spacing
 * w:after` keeps an earlier `w:before`; everything else is replaced.
 */
function mergeProperties(target: Element, source: Element): void {
  for (const child of wordChildren(source)) {
    const existing = wordChild(target, child.localName);
    if (existing && child.attributes.length > 0 && child.childNodes.length === 0) {
      for (const attribute of Array.from(child.attributes)) {
        existing.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
      }
      continue;
    }
    const copy = target.ownerDocument.importNode(child, true) as Element;
    if (existing) target.replaceChild(copy, existing);
    else target.appendChild(copy);
  }
}

/**
 * The paragraph and run properties a style gives its text in its own
 * package: document defaults (paragraph styles only), then each basedOn
 * ancestor from the root down, then the style itself.
 */
export function resolveStyle(
  sheet: StyleSheet,
  styleId: string,
  kind: StyleKind,
  scratch: Document,
): ResolvedStyle {
  const chain: Element[] = [];
  const seen = new Set<string>();
  let current: string | undefined = styleId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const style = sheet.styles.get(current);
    if (!style) break;
    chain.unshift(style);
    current = getWordVal(wordChild(style, 'basedOn')) || undefined;
  }
  const pPr = scratch.createElementNS(WORD_NS, 'w:pPr');
  const rPr = scratch.createElementNS(WORD_NS, 'w:rPr');
  if (kind === 'paragraph' && sheet.docDefaults) {
    const paragraphDefault = wordChild(sheet.docDefaults, 'pPrDefault');
    const runDefault = wordChild(sheet.docDefaults, 'rPrDefault');
    const paragraphDefaults = paragraphDefault ? wordChild(paragraphDefault, 'pPr') : undefined;
    const runDefaults = runDefault ? wordChild(runDefault, 'rPr') : undefined;
    if (paragraphDefaults) mergeProperties(pPr, paragraphDefaults);
    if (runDefaults) mergeProperties(rPr, runDefaults);
    // The document's default font is not a choice the partial made, so it
    // follows the master, like any other document text.
    const defaultFonts = wordChild(rPr, 'rFonts');
    if (defaultFonts) rPr.removeChild(defaultFonts);
  }
  for (const style of chain) {
    const stylePPr = wordChild(style, 'pPr');
    const styleRPr = wordChild(style, 'rPr');
    if (stylePPr && kind === 'paragraph') mergeProperties(pPr, stylePPr);
    if (styleRPr) mergeProperties(rPr, styleRPr);
  }
  dropThemeFonts(rPr);
  normalizeProperties(pPr, PARAGRAPH_ORDER);
  normalizeProperties(rPr, RUN_ORDER);
  return {
    ...(pPr.childNodes.length > 0 ? { pPr } : {}),
    ...(rPr.childNodes.length > 0 ? { rPr } : {}),
  };
}

/** Fingerprint of resolved (schema-ordered) properties, for comparison. */
export function resolvedStyleKey(resolved: ResolvedStyle): string {
  const describe = (properties: Element | undefined): string => (properties
    ? wordChildren(properties)
        .map((child) => {
          const attributes = Array.from(child.attributes)
            .map((attribute) => `${attribute.localName}=${attribute.value}`)
            .sort()
            .join(',');
          return `${child.localName}[${attributes}]${child.childNodes.length > 0 ? new XMLSerializer().serializeToString(child) : ''}`;
        })
        .join(';')
    : '');
  return `${describe(resolved.pPr)}|${describe(resolved.rPr)}`;
}

/** Short stable hash for style IDs (FNV-1a). */
export function styleKeyHash(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * A self-contained style that reproduces `resolved` wherever it is used:
 * no basedOn, so the master's own styles cannot bleed into it.
 */
export function createResolvedStyle(input: {
  document: Document;
  styleId: string;
  name: string;
  kind: StyleKind;
  resolved: ResolvedStyle;
}): Element {
  const style = input.document.createElementNS(WORD_NS, 'w:style');
  style.setAttributeNS(WORD_NS, 'w:type', input.kind);
  style.setAttributeNS(WORD_NS, 'w:customStyle', '1');
  style.setAttributeNS(WORD_NS, 'w:styleId', input.styleId);
  const name = input.document.createElementNS(WORD_NS, 'w:name');
  name.setAttributeNS(WORD_NS, 'w:val', input.name);
  style.appendChild(name);
  style.appendChild(input.document.createElementNS(WORD_NS, 'w:qFormat'));
  if (input.kind === 'paragraph' && input.resolved.pPr) {
    style.appendChild(input.document.importNode(input.resolved.pPr, true));
  }
  if (input.resolved.rPr) style.appendChild(input.document.importNode(input.resolved.rPr, true));
  return style;
}
