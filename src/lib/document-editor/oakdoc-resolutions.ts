import { strFromU8, unzipSync, zipSync } from 'fflate';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import {
  WORD_NS,
  WORD_PARAGRAPH_PROPERTY_ORDER as PARAGRAPH_PROPERTY_ORDER,
  getWordVal,
  insertWordChildOrdered as insertOrdered,
  isWordElement,
  wordChild,
  wordChildren,
} from '@/lib/document-editor/oakdoc-blocks';
import {
  OAKDOC_RESOLUTION_ITEMS_TAG,
  OAKDOC_SCALAR_FIELDS,
  type OakDocRegisteredField,
} from '@/lib/document-editor/oakdoc-field-registry';
import { expandOakDocPartials, oakDocPartialTag } from '@/lib/document-editor/oakdoc-partials';
import type { OakDocDiagnostic } from '@/types/oakdoc';
import {
  customResolutionParagraphs,
  resolutionCompositionIssues,
  resolutionSectionText,
  SAMPLE_RESOLUTION_COMPOSITION,
  type ResolutionComposition,
  type ResolutionSection,
} from '@/lib/resolution-composition';

/**
 * Numbered resolutions for RESOLUTION templates.
 *
 * The master holds one block content control tagged `resolution.items`.
 * At generation it is replaced by an optional bold subject heading and one
 * numbered heading per section chosen on Configure ("1.<tab>HEADING"), each
 * followed by its body: a reference to a Word partial (expanded and pinned
 * by the ordinary partial pipeline afterwards) or the custom text typed for
 * that document. The slot's first paragraph is the formatting prototype, so
 * the template owns the font, spacing and alignment of what is generated.
 * Needs DOMParser/XMLSerializer.
 */

export { OAKDOC_RESOLUTION_ITEMS_TAG };
export {
  customResolutionParagraphs,
  resolutionCompositionIssues,
  resolutionSectionText,
  SAMPLE_RESOLUTION_COMPOSITION,
  type ResolutionComposition,
  type ResolutionSection,
};

const DOCUMENT_PART = 'word/document.xml';
/**
 * Heading text starts after "N." and a tab, one editor indent step (0.5 in)
 * in, so it lines up with partial text indented once in OakDoc.
 */
const HEADING_TAB_TWIPS = 720;

const RUN_PROPERTY_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps'];

function parseXml(bytes: Uint8Array): XMLDocument {
  const xml = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error('OakDoc could not parse word/document.xml.');
  }
  return xml;
}

function serialize(xml: XMLDocument): Uint8Array<ArrayBuffer> {
  return encodeOakDocZipText(new XMLSerializer().serializeToString(xml));
}

function element(xml: XMLDocument, name: string, attributes: Record<string, string> = {}): Element {
  const created = xml.createElementNS(WORD_NS, `w:${name}`);
  for (const [key, value] of Object.entries(attributes)) {
    created.setAttributeNS(WORD_NS, `w:${key}`, value);
  }
  return created;
}

function controlTag(sdt: Element): string {
  const properties = wordChild(sdt, 'sdtPr');
  return properties ? getWordVal(wordChild(properties, 'tag')) : '';
}

export function findResolutionSlots(xml: XMLDocument): Element[] {
  return Array.from(xml.getElementsByTagNameNS(WORD_NS, 'sdt'))
    .filter((sdt) => controlTag(sdt) === OAKDOC_RESOLUTION_ITEMS_TAG);
}

class IdAllocator {
  private next: number;

  constructor(xml: XMLDocument) {
    let max = 0;
    for (const id of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'id'))) {
      const value = Number(getWordVal(id));
      if (Number.isInteger(value) && value > max) max = value;
    }
    this.next = Math.max(400000, max + 1);
  }

  take(): number {
    const value = this.next;
    this.next += 1;
    return value;
  }
}

interface Prototype {
  paragraphProperties: Element | null;
  runProperties: Element | null;
}

