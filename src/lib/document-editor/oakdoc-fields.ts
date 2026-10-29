import { strFromU8, unzipSync, zipSync } from 'fflate';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import { formatOakDocDate } from '@/lib/document-editor/oakdoc-context';
import {
  applyOakDocFieldCase,
  oakDocFieldCaseOfTitle,
  oakDocFieldDateFormatOfTitle,
  type OakDocFieldCase,
} from '@/lib/document-editor/oakdoc-field-case';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export interface OakDocFieldDefinition {
  tag: string;
  label: string;
  category: string;
  /** Case the value prints in, chosen when the field is added; absent = as stored. */
  textCase?: OakDocFieldCase;
  /** Word date pattern a date prints in, e.g. "dd/MM/yyyy"; absent = the field's default. */
  dateFormat?: string;
  /** Set for a custom date field, so the field panel offers a date format. */
  valueType?: 'date';
}

export interface OakDocFieldSummary {
  count: number;
  tags: string[];
}

export interface OakDocFieldResolutionResult {
  bytes: Uint8Array;
  updated: number;
  unresolvedTags: string[];
}

function parseXml(bytes: Uint8Array): XMLDocument {
  const parser = new DOMParser();
  const xml = parser.parseFromString(strFromU8(bytes), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error('OakDoc could not parse WordprocessingML.');
  }
  return xml;
}

function serializeXml(xml: XMLDocument): Uint8Array<ArrayBuffer> {
  return encodeOakDocZipText(new XMLSerializer().serializeToString(xml));
}

function isWordElement(node: Node | null | undefined, localName: string): boolean {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const element = node as Element;
  return element.namespaceURI === WORD_NS && element.localName === localName;
}

function wordChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter(
    (child): child is Element => child.nodeType === Node.ELEMENT_NODE,
  );
}

function getWordVal(element: Element | undefined): string {
  return element
    ? (element.getAttributeNS(WORD_NS, 'val') || element.getAttribute('w:val') || '')
    : '';
}

function setTextValue(textElement: Element, value: string): void {
  textElement.textContent = value;
  if (/^\s|\s$/.test(value)) {
    textElement.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  } else {
    textElement.removeAttributeNS(XML_NS, 'space');
  }
}

/** The case a field control's Word title asks for (see oakdoc-field-case). */
function controlCase(sdt: Element): OakDocFieldCase | null {
  const properties = wordChildren(sdt).find((child) => isWordElement(child, 'sdtPr'));
  const alias = properties
    ? wordChildren(properties).find((child) => isWordElement(child, 'alias'))
    : undefined;
  return oakDocFieldCaseOfTitle(getWordVal(alias));
}

/**
 * The Word date pattern a date field asks for, if any: a date content
 * control's own pattern, else the one chosen in the field panel (kept in
 * its Word title).
 */
function controlDateFormat(sdt: Element): string {
  const properties = wordChildren(sdt).find((child) => isWordElement(child, 'sdtPr'));
  const date = properties
    ? wordChildren(properties).find((child) => isWordElement(child, 'date'))
    : undefined;
  const format = date
    ? wordChildren(date).find((child) => isWordElement(child, 'dateFormat'))
    : undefined;
  const alias = properties
    ? wordChildren(properties).find((child) => isWordElement(child, 'alias'))
    : undefined;
  return getWordVal(format) || oakDocFieldDateFormatOfTitle(getWordVal(alias)) || '';
}

/**
 * Point a HYPERLINK field inside the control at `mailto:<value>`, or drop
 * the field codes when there is no address, leaving plain (empty) text.
 */
