import { zipSync } from 'fflate';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';

/**
 * Small WordprocessingML builders for the reference-layout Service Agreement
 * master and its scope-of-work partials. Every paragraph and run carries its
 * formatting explicitly, so the reference typography (Arial 10 pt, black,
 * selective bold/underline) survives field replacement, partial merges and
 * editing instead of depending on one inherited default.
 */

export const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W15_NS = 'http://schemas.microsoft.com/office/word/2012/wordml';

/** Reference page: 11,910 × 16,840 twips with 1-inch margins. */
export const REFERENCE_PAGE = {
  width: 11910,
  height: 16840,
  margin: 1440,
  headerFooter: 720,
} as const;

export const REFERENCE_HYPERLINK_COLOR = '0000FF';

export function xmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface RunFormat {
  bold?: boolean;
  underline?: boolean;
  /** Character style, such as the Hyperlink style. */
  style?: string;
}

/** Explicit Arial 10 pt black run properties for one run role. */
export function runProperties(format: RunFormat = {}): string {
  return [
    '<w:rPr>',
    format.style ? `<w:rStyle w:val="${format.style}"/>` : '',
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>',
    format.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>',
    format.style ? '' : '<w:color w:val="000000"/>',
    '<w:sz w:val="20"/><w:szCs w:val="20"/>',
    format.underline ? '<w:u w:val="single"/>' : '',
    '</w:rPr>',
  ].join('');
}

/** One run; `\n` becomes a line break inside the same run. */
export function run(text: string, format: RunFormat = {}): string {
  if (!text) return '';
  const content = text.split('\n').map((line, index) => [
    index > 0 ? '<w:br/>' : '',
    `<w:t xml:space="preserve">${xmlText(line)}</w:t>`,
  ].join('')).join('');
  return `<w:r>${runProperties(format)}${content}</w:r>`;
}

/** Runs for text that marks bold spans as `**bold**`. */
export function richRuns(text: string, format: RunFormat = {}): string {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part) => (
    part.startsWith('**') && part.endsWith('**')
      ? run(part.slice(2, -2), { ...format, bold: true })
      : run(part, format)
  )).join('');
}

/** Allocates content-control IDs for one package build. */
export class ControlIds {
  private next: number;

  constructor(start = 7000) {
    this.next = start;
  }

  take(): number {
    const value = this.next;
    this.next += 1;
    return value;
  }
}

/**
 * An inline field control. The placeholder run carries the occurrence's own
 * formatting, which replacement keeps. `dateFormat` asks generation for a
 * Word date pattern such as `d MMMM yyyy`.
 */
export function fieldControl(
  ids: ControlIds,
  tag: string,
  format: RunFormat = {},
  options: { alias?: string; dateFormat?: string } = {},
): string {
  return [
    '<w:sdt><w:sdtPr>',
    `<w:alias w:val="${xmlText(options.alias ?? tag)}"/>`,
    `<w:tag w:val="${xmlText(tag)}"/>`,
    `<w:id w:val="${ids.take()}"/>`,
    options.dateFormat
      ? `<w:date><w:dateFormat w:val="${xmlText(options.dateFormat)}"/><w:lid w:val="en-SG"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>`
      : '',
    '</w:sdtPr><w:sdtContent>',
    run(`{{${tag}}}`, format),
    '</w:sdtContent></w:sdt>',
  ].join('');
}

/**
 * An email field wrapped in a HYPERLINK field, so the resolved address is a
 * working mailto link in the reference hyperlink style.
 */
export function emailFieldControl(ids: ControlIds, tag: string): string {
  const format: RunFormat = { style: 'Hyperlink' };
  return [
    '<w:sdt><w:sdtPr>',
    `<w:alias w:val="${xmlText(tag)}"/>`,
    `<w:tag w:val="${xmlText(tag)}"/>`,
    `<w:id w:val="${ids.take()}"/>`,
    '</w:sdtPr><w:sdtContent>',
    `<w:r>${runProperties(format)}<w:fldChar w:fldCharType="begin"/></w:r>`,
    `<w:r>${runProperties(format)}<w:instrText xml:space="preserve"> HYPERLINK "mailto:" </w:instrText></w:r>`,
    `<w:r>${runProperties(format)}<w:fldChar w:fldCharType="separate"/></w:r>`,
    run(`{{${tag}}}`, format),
    `<w:r>${runProperties(format)}<w:fldChar w:fldCharType="end"/></w:r>`,
    '</w:sdtContent></w:sdt>',
  ].join('');
}

export interface ParagraphFormat {
  style?: string;
  align?: 'left' | 'center' | 'both' | 'right';
  before?: number;
  after?: number;
  /** Auto line spacing in 240ths of a line; the reference uses 276. */
  line?: number;
  left?: number;
  right?: number;
  hanging?: number;
  firstLine?: number;
  /** `true` keeps with the next paragraph; `false` writes an explicit stop. */
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  numbering?: { numId: number; level?: number };
  /** Paragraph-mark formatting, so empty paragraphs keep the body height. */
  mark?: RunFormat;
  /** Section properties ending a section at this paragraph. */
  section?: string;
}

