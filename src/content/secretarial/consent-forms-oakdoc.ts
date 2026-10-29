import { oakDocFieldTitle } from '@/lib/document-editor/oakdoc-field-case';
import { writeOakDocRepeaterSections } from '@/lib/document-editor/oakdoc-custom-fields';
import {
  OAKDOC_DIRECTORS_REPEATER_TAG,
  oakDocContactListSlug,
  oakDocContactsRepeaterTag,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import type { PlaceholderDefinition } from '@/lib/validations/document-template';
import {
  ARIAL_11,
  ControlIds,
  packageOakDoc,
  repeatingSection,
  wordWriter,
  type PageMargins,
  type RunFormat,
} from '@/content/resolution/resolution-oakdoc-xml';

/**
 * Starter consent forms under section 173C of the Companies Act, laid out
 * like the firm's own Word forms (Bordeus Pte. Ltd., 3 Oct 2026): Form 45
 * (consent to act as director) and Form 45B (consent to act as secretary).
 * Each makes a separate document for every person picked on Configure:
 * Form 45 for each director, Form 45B for each contact on the "Corporate
 * secretary to be appointed" list. The person's particulars sit in a
 * repeating section that prints only that person.
 */

export interface ConsentFormStarter {
  name: string;
  description: string;
  fileName: string;
  category: 'OTHER';
  compositionType: 'STANDARD';
  placeholders: PlaceholderDefinition[];
  build: () => Uint8Array;
}

const APPOINTMENT_DATE_KEY = 'appointment_date';

const APPOINTMENT_DATE: PlaceholderDefinition = {
  key: `custom.${APPOINTMENT_DATE_KEY}`,
  path: `custom.${APPOINTMENT_DATE_KEY}`,
  type: 'date',
  label: 'Appointment date',
  source: 'custom',
  category: 'custom',
  required: true,
};

/** Arial 11 pt throughout, as in the reference forms. */
const { run, tabRun, paragraph, field } = wordWriter(ARIAL_11);

const bold: RunFormat = { bold: true };
const note: RunFormat = { italic: true, halfPoints: 18 };
const struck: RunFormat = { strike: true };
const justified = { align: 'both' as const };

const FORM_MARGINS: PageMargins = { top: 1080, right: 1080, bottom: 851, left: 1080 };

function appointmentDate(ids: ControlIds, format: string, sample: string): string {
  return field(ids, `custom.${APPOINTMENT_DATE_KEY}`, oakDocFieldTitle('Appointment date', null, format), sample);
}

function cell(width: number, content: string, options: { borders?: string; span?: number; vMerge?: 'restart' | 'continue'; vAlign?: string } = {}): string {
  return [
    '<w:tc><w:tcPr>',
    `<w:tcW w:w="${width}" w:type="dxa"/>`,
    options.span ? `<w:gridSpan w:val="${options.span}"/>` : '',
    options.vMerge ? `<w:vMerge${options.vMerge === 'restart' ? ' w:val="restart"' : ''}/>` : '',
    options.borders ? `<w:tcBorders>${options.borders}</w:tcBorders>` : '',
    `<w:vAlign w:val="${options.vAlign ?? 'bottom'}"/>`,
    '</w:tcPr>',
    content,
    '</w:tc>',
  ].join('');
}

const line = (side: 'top' | 'bottom' | 'left' | 'right') => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
const BOX = ['top', 'left', 'bottom', 'right'].map((side) => line(side as 'top')).join('');
const NO_BORDERS = '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';

function table(widths: number[], rows: string, indent = 0): string {
  return [
    '<w:tbl><w:tblPr>',
    `<w:tblW w:w="${widths.reduce((sum, width) => sum + width, 0)}" w:type="dxa"/>`,
    indent ? `<w:tblInd w:w="${indent}" w:type="dxa"/>` : '',
    NO_BORDERS,
    '<w:tblLayout w:type="fixed"/>',
    '</w:tblPr>',
    `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`,
    rows,
    '</w:tbl>',
  ].join('');
}

/**
 * The boxed heading: the Act, section and title centred in one box, the
 * form number in a small box at the right margin.
 */
function heading(form: string, section: { number: string; letter: string }, title: readonly string[]): string {
  const widths = [2300, 4400, 800, 2246];
  const centred = (text: string, format: RunFormat = {}) => paragraph(
    run(text, { bold: true, halfPoints: 20, ...format }),
    { align: 'center', after: 0 },
  );
  const box = [
    centred('THE COMPANIES ACT'),
    centred('(CHAPTER 50)'),
    paragraph(
      run(`SECTION ${section.number}`, { bold: true, halfPoints: 20 }) + run(section.letter, { bold: true, italic: true, halfPoints: 20 }),
      { align: 'center', after: 0 },
    ),
    ...title.map((text) => centred(text)),
  ].join('');
  const empty = paragraph('', { after: 0 });
  const formBox = paragraph(run(form, { bold: true, halfPoints: 24 }), { align: 'center', after: 0 });
  const rows = [
    `<w:tr>${[
      cell(widths[0], empty, { vAlign: 'top' }),
      cell(widths[1], box, { borders: BOX, vMerge: 'restart', vAlign: 'top' }),
      cell(widths[2], empty, { vAlign: 'top' }),
      cell(widths[3], formBox, { borders: BOX, vAlign: 'center' }),
    ].join('')}</w:tr>`,
    `<w:tr>${[
      cell(widths[0], empty),
      cell(widths[1], empty, { borders: BOX, vMerge: 'continue' }),
      cell(widths[2], empty),
      cell(widths[3], empty),
    ].join('')}</w:tr>`,
  ].join('');
  return table(widths, rows);
}

function companyLines(ids: ControlIds): string[] {
  return [
    paragraph('', { after: 200 }),
    paragraph(run('Name of Company: ', bold) + field(ids, 'company.name', 'Company Name', 'Sample Company Pte. Ltd.'), { after: 200 }),
    paragraph(run('Company No: ', bold) + field(ids, 'company.uen', 'Company UEN', '202600001A'), { after: 400 }),
  ];
}

/**
 * Name, address, ID and nationality on ruled lines, inside a repeating
 * section of `tag` whose item fields live under `namespace`.
 */
function particulars(ids: ControlIds, tag: string, alias: string, namespace: string, widths: [number, number, number, number]): string {
  const [label, value, middle, last] = widths;
  const ruled = (top: boolean) => (top ? line('top') : '') + line('bottom');
  const text = (content: string) => paragraph(content, { after: 100 });
  const valueField = (path: string, title: string, sample: string) => text(field(ids, `${namespace}.${path}`, title, sample));
  const itemTitle = namespace === 'director' ? 'Director' : 'Contact';
  const rows = [
    `<w:tr><w:trPr><w:trHeight w:val="454"/></w:trPr>${[
      cell(label, text(run('Name:'))),
      cell(value + middle + last, valueField('name', `${itemTitle} Name`, 'Full Name'), { span: 3, borders: ruled(false) }),
    ].join('')}</w:tr>`,
    `<w:tr><w:trPr><w:trHeight w:val="422"/></w:trPr>${[
      cell(label, text(run('Address:'))),
      cell(value + middle + last, valueField('address', `${itemTitle} Address`, '123 Sample Street, #01-01, Singapore 123456'), { span: 3, borders: ruled(true) }),
    ].join('')}</w:tr>`,
    `<w:tr><w:trPr><w:trHeight w:val="413"/></w:trPr>${[
      cell(label, text(run('*NRIC/Passport No:'))),
      cell(value, valueField('identificationNumber', `${itemTitle} Identification Number`, 'S1234567A'), { borders: ruled(true) }),
      cell(middle, text(run('Nationality:')), { borders: line('top') }),
      cell(last, valueField('nationality', `${itemTitle} Nationality`, 'Singaporean'), { borders: ruled(true) }),
    ].join('')}</w:tr>`,
  ].join('');
  return table(widths, repeatingSection(ids, tag, alias, rows), -147);
}

function signature(ids: ControlIds): string[] {
  return [
    paragraph('', { after: 100 }),
    paragraph('', { after: 100 }),
    paragraph('', { after: 100 }),
    paragraph('', { after: 200 }),
    paragraph(run('Signature: ______________________'), { after: 200 }),
    paragraph([
      run('Dated this '),
      appointmentDate(ids, 'do', '3rd'),
      run(' day of '),
      appointmentDate(ids, 'MMMM, yyyy', 'October, 2026'),
    ].join(''), { after: 200 }),
  ];
}

/** "(i)<tab>text" at the reference's hanging indent. */
function roman(numeral: string, text: string, format: RunFormat = {}, spacing = { before: 200, after: 100 }): string {
  return paragraph(run(numeral, format) + tabRun() + run(text, format), {
    ...justified,
    ...spacing,
    indent: { left: 1276, hanging: 567 },
  });
}

function lettered(letter: string, text: string): string {
  return paragraph(run(letter) + tabRun() + run(text), {
    ...justified,
    before: 200,
    after: 100,
    indent: { left: 720, hanging: 360 },
  });
}

function subItem(letter: string, text: string): string {
  return paragraph(run(letter) + tabRun() + run(text), {
    ...justified,
    after: 100,
    indent: { left: 1800, hanging: 360 },
  });
}

function buildForm45(): Uint8Array {
  const ids = new ControlIds();
  const body = [
    heading('FORM 45', { number: '173C', letter: '(a)' }, [
      'CONSENT TO ACT AS DIRECTOR',
      'AND STATEMENT OF NON',
      'DISQUALIFICATION TO ACT AS',
      'DIRECTOR',
    ]),
    ...companyLines(ids),
    paragraph([
      run('I, the undermentioned person, hereby consent to act as a director of the abovenamed company with effect from '),
      appointmentDate(ids, 'do MMMM yyyy', '3rd October 2026'),
      run(' and declare that:'),
    ].join(''), { ...justified, after: 200 }),
    lettered('(a)', 'I am not disqualified from acting as a director, in that:'),
    roman('(i)', 'I am not below 18 years of age and that I am otherwise of full legal capacity.'),
    roman('(ii)', 'Within a period of 3 years preceding the date of this statement I have not had any disqualification order made by the High Court of Singapore against me under section 149A(1) of the Companies Act ("the Act").'),
    roman('(iii)', 'Within a period of 5 years preceding the date of this statement I have not had any disqualification order made by the High Court of Singapore against me under section 149(1) or 154(2) of the Act.'),
    roman('*(iv)', 'That within a period of 5 years preceding 12th November 1993 I have not been convicted whether within or without Singapore, of any offence —'),
    subItem('A.', 'in connection with the promotion, formation or management of a corporation;'),
    subItem('B.', 'involving fraud or dishonesty punishable on conviction with imprisonment for 3 months or more; or'),
    subItem('C.', 'under section 157 (failure to act honestly and diligently as a director or making improper use of company information for gain) or under section 339 (failure to keep proper company accounts books) of the Act.'),
    roman('*(v)', 'That within a period of 5 years preceding the date of this statement I have not been convicted, in Singapore or elsewhere, of any offence involving fraud or dishonesty punishable on conviction with imprisonment for 3 months or more.'),
    roman('(vi)', 'That —'),
    subItem('A.', 'I have not been convicted of 3 or more offences under the Act in relation to the requirements on the filing of returns, accounts or other documents with the Registrar of Companies and have not had 3 or more orders of the High Court of Singapore made against me under section 13 or 399 of the Act in relation to such requirements;'),
    subItem('B.', 'the last of any such conviction did not take place or the last of any such order was not made during the period of 5 years preceding the date of this statement; and'),
    subItem('C.', 'I am not an undischarged bankrupt under section 148(1) of the Act.'),
    roman('(vii)', 'By virtue of the foregoing I am not disqualified from acting as a director of the abovenamed company.'),
    lettered('(b)', 'I am aware of and undertake to abide by my duties, responsibilities and liabilities specified in the Act as well as under the common law where applicable, including the following key administrative and substantive duties, that is, to:'),
    roman('(i)', 'discharge my responsibilities in the company;'),
    roman('(ii)', 'ensure that I have a reasonable degree of skill and knowledge to handle the affairs of the company;'),
    roman('(iii)', 'act honestly and be reasonably diligent in discharging my duties and act in the interest of the company without putting myself in a position of conflict of interest;'),
    roman('(iv)', 'employ the powers and assets that I am entrusted with for the proper purposes of the company and not for any collateral purpose;'),
    roman('(v)', 'ensure that the company and I comply with all the requirements and obligations under the Act including those in respect of meetings, requisitions, resolutions, accounts, reports, statements, records and other documents on the company, filing and notices and any other prerequisites; and'),
    roman('(vi)', 'account to the shareholders for my conduct of the affairs of the company and make such disclosures that are incumbent upon me under the Act.'),
    lettered('(c)', 'That —'),
    paragraph(run('*(i) I have read and understood the above statements; or'), { after: 100, indent: { left: 720 } }),
    paragraph(run('*(ii) the above statements were interpreted to me in', struck), { after: 100, indent: { left: 720 } }),
    paragraph(run('____________________________________________', struck), { after: 100, indent: { left: 1080 } }),
    paragraph(run('(state language/dialect)', { ...struck, italic: true }), { after: 100, indent: { left: 1080 } }),
    paragraph(run('by ____________________________________________', struck), { after: 100, indent: { left: 720 } }),
    paragraph(run('(state name)', { ...struck, italic: true }), { after: 100, indent: { left: 1080 } }),
    paragraph(run('NRIC NO: ________________________________', struck), { after: 200, indent: { left: 720 } }),
    paragraph('', { after: 300 }),
    paragraph(run('before I executed this form and I confirm that the statements are true. I am also aware that I can be prosecuted in Court if I wilfully give any information on this form which is false.'), { after: 300 }),
    particulars(ids, OAKDOC_DIRECTORS_REPEATER_TAG, 'Director', 'director', [2269, 3118, 1305, 3407]),
    ...signature(ids),
    paragraph(run('* Delete where inapplicable.', note), { after: 0 }),
  ];
  return packageOakDoc(body.join('\n    '), { typeface: ARIAL_11, margins: FORM_MARGINS });
}

export const CORPORATE_SECRETARY_LIST_NAME = 'Corporate secretary to be appointed';
const SECRETARY_TAG = oakDocContactsRepeaterTag(oakDocContactListSlug(CORPORATE_SECRETARY_LIST_NAME));

function qualification(numeral: string, text: string): string {
  return roman(numeral, text, {}, { before: 0, after: 120 });
}

function buildForm45B(): Uint8Array {
  const ids = new ControlIds();
  const numbered = { after: 240, indent: { left: 426, hanging: 426 } };
  const body = [
    heading('FORM 45B', { number: '173C', letter: '(b)' }, ['CONSENT TO ACT AS SECRETARY']),
    ...companyLines(ids),
    paragraph([
      run('1.'), tabRun(),
      run('I, the undermentioned person, hereby consent to act as a secretary of the abovenamed company with effect from '),
      appointmentDate(ids, 'dd MMMM yyyy', '03 October 2026'),
      run('.'),
    ].join(''), numbered),
    paragraph(run('^2.') + tabRun() + run('I am a qualified person under section 171 (1AA) of the Companies Act by virtue of my being —'), numbered),
    qualification('*(i)', 'a secretary of a company for at least 3 years of the 5 years immediately preceding the abovementioned date of my appointment as secretary of the abovenamed company.'),
    qualification('*(ii)', 'a qualified person under the Legal Profession Act (Cap. 161).'),
    qualification('*(iii)', 'a public accountant.'),
    qualification('*(iiia)', 'a member of the Institute of Singapore Chartered Accountants (formerly known as the Institute of Certified Public Accountants of Singapore).'),
    qualification('*(iv)', 'a member of the Chartered Secretaries Institute of Singapore.'),
    qualification('*(v)', 'a member of the Association of International Accountants (Singapore Branch).'),
    qualification('*(vi)', 'a member of The Institute of Company Accountants, Singapore.'),
    paragraph('', { after: 120 }),
    particulars(ids, SECRETARY_TAG, CORPORATE_SECRETARY_LIST_NAME, 'contact', [2191, 2717, 1305, 2960]),
    ...signature(ids),
    paragraph('', { after: 120 }),
    paragraph(run('^To be completed by secretaries of public companies only or by secretaries of private companies appointed under section 171(1AB) of the Act.', note), { after: 120 }),
    paragraph(run('* Delete where inapplicable.', note), { after: 0 }),
  ];
  return packageOakDoc(body.join('\n    '), { typeface: ARIAL_11 });
}

export const FORM_45_TEMPLATE: ConsentFormStarter = {
  name: 'F45',
  description: 'Form 45: consent to act as director and statement of non-disqualification. One document for each director ticked on Configure.',
  fileName: 'F45_Consent_to_Act_as_Director.docx',
  category: 'OTHER',
  compositionType: 'STANDARD',
  placeholders: writeOakDocRepeaterSections(
    [APPOINTMENT_DATE],
    { names: {}, shortlists: {}, perPersonTag: OAKDOC_DIRECTORS_REPEATER_TAG },
    [OAKDOC_DIRECTORS_REPEATER_TAG],
  ) as PlaceholderDefinition[],
  build: buildForm45,
};

export const FORM_45B_TEMPLATE: ConsentFormStarter = {
  name: 'F45B',
  description: 'Form 45B: consent to act as secretary. One document for each contact ticked on the "Corporate secretary to be appointed" list; strike out the qualifications that do not apply on Review.',
  fileName: 'F45B_Consent_to_Act_as_Secretary.docx',
  category: 'OTHER',
  compositionType: 'STANDARD',
  placeholders: writeOakDocRepeaterSections(
    [APPOINTMENT_DATE],
    { names: { [SECRETARY_TAG]: CORPORATE_SECRETARY_LIST_NAME }, shortlists: {}, perPersonTag: SECRETARY_TAG },
    [SECRETARY_TAG],
  ) as PlaceholderDefinition[],
  build: buildForm45B,
};

export const CONSENT_FORM_STARTERS: readonly ConsentFormStarter[] = [FORM_45_TEMPLATE, FORM_45B_TEMPLATE];