function retargetMailtoField(content: Element, value: string): void {
  const instructions = Array.from(content.getElementsByTagNameNS(WORD_NS, 'instrText'))
    .filter((node) => /^\s*HYPERLINK\s+"mailto:/i.test(node.textContent || ''));
  if (instructions.length === 0) return;
  const address = value.trim();
  if (address) {
    for (const node of instructions) {
      node.textContent = ` HYPERLINK "mailto:${address.replace(/"/g, '')}" `;
    }
    return;
  }
  const fieldRuns = [
    ...Array.from(content.getElementsByTagNameNS(WORD_NS, 'fldChar')),
    ...instructions,
  ].map((node) => node.parentNode as Element | null);
  for (const fieldRun of fieldRuns) fieldRun?.parentNode?.removeChild(fieldRun);
}

/**
 * Write a resolved value into a field control's content, in the case its
 * Word title asks for. The first text node keeps its run formatting; line breaks in the value become Word line
 * breaks in that same run, and any other text in the control is cleared.
 */
export function writeOakDocControlValue(
  sdt: Element,
  value: string,
  options: { isoDate?: string } = {},
): boolean {
  const content = wordChildren(sdt).find((child) => isWordElement(child, 'sdtContent'));
  if (!content) return false;
  const textNodes = Array.from(content.getElementsByTagNameNS(WORD_NS, 't'));
  if (textNodes.length === 0) return false;

  const dateFormat = options.isoDate ? controlDateFormat(sdt) : '';
  const display = applyOakDocFieldCase(
    dateFormat ? formatOakDocDate(options.isoDate, dateFormat) ?? value : value,
    controlCase(sdt),
  );
  const [first, ...rest] = display.replace(/\r\n?/g, '\n').split('\n');
  // Line breaks in the placeholder belong to the old value.
  for (const lineBreak of [
    ...Array.from(content.getElementsByTagNameNS(WORD_NS, 'br')),
    ...Array.from(content.getElementsByTagNameNS(WORD_NS, 'cr')),
  ]) {
    if (lineBreak.getAttributeNS(WORD_NS, 'type') === 'page') continue;
    lineBreak.parentNode?.removeChild(lineBreak);
  }
  setTextValue(textNodes[0], first);
  for (let index = 1; index < textNodes.length; index += 1) {
    setTextValue(textNodes[index], '');
  }
  let anchor: Node = textNodes[0];
  const document = textNodes[0].ownerDocument;
  for (const line of rest) {
    const lineBreak = document.createElementNS(WORD_NS, 'w:br');
    const text = document.createElementNS(WORD_NS, 'w:t');
    setTextValue(text, line);
    anchor.parentNode?.insertBefore(lineBreak, anchor.nextSibling);
    lineBreak.parentNode?.insertBefore(text, lineBreak.nextSibling);
    anchor = text;
  }
  retargetMailtoField(content, value);
  return true;
}

function wordXmlPartNames(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files).filter(
    (name) => name === 'word/document.xml' || /^word\/(header|footer)\d+\.xml$/i.test(name),
  );
}

function contentControlProperties(sdt: Element): Element | undefined {
  return wordChildren(sdt).find((child) => isWordElement(child, 'sdtPr'));
}

function contentControlTag(sdt: Element): string {
  const properties = contentControlProperties(sdt);
  if (!properties) return '';
  const tag = wordChildren(properties).find((child) => isWordElement(child, 'tag'));
  return getWordVal(tag);
}

function contentControlId(sdt: Element): string {
  const properties = contentControlProperties(sdt);
  if (!properties) return '';
  const id = wordChildren(properties).find((child) => isWordElement(child, 'id'));
  return getWordVal(id);
}

function contentControlPlaceholderState(sdt: Element) {
  const properties = contentControlProperties(sdt);
  const showingPlaceholder = properties
    ? wordChildren(properties).find((child) => isWordElement(child, 'showingPlcHdr'))
    : undefined;
  const content = wordChildren(sdt).find((child) => isWordElement(child, 'sdtContent'));
  const text = content
    ? Array.from(content.getElementsByTagNameNS(WORD_NS, 't'))
      .map((node) => node.textContent || '')
      .join('')
    : '';
  // A cut leaves the control behind with nothing inside it, which editors
  // then render as a "Click here to enter text." prompt.
  const emptied = !content || (
    text.trim() === ''
    && !['drawing', 'pict', 'object'].some((name) => content.getElementsByTagNameNS(WORD_NS, name).length > 0)
  );
  const promptOnly = emptied || /^(?:Click here to enter text\.?\s*)+$/i.test(text.trim());
  return { properties, showingPlaceholder, content, promptOnly };
}

