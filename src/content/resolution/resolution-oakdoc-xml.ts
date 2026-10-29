import { zipSync } from 'fflate';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import { OAKDOC_RESOLUTION_ITEMS_TAG } from '@/lib/document-editor/oakdoc-field-registry';
import {
  OAKDOC_CONDITION_TAG_PREFIX,
  type OakDocConditionDefinition,
} from '@/lib/document-editor/oakdoc-conditions';

/**
 * WordprocessingML helpers for the seeded resolution masters and partials:
 * runs and paragraphs in one typeface (Times New Roman 11 pt by default),
 * field controls, and a minimal DOCX package around a body.
 */

export interface Typeface {
  name: string;
  /** Size in half-points (22 = 11 pt). */
  halfPoints: number;
}

export const TIMES_11: Typeface = { name: 'Times New Roman', halfPoints: 22 };
export const ARIAL_10: Typeface = { name: 'Arial', halfPoints: 20 };
export const ARIAL_11: Typeface = { name: 'Arial', halfPoints: 22 };

function fontName({ name }: Typeface): string {
  return `<w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:eastAsia="${name}" w:cs="${name}"/>`;
}

function fontSize({ halfPoints }: Typeface): string {
  return `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`;
}

export interface RunFormat {
  bold?: boolean;
  italic?: boolean;
  caps?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Size in half-points, when not the typeface's. */
  halfPoints?: number;
}

export function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ParagraphFormat {
  align?: 'left' | 'center' | 'right' | 'both';
  before?: number;
  after?: number;
  keepNext?: boolean;
  pageBreakBefore?: boolean;
  bottomBorder?: boolean;
  /** Left indent and hanging first line, in twips, for list items. */
  indent?: { left: number; hanging?: number };
  /** w14:paraId, so an editor action (a condition) can find the paragraph. */
  paraId?: string;
}

/** Run, paragraph and field builders that all use one typeface. */
export function wordWriter(typeface: Typeface) {
  const fonts = fontName(typeface);
  const size = fontSize(typeface);

  const runProperties = (format: RunFormat = {}) => [
    '<w:rPr>',
    fonts,
    format.bold ? '<w:b/><w:bCs/>' : '',
    format.italic ? '<w:i/><w:iCs/>' : '',
    format.caps ? '<w:caps/>' : '',
    format.strike ? '<w:strike/>' : '',
    format.halfPoints ? fontSize({ name: typeface.name, halfPoints: format.halfPoints }) : size,
    format.underline ? '<w:u w:val="single"/>' : '',
    '</w:rPr>',
  ].join('');

  const run = (text: string, format: RunFormat = {}) =>
    `<w:r>${runProperties(format)}<w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;

  /** A run holding a tab, for "a)<tab>text" list items. */
  const tabRun = () => `<w:r>${runProperties()}<w:tab/></w:r>`;

  const paragraphProperties = (format: ParagraphFormat = {}) => [
    '<w:pPr>',
    format.keepNext ? '<w:keepNext/>' : '',
    format.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    format.bottomBorder ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="000000"/></w:pBdr>' : '',
    format.indent?.hanging ? `<w:tabs><w:tab w:val="left" w:pos="${format.indent.left}"/></w:tabs>` : '',
    `<w:spacing w:before="${format.before ?? 0}" w:after="${format.after ?? 200}" w:line="240" w:lineRule="auto"/>`,
    format.indent
      ? `<w:ind w:left="${format.indent.left}"${format.indent.hanging ? ` w:hanging="${format.indent.hanging}"` : ''}/>`
      : '',
    format.align && format.align !== 'left' ? `<w:jc w:val="${format.align}"/>` : '',
    `<w:rPr>${fonts}${size}</w:rPr>`,
    '</w:pPr>',
  ].join('');

  const paragraph = (content: string, format: ParagraphFormat = {}) => {
    const id = format.paraId ? ` w14:paraId="${format.paraId}"` : '';
    return `<w:p${id}>${paragraphProperties(format)}${content}</w:p>`;
  };

  const field = (ids: ControlIds, tag: string, alias: string, sample: string, format: RunFormat = {}, dateFormat?: string) => [
    '<w:sdt><w:sdtPr>',
    `<w:alias w:val="${xmlText(alias)}"/><w:tag w:val="${xmlText(tag)}"/><w:id w:val="${ids.take()}"/>`,
    dateFormat
      ? `<w:date><w:dateFormat w:val="${dateFormat}"/><w:lid w:val="en-SG"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>`
      : '<w:text/>',
    '</w:sdtPr><w:sdtContent>',
    run(sample, format),
    '</w:sdtContent></w:sdt>',
  ].join('');

  return { run, tabRun, paragraph, field };
}

export type WordWriter = ReturnType<typeof wordWriter>;

const TIMES_WRITER = wordWriter(TIMES_11);

export const { run, tabRun, paragraph, field } = TIMES_WRITER;

export class ControlIds {
  private next: number;

  constructor(start = 9100) {
    this.next = start;
  }

  take(): number {
    const value = this.next;
    this.next += 1;
    return value;
  }
}

/** A Word repeating section with one item holding `content`. */
export function repeatingSection(ids: ControlIds, tag: string, alias: string, content: string): string {
  return [
    '<w:sdt><w:sdtPr>',
    `<w:alias w:val="${xmlText(alias)}"/><w:tag w:val="${xmlText(tag)}"/><w:id w:val="${ids.take()}"/><w15:repeatingSection/>`,
    '</w:sdtPr><w:sdtContent>',
    '<w:sdt><w:sdtPr>',
    `<w:id w:val="${ids.take()}"/><w15:repeatingSectionItem/>`,
    '</w:sdtPr><w:sdtContent>',
    content,
    '</w:sdtContent></w:sdt>',
    '</w:sdtContent></w:sdt>',
  ].join('');
}

/**
 * A stable id per condition, so seeded documents and partials agree on it
 * (identical conditions share one definition when partials are merged).
 */
export function seededConditionId(condition: OakDocConditionDefinition): string {
  const value = condition.value ?? '';
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${condition.field.replace(/[^A-Za-z0-9]/g, '')}${condition.operator}${value ? hash.toString(36) : ''}`;
}