/** Formatting of the slot's first paragraph and its first run. */
function readPrototype(slot: Element): Prototype {
  const paragraph = slot.getElementsByTagNameNS(WORD_NS, 'p')[0]
    ?? (isWordElement(slot.parentNode, 'p') ? slot.parentNode : undefined);
  const run = slot.getElementsByTagNameNS(WORD_NS, 'r')[0];
  const paragraphProperties = paragraph ? wordChild(paragraph, 'pPr') ?? null : null;
  const runProperties = run ? wordChild(run, 'rPr') ?? null : null;
  return {
    paragraphProperties: paragraphProperties
      ? paragraphProperties.cloneNode(true) as Element
      : null,
    runProperties: runProperties ? runProperties.cloneNode(true) as Element : null,
  };
}

function paragraphFrom(
  xml: XMLDocument,
  prototype: Prototype,
  options: { keepNext?: boolean; headingTab?: boolean } = {},
): Element {
  const paragraph = element(xml, 'p');
  const properties = prototype.paragraphProperties
    ? prototype.paragraphProperties.cloneNode(true) as Element
    : element(xml, 'pPr');
  // A paragraph mark's own run properties and section breaks stay with the slot.
  for (const child of wordChildren(properties)) {
    if (['sectPr', 'pPrChange', 'numPr'].includes(child.localName)) properties.removeChild(child);
  }
  if (options.keepNext) insertOrdered(properties, element(xml, 'keepNext'), PARAGRAPH_PROPERTY_ORDER);
  if (options.headingTab) {
    const tabs = element(xml, 'tabs');
    tabs.appendChild(element(xml, 'tab', { val: 'left', pos: String(HEADING_TAB_TWIPS) }));
    insertOrdered(properties, tabs, PARAGRAPH_PROPERTY_ORDER);
    const indent = wordChild(properties, 'ind');
    if (indent) properties.removeChild(indent);
  }
  if (wordChildren(properties).length > 0) paragraph.appendChild(properties);
  return paragraph;
}

function runFrom(xml: XMLDocument, prototype: Prototype, options: { bold?: boolean } = {}): Element {
  const run = element(xml, 'r');
  const properties = prototype.runProperties
    ? prototype.runProperties.cloneNode(true) as Element
    : element(xml, 'rPr');
  if (options.bold) insertOrdered(properties, element(xml, 'b'), RUN_PROPERTY_ORDER);
  if (wordChildren(properties).length > 0) run.appendChild(properties);
  return run;
}

function appendText(xml: XMLDocument, run: Element, value: string): void {
  const text = element(xml, 't');
  text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  text.textContent = value;
  run.appendChild(text);
}

/**
 * Fields custom resolution text can use as `{tag}`: ones that resolve from
 * the company, the resolution date or the system alone, so no extra party
 * has to be chosen on Configure.
 */
export const RESOLUTION_TEXT_FIELDS: readonly OakDocRegisteredField[] = OAKDOC_SCALAR_FIELDS
  .filter((field) => field.context === 'company' || field.context === 'resolution' || field.context === 'system');

const RESOLUTION_TEXT_FIELD_BY_TAG = new Map(RESOLUTION_TEXT_FIELDS.map((field) => [field.tag, field]));
const FIELD_TOKEN = /\{([a-zA-Z][\w.]*)\}/g;

/** Split a line into text and known `{tag}` field tokens; unknown tokens stay as text. */
export function splitResolutionTextFields(line: string): Array<{ text: string } | { field: OakDocRegisteredField }> {
  const parts: Array<{ text: string } | { field: OakDocRegisteredField }> = [];
  let cursor = 0;
  for (const match of line.matchAll(FIELD_TOKEN)) {
    const field = RESOLUTION_TEXT_FIELD_BY_TAG.get(match[1]);
    if (!field) continue;
    if (match.index > cursor) parts.push({ text: line.slice(cursor, match.index) });
    parts.push({ field });
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length) parts.push({ text: line.slice(cursor) });
  return parts;
}

/** An inline field control that generation fills like any template field. */
function fieldControl(xml: XMLDocument, prototype: Prototype, ids: IdAllocator, field: OakDocRegisteredField): Element {
  const sdt = element(xml, 'sdt');
  const properties = element(xml, 'sdtPr');
  properties.appendChild(element(xml, 'alias', { val: field.label }));
  properties.appendChild(element(xml, 'tag', { val: field.tag }));
  properties.appendChild(element(xml, 'id', { val: String(ids.take()) }));
  properties.appendChild(element(xml, 'text'));
  sdt.appendChild(properties);
  const content = element(xml, 'sdtContent');
  const run = runFrom(xml, prototype);
  appendText(xml, run, field.label);
  content.appendChild(run);
  sdt.appendChild(content);
  return sdt;
}