function unwrapDeletedOakDocField(
  sdt: Element,
  state: ReturnType<typeof contentControlPlaceholderState>,
): void {
  const parent = sdt.parentNode;
  if (!parent) return;

  const content = state.content;
  if (content) {
    for (const textNode of Array.from(content.getElementsByTagNameNS(WORD_NS, 't'))) {
      setTextValue(textNode, '');
    }

    while (content.firstChild) {
      parent.insertBefore(content.firstChild, sdt);
    }
  }

  parent.removeChild(sdt);

  // Word table cells must retain paragraph structure. A deleted block-level
  // content control can otherwise leave an empty <w:tc>, which editors may
  // reflow into collapsed columns on the next DOCX reload.
  if (isWordElement(parent, 'tc')) {
    const hasParagraph = wordChildren(parent).some((child) => isWordElement(child, 'p'));
    if (!hasParagraph) {
      parent.appendChild(sdt.ownerDocument.createElementNS(WORD_NS, 'w:p'));
    }
  }
}

function oakDocControlIds(
  docxBytes: Uint8Array,
  knownTags: ReadonlySet<string>,
): Set<string> {
  const files = unzipSync(docxBytes);
  const ids = new Set<string>();

  for (const name of wordXmlPartNames(files)) {
    const xml = parseXml(files[name]);
    for (const sdt of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'sdt'))) {
      const tag = contentControlTag(sdt);
      if (!knownTags.has(tag)) continue;
      const id = contentControlId(sdt);
      if (id) ids.add(`${name}::${id}`);
    }
  }

  return ids;
}

export function normalizeOakDocFields(input: {
  beforeBytes: Uint8Array | null;
  afterBytes: Uint8Array;
  insertedField?: Pick<OakDocFieldDefinition, 'tag'> | null;
  knownTags: ReadonlySet<string>;
}): { bytes: Uint8Array; seeded: number; removed: number } {
  const files = unzipSync(input.afterBytes);
  const beforeIds = input.beforeBytes
    ? oakDocControlIds(input.beforeBytes, input.knownTags)
    : new Set<string>();
  let removed = 0;
  let seeded = 0;
  let fallbackSeeded = false;

  for (const name of wordXmlPartNames(files)) {
    const xml = parseXml(files[name]);
    let changed = false;

    for (const sdt of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'sdt'))) {
      const tag = contentControlTag(sdt);
      if (!input.knownTags.has(tag)) continue;

      const state = contentControlPlaceholderState(sdt);
      if (!state.showingPlaceholder && !state.promptOnly) continue;

      const id = contentControlId(sdt);
      const isNew = Boolean(
        input.insertedField
        && tag === input.insertedField.tag
        && (
          (id && !beforeIds.has(`${name}::${id}`))
          || (!id && !fallbackSeeded)
        ),
      );

      if (isNew && state.content && state.properties) {
        const textNodes = Array.from(state.content.getElementsByTagNameNS(WORD_NS, 't'));
        if (textNodes.length > 0) {
          const token = `{{${tag}}}`;
          setTextValue(textNodes[0], token);
          for (let index = 1; index < textNodes.length; index += 1) {
            setTextValue(textNodes[index], '');
          }
          if (state.showingPlaceholder?.parentNode === state.properties) {
            state.properties.removeChild(state.showingPlaceholder);
          }
          seeded += 1;
          fallbackSeeded = true;
          changed = true;
          continue;
        }
      }

      unwrapDeletedOakDocField(sdt, state);
      removed += 1;
      changed = true;
    }

    if (changed) files[name] = serializeXml(xml);
  }

  return {
    bytes: seeded || removed ? zipSync(files, { level: 6 }) : input.afterBytes,
    seeded,
    removed,
  };
}

function textRun(document: Document, text: string, properties: Element | undefined): Element {
  const run = document.createElementNS(WORD_NS, 'w:r');
  if (properties) run.appendChild(properties.cloneNode(true));
  const textElement = document.createElementNS(WORD_NS, 'w:t');
  setTextValue(textElement, text);
  run.appendChild(textElement);
  return run;
}

/**
 * Move text typed at a field's edge out of the field. Typing right before or
 * after a field lands inside its control in the editor, and generation would
 * overwrite it with the field value. Only inline fields still showing their
 * own `{{tag}}` token are touched.
 */