/**
 * Blocks (paragraphs or table rows) kept at generation only when the
 * condition holds; store the definition with `addOakDocConditionDefinitions`.
 */
export function conditionalBlock(ids: ControlIds, conditionId: string, content: string): string {
  return [
    '<w:sdt><w:sdtPr><w:alias w:val="OakDoc conditional block"/>',
    `<w:tag w:val="${OAKDOC_CONDITION_TAG_PREFIX}${xmlText(conditionId)}"/><w:id w:val="${ids.take()}"/></w:sdtPr>`,
    `<w:sdtContent>${content}</w:sdtContent></w:sdt>`,
  ].join('');
}

/** The locked block the numbered resolutions replace at generation. */
export function resolutionSlot(ids: ControlIds, { paragraph, run }: WordWriter = TIMES_WRITER): string {
  return [
    '<w:sdt><w:sdtPr>',
    `<w:alias w:val="Numbered resolutions"/><w:tag w:val="${OAKDOC_RESOLUTION_ITEMS_TAG}"/><w:id w:val="${ids.take()}"/>`,
    '<w:lock w:val="sdtLocked"/>',
    '</w:sdtPr><w:sdtContent>',
    paragraph(run('[Numbered resolutions: chosen when the document is generated]'), { align: 'both' }),
    '</w:sdtContent></w:sdt>',
  ].join('');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function stylesXml(extraStyles: string, typeface: Typeface): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>${fontName(typeface)}${fontSize(typeface)}<w:lang w:val="en-SG"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="200" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${extraStyles}
</w:styles>`;
}

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const INCH_MARGINS: PageMargins = { top: 1440, right: 1440, bottom: 1440, left: 1440 };

/** An A4 DOCX around `body` (joined block XML), with 1-inch margins unless given. */
export function packageOakDoc(
  body: string,
  options: { extraStyles?: string; typeface?: Typeface; margins?: PageMargins } = {},
): Uint8Array {
  const margins = options.margins ?? INCH_MARGINS;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  mc:Ignorable="w14 w15">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="${margins.top}" w:right="${margins.right}" w:bottom="${margins.bottom}" w:left="${margins.left}" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  return zipSync({
    '[Content_Types].xml': encodeOakDocZipText(CONTENT_TYPES),
    '_rels/.rels': encodeOakDocZipText(ROOT_RELS),
    'word/document.xml': encodeOakDocZipText(documentXml),
    'word/_rels/document.xml.rels': encodeOakDocZipText(DOCUMENT_RELS),
    'word/styles.xml': encodeOakDocZipText(stylesXml(options.extraStyles ?? '', options.typeface ?? TIMES_11)),
  }, { level: 6 });
}
