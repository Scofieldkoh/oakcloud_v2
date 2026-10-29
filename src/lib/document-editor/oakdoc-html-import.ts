import { strFromU8, unzipSync, zipSync } from 'fflate';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import { isA4AlwaysRejectedTag } from '@/lib/a4-content-policy';
import type { OakDocDiagnostic } from '@/types/oakdoc';

/**
 * HTML to WordprocessingML conversion shared by the Service Agreement
 * renderer (SOW partials) and the P8 A4 draft conversion.
 *
 * The converter covers paragraphs, headings, flat lists (numbers written as
 * text), simple tables, page breaks and inline marks. Anything it cannot
 * carry over is reported by `diagnoseHtmlForOakDocImport` instead of
 * disappearing silently. Needs DOMParser/XMLSerializer (browser or
 * `ensureA4ServerDomGlobals()` on the server).
 */

export const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface InlineMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSizeHalfPoints?: number;
  vertAlign?: 'superscript' | 'subscript';
}

export function wordElement(
  document: XMLDocument,
  localName: string,
  attributes: Readonly<Record<string, string>> = {},
): Element {
  const element = document.createElementNS(WORD_NS, `w:${localName}`);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttributeNS(WORD_NS, `w:${name}`, value);
  }
  return element;
}

export function appendTextRun(
  document: XMLDocument,
  parent: Element,
  value: string,
  marks: InlineMarks = {},
): Element {
  const run = wordElement(document, 'r');
  const needsProperties = marks.bold
    || marks.italic
    || marks.underline
    || marks.strike
    || marks.fontSizeHalfPoints
    || marks.vertAlign;
  if (needsProperties) {
    const properties = wordElement(document, 'rPr');
    if (marks.bold) properties.appendChild(wordElement(document, 'b'));
    if (marks.italic) properties.appendChild(wordElement(document, 'i'));
    if (marks.underline) {
      properties.appendChild(wordElement(document, 'u', { val: 'single' }));
    }
    if (marks.strike) properties.appendChild(wordElement(document, 'strike'));
    if (marks.fontSizeHalfPoints) {
      properties.appendChild(
        wordElement(document, 'sz', { val: String(marks.fontSizeHalfPoints) }),
      );
      properties.appendChild(
        wordElement(document, 'szCs', { val: String(marks.fontSizeHalfPoints) }),
      );
    }
    if (marks.vertAlign) {
      properties.appendChild(wordElement(document, 'vertAlign', { val: marks.vertAlign }));
    }
    run.appendChild(properties);
  }
  const text = wordElement(document, 't');
  text.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  text.textContent = value;
  run.appendChild(text);
  parent.appendChild(run);
  return run;
}

export function appendLineBreak(
  document: XMLDocument,
  parent: Element,
  type?: 'page',
): void {
  const run = wordElement(document, 'r');
  run.appendChild(wordElement(document, 'br', type ? { type } : {}));
  parent.appendChild(run);
}

function isPageBreakMarker(element: Element): boolean {
  return element.getAttribute('data-a4-break') === 'page'
    || element.getAttribute('data-break-type') === 'page';
}

function styleMap(element: Element): Map<string, string> {
  const style = element.getAttribute('style') || '';
  return new Map(
    style
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf(':');
        return separator >= 0
          ? [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()]
          : [part.toLowerCase(), ''];
      }),
  );
}

function fontSizeHalfPoints(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^([0-9.]+)(pt|px)$/i);
  if (!match) return undefined;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  const points = match[2].toLowerCase() === 'px' ? numeric * 0.75 : numeric;
  return Math.max(2, Math.round(points * 2));
}

function inlineMarks(element: Element, inherited: InlineMarks): InlineMarks {
  const tag = element.tagName.toLowerCase();
  const styles = styleMap(element);
  const fontWeight = styles.get('font-weight')?.toLowerCase();
  const textDecoration = styles.get('text-decoration')?.toLowerCase() ?? '';
  return {
    bold: inherited.bold
      || tag === 'b'
      || tag === 'strong'
      || fontWeight === 'bold'
      || (fontWeight ? Number(fontWeight) >= 600 : false),
    italic: inherited.italic
      || tag === 'i'
      || tag === 'em'
      || styles.get('font-style')?.toLowerCase() === 'italic',
    underline: inherited.underline
      || tag === 'u'
      || textDecoration.includes('underline'),
    strike: inherited.strike
      || tag === 's'
      || tag === 'strike'
      || tag === 'del'
      || textDecoration.includes('line-through'),
    fontSizeHalfPoints:
      fontSizeHalfPoints(styles.get('font-size')) ?? inherited.fontSizeHalfPoints,
    vertAlign: tag === 'sup'
      ? 'superscript'
      : tag === 'sub'
        ? 'subscript'
        : inherited.vertAlign,
  };
}

