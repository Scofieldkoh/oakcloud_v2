import {
  WORD_NS,
  WORD_PARAGRAPH_PROPERTY_ORDER,
  getWordVal,
  insertWordChildOrdered,
  isWordElement,
  setWordVal,
  wordChild,
  wordChildren,
} from '@/lib/document-editor/oakdoc-blocks';

/**
 * Lettering of a repeating section: when two or more people are listed,
 * each copy opens with "(a)", "(b)"... and its text moves one indent in,
 * so one person's paragraphs read apart from the next. One person alone
 * prints without a letter. The choice is kept in the section's Word title
 * (`w:alias`), e.g. "Officers (Secretary) repeater · Lettered (a), (b)",
 * so it travels with the section into partials and copies.
 */

const LETTERED_SUFFIX = ' · Lettered (a), (b)';

/** One OakDoc indent step: the letter sits where the text was, the text moves this far in. */
const LETTER_INDENT_TWIPS = 720;

const RUN_FORMATTING_DROPPED = ['b', 'bCs', 'i', 'iCs', 'u', 'caps', 'smallCaps', 'strike', 'dstrike', 'highlight'];

function aliasElement(sdt: Element): Element | undefined {
  const properties = wordChild(sdt, 'sdtPr');
  return properties ? wordChild(properties, 'alias') : undefined;
}

export function isOakDocRepeaterLettered(sdt: Element): boolean {
  return getWordVal(aliasElement(sdt)).endsWith(LETTERED_SUFFIX);
}

/** A section's Word title without the lettering mark, for naming its items. */
export function oakDocRepeaterAliasName(alias: string): string {
  return alias.endsWith(LETTERED_SUFFIX) ? alias.slice(0, -LETTERED_SUFFIX.length) : alias;
}

/** Turn lettering on or off in a section's Word title; `fallbackName` names an untitled one. */
export function setOakDocRepeaterLetteredAlias(sdt: Element, lettered: boolean, fallbackName: string): void {
  const properties = wordChild(sdt, 'sdtPr');
  if (!properties) return;
  let alias = wordChild(properties, 'alias');
  if (!alias) {
    alias = sdt.ownerDocument.createElementNS(WORD_NS, 'w:alias');
    // w:alias comes first in w:sdtPr.
    properties.insertBefore(alias, properties.firstChild);
  }
  const name = oakDocRepeaterAliasName(getWordVal(alias)) || fallbackName;
  setWordVal(alias, lettered ? `${name}${LETTERED_SUFFIX}` : name);
}

/** "a"... "z", then "aa", "ab"... */
export function oakDocItemLetter(index: number): string {
  let value = index + 1;
  let letters = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(97 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

function twips(element: Element | undefined, name: string): number {
  if (!element) return 0;
  const raw = element.getAttributeNS(WORD_NS, name) || element.getAttribute(`w:${name}`) || '';
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function setTwips(element: Element, name: string, value: number): void {
  element.setAttributeNS(WORD_NS, `w:${name}`, String(value));
}

function paragraphProperties(paragraph: Element): Element {
  const existing = wordChild(paragraph, 'pPr');
  if (existing) return existing;
  const created = paragraph.ownerDocument.createElementNS(WORD_NS, 'w:pPr');
  paragraph.insertBefore(created, paragraph.firstChild);
  return created;
}

/** The paragraph's left indent (`w:left`, or `w:start` as newer Word writes it). */
function leftIndent(indent: Element | undefined): number {
  return twips(indent, 'left') || twips(indent, 'start');
}

function setLeftIndent(properties: Element, left: number, hanging?: number): void {
  const xml = properties.ownerDocument;
  const indent = wordChild(properties, 'ind') ?? xml.createElementNS(WORD_NS, 'w:ind');
  indent.removeAttributeNS(WORD_NS, 'start');
  indent.removeAttribute('w:start');
  setTwips(indent, 'left', left);
  if (hanging !== undefined) {
    for (const name of ['firstLine', 'firstLineChars', 'hangingChars']) {
      indent.removeAttributeNS(WORD_NS, name);
      indent.removeAttribute(`w:${name}`);
    }
    setTwips(indent, 'hanging', hanging);
  }
  if (!indent.parentNode) insertWordChildOrdered(properties, indent, WORD_PARAGRAPH_PROPERTY_ORDER);
}

/** The first run's look (font, size, colour), without emphasis, for the letter. */
function letterRunProperties(paragraph: Element): Element | null {
  const firstRun = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, 'r'))[0];
  const properties = firstRun ? wordChild(firstRun, 'rPr') : undefined;
  if (!properties) return null;
  const copy = properties.cloneNode(true) as Element;
  for (const child of wordChildren(copy)) {
    if (RUN_FORMATTING_DROPPED.includes(child.localName)) copy.removeChild(child);
  }
  return wordChildren(copy).length > 0 ? copy : null;
}

function letterParagraph(paragraph: Element, letter: string): void {
  const xml = paragraph.ownerDocument;
  const properties = paragraphProperties(paragraph);
  const left = leftIndent(wordChild(properties, 'ind'));
  const textStart = left + LETTER_INDENT_TWIPS;
  setLeftIndent(properties, textStart, LETTER_INDENT_TWIPS);
  const tabs = xml.createElementNS(WORD_NS, 'w:tabs');
  const tab = xml.createElementNS(WORD_NS, 'w:tab');
  setWordVal(tab, 'left');
  setTwips(tab, 'pos', textStart);
  tabs.appendChild(tab);
  insertWordChildOrdered(properties, tabs, WORD_PARAGRAPH_PROPERTY_ORDER);

  const run = xml.createElementNS(WORD_NS, 'w:r');
  const runProperties = letterRunProperties(paragraph);
  if (runProperties) run.appendChild(runProperties);
  const text = xml.createElementNS(WORD_NS, 'w:t');
  text.textContent = `(${letter})`;
  run.appendChild(text);
  run.appendChild(xml.createElementNS(WORD_NS, 'w:tab'));
  paragraph.insertBefore(run, properties.nextSibling);
}

function indentParagraph(paragraph: Element): void {
  const properties = paragraphProperties(paragraph);
  setLeftIndent(properties, leftIndent(wordChild(properties, 'ind')) + LETTER_INDENT_TWIPS);
}

/**
 * Letter one generated copy of a section: its first paragraph opens with
 * "(a)" and a tab, every paragraph moves one indent in. Copies holding
 * tables or table rows are left as they are.
 */
export function letterOakDocRepeaterItem(nodes: readonly Node[], index: number): void {
  const elements = nodes.filter((node): node is Element => node.nodeType === Node.ELEMENT_NODE);
  const blockOnly = elements.every((element) => isWordElement(element, 'p') || isWordElement(element, 'sdt'));
  if (!blockOnly || elements.some((element) => element.getElementsByTagNameNS(WORD_NS, 'tbl').length > 0)) return;
  const paragraphs = elements.flatMap((element): Element[] => (element.localName === 'p'
    ? [element]
    : Array.from(element.getElementsByTagNameNS(WORD_NS, 'p'))));
  const first = paragraphs.findIndex((paragraph) => (paragraph.textContent ?? '').trim() !== '');
  if (first < 0) return;
  paragraphs.forEach((paragraph, position) => {
    if (position === first) letterParagraph(paragraph, oakDocItemLetter(index));
    else indentParagraph(paragraph);
  });
}