export function paragraphProperties(format: ParagraphFormat = {}): string {
  const indent = [
    format.left !== undefined ? ` w:left="${format.left}"` : '',
    format.right !== undefined ? ` w:right="${format.right}"` : '',
    format.hanging !== undefined ? ` w:hanging="${format.hanging}"` : '',
    format.firstLine !== undefined ? ` w:firstLine="${format.firstLine}"` : '',
  ].join('');
  return [
    '<w:pPr>',
    format.style ? `<w:pStyle w:val="${format.style}"/>` : '',
    format.keepNext === true ? '<w:keepNext/>' : '',
    format.keepNext === false ? '<w:keepNext w:val="0"/>' : '',
    format.keepLines ? '<w:keepLines/>' : '',
    format.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    format.numbering
      ? `<w:numPr><w:ilvl w:val="${format.numbering.level ?? 0}"/><w:numId w:val="${format.numbering.numId}"/></w:numPr>`
      : '',
    `<w:spacing w:before="${format.before ?? 0}" w:after="${format.after ?? 0}" w:line="${format.line ?? 276}" w:lineRule="auto"/>`,
    indent ? `<w:ind${indent}/>` : '',
    format.align ? `<w:jc w:val="${format.align}"/>` : '',
    runProperties(format.mark),
    format.section ?? '',
    '</w:pPr>',
  ].join('');
}

export function paragraph(content: string, format: ParagraphFormat = {}): string {
  return `<w:p>${paragraphProperties(format)}${content}</w:p>`;
}

/** A block-level content control around whole paragraphs or tables. */
export function blockControl(
  ids: ControlIds,
  tag: string,
  alias: string,
  content: string,
): string {
  return [
    '<w:sdt><w:sdtPr>',
    `<w:alias w:val="${xmlText(alias)}"/>`,
    `<w:tag w:val="${xmlText(tag)}"/>`,
    `<w:id w:val="${ids.take()}"/>`,
    '</w:sdtPr><w:sdtContent>',
    content,
    '</w:sdtContent></w:sdt>',
  ].join('');
}

/** A Word repeating section with one item, as OakDoc repeaters expect. */
export function repeatingSection(
  ids: ControlIds,
  tag: string,
  alias: string,
  itemBody: string,
): string {
  return [
    '<w:sdt><w:sdtPr>',
    `<w:alias w:val="${xmlText(alias)}"/>`,
    `<w:tag w:val="${xmlText(tag)}"/>`,
    `<w:id w:val="${ids.take()}"/>`,
    '<w15:repeatingSection/>',
    '</w:sdtPr><w:sdtContent>',
    '<w:sdt><w:sdtPr>',
    `<w:id w:val="${ids.take()}"/>`,
    '<w15:repeatingSectionItem/>',
    '</w:sdtPr><w:sdtContent>',
    itemBody,
    '</w:sdtContent></w:sdt>',
    '</w:sdtContent></w:sdt>',
  ].join('');
}

export interface CellFormat {
  width: number;
  span?: number;
  fill?: string;
  verticalAlign?: 'top' | 'center' | 'bottom';
  /** Suppress all four cell borders (the reference's borderless terms). */
  borderless?: boolean;
}

export function tableCell(content: string, format: CellFormat): string {
  return [
    '<w:tc><w:tcPr>',
    `<w:tcW w:w="${format.width}" w:type="dxa"/>`,
    format.span && format.span > 1 ? `<w:gridSpan w:val="${format.span}"/>` : '',
    format.borderless
      ? '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>'
      : '',
    format.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${format.fill}"/>` : '',
    format.verticalAlign ? `<w:vAlign w:val="${format.verticalAlign}"/>` : '',
    '</w:tcPr>',
    content || '<w:p/>',
    '</w:tc>',
  ].join('');
}

export function tableRow(
  cells: string,
  options: { header?: boolean; cantSplit?: boolean; minHeight?: number } = {},
): string {
  const properties = [
    options.cantSplit ? '<w:cantSplit/>' : '',
    options.minHeight ? `<w:trHeight w:val="${options.minHeight}" w:hRule="atLeast"/>` : '',
    options.header ? '<w:tblHeader/>' : '',
  ].join('');
  return `<w:tr>${properties ? `<w:trPr>${properties}</w:trPr>` : ''}${cells}</w:tr>`;
}