function textParagraph(
  xml: XMLDocument,
  prototype: Prototype,
  lines: string[],
  options: { bold?: boolean; keepNext?: boolean; ids?: IdAllocator } = {},
): Element {
  const paragraph = paragraphFrom(xml, prototype, { keepNext: options.keepNext });
  let run = runFrom(xml, prototype, { bold: options.bold });
  paragraph.appendChild(run);
  lines.forEach((line, index) => {
    if (index > 0) run.appendChild(element(xml, 'br'));
    const parts = options.ids ? splitResolutionTextFields(line) : [{ text: line }];
    for (const part of parts) {
      if ('text' in part) {
        appendText(xml, run, part.text);
        continue;
      }
      paragraph.appendChild(fieldControl(xml, prototype, options.ids!, part.field));
      run = runFrom(xml, prototype, { bold: options.bold });
      paragraph.appendChild(run);
    }
  });
  return paragraph;
}

/**
 * Character style a master may define (word/styles.xml) to format the
 * heading text after "N.<tab>", such as an underline; the number keeps the
 * slot's formatting.
 */
export const OAKDOC_RESOLUTION_HEADING_STYLE = 'OakDocResolutionHeading';

function hasHeadingStyle(files: Record<string, Uint8Array>): boolean {
  const styles = files['word/styles.xml'];
  return !!styles && strFromU8(styles).includes(`w:styleId="${OAKDOC_RESOLUTION_HEADING_STYLE}"`);
}

function headingParagraph(
  xml: XMLDocument,
  prototype: Prototype,
  number: number,
  heading: string,
  styled = false,
): Element {
  const paragraph = paragraphFrom(xml, prototype, { keepNext: true, headingTab: true });
  let run = runFrom(xml, prototype);
  appendText(xml, run, `${number}.`);
  run.appendChild(element(xml, 'tab'));
  if (styled) {
    paragraph.appendChild(run);
    run = runFrom(xml, prototype);
    const properties = wordChild(run, 'rPr') ?? run.insertBefore(element(xml, 'rPr'), run.firstChild);
    insertOrdered(properties, element(xml, 'rStyle', { val: OAKDOC_RESOLUTION_HEADING_STYLE }), RUN_PROPERTY_ORDER);
  }
  appendText(xml, run, heading.trim());
  paragraph.appendChild(run);
  return paragraph;
}

function partialReference(xml: XMLDocument, ids: IdAllocator, partialId: string, label: string): Element {
  const sdt = element(xml, 'sdt');
  const properties = element(xml, 'sdtPr');
  properties.appendChild(element(xml, 'alias', { val: `Partial: ${label}` }));
  properties.appendChild(element(xml, 'tag', { val: oakDocPartialTag(partialId) }));
  properties.appendChild(element(xml, 'id', { val: String(ids.take()) }));
  sdt.appendChild(properties);
  const content = element(xml, 'sdtContent');
  content.appendChild(element(xml, 'p'));
  sdt.appendChild(content);
  return sdt;
}

/** Replace a block slot, or the paragraph an inline slot occupies alone. */
function replaceSlot(slot: Element, replacements: Element[]): boolean {
  const parent = slot.parentNode;
  if (!parent) return false;
  let anchor: Node = slot;
  if (isWordElement(parent, 'p')) {
    const others = wordChildren(parent).filter((child) => !isWordElement(child, 'pPr') && child !== slot);
    if (others.length > 0 || !parent.parentNode) return false;
    anchor = parent;
  }
  const container = anchor.parentNode!;
  for (const replacement of replacements) container.insertBefore(replacement, anchor);
  container.removeChild(anchor);
  return true;
}

export interface ResolutionCompositionResult {
  bytes: Uint8Array;
  /** Partials the composed document now references, in order. */
  partialIds: string[];
  diagnostics: OakDocDiagnostic[];
}

function slotError(code: string, message: string): OakDocDiagnostic {
  return { code, severity: 'error', stage: 'render', message, controlTag: OAKDOC_RESOLUTION_ITEMS_TAG };
}

