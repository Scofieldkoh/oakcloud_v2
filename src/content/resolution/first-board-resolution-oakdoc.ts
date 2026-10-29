import { createOakDocCondition } from '@/lib/document-editor/oakdoc-conditions';
import { oakDocFieldTitle } from '@/lib/document-editor/oakdoc-field-case';
import { OAKDOC_CONDITION_FIELD_TAGS } from '@/lib/document-editor/oakdoc-field-registry';
import { oakDocOfficersRepeaterTag } from '@/lib/document-editor/oakdoc-repeater-definitions';
import { OAKDOC_RESOLUTION_HEADING_STYLE } from '@/lib/document-editor/oakdoc-resolutions';
import type { PlaceholderDefinition } from '@/lib/validations/document-template';
import { BOARD_RESOLUTION_PLACEHOLDERS, buildDirectorsResolutionOakDocMaster } from './board-resolution-oakdoc';
import {
  ARIAL_10,
  ControlIds,
  packageOakDoc,
  repeatingSection,
  wordWriter,
} from './resolution-oakdoc-xml';

/**
 * The firm's first directors' resolution after incorporation (reference:
 * Bordeus Pte. Ltd., 3 Oct 2026). The master carries the fixed "NOTED THAT"
 * part (incorporation, business activities, first directors); the seven
 * "RESOLVED THAT" items are ordinary resolution partials, preset on the
 * template in the reference order so more can be added, removed or
 * reordered on Configure. Building the master needs DOMParser/XMLSerializer.
 */

export const FIRST_BOARD_RESOLUTION_TEMPLATE = {
  name: 'First Board Resolution',
  description: 'First directors’ resolutions after incorporation: notes the incorporation, business activities and first directors, then the preset resolutions (constitution, registered address, financial year end, secretary, corporate secretarial agent, subscribers’ shares, lodgement). Add or remove resolutions on Configure.',
  fileName: 'First_Board_Resolution.docx',
  category: 'RESOLUTION' as const,
  compositionType: 'RESOLUTION' as const,
};

const NOTICE_OF_INCORPORATION_KEY = 'notice_of_incorporation_no';

export const FIRST_BOARD_RESOLUTION_PLACEHOLDERS: PlaceholderDefinition[] = [
  ...BOARD_RESOLUTION_PLACEHOLDERS,
  {
    key: `custom.${NOTICE_OF_INCORPORATION_KEY}`,
    path: `custom.${NOTICE_OF_INCORPORATION_KEY}`,
    type: 'text',
    label: 'Notice of Incorporation No.',
    source: 'custom',
    category: 'custom',
    required: true,
  },
];

/** Underlines the heading text after "N.<tab>", as in the reference. */
export const HEADING_STYLE = `
  <w:style w:type="character" w:customStyle="1" w:styleId="${OAKDOC_RESOLUTION_HEADING_STYLE}"><w:name w:val="Resolution Heading"/><w:rPr><w:u w:val="single"/></w:rPr></w:style>`;

/** The whole template, master and partials, prints in Arial 10 pt. */
const { run, tabRun, paragraph, field } = wordWriter(ARIAL_10);

const SECONDARY_ACTIVITY_PARAGRAPH = '1F2A0001';

const justified = { align: 'both' as const };
const lettered = { align: 'both' as const, indent: { left: 360, hanging: 360 }, after: 80 };
const bulleted = { indent: { left: 720, hanging: 360 }, after: 80 };

