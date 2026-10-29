import { strFromU8, unzipSync, zipSync } from 'fflate';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import {
  WORD_NS,
  getWordVal,
  isWordElement,
  wordChild,
  wordChildren,
} from '@/lib/document-editor/oakdoc-blocks';
import { OAKDOC_PARTIAL_TAG_PREFIX } from '@/lib/document-editor/oakdoc-field-registry';
import {
  addOakDocConditionDefinitions,
  importOakDocConditionBlocks,
  readOakDocConditionDefinitionsFromFiles,
  type OakDocConditionDefinition,
} from '@/lib/document-editor/oakdoc-conditions';
import {
  createResolvedStyle,
  defaultParagraphStyleId,
  readStyleSheet,
  resolveStyle,
  resolvedStyleKey,
  styleKeyHash,
  type StyleKind,
  type StyleSheet,
} from '@/lib/document-editor/oakdoc-partial-styles';
import { ValidationError } from '@/lib/errors';
import type { OakDocDiagnostic } from '@/types/oakdoc';

/**
 * C06 native reusable partials.
 *
 * A master references a partial with a block-level content control tagged
 * `oakdoc.partial:<partialId>`. At generation the control is replaced by the
 * partial's body, merging what the body depends on: styles the master lacks,
 * numbering definitions (renumbered), hyperlinks and images (new
 * relationship IDs), and unique content-control, bookmark and drawing IDs.
 * Section properties are never transplanted. Needs DOMParser/XMLSerializer.
 */

export { OAKDOC_PARTIAL_TAG_PREFIX };
export const OAKDOC_PARTIAL_MAX_DEPTH = 3;

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_TYPES = {
  styles: `${REL_TYPE}/styles`,
  numbering: `${REL_TYPE}/numbering`,
  image: `${REL_TYPE}/image`,
  hyperlink: `${REL_TYPE}/hyperlink`,
} as const;
const CONTENT_TYPES = {
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
} as const;

const DOCUMENT_PART = 'word/document.xml';
const DOCUMENT_RELS_PART = 'word/_rels/document.xml.rels';
const STYLES_PART = 'word/styles.xml';
const NUMBERING_PART = 'word/numbering.xml';
const CONTENT_TYPES_PART = '[Content_Types].xml';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Body elements that cannot survive a transplant and are removed. */
const DROPPED_REFERENCES = [
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
  'footnoteReference',
  'endnoteReference',
] as const;

export function oakDocPartialTag(partialId: string): string {
  return `${OAKDOC_PARTIAL_TAG_PREFIX}${partialId}`;
}

export function partialIdFromTag(tag: string): string | null {
  if (!tag.startsWith(OAKDOC_PARTIAL_TAG_PREFIX)) return null;
  const id = tag.slice(OAKDOC_PARTIAL_TAG_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface OakDocPartialPin {
  partialId: string;
  version: number;
  sha256: string;
  storageKey: string;
  /** The partial's own pins at that version, so nested expansion is fixed too. */
  nested: OakDocPartialPin[];
}

function readPin(value: unknown, depth: number): OakDocPartialPin | null {
  if (!isRecord(value) || depth > 4) return null;
  if (
    typeof value.partialId !== 'string'
    || typeof value.version !== 'number'
    || typeof value.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.storageKey !== 'string'
  ) {
    return null;
  }
  const nested = Array.isArray(value.nested)
    ? value.nested.map((entry) => readPin(entry, depth + 1))
    : [];
  if (nested.some((entry) => entry === null)) return null;
  return {
    partialId: value.partialId,
    version: value.version,
    sha256: value.sha256,
    storageKey: value.storageKey,
    nested: nested as OakDocPartialPin[],
  };
}

export function readOakDocPartialPins(contentJson: unknown): OakDocPartialPin[] {
  if (!isRecord(contentJson) || !Array.isArray(contentJson.oakDocPartials)) return [];
  const pins = contentJson.oakDocPartials.map((entry) => readPin(entry, 0));
  if (pins.some((entry) => entry === null)) {
    throw new ValidationError('Pinned partial references are damaged', {
      reason: 'OAKDOC_PARTIAL_PINS_INVALID',
    });
  }
  return pins as OakDocPartialPin[];
}

type Files = Record<string, Uint8Array>;

function diagnostic(
  code: string,
  severity: OakDocDiagnostic['severity'],
  message: string,
  controlTag?: string,
): OakDocDiagnostic {
  return {
    code: `OAKDOC_PARTIAL_${code}`,
    severity,
    stage: 'render',
    message,
    ...(controlTag ? { controlTag } : {}),
  };
}

function parseXml(bytes: Uint8Array, part: string): XMLDocument {
  const xml = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`OakDoc could not parse ${part}.`);
  }
  return xml;
}

function serialize(xml: XMLDocument): Uint8Array<ArrayBuffer> {
  return encodeOakDocZipText(new XMLSerializer().serializeToString(xml));
}