export function composeOakDocResolutions(
  docxBytes: Uint8Array,
  composition: ResolutionComposition,
): ResolutionCompositionResult {
  const files = unzipSync(docxBytes);
  const documentBytes = files[DOCUMENT_PART];
  if (!documentBytes) throw new Error('This DOCX has no word/document.xml part.');
  const xml = parseXml(documentBytes);
  const slots = findResolutionSlots(xml);
  const diagnostics: OakDocDiagnostic[] = [];
  if (slots.length !== 1) {
    diagnostics.push(slotError(
      slots.length === 0 ? 'OAKDOC_RESOLUTION_SLOT_MISSING' : 'OAKDOC_RESOLUTION_SLOT_DUPLICATE',
      slots.length === 0
        ? 'This resolution template has no place for the numbered resolutions. Insert it in the template editor.'
        : 'This resolution template must have exactly one place for the numbered resolutions.',
    ));
    return { bytes: docxBytes, partialIds: [], diagnostics };
  }
  for (const issue of resolutionCompositionIssues(composition)) {
    diagnostics.push(slotError('OAKDOC_RESOLUTION_INCOMPLETE', issue));
  }

  const [slot] = slots;
  const prototype = readPrototype(slot);
  const ids = new IdAllocator(xml);
  const blocks: Element[] = [];
  const partialIds: string[] = [];
  const styledHeadings = hasHeadingStyle(files);
  if (composition.subject.trim()) {
    blocks.push(textParagraph(xml, prototype, [composition.subject.trim()], { bold: true, keepNext: true }));
  }
  composition.sections.forEach((section, index) => {
    blocks.push(headingParagraph(xml, prototype, index + 1, section.heading, styledHeadings));
    const text = resolutionSectionText(section);
    if (section.kind === 'PARTIAL' && text === null) {
      partialIds.push(section.partialId);
      blocks.push(partialReference(xml, ids, section.partialId, section.heading.trim() || 'Resolution'));
      return;
    }
    for (const lines of customResolutionParagraphs(text ?? '')) {
      blocks.push(textParagraph(xml, prototype, lines, { ids }));
    }
  });

  if (!replaceSlot(slot, blocks)) {
    diagnostics.push(slotError(
      'OAKDOC_RESOLUTION_SLOT_LOCATION',
      'The numbered resolutions must sit in their own paragraph in the template.',
    ));
    return { bytes: docxBytes, partialIds: [], diagnostics };
  }
  files[DOCUMENT_PART] = serialize(xml);
  return { bytes: zipSync(files, { level: 6 }), partialIds, diagnostics };
}

export const RESOLUTION_SLOT_PLACEHOLDER = '[Numbered resolutions: chosen when the document is generated]';
const RESOLUTION_SLOT_PRESET_LABEL = '[Preset resolutions, which can still be changed when the document is generated:]';

export interface ResolutionSlotPreviewSection {
  heading: string;
  /** Plain wording; empty when it isn't known. */
  text: string;
  /**
   * The partial's current Word file. When given, the preview shows the
   * partial itself (its fields and repeating sections as in the editor)
   * instead of the plain wording.
   */
  partial?: { id: string; bytes: Uint8Array };
}

/**
 * Editor preview: show a template's preset resolutions inside its slot, laid
 * out like generation (numbered headings, then each partial with its fields,
 * or the wording as plain text). The slot's first paragraph stays the
 * formatting prototype and only changes its text, so generation formatting
 * is unaffected; generation replaces the whole slot anyway, and saving
 * clears the preview (`clearOakDocResolutionSlotPreview`). No sections
 * restores the plain placeholder. Returns the input bytes untouched when
 * there is no single slot.
 */