function appendInlineHtml(
  document: XMLDocument,
  parent: Element,
  node: Node,
  marks: InlineMarks = {},
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const normalized = (node.textContent || '').replace(/\s+/g, ' ');
    if (normalized) appendTextRun(document, parent, normalized, marks);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (tag === 'br') {
    appendLineBreak(document, parent);
    return;
  }
  if (isPageBreakMarker(element)) {
    appendLineBreak(document, parent, 'page');
    return;
  }
  if (isA4AlwaysRejectedTag(tag)) return;

  const nextMarks = inlineMarks(element, marks);
  for (const child of Array.from(element.childNodes)) {
    appendInlineHtml(document, parent, child, nextMarks);
  }
}

function paragraphPropertiesFromHtml(
  document: XMLDocument,
  element: Element | null,
  headingLevel?: number,
): Element | null {
  const properties = wordElement(document, 'pPr');
  let used = false;

  if (headingLevel) {
    properties.appendChild(
      wordElement(document, 'pStyle', { val: `Heading${Math.min(headingLevel, 6)}` }),
    );
    used = true;
  }

  if (element) {
    const styles = styleMap(element);
    const alignment = styles.get('text-align')?.toLowerCase();
    if (alignment && ['left', 'right', 'center', 'justify'].includes(alignment)) {
      // Word's value for justified text is "both"; "justify" is not valid OOXML.
      properties.appendChild(wordElement(document, 'jc', { val: alignment === 'justify' ? 'both' : alignment }));
      used = true;
    }

    const marginLeft = styles.get('margin-left');
    const match = marginLeft?.match(/^([0-9.]+)(em|pt|px)$/i);
    if (match) {
      const numeric = Number(match[1]);
      const unit = match[2].toLowerCase();
      const points = unit === 'em' ? numeric * 11 : unit === 'px' ? numeric * 0.75 : numeric;
      properties.appendChild(
        wordElement(document, 'ind', { left: String(Math.max(0, Math.round(points * 20))) }),
      );
      used = true;
    }
  }

  return used ? properties : null;
}

function createParagraphFromHtml(
  document: XMLDocument,
  element: Element,
  options: { prefix?: string; headingLevel?: number } = {},
): Element {
  const paragraph = wordElement(document, 'p');
  const properties = paragraphPropertiesFromHtml(
    document,
    element,
    options.headingLevel,
  );
  if (properties) paragraph.appendChild(properties);
  if (options.prefix) appendTextRun(document, paragraph, options.prefix);
  for (const child of Array.from(element.childNodes)) {
    appendInlineHtml(document, paragraph, child);
  }
  return paragraph;
}

function createSimpleTableFromHtml(
  document: XMLDocument,
  table: Element,
): Element {
  const rows = Array.from(table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr'));
  const effectiveRows = rows.length > 0 ? rows : Array.from(table.querySelectorAll('tr'));
  const maxColumns = Math.max(
    1,
    ...effectiveRows.map((row) => row.querySelectorAll(':scope > th, :scope > td').length),
  );
  const width = 9000;
  const columnWidth = Math.floor(width / maxColumns);
  const result = wordElement(document, 'tbl');
  const properties = wordElement(document, 'tblPr');
  properties.appendChild(wordElement(document, 'tblW', { w: String(width), type: 'dxa' }));
  properties.appendChild(wordElement(document, 'tblLayout', { type: 'fixed' }));
  result.appendChild(properties);
  const grid = wordElement(document, 'tblGrid');
  for (let index = 0; index < maxColumns; index += 1) {
    grid.appendChild(wordElement(document, 'gridCol', { w: String(columnWidth) }));
  }
  result.appendChild(grid);

  effectiveRows.forEach((row) => {
    const wordRow = wordElement(document, 'tr');
    const cells = Array.from(row.querySelectorAll(':scope > th, :scope > td'));
    cells.forEach((cell) => {
      const wordCell = wordElement(document, 'tc');
      const cellProperties = wordElement(document, 'tcPr');
      cellProperties.appendChild(
        wordElement(document, 'tcW', { w: String(columnWidth), type: 'dxa' }),
      );
      wordCell.appendChild(cellProperties);
      const paragraph = wordElement(document, 'p');
      for (const child of Array.from(cell.childNodes)) {
        appendInlineHtml(
          document,
          paragraph,
          child,
          cell.tagName.toLowerCase() === 'th' ? { bold: true } : {},
        );
      }
      wordCell.appendChild(paragraph);
      wordRow.appendChild(wordCell);
    });
    result.appendChild(wordRow);
  });
  return result;
}

function parseHtmlBody(html: string): HTMLElement {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html',
  ).body;
}