function controlTag(sdt: Element): string {
  const properties = wordChild(sdt, 'sdtPr');
  return properties ? getWordVal(wordChild(properties, 'tag')) : '';
}

function partialControls(scope: Document | Element): Array<{ sdt: Element; partialId: string; tag: string }> {
  return Array.from(scope.getElementsByTagNameNS(WORD_NS, 'sdt'))
    .map((sdt) => ({ sdt, tag: controlTag(sdt) }))
    .map(({ sdt, tag }) => ({ sdt, tag, partialId: partialIdFromTag(tag) }))
    .filter((entry): entry is { sdt: Element; partialId: string; tag: string } => Boolean(entry.partialId));
}

/** Partial IDs a package references, in document order, without duplicates. */
export function inspectOakDocPartialReferences(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes, { filter: (entry) => entry.name === DOCUMENT_PART });
  if (!files[DOCUMENT_PART]) return [];
  const xml = parseXml(files[DOCUMENT_PART], DOCUMENT_PART);
  return Array.from(new Set(partialControls(xml).map((entry) => entry.partialId)));
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function readRelationships(files: Files): Map<string, Relationship> {
  const bytes = files[DOCUMENT_RELS_PART];
  const result = new Map<string, Relationship>();
  if (!bytes) return result;
  const xml = parseXml(bytes, DOCUMENT_RELS_PART);
  for (const element of Array.from(xml.getElementsByTagNameNS(PKG_REL_NS, 'Relationship'))) {
    result.set(element.getAttribute('Id') || '', {
      id: element.getAttribute('Id') || '',
      type: element.getAttribute('Type') || '',
      target: element.getAttribute('Target') || '',
      external: element.getAttribute('TargetMode') === 'External',
    });
  }
  return result;
}

function relationshipAttributes(root: Element): Attr[] {
  const attributes: Attr[] = [];
  const visit = (element: Element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.namespaceURI === REL_NS) attributes.push(attribute);
    }
    for (const child of wordChildren(element)) visit(child);
  };
  visit(root);
  return attributes;
}

function descendants(blocks: Element[], namespace: string, localName: string): Element[] {
  return blocks.flatMap((block) => [
    ...(block.namespaceURI === namespace && block.localName === localName ? [block] : []),
    ...Array.from(block.getElementsByTagNameNS(namespace, localName)),
  ]);
}

/**
 * Check a partial package at upload. Errors make it unusable as a partial;
 * warnings describe what is dropped when it is inserted into a master.
 */
export function validateOakDocPartialPackage(bytes: Uint8Array): OakDocDiagnostic[] {
  const files = unzipSync(bytes);
  if (!files[DOCUMENT_PART]) {
    return [diagnostic('INVALID_PACKAGE', 'error', 'The partial has no Word document body.')];
  }
  const xml = parseXml(files[DOCUMENT_PART], DOCUMENT_PART);
  const body = xml.getElementsByTagNameNS(WORD_NS, 'body')[0];
  const blocks = body ? wordChildren(body).filter((child) => !isWordElement(child, 'sectPr')) : [];
  const diagnostics: OakDocDiagnostic[] = [];
  if (blocks.length === 0) {
    diagnostics.push(diagnostic('EMPTY', 'error', 'The partial has no content.'));
  }
  const relationships = readRelationships(files);
  const unsupported = new Set<string>();
  for (const block of blocks) {
    for (const attribute of relationshipAttributes(block)) {
      const relationship = relationships.get(attribute.value);
      if (!relationship || (relationship.type !== REL_TYPES.image && relationship.type !== REL_TYPES.hyperlink)) {
        unsupported.add(relationship?.type.split('/').pop() || attribute.value);
      }
    }
  }
  if (unsupported.size > 0) {
    diagnostics.push(diagnostic(
      'UNSUPPORTED_PART',
      'error',
      `The partial uses content that cannot be inserted into another document: ${Array.from(unsupported).sort().join(', ')}. Only text, tables, lists, links and images are supported.`,
    ));
  }
  if (DROPPED_REFERENCES.some((name) => descendants(blocks, WORD_NS, name).length > 0)) {
    diagnostics.push(diagnostic('NOTES_DROPPED', 'warning', 'Comments, footnotes and endnotes in the partial are not carried into documents.'));
  }
  if (descendants(blocks, WORD_NS, 'sectPr').length > 0) {
    diagnostics.push(diagnostic('SECTION_DROPPED', 'warning', 'Section breaks in the partial are removed; the master document controls page layout.'));
  }
  return diagnostics;
}