export function previewOakDocResolutionSlot(
  docxBytes: Uint8Array,
  sections: ResolutionSlotPreviewSection[],
): Uint8Array {
  const files = unzipSync(docxBytes);
  const documentBytes = files[DOCUMENT_PART];
  if (!documentBytes) return docxBytes;
  const xml = parseXml(documentBytes);
  const slots = findResolutionSlots(xml);
  if (slots.length !== 1) return docxBytes;
  const content = wordChild(slots[0], 'sdtContent');
  const first = content ? wordChildren(content).find((child) => child.localName === 'p') : undefined;
  if (!content || !first) return docxBytes;

  const prototype = readPrototype(slots[0]);
  for (const child of wordChildren(content)) {
    if (child !== first) content.removeChild(child);
  }
  for (const child of wordChildren(first)) {
    if (child.localName !== 'pPr') first.removeChild(child);
  }
  const label = runFrom(xml, prototype);
  appendText(xml, label, sections.length > 0 ? RESOLUTION_SLOT_PRESET_LABEL : RESOLUTION_SLOT_PLACEHOLDER);
  first.appendChild(label);
  const styledHeadings = hasHeadingStyle(files);
  const ids = new IdAllocator(xml);
  const fragments = new Map<string, Uint8Array>();
  sections.forEach((section, index) => {
    content.appendChild(headingParagraph(xml, prototype, index + 1, section.heading, styledHeadings));
    if (section.partial) {
      fragments.set(section.partial.id, section.partial.bytes);
      content.appendChild(partialReference(xml, ids, section.partial.id, section.heading.trim() || 'Resolution'));
      return;
    }
    for (const lines of customResolutionParagraphs(section.text)) {
      content.appendChild(textParagraph(xml, prototype, lines));
    }
  });
  files[DOCUMENT_PART] = serialize(xml);
  const bytes = zipSync(files, { level: 6 });
  if (fragments.size === 0) return bytes;
  // Partials go in as generation inserts them; one that can't stays a reference.
  return expandOakDocPartials({ docxBytes: bytes, fragments }).bytes;
}

/**
 * The master as it is saved: a preset preview in the slot is display only,
 * so the slot goes back to its plain placeholder (its formatting kept).
 * Bytes without a single slot, or with a plain one, come back unchanged.
 */
export function clearOakDocResolutionSlotPreview(docxBytes: Uint8Array): Uint8Array {
  const files = unzipSync(docxBytes);
  const documentBytes = files[DOCUMENT_PART];
  if (!documentBytes) return docxBytes;
  const slots = findResolutionSlots(parseXml(documentBytes));
  if (slots.length !== 1) return docxBytes;
  const content = wordChild(slots[0], 'sdtContent');
  const blocks = content ? wordChildren(content) : [];
  const plain = blocks.length === 1
    && blocks[0].localName === 'p'
    && (blocks[0].textContent ?? '').trim() === RESOLUTION_SLOT_PLACEHOLDER;
  return plain ? docxBytes : previewOakDocResolutionSlot(docxBytes, []);
}

/** Whether a master already holds the numbered resolutions slot. */
export function hasOakDocResolutionSlot(docxBytes: Uint8Array): boolean {
  const files = unzipSync(docxBytes);
  const documentBytes = files[DOCUMENT_PART];
  return documentBytes ? findResolutionSlots(parseXml(documentBytes)).length > 0 : false;
}

/**
 * Slots saved before the placeholder could be restyled locked their content
 * too. Downgrade them to a wrapper-only lock so the font can be changed.
 * Returns the input bytes untouched when nothing needs changing.
 */
export function unlockOakDocResolutionSlotContent(docxBytes: Uint8Array): Uint8Array {
  const files = unzipSync(docxBytes);
  const documentBytes = files[DOCUMENT_PART];
  if (!documentBytes) return docxBytes;
  const xml = parseXml(documentBytes);
  let changed = false;
  for (const slot of findResolutionSlots(xml)) {
    const properties = wordChild(slot, 'sdtPr');
    const lock = properties ? wordChild(properties, 'lock') : undefined;
    if (lock && getWordVal(lock) === 'sdtContentLocked') {
      lock.setAttributeNS(WORD_NS, 'w:val', 'sdtLocked');
      changed = true;
    }
  }
  if (!changed) return docxBytes;
  files[DOCUMENT_PART] = serialize(xml);
  return zipSync(files, { level: 6 });
}

/**
 * Editor action: add the numbered resolutions slot after the paragraph
 * holding the caret. The slot keeps that paragraph's formatting, which the
 * generated resolutions then follow.
 */