/** Convert an HTML fragment into Word block elements (`w:p` / `w:tbl`). */
export function htmlToWordBlocks(
  wordDocument: XMLDocument,
  html: string,
): Element[] {
  const body = parseHtmlBody(html);
  const blocks: Element[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) {
        const paragraph = wordElement(wordDocument, 'p');
        appendTextRun(wordDocument, paragraph, text);
        blocks.push(paragraph);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (isA4AlwaysRejectedTag(tag)) return;

    if (/^h[1-6]$/.test(tag)) {
      blocks.push(
        createParagraphFromHtml(wordDocument, element, {
          headingLevel: Number(tag.slice(1)),
        }),
      );
      return;
    }
    if (tag === 'p' || tag === 'blockquote') {
      blocks.push(createParagraphFromHtml(wordDocument, element));
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(element.children).filter(
        (child) => child.tagName.toLowerCase() === 'li',
      );
      const start = tag === 'ol' ? Number(element.getAttribute('start') || 1) || 1 : 1;
      items.forEach((item, index) => {
        blocks.push(
          createParagraphFromHtml(wordDocument, item, {
            prefix: tag === 'ol' ? `${start + index}. ` : '• ',
          }),
        );
      });
      return;
    }
    if (tag === 'table') {
      blocks.push(createSimpleTableFromHtml(wordDocument, element));
      return;
    }
    if (tag === 'br') {
      const paragraph = wordElement(wordDocument, 'p');
      appendLineBreak(wordDocument, paragraph);
      blocks.push(paragraph);
      return;
    }
    if (isPageBreakMarker(element)) {
      const paragraph = wordElement(wordDocument, 'p');
      appendLineBreak(wordDocument, paragraph, 'page');
      blocks.push(paragraph);
      return;
    }
    if (tag === 'hr') {
      const paragraph = wordElement(wordDocument, 'p');
      const properties = wordElement(wordDocument, 'pPr');
      const borders = wordElement(wordDocument, 'pBdr');
      borders.appendChild(
        wordElement(wordDocument, 'bottom', { val: 'single', sz: '6', space: '1', color: 'auto' }),
      );
      properties.appendChild(borders);
      paragraph.appendChild(properties);
      blocks.push(paragraph);
      return;
    }

    const blockChildren = Array.from(element.children).some((child) =>
      /^(p|div|section|article|h[1-6]|ul|ol|table|blockquote|hr)$/i.test(child.tagName)
      || isPageBreakMarker(child),
    );
    if (blockChildren) {
      for (const child of Array.from(element.childNodes)) visit(child);
      return;
    }

    const paragraph = createParagraphFromHtml(wordDocument, element);
    if (
      paragraph.getElementsByTagNameNS(WORD_NS, 't').length > 0
      || paragraph.getElementsByTagNameNS(WORD_NS, 'br').length > 0
    ) {
      blocks.push(paragraph);
    }
  };

  for (const child of Array.from(body.childNodes)) visit(child);
  return blocks.length > 0 ? blocks : [wordElement(wordDocument, 'p')];
}

