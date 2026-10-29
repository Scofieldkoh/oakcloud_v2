const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

export type OakDocBlockRangeKind =
  | 'paragraph'
  | 'table row'
  | 'block range'
  | 'table row range';

export interface OakDocBlockRange {
  parent: Element;
  nodes: Element[];
  kind: OakDocBlockRangeKind;
}

export function isWordElement(
  node: Node | null | undefined,
  localName: string,
): node is Element {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const element = node as Element;
  return element.namespaceURI === WORD_NS && element.localName === localName;
}

export function wordChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter(
    (child): child is Element => child.nodeType === Node.ELEMENT_NODE,
  );
}

export function wordChild(node: Node, localName: string): Element | undefined {
  return wordChildren(node).find((child) => isWordElement(child, localName));
}

/** Word's schema order for paragraph properties (`w:pPr` children). */
export const WORD_PARAGRAPH_PROPERTY_ORDER: readonly string[] = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl',
  'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens',
  'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE',
  'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind',
  'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
  'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr',
  'sectPr', 'pPrChange',
];

/** Insert `child` among `parent`'s children in schema order, replacing one of the same name. */
export function insertWordChildOrdered(parent: Element, child: Element, order: readonly string[]): void {
  const rank = order.indexOf(child.localName);
  const existing = wordChild(parent, child.localName);
  if (existing) parent.removeChild(existing);
  const before = wordChildren(parent).find((candidate) => order.indexOf(candidate.localName) > rank);
  parent.insertBefore(child, before ?? null);
}

export function getWordVal(element: Element | undefined): string {
  return element
    ? (element.getAttributeNS(WORD_NS, 'val') || element.getAttribute('w:val') || '')
    : '';
}

export function setWordVal(element: Element, value: string): void {
  element.setAttributeNS(WORD_NS, 'w:val', value);
}

export function paragraphId(paragraph: Element): string {
  return (
    paragraph.getAttributeNS(WORD14_NS, 'paraId')
    || paragraph.getAttribute('w14:paraId')
    || ''
  ).toUpperCase();
}

export function findParagraphById(
  xml: XMLDocument,
  paraId: string,
): Element | undefined {
  const expected = paraId.trim().toUpperCase();
  return Array.from(xml.getElementsByTagNameNS(WORD_NS, 'p'))
    .find((paragraph) => paragraphId(paragraph) === expected);
}

export function closestWordElement(
  start: Element,
  localName: string,
): Element | undefined {
  let current: Element | null = start;
  while (current) {
    if (current.namespaceURI === WORD_NS && current.localName === localName) return current;
    current = current.parentElement;
  }
  return undefined;
}

function directChildWithin(start: Element, parent: Element): Element | undefined {
  let current: Element | null = start;
  while (current?.parentElement && current.parentElement !== parent) {
    current = current.parentElement;
  }
  return current?.parentElement === parent ? current : undefined;
}

function nearestCommonParent(
  from: Element,
  to: Element,
): Element | undefined {
  const toAncestors = new Set<Element>();
  let current: Element | null = to.parentElement;
  while (current) {
    toAncestors.add(current);
    current = current.parentElement;
  }

  current = from.parentElement;
  while (current) {
    if (toAncestors.has(current)) return current;
    current = current.parentElement;
  }
  return undefined;
}

function containsSectionProperties(node: Element): boolean {
  if (node.namespaceURI === WORD_NS && node.localName === 'sectPr') return true;
  return node.getElementsByTagNameNS(WORD_NS, 'sectPr').length > 0;
}

function orderedRange(
  parent: Element,
  fromNode: Element,
  toNode: Element,
): Element[] {
  const children = wordChildren(parent);
  const fromIndex = children.indexOf(fromNode);
  const toIndex = children.indexOf(toNode);
  if (fromIndex < 0 || toIndex < 0) {
    throw new Error('OakDoc could not locate the selected Word block range.');
  }
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return children.slice(start, end + 1);
}

/**
 * Resolve a conservative block-level range that can safely live inside a
 * Word structured document tag (SDT).
 *
 * - Any selection inside one table row targets that whole row.
 * - Selections spanning sibling table rows target the contiguous row range.
 * - Normal paragraphs can span sibling paragraphs/tables under the same Word
 *   block container.
 * - Mixed inside/outside-table selections, unsupported intermediate nodes and
 *   Word section boundaries are rejected instead of guessing.
 */
export function resolveOakDocBlockRange(
  fromParagraph: Element,
  toParagraph: Element,
): OakDocBlockRange {
  const fromRow = closestWordElement(fromParagraph, 'tr');
  const toRow = closestWordElement(toParagraph, 'tr');

  if (Boolean(fromRow) !== Boolean(toRow)) {
    throw new Error(
      'OakDoc cannot wrap a selection that starts inside a table and ends outside it.',
    );
  }

  if (fromRow && toRow) {
    if (!fromRow.parentElement || fromRow.parentElement !== toRow.parentElement) {
      throw new Error('OakDoc can only wrap table rows from the same table region.');
    }
    const parent = fromRow.parentElement;
    const nodes = orderedRange(parent, fromRow, toRow);
    if (nodes.some((node) => node.namespaceURI !== WORD_NS || node.localName !== 'tr')) {
      throw new Error('OakDoc found an unsupported structure between the selected table rows.');
    }
    if (nodes.some(containsSectionProperties)) {
      throw new Error('OakDoc controlled blocks cannot cross a Word section boundary.');
    }
    return {
      parent,
      nodes,
      kind: nodes.length === 1 ? 'table row' : 'table row range',
    };
  }

  const parent = nearestCommonParent(fromParagraph, toParagraph);
  if (!parent) {
    throw new Error('OakDoc could not locate a common Word block container.');
  }

  const fromNode = directChildWithin(fromParagraph, parent);
  const toNode = directChildWithin(toParagraph, parent);
  if (!fromNode || !toNode) {
    throw new Error('OakDoc could not map the selected paragraphs to Word blocks.');
  }

  const nodes = orderedRange(parent, fromNode, toNode);
  if (nodes.some((node) => (
    node.namespaceURI !== WORD_NS
    || (node.localName !== 'p' && node.localName !== 'tbl')
  ))) {
    throw new Error('OakDoc found an unsupported structure inside the selected block range.');
  }
  if (nodes.some(containsSectionProperties)) {
    throw new Error('OakDoc controlled blocks cannot cross a Word section boundary.');
  }

  return {
    parent,
    nodes,
    kind: nodes.length === 1
      && nodes[0].namespaceURI === WORD_NS
      && nodes[0].localName === 'p'
      ? 'paragraph'
      : 'block range',
  };
}

export function nodeContainsWordElement(
  node: Element,
  localName: string,
): boolean {
  return node.getElementsByTagNameNS(WORD_NS, localName).length > 0;
}

export { WORD_NS, WORD14_NS };