/** Short content fingerprint for media names (FNV-1a; browser-safe). */
function fingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}${bytes.byteLength.toString(16)}`;
}

class IdAllocator {
  private next: number;

  constructor(start: number) {
    this.next = start;
  }

  take(): number {
    const value = this.next;
    this.next += 1;
    return value;
  }
}

function maxNumeric(values: Iterable<string | null>): number {
  let max = 0;
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric > max) max = numeric;
  }
  return max;
}

function wordAttribute(element: Element, name: string): string {
  return element.getAttributeNS(WORD_NS, name) || element.getAttribute(`w:${name}`) || '';
}

function setWordAttribute(element: Element, name: string, value: string): void {
  element.setAttributeNS(WORD_NS, `w:${name}`, value);
}

/** State for one master package while partials are merged into it. */
class MasterPackage {
  readonly files: Files;
  readonly document: XMLDocument;
  private styles: XMLDocument | null;
  private numbering: XMLDocument | null;
  private readonly relationships: XMLDocument;
  private readonly contentTypes: XMLDocument;
  private readonly controlIds: IdAllocator;
  private readonly drawingIds: IdAllocator;
  private relationshipCounter = 0;
  private dirty = new Set<string>();
  /** The master's conditions and those its partials bring, written after the merge. */
  readonly conditions: Map<string, OakDocConditionDefinition>;
  private readonly masterConditionIds: Set<string>;

  constructor(files: Files) {
    this.files = files;
    this.conditions = readOakDocConditionDefinitionsFromFiles(files);
    this.masterConditionIds = new Set(this.conditions.keys());
    this.document = parseXml(files[DOCUMENT_PART], DOCUMENT_PART);
    this.styles = files[STYLES_PART] ? parseXml(files[STYLES_PART], STYLES_PART) : null;
    this.numbering = files[NUMBERING_PART] ? parseXml(files[NUMBERING_PART], NUMBERING_PART) : null;
    this.relationships = files[DOCUMENT_RELS_PART]
      ? parseXml(files[DOCUMENT_RELS_PART], DOCUMENT_RELS_PART)
      : new DOMParser().parseFromString(`<Relationships xmlns="${PKG_REL_NS}"/>`, 'application/xml');
    this.contentTypes = parseXml(files[CONTENT_TYPES_PART], CONTENT_TYPES_PART);
    const ids = Array.from(this.document.getElementsByTagNameNS(WORD_NS, 'id'))
      .map((element) => wordAttribute(element, 'val'));
    const bookmarkIds = ['bookmarkStart', 'bookmarkEnd']
      .flatMap((name) => Array.from(this.document.getElementsByTagNameNS(WORD_NS, name)))
      .map((element) => wordAttribute(element, 'id'));
    this.controlIds = new IdAllocator(Math.max(200000, maxNumeric([...ids, ...bookmarkIds]) + 1));
    this.drawingIds = new IdAllocator(
      maxNumeric(Array.from(this.document.getElementsByTagNameNS(WP_NS, 'docPr')).map((element) => element.getAttribute('id'))) + 1,
    );
  }

  private ensureStyles(): XMLDocument {
    if (!this.styles) {
      this.styles = new DOMParser().parseFromString(`<w:styles xmlns:w="${WORD_NS}"/>`, 'application/xml');
      this.addRelationship(REL_TYPES.styles, 'styles.xml');
      this.addOverride(`/${STYLES_PART}`, CONTENT_TYPES.styles);
    }
    this.dirty.add(STYLES_PART);
    return this.styles;
  }

  private ensureNumbering(): XMLDocument {
    if (!this.numbering) {
      this.numbering = new DOMParser().parseFromString(`<w:numbering xmlns:w="${WORD_NS}"/>`, 'application/xml');
      this.addRelationship(REL_TYPES.numbering, 'numbering.xml');
      this.addOverride(`/${NUMBERING_PART}`, CONTENT_TYPES.numbering);
    }
    this.dirty.add(NUMBERING_PART);
    return this.numbering;
  }

  private addOverride(partName: string, contentType: string): void {
    const root = this.contentTypes.documentElement;
    const exists = Array.from(root.getElementsByTagNameNS(CT_NS, 'Override'))
      .some((element) => element.getAttribute('PartName') === partName);
    if (exists) return;
    const override = this.contentTypes.createElementNS(CT_NS, 'Override');
    override.setAttribute('PartName', partName);
    override.setAttribute('ContentType', contentType);
    root.appendChild(override);
    this.dirty.add(CONTENT_TYPES_PART);
  }

  ensureDefaultContentType(extension: string, contentType: string): void {
    const root = this.contentTypes.documentElement;
    const exists = Array.from(root.getElementsByTagNameNS(CT_NS, 'Default'))
      .some((element) => (element.getAttribute('Extension') || '').toLowerCase() === extension.toLowerCase());
    if (exists) return;
    const entry = this.contentTypes.createElementNS(CT_NS, 'Default');
    entry.setAttribute('Extension', extension);
    entry.setAttribute('ContentType', contentType);
    root.insertBefore(entry, root.firstChild);
    this.dirty.add(CONTENT_TYPES_PART);
  }

  addRelationship(type: string, target: string, external = false): string {
    const root = this.relationships.documentElement;
    const taken = new Set(
      Array.from(root.getElementsByTagNameNS(PKG_REL_NS, 'Relationship')).map((element) => element.getAttribute('Id')),
    );
    let id = '';
    do {
      this.relationshipCounter += 1;
      id = `rIdOakPartial${this.relationshipCounter}`;
    } while (taken.has(id));
    const relationship = this.relationships.createElementNS(PKG_REL_NS, 'Relationship');
    relationship.setAttribute('Id', id);
    relationship.setAttribute('Type', type);
    relationship.setAttribute('Target', target);
    if (external) relationship.setAttribute('TargetMode', 'External');
    root.appendChild(relationship);
    this.dirty.add(DOCUMENT_RELS_PART);
    return id;
  }

  styleIds(): Map<string, Element> {
    const styles = this.styles;
    if (!styles) return new Map();
    return new Map(
      Array.from(styles.getElementsByTagNameNS(WORD_NS, 'style'))
        .map((style) => [wordAttribute(style, 'styleId'), style]),
    );
  }

  addStyle(style: Element): Element {
    const styles = this.ensureStyles();
    const imported = styles.importNode(style, true) as Element;
    styles.documentElement.appendChild(imported);
    this.dirty.add(STYLES_PART);
    return imported;
  }

  styleSheet(): StyleSheet {
    return readStyleSheet(this.styles);
  }

  addNumbering(abstractNum: Element, num: Element): string {
    const numbering = this.ensureNumbering();
    const root = numbering.documentElement;
    const abstractIds = Array.from(root.getElementsByTagNameNS(WORD_NS, 'abstractNum'))
      .map((element) => wordAttribute(element, 'abstractNumId'));
    const numIds = Array.from(root.getElementsByTagNameNS(WORD_NS, 'num'))
      .map((element) => wordAttribute(element, 'numId'));
    const abstractId = String(maxNumeric(abstractIds) + 1);
    const numId = String(maxNumeric(numIds) + 1);

    const importedAbstract = numbering.importNode(abstractNum, true) as Element;
    setWordAttribute(importedAbstract, 'abstractNumId', abstractId);
    // A numbering style link would point at a style the master may lack.
    for (const link of [...Array.from(importedAbstract.getElementsByTagNameNS(WORD_NS, 'numStyleLink'))]) {
      link.parentNode?.removeChild(link);
    }
    const firstNum = wordChildren(root).find((child) => isWordElement(child, 'num'));
    root.insertBefore(importedAbstract, firstNum ?? null);

    const importedNum = numbering.importNode(num, true) as Element;
    setWordAttribute(importedNum, 'numId', numId);
    const abstractReference = wordChild(importedNum, 'abstractNumId');
    if (abstractReference) setWordAttribute(abstractReference, 'val', abstractId);
    root.appendChild(importedNum);
    return numId;
  }

  nextControlId(): string {
    return String(this.controlIds.take());
  }

  nextDrawingId(): string {
    return String(this.drawingIds.take());
  }

  addMedia(sourceName: string, bytes: Uint8Array): string {
    const base = sourceName.split('/').pop() || 'image';
    const digest = fingerprint(bytes);
    const target = `media/oakpartial-${digest}-${base}`;
    this.files[`word/${target}`] = bytes;
    return target;
  }

  toBytes(): Uint8Array {
    this.files[DOCUMENT_PART] = serialize(this.document);
    if (this.dirty.has(STYLES_PART) && this.styles) this.files[STYLES_PART] = serialize(this.styles);
    if (this.dirty.has(NUMBERING_PART) && this.numbering) this.files[NUMBERING_PART] = serialize(this.numbering);
    if (this.dirty.has(DOCUMENT_RELS_PART)) this.files[DOCUMENT_RELS_PART] = serialize(this.relationships);
    if (this.dirty.has(CONTENT_TYPES_PART)) this.files[CONTENT_TYPES_PART] = serialize(this.contentTypes);
    const bytes = zipSync(this.files, { level: 6 });
    // Conditions live in a custom properties part, added once the package is whole.
    const imported = new Map([...this.conditions].filter(([id]) => !this.masterConditionIds.has(id)));
    return addOakDocConditionDefinitions(bytes, imported);
  }
}

function contentTypeForExtension(files: Files, extension: string): string | null {
  const bytes = files[CONTENT_TYPES_PART];
  if (!bytes) return null;
  const xml = parseXml(bytes, CONTENT_TYPES_PART);
  const match = Array.from(xml.getElementsByTagNameNS(CT_NS, 'Default'))
    .find((element) => (element.getAttribute('Extension') || '').toLowerCase() === extension.toLowerCase());
  return match?.getAttribute('ContentType') ?? null;
}

function resolvePartTarget(target: string): string {
  const parts = `word/${target}`.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part && part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

/**
 * Import one fragment's body into the master. Returns the blocks to insert,
 * or null (with an error diagnostic) when the fragment cannot be merged.
 */
/** Word's built-in values, so a master's document defaults cannot leak in. */
function withWordDefaults(document: Document, resolved: ReturnType<typeof resolveStyle>, kind: StyleKind) {
  const pPr = resolved.pPr ?? document.createElementNS(WORD_NS, 'w:pPr');
  const rPr = resolved.rPr ?? document.createElementNS(WORD_NS, 'w:rPr');
  if (kind === 'paragraph') {
    let spacing = wordChild(pPr, 'spacing');
    if (!spacing) {
      spacing = document.createElementNS(WORD_NS, 'w:spacing');
      const before = wordChildren(pPr).find((child) => ['ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle'].includes(child.localName));
      pPr.insertBefore(spacing, before ?? null);
    }
    for (const [name, value] of [['before', '0'], ['after', '0'], ['line', '240'], ['lineRule', 'auto']] as const) {
      if (!wordAttribute(spacing, name)) setWordAttribute(spacing, name, value);
    }
    for (const name of ['sz', 'szCs'] as const) {
      if (!wordChild(rPr, name)) {
        const size = document.createElementNS(WORD_NS, `w:${name}`);
        setWordAttribute(size, 'val', '20');
        const next = wordChildren(rPr).find((child) => ['highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'].includes(child.localName)
          || (name === 'sz' && child.localName === 'szCs'));
        rPr.insertBefore(size, next ?? null);
      }
    }
  }
  return {
    ...(pPr.childNodes.length > 0 ? { pPr } : {}),
    ...(rPr.childNodes.length > 0 ? { rPr } : {}),
  };
}

/**
 * Give the partial's text the look it has in the partial. A paragraph or
 * character style that resolves the same in both packages is shared; one
 * that differs (or that the master lacks) is added as a self-contained copy,
 * under a new ID when the master already uses the name. Paragraphs without
 * a style take the partial's default paragraph style explicitly. Returns the
 * added styles, whose list references still need renumbering.
 */
function importFragmentStyles(
  master: MasterPackage,
  fragmentSheet: StyleSheet,
  blocks: Element[],
  tag: string,
  diagnostics: OakDocDiagnostic[],
): Element[] {
  const scratch = master.document;
  const defaultStyle = defaultParagraphStyleId(fragmentSheet);
  if (defaultStyle) {
    for (const paragraph of descendants(blocks, WORD_NS, 'p')) {
      let properties = wordChild(paragraph, 'pPr');
      if (properties && wordChild(properties, 'pStyle')) continue;
      if (!properties) {
        properties = scratch.createElementNS(WORD_NS, 'w:pPr');
        paragraph.insertBefore(properties, paragraph.firstChild);
      }
      const pStyle = scratch.createElementNS(WORD_NS, 'w:pStyle');
      setWordAttribute(pStyle, 'val', defaultStyle);
      properties.insertBefore(pStyle, properties.firstChild);
    }
  }

  const masterSheet = master.styleSheet();
  const references = ['pStyle', 'rStyle', 'tblStyle']
    .flatMap((name) => descendants(blocks, WORD_NS, name))
    .filter((element) => getWordVal(element));
  const mapped = new Map<string, string>();
  const copies: Element[] = [];
  let tableConflicts = 0;
  const serializer = new XMLSerializer();

  for (const reference of references) {
    const styleId = getWordVal(reference);
    const known = mapped.get(styleId);
    if (known !== undefined) {
      setWordAttribute(reference, 'val', known);
      continue;
    }
    const source = fragmentSheet.styles.get(styleId);
    if (!source) {
      mapped.set(styleId, styleId);
      continue;
    }
    const type = wordAttribute(source, 'type');
    if (type !== 'paragraph' && type !== 'character') {
      // Table styles: copy what the master lacks; the master's wins otherwise.
      const existing = masterSheet.styles.get(styleId);
      if (!existing) {
        master.addStyle(source);
        (masterSheet.styles as Map<string, Element>).set(styleId, source);
      } else if (serializer.serializeToString(existing) !== serializer.serializeToString(source)) {
        tableConflicts += 1;
      }
      mapped.set(styleId, styleId);
      continue;
    }
    const kind: StyleKind = type;
    const resolved = withWordDefaults(scratch, resolveStyle(fragmentSheet, styleId, kind, scratch), kind);
    const key = resolvedStyleKey(resolved);
    const existing = masterSheet.styles.get(styleId);
    if (existing && resolvedStyleKey(withWordDefaults(scratch, resolveStyle(masterSheet, styleId, kind, scratch), kind)) === key) {
      mapped.set(styleId, styleId);
      continue;
    }
    const targetId = existing ? `${styleId}-${styleKeyHash(key)}` : styleId;
    if (!masterSheet.styles.has(targetId)) {
      const name = getWordVal(wordChild(source, 'name')) || styleId;
      const copy = master.addStyle(createResolvedStyle({
        document: scratch,
        styleId: targetId,
        name: existing ? `${name} (${styleKeyHash(key)})` : name,
        kind,
        resolved,
      }));
      (masterSheet.styles as Map<string, Element>).set(targetId, copy);
      copies.push(copy);
    }
    mapped.set(styleId, targetId);
    setWordAttribute(reference, 'val', targetId);
  }

  if (tableConflicts > 0) {
    diagnostics.push(diagnostic(
      'STYLE_CONFLICT',
      'warning',
      `${tableConflicts} table style${tableConflicts === 1 ? '' : 's'} in a partial differ from the master's table styles of the same name; the master's formatting is used.`,
      tag,
    ));
  }
  return copies;
}

function importFragment(
  master: MasterPackage,
  fragmentFiles: Files,
  tag: string,
  diagnostics: OakDocDiagnostic[],
): Element[] | null {
  const fragment = parseXml(fragmentFiles[DOCUMENT_PART], DOCUMENT_PART);
  const body = fragment.getElementsByTagNameNS(WORD_NS, 'body')[0];
  if (!body) {
    diagnostics.push(diagnostic('INVALID_PACKAGE', 'error', 'A partial has no Word document body.', tag));
    return null;
  }
  const blocks = wordChildren(body)
    .filter((child) => !isWordElement(child, 'sectPr'))
    .map((child) => master.document.importNode(child, true) as Element);

  // Relationships first: an unsupported one stops this partial entirely.
  const relationships = readRelationships(fragmentFiles);
  const attributes = blocks.flatMap((block) => relationshipAttributes(block));
  const unsupported = attributes.filter((attribute) => {
    const relationship = relationships.get(attribute.value);
    return !relationship || (relationship.type !== REL_TYPES.image && relationship.type !== REL_TYPES.hyperlink);
  });
  if (unsupported.length > 0) {
    diagnostics.push(diagnostic(
      'UNSUPPORTED_PART',
      'error',
      'A partial uses content that cannot be inserted into another document.',
      tag,
    ));
    return null;
  }
  const remapped = new Map<string, string>();
  for (const attribute of attributes) {
    let next = remapped.get(attribute.value);
    if (!next) {
      const relationship = relationships.get(attribute.value)!;
      if (relationship.type === REL_TYPES.hyperlink) {
        next = master.addRelationship(REL_TYPES.hyperlink, relationship.target, relationship.external);
      } else {
        const partName = resolvePartTarget(relationship.target);
        const bytes = fragmentFiles[partName];
        if (!bytes) {
          diagnostics.push(diagnostic('MISSING_MEDIA', 'error', 'An image in a partial is missing from its package.', tag));
          return null;
        }
        const extension = partName.split('.').pop() || '';
        const contentType = contentTypeForExtension(fragmentFiles, extension);
        if (contentType) master.ensureDefaultContentType(extension, contentType);
        next = master.addRelationship(REL_TYPES.image, master.addMedia(partName, bytes));
      }
      remapped.set(attribute.value, next);
    }
    attribute.value = next;
  }

  // Section properties belong to the master.
  for (const sectPr of descendants(blocks, WORD_NS, 'sectPr')) {
    sectPr.parentNode?.removeChild(sectPr);
  }
  for (const name of DROPPED_REFERENCES) {
    for (const element of descendants(blocks, WORD_NS, name)) {
      const run = element.parentNode as Element | null;
      element.parentNode?.removeChild(element);
      if (run && isWordElement(run, 'r') && wordChildren(run).every((child) => isWordElement(child, 'rPr'))) {
        run.parentNode?.removeChild(run);
      }
    }
  }

  // Styles: each paragraph and character style keeps the partial's look.
  const fragmentStylesXml = fragmentFiles[STYLES_PART] ? parseXml(fragmentFiles[STYLES_PART], STYLES_PART) : null;
  const styleCopies = importFragmentStyles(master, readStyleSheet(fragmentStylesXml), blocks, tag, diagnostics);

  // Numbering: copy each used list definition under new IDs.
  const numIdElements = descendants([...blocks, ...styleCopies], WORD_NS, 'numId')
    .filter((element) => getWordVal(element) && getWordVal(element) !== '0');
  if (numIdElements.length > 0) {
    const numbering = fragmentFiles[NUMBERING_PART]
      ? parseXml(fragmentFiles[NUMBERING_PART], NUMBERING_PART)
      : null;
    const numById = new Map(
      numbering
        ? Array.from(numbering.getElementsByTagNameNS(WORD_NS, 'num')).map((num) => [wordAttribute(num, 'numId'), num])
        : [],
    );
    const abstractById = new Map(
      numbering
        ? Array.from(numbering.getElementsByTagNameNS(WORD_NS, 'abstractNum'))
            .map((element) => [wordAttribute(element, 'abstractNumId'), element])
        : [],
    );
    const numMap = new Map<string, string>();
    for (const element of numIdElements) {
      const sourceId = getWordVal(element);
      let targetId = numMap.get(sourceId);
      if (!targetId) {
        const num = numById.get(sourceId);
        const abstractNum = num ? abstractById.get(getWordVal(wordChild(num, 'abstractNumId'))) : undefined;
        if (!num || !abstractNum) {
          diagnostics.push(diagnostic('MISSING_NUMBERING', 'warning', 'A list in a partial has no numbering definition and is shown without numbers.', tag));
          targetId = '0';
        } else {
          targetId = master.addNumbering(abstractNum, num);
        }
        numMap.set(sourceId, targetId);
      }
      setWordAttribute(element, 'val', targetId);
    }
  }

  // IDs that must stay unique across the whole document.
  for (const properties of descendants(blocks, WORD_NS, 'sdtPr')) {
    const id = wordChild(properties, 'id');
    if (id) setWordAttribute(id, 'val', master.nextControlId());
  }
  const bookmarkMap = new Map<string, string>();
  for (const name of ['bookmarkStart', 'bookmarkEnd']) {
    for (const element of descendants(blocks, WORD_NS, name)) {
      const source = wordAttribute(element, 'id');
      if (!bookmarkMap.has(source)) bookmarkMap.set(source, master.nextControlId());
      setWordAttribute(element, 'id', bookmarkMap.get(source)!);
    }
  }
  for (const docPr of descendants(blocks, WP_NS, 'docPr')) {
    docPr.setAttribute('id', master.nextDrawingId());
  }
  // Conditional blocks in the partial keep their conditions.
  importOakDocConditionBlocks({
    blocks,
    source: readOakDocConditionDefinitionsFromFiles(fragmentFiles),
    target: master.conditions,
  });

  return blocks;
}

/**
 * Insert a reference to a partial as its own block after the paragraph the
 * caret is in. The reference shows the partial's name until generation
 * replaces it with the pinned partial body.
 */
export function insertOakDocPartialReference(input: {
  docxBytes: Uint8Array;
  paraId: string;
  partialId: string;
  label: string;
}): Uint8Array {
  if (!partialIdFromTag(oakDocPartialTag(input.partialId))) {
    throw new Error('This partial cannot be referenced.');
  }
  const files = unzipSync(input.docxBytes);
  if (!files[DOCUMENT_PART]) throw new Error('OakDoc could not find word/document.xml.');
  const xml = parseXml(files[DOCUMENT_PART], DOCUMENT_PART);
  const expected = input.paraId.trim().toUpperCase();
  const paragraph = Array.from(xml.getElementsByTagNameNS(WORD_NS, 'p')).find((candidate) => (
    (candidate.getAttributeNS('http://schemas.microsoft.com/office/word/2010/wordml', 'paraId')
      || candidate.getAttribute('w14:paraId')
      || '').toUpperCase() === expected
  ));
  if (!paragraph) throw new Error('Place the caret in a paragraph first.');
  // Climb out of block controls so the reference lands at body or cell level.
  let anchor: Element = paragraph;
  while (anchor.parentNode && isWordElement(anchor.parentNode, 'sdtContent')) {
    const sdt = anchor.parentNode.parentNode as Element | null;
    if (!sdt) break;
    anchor = sdt;
  }
  const parent = anchor.parentNode as Element | null;
  if (!parent || !['body', 'tc'].includes(parent.localName)) {
    throw new Error('Partials can only be inserted between paragraphs, not inside one.');
  }

  const element = (name: string, attributes: Record<string, string> = {}) => {
    const created = xml.createElementNS(WORD_NS, `w:${name}`);
    for (const [key, value] of Object.entries(attributes)) created.setAttributeNS(WORD_NS, `w:${key}`, value);
    return created;
  };
  const ids = Array.from(xml.getElementsByTagNameNS(WORD_NS, 'id')).map((id) => wordAttribute(id, 'val'));
  const sdt = element('sdt');
  const properties = element('sdtPr');
  properties.appendChild(element('alias', { val: `Partial: ${input.label}` }));
  properties.appendChild(element('tag', { val: oakDocPartialTag(input.partialId) }));
  properties.appendChild(element('id', { val: String(Math.max(300000, maxNumeric(ids) + 1)) }));
  properties.appendChild(element('lock', { val: 'sdtContentLocked' }));
  sdt.appendChild(properties);
  const content = element('sdtContent');
  const body = element('p');
  const run = element('r');
  const text = element('t');
  text.textContent = `[Partial: ${input.label}]`;
  run.appendChild(text);
  body.appendChild(run);
  content.appendChild(body);
  sdt.appendChild(content);
  parent.insertBefore(sdt, anchor.nextSibling);

  files[DOCUMENT_PART] = serialize(xml);
  return zipSync(files, { level: 6 });
}

export interface OakDocPartialExpansionResult {
  bytes: Uint8Array;
  diagnostics: OakDocDiagnostic[];
  /** Partial IDs inserted, including nested ones. */
  expanded: string[];
}

function expandInto(
  master: MasterPackage,
  scope: Document | Element,
  fragments: ReadonlyMap<string, Uint8Array>,
  chain: string[],
  diagnostics: OakDocDiagnostic[],
  expanded: Set<string>,
  maxDepth: number,
): void {
  for (const { sdt, partialId, tag } of partialControls(scope)) {
    const parent = sdt.parentNode as Element | null;
    if (!parent) continue;
    if (!['body', 'tc', 'sdtContent', 'txbxContent'].includes(parent.localName)) {
      diagnostics.push(diagnostic('INLINE_REFERENCE', 'error', 'A partial must be placed on its own line, not inside a paragraph.', tag));
      continue;
    }
    if (chain.includes(partialId)) {
      diagnostics.push(diagnostic('CYCLE', 'error', 'A partial includes itself, directly or through another partial.', tag));
      continue;
    }
    if (chain.length >= maxDepth) {
      diagnostics.push(diagnostic('DEPTH', 'error', `Partials can be nested at most ${maxDepth} levels deep.`, tag));
      continue;
    }
    const fragmentBytes = fragments.get(partialId);
    if (!fragmentBytes) {
      diagnostics.push(diagnostic('MISSING', 'error', 'A partial used by this template is missing or not available in this workspace.', tag));
      continue;
    }
    const fragmentFiles = unzipSync(fragmentBytes);
    if (!fragmentFiles[DOCUMENT_PART]) {
      diagnostics.push(diagnostic('INVALID_PACKAGE', 'error', 'A partial has no Word document body.', tag));
      continue;
    }
    const blocks = importFragment(master, fragmentFiles, tag, diagnostics);
    if (!blocks) continue;

    // Place the blocks in a temporary holder so nested references inside
    // them expand with this partial on the chain, then unwrap the holder.
    const holder = master.document.createElementNS(WORD_NS, 'w:sdtContent');
    for (const block of blocks) holder.appendChild(block);
    parent.replaceChild(holder, sdt);
    expanded.add(partialId);
    expandInto(master, holder, fragments, [...chain, partialId], diagnostics, expanded, maxDepth);
    while (holder.firstChild) parent.insertBefore(holder.firstChild, holder);
    parent.removeChild(holder);
  }
}

/**
 * Replace every partial reference in `docxBytes` with the partial's body.
 * `fragments` holds the pinned bytes for every partial that may be needed,
 * including nested ones. References that cannot be expanded stay in place
 * and are reported as error diagnostics.
 */
export function expandOakDocPartials(input: {
  docxBytes: Uint8Array;
  fragments: ReadonlyMap<string, Uint8Array>;
  maxDepth?: number;
}): OakDocPartialExpansionResult {
  const files = unzipSync(input.docxBytes);
  if (!files[DOCUMENT_PART]) throw new Error('OakDoc could not find word/document.xml.');
  const master = new MasterPackage(files);
  if (partialControls(master.document).length === 0) {
    return { bytes: input.docxBytes, diagnostics: [], expanded: [] };
  }
  const diagnostics: OakDocDiagnostic[] = [];
  const expanded = new Set<string>();
  expandInto(
    master,
    master.document,
    input.fragments,
    [],
    diagnostics,
    expanded,
    input.maxDepth ?? OAKDOC_PARTIAL_MAX_DEPTH,
  );
  return { bytes: master.toBytes(), diagnostics, expanded: Array.from(expanded) };
}

/**
 * A service variant whose scope of work is a Word partial snapshots the
 * partial's pin instead of HTML wording. The snapshot is kept in the item's
 * text column as a small HTML wrapper, so A4 renderers show a short notice
 * and OakDoc expands the pinned Word body in its place.
 */
export interface OakDocSowSnapshot {
  pin: OakDocPartialPin;
  /** Field tags the pinned partial uses, so generation resolves them. */
  fieldTags: string[];
}

const SOW_SNAPSHOT_PATTERN = /^<div data-oakdoc-sow="([^"]*)">/;
const SOW_SNAPSHOT_NOTICE =
  '<p>This scope of work is a Word partial and appears in the OakDoc version of this agreement.</p>';

export function encodeOakDocSowSnapshot(snapshot: OakDocSowSnapshot): string {
  const payload = encodeURIComponent(JSON.stringify({ schemaVersion: 1, ...snapshot }));
  return `<div data-oakdoc-sow="${payload}">${SOW_SNAPSHOT_NOTICE}</div>`;
}

/** Read a Word scope-of-work snapshot, or null for HTML wording. */
export function readOakDocSowSnapshot(content: string): OakDocSowSnapshot | null {
  const match = SOW_SNAPSHOT_PATTERN.exec(content);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(match[1]));
  } catch {
    parsed = null;
  }
  const pin = isRecord(parsed) ? readPin(parsed.pin, 0) : null;
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !pin) {
    throw new ValidationError('The Word scope-of-work snapshot is damaged', {
      reason: 'OAKDOC_SOW_SNAPSHOT_INVALID',
    });
  }
  const fieldTags = Array.isArray(parsed.fieldTags)
    ? parsed.fieldTags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  return { pin, fieldTags };
}