function diagnostic(
  code: string,
  severity: OakDocDiagnostic['severity'],
  message: string,
): OakDocDiagnostic {
  return { code: `OAKDOC_IMPORT_${code}`, severity, stage: 'import', message };
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Style properties the converter carries over; anything else is reported. */
const SUPPORTED_STYLE_PROPERTIES = new Set([
  'font-weight', 'font-style', 'text-decoration', 'font-size', 'text-align', 'margin-left',
]);

/**
 * Report every construct `htmlToWordBlocks` cannot carry over faithfully.
 * Errors lose content or structure and must be acknowledged before a
 * converted copy is accepted; warnings lose only presentation.
 */
export function diagnoseHtmlForOakDocImport(html: string): OakDocDiagnostic[] {
  const body = parseHtmlBody(html);
  const diagnostics: OakDocDiagnostic[] = [];
  const all = Array.from(body.querySelectorAll('*'));
  const count = (predicate: (element: Element) => boolean) => all.filter(predicate).length;
  const tagOf = (element: Element) => element.tagName.toLowerCase();

  const images = count((element) => tagOf(element) === 'img');
  if (images > 0) {
    diagnostics.push(diagnostic(
      'IMAGE_DROPPED',
      'error',
      `${plural(images, 'image')} cannot be carried over. Insert them again in the OakDoc copy.`,
    ));
  }

  const mergedCells = count((element) =>
    (tagOf(element) === 'td' || tagOf(element) === 'th')
    && (Number(element.getAttribute('colspan') || 1) > 1 || Number(element.getAttribute('rowspan') || 1) > 1));
  if (mergedCells > 0) {
    diagnostics.push(diagnostic(
      'MERGED_CELLS',
      'error',
      `${plural(mergedCells, 'merged table cell')} will be split. Check the table layout in the OakDoc copy.`,
    ));
  }

  const nestedTables = count((element) => tagOf(element) === 'table' && Boolean(element.parentElement?.closest('table')));
  if (nestedTables > 0) {
    diagnostics.push(diagnostic(
      'NESTED_TABLE',
      'error',
      `${plural(nestedTables, 'table')} inside other tables will be flattened to text.`,
    ));
  }

  const nestedLists = count((element) =>
    (tagOf(element) === 'ul' || tagOf(element) === 'ol') && Boolean(element.parentElement?.closest('li')));
  if (nestedLists > 0) {
    diagnostics.push(diagnostic(
      'NESTED_LIST',
      'error',
      `${plural(nestedLists, 'nested list')} will be merged into the parent item. Check list levels in the OakDoc copy.`,
    ));
  }

  const loops = count((element) => element.hasAttribute('data-template-each'));
  const text = body.textContent || '';
  const placeholders = Array.from(new Set(text.match(/\{\{[^{}]+\}\}/g) ?? []));
  if (loops > 0 || placeholders.length > 0) {
    diagnostics.push(diagnostic(
      'UNRESOLVED_PLACEHOLDER',
      'error',
      placeholders.length > 0
        ? `Unfilled placeholders stay as plain text: ${placeholders.slice(0, 5).join(', ')}${placeholders.length > 5 ? ', …' : ''}.`
        : 'Unfilled repeating blocks stay as plain text.',
    ));
  }

  const cellsWithBlocks = count((element) =>
    (tagOf(element) === 'td' || tagOf(element) === 'th')
    && element.querySelectorAll('p, div, ul, ol, h1, h2, h3, h4, h5, h6, blockquote').length > 1);
  if (cellsWithBlocks > 0) {
    diagnostics.push(diagnostic(
      'CELL_PARAGRAPHS_MERGED',
      'warning',
      `${plural(cellsWithBlocks, 'table cell')} with several paragraphs will be joined into one paragraph.`,
    ));
  }

  const lists = count((element) => tagOf(element) === 'ul' || tagOf(element) === 'ol');
  if (lists > 0) {
    diagnostics.push(diagnostic(
      'LIST_AS_TEXT',
      'warning',
      `${plural(lists, 'list')} will use typed numbers and bullets instead of Word list numbering.`,
    ));
  }

  const lostLinks = count((element) => {
    if (tagOf(element) !== 'a') return false;
    const href = (element.getAttribute('href') || '').trim();
    return Boolean(href) && href.replace(/^mailto:/i, '') !== (element.textContent || '').trim();
  });
  if (lostLinks > 0) {
    diagnostics.push(diagnostic(
      'LINK_TARGET_DROPPED',
      'warning',
      `${plural(lostLinks, 'link')} will keep their text but not their web address.`,
    ));
  }

  const rejected = count((element) => isA4AlwaysRejectedTag(tagOf(element)));
  if (rejected > 0) {
    diagnostics.push(diagnostic(
      'ACTIVE_CONTENT_REMOVED',
      'warning',
      `${plural(rejected, 'script, form or embedded element')} will be removed.`,
    ));
  }

  const droppedStyles = new Set<string>();
  for (const element of all) {
    for (const [property] of styleMap(element)) {
      if (!SUPPORTED_STYLE_PROPERTIES.has(property)) droppedStyles.add(property);
    }
  }
  if (droppedStyles.size > 0) {
    diagnostics.push(diagnostic(
      'STYLE_DROPPED',
      'warning',
      `Some formatting is not carried over: ${Array.from(droppedStyles).sort().slice(0, 6).join(', ')}.`,
    ));
  }

  return diagnostics;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, '');
}