export function insertOakDocResolutionSlot(input: {
  docxBytes: Uint8Array;
  paraId: string;
}): Uint8Array {
  const files = unzipSync(input.docxBytes);
  if (!files[DOCUMENT_PART]) throw new Error('OakDoc could not find word/document.xml.');
  const xml = parseXml(files[DOCUMENT_PART]);
  if (findResolutionSlots(xml).length > 0) {
    throw new Error('This template already has the numbered resolutions.');
  }
  const expected = input.paraId.trim().toUpperCase();
  const paragraph = Array.from(xml.getElementsByTagNameNS(WORD_NS, 'p')).find((candidate) => (
    (candidate.getAttributeNS('http://schemas.microsoft.com/office/word/2010/wordml', 'paraId')
      || candidate.getAttribute('w14:paraId')
      || '').toUpperCase() === expected
  ));
  if (!paragraph) throw new Error('Place the caret in a paragraph first.');
  let anchor: Element = paragraph;
  while (anchor.parentNode && isWordElement(anchor.parentNode, 'sdtContent')) {
    const sdt = anchor.parentNode.parentNode as Element | null;
    if (!sdt) break;
    anchor = sdt;
  }
  const parent = anchor.parentNode as Element | null;
  if (!parent || parent.localName !== 'body') {
    throw new Error('Put the caret in a body paragraph, outside tables and other sections.');
  }

  const sdt = element(xml, 'sdt');
  const properties = element(xml, 'sdtPr');
  properties.appendChild(element(xml, 'alias', { val: 'Numbered resolutions' }));
  properties.appendChild(element(xml, 'tag', { val: OAKDOC_RESOLUTION_ITEMS_TAG }));
  properties.appendChild(element(xml, 'id', { val: String(new IdAllocator(xml).take()) }));
  // The slot can't be deleted, but its placeholder can be restyled: the
  // generated resolutions take its paragraph and font formatting.
  properties.appendChild(element(xml, 'lock', { val: 'sdtLocked' }));
  sdt.appendChild(properties);
  const content = element(xml, 'sdtContent');
  const body = element(xml, 'p');
  const sourceProperties = wordChild(paragraph, 'pPr');
  if (sourceProperties) {
    const copied = sourceProperties.cloneNode(true) as Element;
    for (const child of wordChildren(copied)) {
      if (['sectPr', 'pPrChange', 'numPr'].includes(child.localName)) copied.removeChild(child);
    }
    body.appendChild(copied);
  }
  const run = element(xml, 'r');
  const sourceRun = paragraph.getElementsByTagNameNS(WORD_NS, 'r')[0];
  const sourceRunProperties = sourceRun ? wordChild(sourceRun, 'rPr') : undefined;
  if (sourceRunProperties) run.appendChild(sourceRunProperties.cloneNode(true));
  appendText(xml, run, RESOLUTION_SLOT_PLACEHOLDER);
  body.appendChild(run);
  content.appendChild(body);
  sdt.appendChild(content);
  parent.insertBefore(sdt, anchor.nextSibling);

  files[DOCUMENT_PART] = serialize(xml);
  return zipSync(files, { level: 6 });
}

/**
 * A partial's wording as plain text for the Configure step: paragraphs
 * separated by a blank line, line breaks kept. Fields custom text supports
 * read as `{tag}`; other fields show their sample text.
 */
export function readOakDocPlainText(docxBytes: Uint8Array): string {
  const files = unzipSync(docxBytes, { filter: (entry) => entry.name === DOCUMENT_PART });
  const part = files[DOCUMENT_PART];
  if (!part) return '';
  const xml = parseXml(part);
  const paragraphs: string[] = [];
  for (const paragraph of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'p'))) {
    let text = '';
    const walk = (node: Element) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== 1) continue;
        const el = child as Element;
        if (el.namespaceURI !== WORD_NS) continue;
        // Nested paragraphs (text boxes) are read on their own.
        if (el.localName === 'p' || el.localName === 'pPr' || el.localName === 'rPr') continue;
        if (el.localName === 'sdt') {
          // A field custom text can use reads back as its {tag} token.
          const sdtPr = wordChild(el, 'sdtPr');
          const tag = sdtPr ? getWordVal(wordChild(sdtPr, 'tag')) : '';
          if (tag && RESOLUTION_TEXT_FIELD_BY_TAG.has(tag)) {
            text += `{${tag}}`;
            continue;
          }
        }
        if (el.localName === 't') text += el.textContent ?? '';
        else if (el.localName === 'tab') text += '\t';
        else if (el.localName === 'br' || el.localName === 'cr') text += '\n';
        else walk(el);
      }
    };
    walk(paragraph);
    if (text.trim()) paragraphs.push(text.trimEnd());
  }
  return paragraphs.join('\n\n');
}