function noted(ids: ControlIds): string[] {
  const heading = (text: string) => paragraph(run(text, { underline: true }), { keepNext: true });
  return [
    paragraph(run('NOTED THAT: -', { bold: true }), { keepNext: true }),
    heading('INCORPORATION'),
    paragraph([
      run('a)'), tabRun(), run('the Company was duly incorporated on '),
      field(ids, 'company.incorporationDate', 'Incorporation Date', '3 October 2026', {}, 'd MMMM yyyy'),
      run('; and'),
    ].join(''), lettered),
    paragraph([
      run('b)'), tabRun(), run('the Notice of Incorporation No. '),
      field(ids, `custom.${NOTICE_OF_INCORPORATION_KEY}`, 'Notice of Incorporation No.', 'T26XXXXXXX'),
      run(' was issued by the Accounting and Corporate Regulatory Authority.'),
    ].join(''), { ...lettered, after: 200 }),
    heading('BUSINESS ACTIVITIES'),
    paragraph(run('the Company is authorized to undertake the following business activities: -'), justified),
    paragraph([
      run('•'), tabRun(), run('Primary Activity - '),
      field(ids, 'company.primaryActivity', 'Primary Activity', '46900 | Wholesale trade of a variety of goods without a dominant product'),
    ].join(''), bulleted),
    paragraph([
      run('•'), tabRun(), run('Secondary Activity - '),
      field(ids, 'company.secondaryActivity', 'Secondary Activity', '70201 | Management consultancy services'),
    ].join(''), { ...bulleted, paraId: SECONDARY_ACTIVITY_PARAGRAPH }),
    paragraph('', { after: 120 }),
    heading('FIRST DIRECTORS'),
    paragraph(run('the appointments of the following persons, having consented to act, as the First Directors of the Company be hereby confirmed: -'), justified),
    repeatingSection(ids, 'repeat.directors', 'First Directors', paragraph([
      run('•'), tabRun(),
      field(ids, 'director.name', 'Director Name', 'Director Name'),
      run(' ('),
      field(ids, 'director.identificationNumber', 'Director Identification Number', 'S1234567A'),
      run(')'),
    ].join(''), bulleted)),
    paragraph('', { after: 120 }),
    paragraph(run('RESOLVED THAT: -', { bold: true }), { keepNext: true }),
  ];
}

/** The First Board Resolution master; the secondary activity line prints only when there is one. */
export function buildFirstBoardResolutionOakDocMaster(): Uint8Array {
  const ids = new ControlIds();
  const bytes = buildDirectorsResolutionOakDocMaster({
    beforeResolutions: noted(ids),
    extraStyles: HEADING_STYLE,
    typeface: ARIAL_10,
  }, ids);
  return createOakDocCondition({
    docxBytes: bytes,
    fromParaId: SECONDARY_ACTIVITY_PARAGRAPH,
    condition: { field: 'company.secondaryActivity', operator: 'truthy' },
    allowedFields: OAKDOC_CONDITION_FIELD_TAGS,
  }).bytes;
}

export interface SeedResolutionPartial {
  /** Stable partial name (letters, numbers, hyphens). */
  name: string;
  displayName: string;
  /** Default numbered heading. */
  header: string;
  /** Custom fields asked on Configure when the partial is picked. */
  placeholders?: PlaceholderDefinition[];
  build: () => Uint8Array;
}

const partialText = { align: 'both' as const, after: 0 };

/** A partial package; each ends with an empty line, which spaces it from the next resolution. */
function partialPackage(blocks: (ids: ControlIds) => string[]): Uint8Array {
  const body = [...blocks(new ControlIds(9500)), paragraph('', { after: 0 })];
  return packageOakDoc(body.join('\n    '), { typeface: ARIAL_10 });
}

const CONSTITUTION_KEY = 'constitution';

/** What the company adopts; the chosen option prints inside the sentence. */
export const CONSTITUTION_OPTIONS = [
  'the model constitution in force at the time of adoption',
  'the model constitution in force from time to time',
  'the constitution drafted by the Shareholders',
];

const bold = { bold: true };