/**
 * True when every visible character of the HTML appears, in order, in the
 * Word text. List prefixes the converter adds are extra characters, so a
 * subsequence check proves no typed text was dropped.
 */
export function wordTextPreservesHtmlText(html: string, wordText: string): boolean {
  const body = parseHtmlBody(html);
  for (const element of Array.from(body.querySelectorAll('script, style, iframe, object, embed, textarea, select'))) {
    element.remove();
  }
  const expected = normalizedText(body.textContent || '');
  const actual = normalizedText(wordText);
  let cursor = 0;
  for (const character of expected) {
    cursor = actual.indexOf(character, cursor);
    if (cursor < 0) return false;
    cursor += 1;
  }
  return true;
}

/** Plain text of a DOCX body, for preservation checks. */
export function readOakDocBodyText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (entry) => entry.name === 'word/document.xml' });
  const part = files['word/document.xml'];
  if (!part) return '';
  const xml = new DOMParser().parseFromString(strFromU8(part), 'application/xml');
  return Array.from(xml.getElementsByTagNameNS(WORD_NS, 't'))
    .map((element) => element.textContent || '')
    .join(' ');
}

const IMPORT_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD_NS}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto" w:after="120"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[1, 2, 3, 4, 5, 6].map((level) => `  <w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.max(22, 34 - level * 2)}"/></w:rPr></w:style>`).join('\n')}
</w:styles>`;

const IMPORT_DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const IMPORT_PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const IMPORT_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

export interface OakDocHtmlImportResult {
  bytes: Uint8Array;
  diagnostics: OakDocDiagnostic[];
}

/**
 * Build a standalone A4 DOCX from an HTML fragment and report what could
 * not be carried over, including a text-preservation check on the output.
 */
export function buildOakDocFromHtml(html: string): OakDocHtmlImportResult {
  const wordDocument = new DOMParser().parseFromString(
    `<w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}"><w:body/></w:document>`,
    'application/xml',
  );
  const body = wordDocument.getElementsByTagNameNS(WORD_NS, 'body')[0];
  for (const block of htmlToWordBlocks(wordDocument, html)) body.appendChild(block);
  const section = wordElement(wordDocument, 'sectPr');
  section.appendChild(wordElement(wordDocument, 'pgSz', { w: '11906', h: '16838' }));
  section.appendChild(wordElement(wordDocument, 'pgMar', {
    top: '1134', right: '1134', bottom: '1134', left: '1134', header: '568', footer: '568', gutter: '0',
  }));
  body.appendChild(section);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${new XMLSerializer().serializeToString(wordDocument)}`;
  const bytes = zipSync({
    '[Content_Types].xml': encodeOakDocZipText(IMPORT_CONTENT_TYPES),
    '_rels/.rels': encodeOakDocZipText(IMPORT_PACKAGE_RELS),
    'word/document.xml': encodeOakDocZipText(documentXml),
    'word/styles.xml': encodeOakDocZipText(IMPORT_STYLES_XML),
    'word/_rels/document.xml.rels': encodeOakDocZipText(IMPORT_DOCUMENT_RELS),
  }, { level: 6 });

  const diagnostics = diagnoseHtmlForOakDocImport(html);
  if (!wordTextPreservesHtmlText(html, readOakDocBodyText(bytes))) {
    diagnostics.unshift(diagnostic(
      'TEXT_NOT_PRESERVED',
      'error',
      'Some text did not carry over. Compare the OakDoc copy with the original before accepting it.',
    ));
  }
  return { bytes, diagnostics };
}

/** An empty A4 Word document: the starting point for blank documents, templates and partials. */
export function buildBlankOakDocBytes(): Uint8Array {
  return buildOakDocFromHtml('<p></p>').bytes;
}