export function table(input: {
  columns: readonly number[];
  rows: string;
  indent?: number;
  grid?: boolean;
}): string {
  const width = input.columns.reduce((total, column) => total + column, 0);
  const border = input.grid
    ? 'w:val="single" w:sz="4" w:space="0" w:color="000000"'
    : 'w:val="nil"';
  return [
    '<w:tbl><w:tblPr>',
    `<w:tblW w:w="${width}" w:type="dxa"/>`,
    input.indent ? `<w:tblInd w:w="${input.indent}" w:type="dxa"/>` : '',
    '<w:tblBorders>',
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} ${border}/>`)
      .join(''),
    '</w:tblBorders>',
    '<w:tblLayout w:type="fixed"/>',
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>',
    '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>',
    '</w:tblPr><w:tblGrid>',
    input.columns.map((column) => `<w:gridCol w:w="${column}"/>`).join(''),
    '</w:tblGrid>',
    input.rows,
    '</w:tbl>',
  ].join('');
}

/** Section properties for the reference page with no header or footer. */
export function sectionProperties(options: { nextPage?: boolean } = {}): string {
  return [
    '<w:sectPr>',
    options.nextPage === false ? '<w:type w:val="continuous"/>' : '<w:type w:val="nextPage"/>',
    `<w:pgSz w:w="${REFERENCE_PAGE.width}" w:h="${REFERENCE_PAGE.height}"/>`,
    `<w:pgMar w:top="${REFERENCE_PAGE.margin}" w:right="${REFERENCE_PAGE.margin}" w:bottom="${REFERENCE_PAGE.margin}" w:left="${REFERENCE_PAGE.margin}" w:header="${REFERENCE_PAGE.headerFooter}" w:footer="${REFERENCE_PAGE.headerFooter}" w:gutter="0"/>`,
    '<w:cols w:space="720"/>',
    '</w:sectPr>',
  ].join('');
}

/**
 * The named styles shared by the master and its partials. Identical
 * definitions mean a partial merge never reports a style conflict.
 */
export const REFERENCE_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-SG" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="AppendixTitle"><w:name w:val="Appendix Title"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableParagraph"><w:name w:val="Table Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:unhideWhenUsed/><w:rPr><w:color w:val="${REFERENCE_HYPERLINK_COLOR}"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

export interface ListLevel {
  format: 'decimal' | 'lowerLetter' | 'bullet';
  text: string;
  left: number;
  hanging: number;
  bold?: boolean;
  /** Bullet glyph font; numbers use Arial. */
  font?: string;
}

/** A numbering part with one single-level definition per list. */
export function numberingXml(lists: ReadonlyArray<{ numId: number; level: ListLevel }>): string {
  const abstracts = lists.map(({ numId, level }) => [
    `<w:abstractNum w:abstractNumId="${numId}">`,
    '<w:multiLevelType w:val="singleLevel"/>',
    '<w:lvl w:ilvl="0">',
    '<w:start w:val="1"/>',
    `<w:numFmt w:val="${level.format}"/>`,
    `<w:lvlText w:val="${xmlText(level.text)}"/>`,
    '<w:lvlJc w:val="left"/>',
    `<w:pPr><w:ind w:left="${level.left}" w:hanging="${level.hanging}"/></w:pPr>`,
    '<w:rPr>',
    level.font
      ? `<w:rFonts w:ascii="${level.font}" w:hAnsi="${level.font}" w:hint="default"/>`
      : '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial" w:hint="default"/>',
    level.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>',
    '<w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/>',
    '</w:rPr>',
    '</w:lvl>',
    '</w:abstractNum>',
  ].join(''));
  const nums = lists.map(({ numId }) => `<w:num w:numId="${numId}"><w:abstractNumId w:val="${numId}"/></w:num>`);
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:numbering xmlns:w="${WORD_NS}">`,
    ...abstracts,
    ...nums,
    '</w:numbering>',
  ].join('');
}

export function documentXml(body: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}" xmlns:w15="${W15_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w15">`,
    '<w:body>',
    body,
    '</w:body>',
    '</w:document>',
  ].join('');
}

/** Zip a document body with the shared styles and a numbering part. */
export function buildReferencePackage(input: {
  documentXml: string;
  numberingXml: string;
  title: string;
  subject: string;
}): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlText(input.title)}</dc:title>
  <dc:creator>Oakcloud</dc:creator>
  <dc:subject>${xmlText(input.subject)}</dc:subject>
</cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Oakcloud OakDoc</Application>
</Properties>`;

  return zipSync({
    '[Content_Types].xml': encodeOakDocZipText(contentTypes),
    '_rels/.rels': encodeOakDocZipText(packageRels),
    'docProps/core.xml': encodeOakDocZipText(core),
    'docProps/app.xml': encodeOakDocZipText(app),
    'word/document.xml': encodeOakDocZipText(input.documentXml),
    'word/styles.xml': encodeOakDocZipText(REFERENCE_STYLES_XML),
    'word/numbering.xml': encodeOakDocZipText(input.numberingXml),
    'word/_rels/document.xml.rels': encodeOakDocZipText(documentRels),
  }, { level: 6, mtime: new Date('2026-09-27T00:00:00Z') });
}