export function moveOakDocFieldEdgeText(
  docxBytes: Uint8Array,
  knownTags: ReadonlySet<string>,
): { bytes: Uint8Array; moved: number } {
  const files = unzipSync(docxBytes);
  let moved = 0;

  for (const name of wordXmlPartNames(files)) {
    const xml = parseXml(files[name]);
    let changed = false;

    for (const sdt of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'sdt'))) {
      const tag = contentControlTag(sdt);
      if (!knownTags.has(tag) || !isWordElement(sdt.parentNode, 'p')) continue;
      const content = wordChildren(sdt).find((child) => isWordElement(child, 'sdtContent'));
      if (!content) continue;
      const textNodes = Array.from(content.getElementsByTagNameNS(WORD_NS, 't'));
      const text = textNodes.map((node) => node.textContent || '').join('');
      const token = `{{${tag}}}`;
      const index = text.indexOf(token);
      if (index < 0 || text === token) continue;

      const before = text.slice(0, index);
      const after = text.slice(index + token.length);
      const firstRun = wordChildren(content).find((child) => isWordElement(child, 'r'));
      const properties = firstRun
        ? wordChildren(firstRun).find((child) => isWordElement(child, 'rPr'))
        : undefined;
      const parent = sdt.parentNode!;
      if (before) parent.insertBefore(textRun(xml, before, properties), sdt);
      if (after) parent.insertBefore(textRun(xml, after, properties), sdt.nextSibling);
      textNodes.forEach((node, position) => setTextValue(node, position === 0 ? token : ''));
      moved += 1;
      changed = true;
    }

    if (changed) files[name] = serializeXml(xml);
  }

  return { bytes: moved > 0 ? zipSync(files, { level: 6 }) : docxBytes, moved };
}

/**
 * Remove deleted or emptied fields and move edge text out of the rest.
 * `changed` counts both, for callers that remount the cleaned document.
 */
export function pruneDeletedOakDocFields(
  docxBytes: Uint8Array,
  knownTags: ReadonlySet<string>,
): { bytes: Uint8Array; removed: number; changed: number } {
  const result = normalizeOakDocFields({
    beforeBytes: null,
    afterBytes: docxBytes,
    knownTags,
  });
  const edges = moveOakDocFieldEdgeText(result.bytes, knownTags);
  return { bytes: edges.bytes, removed: result.removed, changed: result.removed + edges.moved };
}

export function inspectOakDocFields(
  docxBytes: Uint8Array,
  knownTags?: ReadonlySet<string>,
): OakDocFieldSummary {
  const files = unzipSync(docxBytes);
  const tags: string[] = [];

  for (const name of wordXmlPartNames(files)) {
    const xml = parseXml(files[name]);
    for (const sdt of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'sdt'))) {
      const tag = contentControlTag(sdt);
      if (!tag || (knownTags && !knownTags.has(tag))) continue;
      tags.push(tag);
    }
  }

  return {
    count: tags.length,
    tags: Array.from(new Set(tags)).sort(),
  };
}

export function resolveOakDocFields(
  docxBytes: Uint8Array,
  values: Readonly<Record<string, string>>,
  options: {
    /** ISO calendar dates for date fields whose controls set a date pattern. */
    dates?: Readonly<Record<string, string>>;
  } = {},
): OakDocFieldResolutionResult {
  const files = unzipSync(docxBytes);
  let updated = 0;
  const seenTags = new Set<string>();

  for (const name of wordXmlPartNames(files)) {
    const xml = parseXml(files[name]);
    let changed = false;

    for (const sdt of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'sdt'))) {
      const tag = contentControlTag(sdt);
      if (!tag) continue;
      seenTags.add(tag);
      if (!Object.prototype.hasOwnProperty.call(values, tag)) continue;

      if (!writeOakDocControlValue(sdt, values[tag], { isoDate: options.dates?.[tag] })) continue;
      updated += 1;
      changed = true;
    }

    if (changed) files[name] = serializeXml(xml);
  }

  const unresolvedTags = Array.from(seenTags)
    .filter((tag) => !Object.prototype.hasOwnProperty.call(values, tag))
    .sort();

  return {
    bytes: updated ? zipSync(files, { level: 6 }) : docxBytes,
    updated,
    unresolvedTags,
  };
}