/** Two-column, borderless subscriber table with one repeated shareholder row. */
function subscriberTable(ids: ControlIds): string {
  const widths = [5026, 4000];
  const cell = (width: number, content: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
  const cellParagraph = (content: string, align: 'left' | 'center') => paragraph(content, { align, after: 0 });
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${[
    cell(widths[0], cellParagraph(run('Subscriber’s Name', { bold: true, underline: true }), 'center')),
    cell(widths[1], cellParagraph(run('No. of Ordinary Shares Allotted', { bold: true, underline: true }), 'center')),
  ].join('')}</w:tr>`;
  const row = `<w:tr>${[
    cell(widths[0], cellParagraph(field(ids, 'shareholder.name', 'Shareholder Name', 'Shareholder Name'), 'left')),
    cell(widths[1], cellParagraph(field(ids, 'shareholder.numberOfShares', 'Number of Shares', '1,000'), 'center')),
  ].join('')}</w:tr>`;
  return [
    '<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/>',
    '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>',
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/></w:tblCellMar>',
    '</w:tblPr>',
    `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`,
    header,
    repeatingSection(ids, 'repeat.shareholders', 'Subscribers', row),
    '</w:tbl>',
  ].join('');
}

/** The seven resolutions of the reference, in its order. */
export const FIRST_BOARD_RESOLUTION_PARTIALS: readonly SeedResolutionPartial[] = [
  {
    name: 'resolution-adopt-model-constitution',
    displayName: 'First Resolution - Adoption of Constitution',
    header: 'ADOPTION OF CONSTITUTION',
    placeholders: [{
      key: `custom.${CONSTITUTION_KEY}`,
      path: `custom.${CONSTITUTION_KEY}`,
      type: 'text',
      label: 'Constitution adopted',
      source: 'custom',
      category: 'custom',
      required: true,
      options: CONSTITUTION_OPTIONS,
    }],
    build: () => partialPackage((ids) => [
      paragraph([
        run('RESOLVED that the Company shall adopt '),
        field(ids, `custom.${CONSTITUTION_KEY}`, 'Constitution adopted', CONSTITUTION_OPTIONS[0]),
        run('.'),
      ].join(''), partialText),
    ]),
  },
  {
    name: 'resolution-confirm-registered-address',
    displayName: 'First Resolution - Registered Address',
    header: 'REGISTERED ADDRESS',
    build: () => partialPackage((ids) => [
      paragraph([
        run('the registered address of the Company situated at '),
        field(ids, 'company.registeredAddress', oakDocFieldTitle('Full Address', 'upper'), '123 SAMPLE STREET, SINGAPORE 123456', bold),
        run(' since the date of incorporation be hereby confirmed.'),
      ].join(''), partialText),
    ]),
  },
  {
    name: 'resolution-fix-financial-year-end',
    displayName: 'First Resolution - Company’s Financial Year End',
    header: 'COMPANY’S FINANCIAL YEAR END',
    build: () => partialPackage((ids) => [
      paragraph([
        run('the financial year end of the Company be fixed on '),
        field(ids, 'company.financialYearEnd', 'Financial Year End', '31 December', bold),
        run(' with its first financial year end to be '),
        field(ids, 'company.firstFinancialYearEnd', 'First Financial Year End', '31 December 2026', bold, 'd MMMM yyyy'),
        run('.'),
      ].join(''), partialText),
    ]),
  },
  {
    name: 'resolution-appoint-secretary',
    displayName: 'First Resolution - Appointment of Secretary',
    header: 'APPOINTMENT OF SECRETARY',
    build: () => partialPackage((ids) => [
      repeatingSection(ids, oakDocOfficersRepeaterTag(['SECRETARY']), 'Secretary', paragraph([
        run('the appointment of '),
        field(ids, 'officer.name', oakDocFieldTitle('Officer Name', 'upper'), 'SECRETARY NAME', bold),
        run(' ('),
        field(ids, 'officer.identificationNumber', 'Officer Identification Number', 'S1234567A', bold),
        run(') as Secretary of the Company be hereby approved with effect from the date of consent to act.'),
      ].join(''), partialText)),
    ]),
  },
  {
    name: 'resolution-appoint-corporate-secretarial-agent',
    displayName: 'First Resolution - Corporate Service Provider',
    header: 'CORPORATE SERVICE PROVIDER',
    build: () => partialPackage(() => [
      paragraph([
        run('that '),
        run('OAKTREE ACCOUNTING & CORPORATE SOLUTIONS PTE. LTD. (202437906H)', bold),
        run(' be hereby appointed as corporate secretarial agent of the Company with effect from the date enumerated in the service agreement.'),
      ].join(''), partialText),
    ]),
  },
  {
    name: 'resolution-confirm-subscribers-shares',
    displayName: 'First Resolution - Subscribers’ Shares',
    header: 'SUBSCRIBERS’ SHARES',
    build: () => partialPackage((ids) => [
      paragraph([
        run('that the allotment of subscribers’ shares for a total consideration of '),
        field(ids, 'company.paidUpCapital', 'Paid-up Capital', 'SGD 10,000.00', bold),
        run(' by virtue of Section 63 of the Companies Act 1967 to the subscribers to the Constitution of the Company, listed below, be hereby confirmed.'),
      ].join(''), { ...partialText, after: 120 }),
      subscriberTable(ids),
    ]),
  },
  {
    name: 'resolution-notification-and-lodgement',
    displayName: 'First Resolution - Notification and Lodgement',
    header: 'NOTIFICATION AND LODGEMENT',
    build: () => partialPackage(() => [
      paragraph(run('that all necessary documents and forms be completed, signed and lodged with the Accounting and Corporate Regulatory Authority.'), partialText),
    ]),
  },
];
