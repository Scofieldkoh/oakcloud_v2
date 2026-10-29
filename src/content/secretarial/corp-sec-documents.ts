import {
  OAKDOC_DIRECTORS_REPEATER_TAG,
  OAKDOC_SHAREHOLDERS_REPEATER_TAG,
  oakDocContactListSlug,
  oakDocContactsRepeaterTag,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import { ARIAL_10, type PageMargins } from '@/content/resolution/resolution-oakdoc-xml';
import {
  DocumentWriter,
  TAB,
  as,
  bold,
  custom,
  field,
  personField,
  t,
  whenBlank,
  whenSet,
  type BuiltDocument,
  type FieldRef,
  type Segment,
} from './corp-sec-oakdoc-kit';
import * as F from './corp-sec-fields';
import {
  APPLICANT_LIST,
  DIRECTORS_FOR_RE_ELECTION,
  TRANSFEREE_LIST,
  TRANSFEROR_LIST,
} from './corp-sec-resolutions';

/**
 * Corporate secretarial documents that are not numbered resolutions: AGM
 * notices, consents, minutes and proxies; officer letters; share
 * applications, certificates and transfers; the solvency statement, dividend
 * vouchers, the striking off declaration and onboarding letters. All Arial
 * 10, like the firm's Application for Shares (Bordeus Pte. Ltd., 3 Oct 2026).
 * A document "for each" person makes one document per person ticked on
 * Configure.
 */

export type CorpSecDocumentCategory = 'LETTER' | 'MINUTES' | 'NOTICE' | 'CERTIFICATE' | 'CONTRACT' | 'OTHER';

export interface CorpSecDocument {
  name: string;
  description: string;
  fileName: string;
  category: CorpSecDocumentCategory;
  compositionType: 'STANDARD';
  build: () => BuiltDocument;
}

interface Written {
  body: string[];
  /** The section whose people each get their own document. */
  perPersonTag?: string;
  margins?: PageMargins;
}

function document(
  name: string,
  category: CorpSecDocumentCategory,
  description: string,
  write: (d: DocumentWriter) => Written,
): CorpSecDocument {
  let built: BuiltDocument | undefined;
  return {
    name,
    description,
    fileName: `${name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}.docx`,
    category,
    compositionType: 'STANDARD',
    build: () => {
      if (built) return built;
      const d = new DocumentWriter(ARIAL_10);
      const written = write(d);
      const bytes = d.package(written.body, written.margins);
      built = { bytes, placeholders: d.placeholders(written.perPersonTag) };
      return built;
    },
  };
}

const justified = { align: 'both' as const };
const centred = { align: 'center' as const, after: 0 };
const numbered = { align: 'both' as const, indent: { left: 567, hanging: 567 }, after: 160 };
const lettered = { align: 'both' as const, indent: { left: 1134, hanging: 567 }, after: 100 };
const bullet = { indent: { left: 1134, hanging: 567 }, after: 60 };

/** Company name, registration number and place of incorporation, centred. */
function companyHeading(d: DocumentWriter, after = 360): string[] {
  return [
    d.p([F.COMPANY_NAME_UPPER], centred),
    d.p(t`(Company Registration No. ${F.COMPANY_UEN})`, centred),
    d.p('(Incorporated in the Republic of Singapore)', { align: 'center', after }),
  ];
}

function title(d: DocumentWriter, text: string, after = 240): string {
  return d.p([bold(text)], { align: 'center', after, keepNext: true });
}

function ruledTitle(d: DocumentWriter, text: string): string {
  return d.p([bold(text)], { bottomBorder: true, after: 240, keepNext: true });
}

function heading(d: DocumentWriter, text: string): string {
  return d.p([bold(text)], { after: 120, keepNext: true });
}

/** A signature line with the name and capacity beneath it. */
function signature(d: DocumentWriter, name: Segment[], capacity: Segment[] | string, after = 240): string[] {
  return [
    d.p('', { keepNext: true, after: 600 }),
    d.p('……………………………………..', { keepNext: true, after: 0 }),
    d.p(name, { keepNext: true, after: 0 }),
    d.p(capacity, { after }),
  ];
}

/** A company signs: "For and on behalf of" it above the line, the signatory's name and capacity below. */
function entitySignature(d: DocumentWriter, entity: Segment[], capacity: Segment[] | string, after = 240, signatory: Segment[] = ['Name:']): string[] {
  return [
    d.p('For and on behalf of', { keepNext: true, after: 0 }),
    d.p(entity, { keepNext: true, after: 0 }),
    ...signature(d, signatory, capacity, after),
  ];
}

/**
 * A party in a repeating section signs: a person in their own name, a
 * company through its authorised signatory, chosen per person by whether
 * the party is a company.
 */
function partySignature(
  d: DocumentWriter,
  input: { name: FieldRef; isCorporate: string; capacity: string; after?: number; signatory?: Segment[] },
): string {
  return [
    d.when(whenBlank(input.isCorporate), signature(d, [input.name], input.capacity, input.after)),
    d.when(whenSet(input.isCorporate), entitySignature(d, [input.name], 'Authorised Signatory', input.after, input.signatory)),
  ].join('');
}

/** Each director signs, in a section listing every director (Configure can untick). */
function directorSignatures(d: DocumentWriter): string {
  return d.repeat(OAKDOC_DIRECTORS_REPEATER_TAG, signature(d, [F.DIRECTOR_NAME], 'Director').join(''));
}

/** Each member signs; a corporate member through its authorised signatory. */
function shareholderSignatures(d: DocumentWriter): string {
  return d.repeat(OAKDOC_SHAREHOLDERS_REPEATER_TAG, partySignature(d, { name: F.SHAREHOLDER_NAME, isCorporate: F.SHAREHOLDER_IS_CORPORATE, capacity: 'Member' }));
}

/** The meeting the AGM papers are for. */
const MEETING = t`held at ${F.AGM_VENUE} on ${F.AGM_DATE} at ${F.AGM_TIME}`;

// ---------------------------------------------------------------------------
// AGM papers
// ---------------------------------------------------------------------------

export const NOTICE_OF_AGM = document('Notice of Annual General Meeting', 'NOTICE', 'Notice of the AGM with the ordinary business: financial statements, re-election of the directors ticked under “Directors for re-election”, auditors or audit exemption, and directors’ fees (left out when no fee is entered). Signed by the secretary.', (d) => ({
  body: [
    ...companyHeading(d),
    ruledTitle(d, 'NOTICE OF ANNUAL GENERAL MEETING'),
    d.p(t`NOTICE IS HEREBY GIVEN that the Annual General Meeting of the Company will be ${MEETING} for the following purposes:`, { ...justified, after: 240 }),
    d.p([bold('AS ORDINARY BUSINESS')], { after: 160, keepNext: true }),
    d.p(t`1.${TAB}To receive and adopt the ${F.FS_DOCUMENTS} for the financial year ended ${F.FS_PERIOD_END}.`, numbered),
    d.p(t`2.${TAB}To re-elect the following Directors, who retire in accordance with the Constitution of the Company and, being eligible, have offered themselves for re-election:`, { ...numbered, after: 60 }),
    d.repeat(OAKDOC_DIRECTORS_REPEATER_TAG, d.p(['•', TAB, F.DIRECTOR_NAME], bullet), DIRECTORS_FOR_RE_ELECTION),
    d.gap(100),
    d.p(t`3.${TAB}${F.AGM_AUDITOR_ITEM}`, numbered),
    d.when(whenSet(F.DIRECTORS_FEES), d.p(t`4.${TAB}To approve Directors’ fees of S$${F.DIRECTORS_FEES} for the financial year ended ${F.FS_PERIOD_END}.`, numbered)),
    d.p('To transact any other ordinary business which may properly be transacted at an Annual General Meeting.', { ...justified, after: 360 }),
    d.p([bold('BY ORDER OF THE BOARD')], { after: 0, keepNext: true }),
    d.repeat(F.SECRETARY_OFFICERS_TAG, signature(d, [F.SECRETARY_NAME], 'Secretary', 120).join('')),
    d.p(t`Singapore, ${F.NOTICE_DATE}`, { after: 360 }),
    d.p([bold('Notes:')], { after: 80, keepNext: true }),
    d.p(t`1.${TAB}A member entitled to attend and vote at the meeting is entitled to appoint not more than two proxies to attend and vote instead of the member. A proxy need not be a member of the Company.`, { ...numbered, after: 80 }),
    d.p(t`2.${TAB}The instrument appointing a proxy must be deposited at the registered office of the Company at ${F.REGISTERED_ADDRESS} not less than 48 hours before the time appointed for holding the meeting.`, { ...numbered, after: 80 }),
    d.p(t`3.${TAB}A corporation which is a member may authorise a person to act as its representative at the meeting under Section 179 of the Companies Act 1967.`, { ...numbered, after: 0 }),
  ],
}));

export const CONSENT_TO_SHORT_NOTICE = document('Consent to Short Notice', 'NOTICE', 'Every member agrees to the AGM being held at short notice under Section 177(3). Signed by each shareholder ticked on Configure.', (d) => ({
  body: [
    ...companyHeading(d),
    ruledTitle(d, 'CONSENT TO SHORT NOTICE OF ANNUAL GENERAL MEETING'),
    d.p(t`We, the undersigned, being all the members of the Company having the right to attend and vote at the Annual General Meeting of the Company to be ${MEETING}, hereby agree, pursuant to Section 177(3) of the Companies Act 1967, to the meeting being held, and the resolutions set out in the notice of the meeting being proposed and passed, notwithstanding that shorter notice than that specified in the Companies Act 1967 or the Constitution of the Company has been given.`, justified),
    shareholderSignatures(d),
  ],
}));

export const AGM_ATTENDANCE_LIST = document('AGM Attendance List', 'MINUTES', 'Attendance sheet for the AGM: each shareholder ticked on Configure with their shares and a space to sign, then the secretary in attendance.', (d) => {
  const widths = [4200, 2000, 2826];
  const cellText = (content: Segment[] | string, align: 'left' | 'center' = 'left') => d.p(content, { align, after: 0 });
  return {
    body: [
      ...companyHeading(d),
      ruledTitle(d, 'ATTENDANCE LIST'),
      d.p(t`Annual General Meeting of the Company ${MEETING}.`, { ...justified, after: 240 }),
      d.p([bold('MEMBERS PRESENT')], { after: 120, keepNext: true }),
      d.table(widths, [
        d.row([
          d.cell(widths[0], cellText([bold('Name')])),
          d.cell(widths[1], cellText([bold('No. of Shares')], 'center')),
          d.cell(widths[2], cellText([bold('Signature')], 'center')),
        ], { header: true }),
        d.repeat(OAKDOC_SHAREHOLDERS_REPEATER_TAG, d.row([
          d.cell(widths[0], cellText([F.SHAREHOLDER_NAME])),
          d.cell(widths[1], cellText([F.SHAREHOLDER_SHARES], 'center')),
          d.cell(widths[2], d.p('', { after: 480 })),
        ], { cantSplit: true })),
      ], { borders: true }),
      d.gap(240),
      d.p([bold('IN ATTENDANCE')], { after: 120, keepNext: true }),
      d.repeat(F.SECRETARY_OFFICERS_TAG, d.p(t`${F.SECRETARY_NAME}${TAB}Secretary`, { indent: { left: 4536, hanging: 4536 }, after: 60 })),
    ],
  };
});

export const CHAIRMAN_OF_THE_MEETING = 'Chairman of the meeting';

export const MINUTES_OF_AGM = document('Minutes of Annual General Meeting', 'MINUTES', 'Minutes of an AGM held in person: members present, the secretary in attendance, the chairman picked on Configure, and the ordinary business (directors’ fees left out when no fee is entered). Signed by the chairman.', (d) => {
  d.namePicker('selectedDirector', CHAIRMAN_OF_THE_MEETING);
  const minute = (segments: Segment[]) => d.p(segments, { ...justified, indent: { left: 567 } });
  return {
    body: [
      ...companyHeading(d),
      d.p([bold('MINUTES OF THE ANNUAL GENERAL MEETING OF THE COMPANY '), ...MEETING.map((segment) => (typeof segment === 'string' ? bold(segment.toUpperCase()) : as(segment as FieldRef, { upper: true, bold: true })))], { bottomBorder: true, after: 240 }),
      heading(d, 'PRESENT'),
      d.repeat(OAKDOC_SHAREHOLDERS_REPEATER_TAG, d.p(t`${F.SHAREHOLDER_NAME}${TAB}Member`, { indent: { left: 4536, hanging: 3969 }, after: 60 })),
      d.gap(120),
      heading(d, 'IN ATTENDANCE'),
      d.repeat(F.SECRETARY_OFFICERS_TAG, d.p(t`${F.SECRETARY_NAME}${TAB}Secretary`, { indent: { left: 4536, hanging: 3969 }, after: 60 })),
      d.gap(120),
      heading(d, 'CHAIRMAN'),
      minute(t`${F.PICKED_DIRECTOR_NAME} presided as Chairman of the meeting.`),
      heading(d, 'QUORUM'),
      minute(['The Chairman noted that a quorum was present and declared the meeting open.']),
      heading(d, 'NOTICE'),
      minute(['The notice convening the meeting, having been circulated to all members, was taken as read.']),
      heading(d, '1.  FINANCIAL STATEMENTS'),
      minute(t`It was RESOLVED THAT the ${F.FS_DOCUMENTS} for the financial year ended ${F.FS_PERIOD_END} be received and adopted.`),
      heading(d, '2.  RE-ELECTION OF DIRECTORS'),
      d.repeat(OAKDOC_DIRECTORS_REPEATER_TAG, minute(t`It was RESOLVED THAT ${F.DIRECTOR_NAME}, retiring in accordance with the Constitution of the Company, be re-elected as a Director of the Company.`), DIRECTORS_FOR_RE_ELECTION),
      heading(d, '3.  AUDITORS'),
      minute(t`The meeting considered the following business, which was RESOLVED as proposed: ${F.AGM_AUDITOR_ITEM}`),
      d.when(whenSet(F.DIRECTORS_FEES), [
        heading(d, '4.  DIRECTORS’ FEES'),
        minute(t`It was RESOLVED THAT Directors’ fees of S$${F.DIRECTORS_FEES} for the financial year ended ${F.FS_PERIOD_END} be approved.`),
      ]),
      heading(d, 'CONCLUSION'),
      minute(['There being no other business, the meeting ended with a vote of thanks to the Chair.']),
      d.p('Confirmed as a correct record,', { before: 240, after: 0, keepNext: true }),
      ...signature(d, [F.PICKED_DIRECTOR_NAME], 'Chairman', 0),
    ],
  };
});

/** The field in bold. */
function strong(ref: FieldRef): FieldRef {
  return { ...ref, format: { ...ref.format, bold: true } };
}

// Each member names their own proxy.
const PROXY_NAME = personField('proxy_name', 'Proxy’s name', 'text', 'PROXY NAME', { upper: true, bold: true });
const PROXY_ID = personField('proxy_id', 'Proxy’s NRIC or passport no.', 'text', 'S1234567A');
const PROXY_ADDRESS = personField('proxy_address', 'Proxy’s address', 'text', '1 Sample Road, Singapore 123456');

/** A member's name, ID and address: "NAME (NRIC No. S1234567A) of ADDRESS". */
const MEMBER = t`${strong(F.SHAREHOLDER_NAME)} (${F.SHAREHOLDER_ID_LABEL} ${F.SHAREHOLDER_ID}) of ${F.SHAREHOLDER_ADDRESS}`;

export const PROXY_FORM = document('Proxy Form', 'OTHER', 'Proxy form for the AGM, one for each shareholder ticked on Configure, appointing the proxy entered for that shareholder (or the Chairman). A corporate member’s form reads “We … our”.', (d) => {
  const appointment = (pronoun: { we: string; our: string; us: string }, member: string) => t`${pronoun.we}, ${MEMBER}, ${member} holding ${F.SHAREHOLDER_SHARES} shares, hereby appoint ${PROXY_NAME} (${PROXY_ID}) of ${PROXY_ADDRESS}, or failing whom the Chairman of the meeting, as ${pronoun.our} proxy to attend and vote for ${pronoun.us} and on ${pronoun.our} behalf at the Annual General Meeting of the Company to be ${MEETING}, and at any adjournment of it.`;
  return {
    body: [
      ...companyHeading(d),
      ruledTitle(d, 'PROXY FORM'),
      d.repeat(OAKDOC_SHAREHOLDERS_REPEATER_TAG, [
        d.when(whenBlank(F.SHAREHOLDER_IS_CORPORATE), [
          d.p(appointment({ we: 'I', our: 'my', us: 'me' }, 'being a member of the Company'), justified),
          d.p('My proxy may vote or abstain from voting at his or her discretion on each resolution proposed at the meeting.', { ...justified, after: 360 }),
        ]),
        d.when(whenSet(F.SHAREHOLDER_IS_CORPORATE), [
          d.p(appointment({ we: 'We', our: 'our', us: 'us' }, 'a corporation which is a member of the Company'), justified),
          d.p('Our proxy may vote or abstain from voting at his or her discretion on each resolution proposed at the meeting.', { ...justified, after: 360 }),
        ]),
        d.p('Dated this ………… day of ……………………', { after: 0 }),
        partySignature(d, { name: F.SHAREHOLDER_NAME, isCorporate: F.SHAREHOLDER_IS_CORPORATE, capacity: 'Member' }),
      ].join(''), 'Shareholder'),
      d.p([bold('Notes:')], { before: 240, after: 80, keepNext: true }),
      d.p(t`1.${TAB}A member may appoint not more than two proxies. A proxy need not be a member of the Company.`, { ...numbered, after: 80 }),
      d.p(t`2.${TAB}A corporate member signs under its common seal or by its duly authorised officer or attorney.`, { ...numbered, after: 80 }),
      d.p(t`3.${TAB}This form must be deposited at the registered office of the Company at ${F.REGISTERED_ADDRESS} not less than 48 hours before the time appointed for holding the meeting.`, { ...numbered, after: 0 }),
    ],
    perPersonTag: OAKDOC_SHAREHOLDERS_REPEATER_TAG,
  };
});

// Each corporate member names its own representative.
const REPRESENTATIVE_NAME = personField('representative_name', 'Representative’s name', 'text', 'REPRESENTATIVE NAME', { upper: true, bold: true });
const REPRESENTATIVE_ID = personField('representative_id', 'Representative’s NRIC or passport no.', 'text', 'S1234567A');

export const CORPORATE_REPRESENTATIVE = document('Certificate of Appointment of Corporate Representative', 'OTHER', 'A corporate shareholder appoints its representative at general meetings under Section 179, one for each shareholder ticked on Configure (tick corporate shareholders only), with the representative entered for each.', (d) => ({
  body: [
    ...companyHeading(d),
    ruledTitle(d, 'CERTIFICATE OF APPOINTMENT OF CORPORATE REPRESENTATIVE'),
    d.p('(Section 179 of the Companies Act 1967)', { align: 'center', after: 240 }),
    d.repeat(OAKDOC_SHAREHOLDERS_REPEATER_TAG, [
      d.p(t`We, ${strong(F.SHAREHOLDER_NAME)} (${F.SHAREHOLDER_ID_LABEL} ${F.SHAREHOLDER_ID}), a corporation which is a member of the Company, hereby certify that by a resolution of our directors ${REPRESENTATIVE_NAME} (${REPRESENTATIVE_ID}) has been appointed to act as our representative at any general meeting of the Company, including the Annual General Meeting to be ${MEETING} and any adjournment of it, until this appointment is revoked.`, { ...justified, after: 360 }),
      ...entitySignature(d, [F.SHAREHOLDER_NAME], 'Director'),
      ...signature(d, ['Name:'], 'Director / Secretary'),
    ].join(''), 'Shareholder'),
  ],
  perPersonTag: OAKDOC_SHAREHOLDERS_REPEATER_TAG,
}));

// ---------------------------------------------------------------------------
// Officers and auditors
// ---------------------------------------------------------------------------

/** "The Board of Directors", the company and its address, as a letter's addressee. */
function toTheBoard(d: DocumentWriter): string[] {
  return [
    d.p(t`${F.LETTER_DATE}`, { after: 240 }),
    d.p('The Board of Directors', { after: 0 }),
    d.p([F.COMPANY_NAME_UPPER], { after: 0 }),
    d.p([F.LETTER_ADDRESS], { after: 240 }),
    d.p('Dear Sirs,', { after: 240 }),
  ];
}

export const DIRECTOR_RESIGNATION_LETTER = document('Director Resignation Letter', 'LETTER', 'Resignation letter to the Board, one for each director ticked on Configure. A company must keep at least one director ordinarily resident in Singapore, so a resident director’s resignation needs a replacement first.', (d) => ({
  body: [
    ...toTheBoard(d),
    d.p([bold('RESIGNATION AS DIRECTOR')], { after: 240 }),
    d.repeat(OAKDOC_DIRECTORS_REPEATER_TAG, [
      d.p(t`I, ${strong(F.DIRECTOR_NAME)} (${F.DIRECTOR_ID_LABEL} ${F.DIRECTOR_ID}), hereby tender my resignation as a Director of the Company with effect from ${F.CESSATION_DATE}.`, justified),
      d.p('I confirm that I have no claim against the Company for compensation for loss of office or otherwise. Please arrange for the necessary notification to be lodged with the Accounting and Corporate Regulatory Authority.', { ...justified, after: 360 }),
      d.p('Yours faithfully,', { after: 0 }),
      ...signature(d, [F.DIRECTOR_NAME], ''),
    ].join(''), 'Director resigning'),
  ],
  perPersonTag: OAKDOC_DIRECTORS_REPEATER_TAG,
}));

export const DIRECTOR_CHANGE_OF_PARTICULARS = document('Director Notice of Change in Particulars', 'LETTER', 'A director tells the company a particular has changed (address, name, ID, nationality), one for each director ticked on Configure, with each director’s own change.', (d) => ({
  body: [
    ...toTheBoard(d),
    d.p([bold('NOTICE OF CHANGE IN PARTICULARS OF DIRECTOR')], { after: 240 }),
    d.repeat(OAKDOC_DIRECTORS_REPEATER_TAG, [
      d.p(t`I, ${strong(F.DIRECTOR_NAME)} (${F.DIRECTOR_ID_LABEL} ${F.DIRECTOR_ID}), a Director of the Company, hereby give notice that my particulars below have changed with effect from ${F.EFFECTIVE_DATE}.`, justified),
      d.p(t`Particular changed:${TAB}${F.CHANGED_PARTICULAR}`, { indent: { left: 2835, hanging: 2835 }, after: 120 }),
      d.p(t`New particulars:${TAB}${F.NEW_PARTICULARS}`, { indent: { left: 2835, hanging: 2835 }, after: 240 }),
      d.p('Please update the Company’s records and lodge the change with the Accounting and Corporate Regulatory Authority.', { ...justified, after: 360 }),
      d.p('Yours faithfully,', { after: 0 }),
      ...signature(d, [F.DIRECTOR_NAME], 'Director'),
    ].join(''), 'Director'),
  ],
  perPersonTag: OAKDOC_DIRECTORS_REPEATER_TAG,
}));

export const AUDITOR_CONSENT = document('Auditor Consent to Act', 'LETTER', 'The incoming auditors consent to act, for the Board’s appointment of auditors.', (d) => ({
  body: [
    ...toTheBoard(d),
    d.p([bold('CONSENT TO ACT AS AUDITORS')], { after: 240 }),
    d.p(t`We, ${F.NEW_AUDITOR_NAME}, of ${F.NEW_AUDITOR_ADDRESS}, hereby consent to act as auditors of the Company with effect from ${F.APPOINTMENT_DATE}.`, justified),
    d.p('We confirm that we are public accountants registered under the Accountants Act 2004 and that we are not disqualified from acting as auditors of the Company under the Companies Act 1967.', { ...justified, after: 360 }),
    d.p('Yours faithfully,', { after: 0 }),
    ...entitySignature(d, [F.NEW_AUDITOR_NAME], 'Public Accountants and Chartered Accountants'),
  ],
}));

// ---------------------------------------------------------------------------
// Nominee director
// ---------------------------------------------------------------------------

export const NOMINATOR_LIST = 'Nominator';
export const NOMINEE_DIRECTOR_LIST = 'Nominee director';
const AGREEMENT_DATE = custom('agreement_date', 'Agreement date', 'date', '3 October 2026', { dateFormat: 'd MMMM yyyy' });
const NOMINEE_FEE = custom('nominee_fee', 'Nominee director fee per year (S$)', 'currency', '2,400.00');
const NOMINEE_NOTICE = custom('nominee_notice_period', 'Resignation notice period', 'text', 'one (1) month');

/** "NAME (NRIC No. ID)", or "(UEN …)" for a company. */
const CONTACT = t`${F.CONTACT_NAME_BOLD} (${F.CONTACT_ID_LABEL} ${F.CONTACT_ID})`;

function party(d: DocumentWriter, list: string, number: string, role: string): string {
  return d.contacts(list, d.p(t`${number}${TAB}${CONTACT} of ${F.CONTACT_ADDRESS} (the “${role}”)`, { ...numbered, align: 'left' }));
}

/** Numbered clauses; a clause's opening words up to the first full stop ("Fees.") print in bold. */
function clauses(d: DocumentWriter, items: Array<[string, Segment[] | string]>): string[] {
  return items.map(([number, text]) => {
    const [first, ...rest] = typeof text === 'string' ? [text] : text;
    const split = typeof first === 'string' ? /^([A-Z][a-z]+(?: [a-z]+)?\. )([^]*)$/.exec(first) : null;
    const opening: Segment[] = split ? [bold(split[1]), split[2]] : [first];
    return d.p([number, TAB, ...opening, ...rest], numbered);
  });
}

/** Each contact on the list signs before a witness; a company through its authorised signatory. */
function witnessedSignature(d: DocumentWriter, list: string, role: string): string {
  return d.contacts(list, [
    d.p([bold(`SIGNED by the ${role}`)], { before: 360, after: 0, keepNext: true }),
    partySignature(d, { name: F.CONTACT_NAME, isCorporate: F.CONTACT_IS_CORPORATE, capacity: role, after: 120 }),
    d.p('in the presence of: …………………………………… (witness name and NRIC)', { after: 240 }),
  ].join(''));
}

export const NOMINEE_DIRECTOR_AGREEMENT = document('Nominee Director Agreement', 'CONTRACT', 'Agreement between the client (the “Nominator” contact) and the nominee director (the “Nominee director” contact) setting out the nominee’s limited role, fees, indemnity and resignation. Have it reviewed before first use.', (d) => ({
  body: [
    title(d, 'NOMINEE DIRECTOR AGREEMENT', 360),
    d.p(t`THIS AGREEMENT is made on ${AGREEMENT_DATE}`, { after: 240 }),
    d.p([bold('BETWEEN')], { after: 120 }),
    party(d, NOMINATOR_LIST, '(1)', 'Nominator'),
    d.p([bold('AND')], { after: 120 }),
    party(d, NOMINEE_DIRECTOR_LIST, '(2)', 'Nominee'),
    d.p(t`in respect of ${F.COMPANY_NAME_UPPER} (UEN ${F.COMPANY_UEN}) (the “Company”).`, { ...justified, after: 240 }),
    d.p([bold('WHEREAS')], { after: 120 }),
    ...clauses(d, [
      ['(A)', 'The Nominator is the beneficial owner of, or controls, the Company and wishes the Company to have a director who is ordinarily resident in Singapore, as section 145 of the Companies Act 1967 requires.'],
      ['(B)', 'The Nominee has agreed to act as a director of the Company at the Nominator’s request on the terms of this Agreement.'],
    ]),
    d.p([bold('IT IS AGREED as follows:')], { before: 120, after: 120 }),
    ...clauses(d, [
      ['1.', 'Appointment. The Nominator shall procure the appointment of the Nominee as a director of the Company, and the Nominee consents to act and shall sign the consent to act as director (Form 45).'],
      ['2.', 'Role. The Nominee’s role is to meet the requirement for a locally resident director. The Nominee shall not take part in the day-to-day management or operations of the Company, which remain the responsibility of the Nominator and the other directors.'],
      ['3.', 'Statutory duties. Nothing in this Agreement requires the Nominee to act in breach of the Nominee’s duties as a director under the Companies Act 1967, any other law or the Constitution of the Company. The Nominee may refuse to sign any document or take any action that the Nominee reasonably considers unlawful or improper.'],
      ['4.', 'Information. The Nominator shall procure that the Company gives the Nominee promptly, and in any case on request, its accounting records, bank statements, financial statements, minutes and any other information the Nominee needs to discharge the Nominee’s duties, and tells the Nominee of any matter that may expose the Nominee to liability.'],
      ['5.', 'Compliance. The Nominator shall procure that the Company keeps proper accounting records, files its returns with the Accounting and Corporate Regulatory Authority and the Inland Revenue Authority of Singapore on time, and complies with all laws, including those on anti-money laundering, countering the financing of terrorism and sanctions.'],
      ['6.', t`Fees. The Nominator shall pay the Nominee a fee of S$${NOMINEE_FEE} a year, payable in advance, together with any disbursements, and any fines, penalties or costs the Nominee incurs because of the Company’s defaults.`],
      ['7.', 'Indemnity. The Nominator shall indemnify the Nominee, and keep the Nominee indemnified, against all claims, losses, liabilities, fines, penalties, costs and expenses the Nominee suffers or incurs by reason of acting as a director of the Company, except to the extent caused by the Nominee’s own fraud, wilful default or dishonesty.'],
      ['8.', t`Resignation. The Nominee may resign as a director by giving the Nominator written notice of ${NOMINEE_NOTICE}, or immediately if the Nominator breaches this Agreement or if continuing to act would expose the Nominee to liability. The Nominator shall procure the appointment of another locally resident director before the resignation takes effect, and authorises the Nominee to lodge the Nominee’s cessation with the Accounting and Corporate Regulatory Authority.`],
      ['9.', 'Disclosure. The Nominator acknowledges that the Nominee must inform the Company that the Nominee is a nominee director and give the Nominator’s particulars to the Company for its register of nominee directors, and consents to that disclosure.'],
      ['10.', 'Governing law. This Agreement is governed by the laws of Singapore, and the parties submit to the non-exclusive jurisdiction of the Singapore courts.'],
    ]),
    d.p([bold('IN WITNESS WHEREOF')], { before: 240, after: 0 }),
    d.p('the parties have signed this Agreement on the date stated above.', { after: 120 }),
    witnessedSignature(d, NOMINATOR_LIST, 'Nominator'),
    witnessedSignature(d, NOMINEE_DIRECTOR_LIST, 'Nominee'),
  ],
}));

export const NOMINEE_DIRECTOR_INDEMNITY = document('Nominee Director Indemnity and Undertaking', 'CONTRACT', 'Letter of indemnity and undertaking from the client (the “Nominator” contact) to the nominee director (the “Nominee director” contact). Have it reviewed before first use.', (d) => ({
  body: [
    d.p(t`${AGREEMENT_DATE}`, { after: 240 }),
    d.p('To:', { after: 0 }),
    d.contacts(NOMINEE_DIRECTOR_LIST, [
      d.p([F.CONTACT_NAME_BOLD], { after: 0 }),
      d.p([F.CONTACT_ADDRESS], { after: 240 }),
    ].join('')),
    d.p('Dear Sir / Madam,', { after: 240 }),
    d.p(t`${bold('LETTER OF INDEMNITY AND UNDERTAKING – ')}${F.COMPANY_NAME_UPPER} (UEN ${F.COMPANY_UEN}) (the “Company”)`, { after: 240 }),
    d.p('In consideration of you agreeing, at the request of the undersigned (the “Nominator”, which where there is more than one means each of them jointly and severally), to act as a director of the Company, the Nominator irrevocably and unconditionally undertakes and agrees with you as follows:', justified),
    ...[
      ['(a)', 'to indemnify you, and keep you indemnified, against all claims, losses, liabilities, fines, penalties, costs and expenses you suffer or incur by reason of acting as a director of the Company, except to the extent caused by your own fraud, wilful default or dishonesty;'],
      ['(b)', 'not to ask you to sign any document or take any action that is unlawful or in breach of your duties as a director, and to accept your refusal to do so;'],
      ['(c)', 'to procure that the Company keeps proper accounting records, files its returns on time and gives you any information you ask for about its affairs;'],
      ['(d)', 'to procure the appointment of another director ordinarily resident in Singapore within one month after you give notice of your wish to resign, so that your resignation may take effect; and'],
      ['(e)', 'to pay any fines or penalties imposed on you, and any costs you incur, because of a default by the Company.'],
    ].map(([letter, text]) => d.p([letter, TAB, text], lettered)),
    d.p('This letter is governed by the laws of Singapore and binds the Nominator and the Nominator’s successors.', { ...justified, before: 120, after: 360 }),
    d.p('Yours faithfully,', { after: 0 }),
    d.contacts(NOMINATOR_LIST, partySignature(d, { name: F.CONTACT_NAME, isCorporate: F.CONTACT_IS_CORPORATE, capacity: 'Nominator' })),
  ],
}));

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

/** The applicant's name as stored, in bold, as in the reference. */
const APPLICANT_NAME = field('contact.name', 'Contact Name', 'Engterprise Holdings Pte. Ltd.', { bold: true });
const APPLICANT_TAG = oakDocContactsRepeaterTag(oakDocContactListSlug(APPLICANT_LIST));

export const APPLICATION_FOR_SHARES = document('Application for Shares', 'OTHER', 'Application for new shares, one for each contact on the “Applicant” list, laid out like the Bordeus application, with the shares and amount entered for each applicant. A corporate applicant’s form reads “We … us” and prints its authorised signatory.', (d) => {
  const widths = [3402, 284, 5340];
  const label = (text: Segment[] | string) => d.cell(widths[0], d.p(text, { after: 160 }));
  const colon = () => d.cell(widths[1], d.p(':', { after: 160 }));
  const value = (segments: Segment[]) => d.cell(widths[2], d.p(segments, { after: 160 }));
  const application = (we: string, me: string, my: string) => [
    d.p(t`${we}, the undersigned, hereby apply for ${F.APPLICATION_SHARES} Ordinary Shares at S$${F.ISSUE_PRICE} per share for cash, to be issued by ${F.COMPANY_NAME_UPPER} (the ‘Company’) and request that you allot ${me} that number of shares.`, justified),
    d.p(t`A sum of S$${F.APPLICATION_AMOUNT} being full payment for such number of shares be satisfied in full by payment into the Company’s account.`, justified),
    d.p(`${we} agree to accept the number of shares applied for and authorise the Company to enter ${my} name in the Register of Members of the Company as the holder of such shares and to hold the same, subject to the Constitution of the Company.`, { ...justified, after: 480 }),
  ];
  return {
    body: [
      title(d, 'APPLICATION FOR SHARES', 480),
      d.p(t`To:${TAB}The Board of Directors`, { indent: { left: 709, hanging: 709 }, after: 0 }),
      d.p([F.COMPANY_NAME_UPPER], { indent: { left: 709 }, after: 0 }),
      d.p([F.LETTER_ADDRESS], { indent: { left: 709 }, after: 480 }),
      d.p('Dear Sirs,', { after: 240 }),
      d.contacts(APPLICANT_LIST, [
        d.when(whenBlank(F.CONTACT_IS_CORPORATE), application('I', 'me', 'my')),
        d.when(whenSet(F.CONTACT_IS_CORPORATE), application('We', 'us', 'our')),
        d.p(t`Dated this ${F.APPLICATION_DATE} day of ${F.APPLICATION_MONTH_YEAR}`, { after: 1200 }),
        d.p('……………………………………..', { after: 0, keepNext: true }),
        d.p(t`Name: ${APPLICANT_NAME}`, { after: 0, keepNext: true }),
        d.when(whenSet(F.CONTACT_IS_CORPORATE), d.p(t`Authorised Signature: ${F.AUTHORISED_SIGNATORY}`, { after: 0 })),
        d.gap(480),
        d.p([bold('PARTICULARS OF APPLICANT:')], { after: 240, keepNext: true }),
        d.table(widths, [
          d.row([label('Name (in full)'), colon(), value([APPLICANT_NAME])]),
          d.row([label('Address (in full)'), colon(), value([F.CONTACT_ADDRESS])]),
          d.row([label([F.CONTACT_ID_LABEL]), colon(), value([F.CONTACT_ID])]),
        ]),
      ].join('')),
    ],
    perPersonTag: APPLICANT_TAG,
  };
});

export const SHARE_CERTIFICATE = document('Share Certificate', 'CERTIFICATE', 'Share certificate for each shareholder ticked on Configure, with the certificate number and the shares on that certificate entered for each. Update the shareholdings first.', (d) => {
  const half = 4513;
  const signatory = (capacity: string) => d.cell(half, [
    d.p('', { after: 720 }),
    d.p('……………………………………..', { align: 'center', after: 0 }),
    d.p(capacity, { align: 'center', after: 0 }),
  ]);
  return {
    body: [
      d.repeat(OAKDOC_SHAREHOLDERS_REPEATER_TAG, [
        d.p(t`Certificate No. ${F.CERTIFICATE_NO}`, { align: 'right', after: 360 }),
        d.p([F.COMPANY_NAME_UPPER], { align: 'center', after: 0 }, { halfPoints: 28 }),
        d.p(t`(Company Registration No. ${F.COMPANY_UEN})`, centred),
        d.p('(Incorporated in the Republic of Singapore under the Companies Act 1967)', { align: 'center', after: 480 }),
        d.p([bold('SHARE CERTIFICATE')], { align: 'center', after: 480 }, { halfPoints: 28, underline: true }),
        d.p(t`THIS IS TO CERTIFY THAT ${strong(F.SHAREHOLDER_NAME)} (${F.SHAREHOLDER_ID_LABEL} ${F.SHAREHOLDER_ID}) of ${F.SHAREHOLDER_ADDRESS} is the registered holder of ${strong(F.CERTIFICATE_SHARES)} fully paid ${F.SHAREHOLDER_CLASS} shares in the capital of the above-named Company, subject to the Constitution of the Company.`, { ...justified, after: 360 }),
      ].join(''), 'Shareholder'),
      d.p(t`Dated ${F.CERTIFICATE_DATE}`, { after: 240 }),
      d.p('Executed by the Company in accordance with Section 41B of the Companies Act 1967:', { after: 120, keepNext: true }),
      d.table([half, half], [d.row([signatory('Director'), signatory('Director / Secretary')], { cantSplit: true })]),
      d.p('No transfer of any of the shares comprised in this certificate will be registered unless this certificate is produced.', { align: 'center', before: 480, after: 0 }, { italic: true, halfPoints: 16 }),
    ],
    perPersonTag: OAKDOC_SHAREHOLDERS_REPEATER_TAG,
  };
});

/** A party's particulars and their part of the transfer, for each contact on the list. */
function transferParty(d: DocumentWriter, list: string, shares: Segment[]): string {
  const widths = [2600, 284, 6142];
  const row = (text: Segment[] | string, value: Segment[]) => d.row([
    d.cell(widths[0], d.p(text, { after: 80 })),
    d.cell(widths[1], d.p(':', { after: 80 })),
    d.cell(widths[2], d.p(value, { after: 80 })),
  ], { cantSplit: true });
  return d.table(widths, [d.contacts(list, [
    row('Name', [F.CONTACT_NAME_BOLD]),
    row([F.CONTACT_ID_LABEL], [F.CONTACT_ID]),
    d.when(whenBlank(F.CONTACT_IS_CORPORATE), row('Nationality', [F.CONTACT_NATIONALITY])),
    row('Address', [F.CONTACT_ADDRESS]),
    row('Shares', shares),
    d.row([d.cell(widths[0], d.gap(120)), d.cell(widths[1], ''), d.cell(widths[2], '')]),
  ].join(''))]);
}

/** Each party on the list signs before a witness; a company through its authorised signatory. */
function transferSignatures(d: DocumentWriter, list: string, role: string): string {
  return d.contacts(list, [
    d.p([bold(`Signed by the ${role}`)], { before: 240, after: 0, keepNext: true }),
    partySignature(d, { name: F.CONTACT_NAME, isCorporate: F.CONTACT_IS_CORPORATE, capacity: role, after: 120 }),
    d.p('Witness: ………………………………', { after: 0, keepNext: true }),
    d.p('Name and NRIC: ………………………', { after: 240 }),
  ].join(''));
}

export const INSTRUMENT_OF_TRANSFER = document('Instrument of Transfer', 'OTHER', 'Share transfer form between the contacts on the “Transferor” and “Transferee” lists, with each party’s shares and consideration (checked against the totals on Configure), a signature and witness for each party, and a stamp duty reminder.', (d) => ({
  body: [
    title(d, 'INSTRUMENT OF TRANSFER', 360),
    d.p(t`Name of Company: ${F.COMPANY_NAME_UPPER} (UEN ${F.COMPANY_UEN}) (the “Company”)`, { after: 240 }),
    heading(d, 'TRANSFEROR(S)'),
    transferParty(d, TRANSFEROR_LIST, t`${F.TRANSFEROR_SHARES} ordinary shares, for a consideration of S$${F.TRANSFEROR_CONSIDERATION} (share certificate no. ${F.TRANSFEROR_CERTIFICATE})`),
    d.gap(120),
    heading(d, 'TRANSFEREE(S)'),
    transferParty(d, TRANSFEREE_LIST, t`${F.TRANSFEREE_SHARES} ordinary shares`),
    d.gap(240),
    d.p(t`The Transferor(s) named above, in consideration of the total sum of S$${F.TRANSFER_CONSIDERATION} paid by the Transferee(s) named above (the receipt of which is acknowledged), hereby transfer to the Transferee(s) ${F.TRANSFER_SHARES} ordinary shares in the Company standing in the name of the Transferor(s) in the register of members of the Company, in the numbers set out above, to hold unto the Transferee(s), and their executors, administrators, successors and assigns, subject to the several conditions on which the Transferor(s) held the same at the time of signing this instrument; and the Transferee(s) hereby agree to take the said shares subject to the same conditions.`, justified),
    d.p(t`Dated ${F.TRANSFER_DATE}`, { after: 240 }),
    transferSignatures(d, TRANSFEROR_LIST, 'Transferor'),
    transferSignatures(d, TRANSFEREE_LIST, 'Transferee'),
    d.p('Stamp duty is payable on this instrument to the Inland Revenue Authority of Singapore within 14 days after the date it is signed (30 days if signed outside Singapore).', { before: 480, after: 0 }, { italic: true, halfPoints: 16 }),
  ],
}));

const STATEMENT_DATE = custom('statement_date', 'Statement date', 'date', '3 October 2026', { dateFormat: 'd MMMM yyyy' });

export const SOLVENCY_STATEMENT = document('Solvency Statement', 'OTHER', 'Directors’ solvency statement for a capital reduction under Section 78B, signed by each director. It must be made no more than 20 days before the members’ special resolution.', (d) => ({
  body: [
    ...companyHeading(d),
    ruledTitle(d, 'SOLVENCY STATEMENT'),
    d.p('(Sections 7A and 78B of the Companies Act 1967)', { align: 'center', after: 240 }),
    d.p(t`We, the undersigned, being all the Directors of the Company, having made a full inquiry into the affairs of the Company, have formed the opinion that, in relation to the proposed reduction of the share capital of the Company by S$${F.REDUCTION_AMOUNT}:`, justified),
    ...[
      ['(a)', 'as regards the Company’s situation at the date of this statement, there is no ground on which the Company could then be found to be unable to pay its debts;'],
      ['(b)', 'if it is intended to commence the winding up of the Company within the period of 12 months immediately after the date of this statement, the Company will be able to pay its debts in full within the period of 12 months after the date of commencement of the winding up, or, if it is not so intended, the Company will be able to pay its debts as they fall due during the period of 12 months immediately after the date of this statement; and'],
      ['(c)', 'the value of the Company’s assets is not less than the value of its liabilities (including contingent liabilities) and will not, after the proposed reduction, become less than the value of its liabilities (including contingent liabilities).'],
    ].map(([letter, text]) => d.p([letter, TAB, text], lettered)),
    d.p(t`Dated ${STATEMENT_DATE}`, { before: 240, after: 120 }),
    directorSignatures(d),
  ],
}));

export const DIVIDEND_VOUCHER = document('Dividend Voucher', 'OTHER', 'Dividend voucher for each shareholder ticked on Configure; the amount is their shares times the dividend per share.', (d) => {
  const widths = [3402, 5624];
  const row = (text: string, value: Segment[]) => d.row([
    d.cell(widths[0], d.p([bold(text)], { after: 0 })),
    d.cell(widths[1], d.p(value, { after: 0 })),
  ]);
  return {
    body: [
      ...companyHeading(d),
      ruledTitle(d, 'DIVIDEND VOUCHER'),
      d.table(widths, [
        d.repeat(OAKDOC_SHAREHOLDERS_REPEATER_TAG, [
          row('Shareholder', [F.SHAREHOLDER_NAME]),
          row('Address', [F.SHAREHOLDER_ADDRESS]),
          row('Number of shares held', [F.SHAREHOLDER_SHARES]),
          row('Dividend per share', ['S$', F.DIVIDEND_PER_SHARE]),
          row('Dividend', t`One-tier tax-exempt dividend in respect of the financial year ending ${F.DIVIDEND_PERIOD_END}`),
          row('Record date', [F.DIVIDEND_RECORD_DATE]),
          row('Payment date', [F.DIVIDEND_PAYMENT_DATE]),
          row('Amount payable', [bold('S$'), strong(F.SHAREHOLDER_DIVIDEND)]),
        ].join(''), 'Shareholder'),
      ], { borders: true }),
      d.p('This is a one-tier tax-exempt dividend and is not taxable in the hands of the shareholder.', { before: 240, after: 360 }, { italic: true }),
      ...entitySignature(d, [F.COMPANY_NAME_UPPER], 'Director'),
    ],
    perPersonTag: OAKDOC_SHAREHOLDERS_REPEATER_TAG,
  };
});

const DECLARATION_DATE = custom('declaration_date', 'Declaration date', 'date', '3 October 2026', { dateFormat: 'd MMMM yyyy' });

export const STRIKE_OFF_DECLARATION = document('Striking Off Declaration by Directors', 'OTHER', 'Directors declare the company meets ACRA’s criteria for striking off under Section 344A, signed by each director.', (d) => ({
  body: [
    ...companyHeading(d),
    ruledTitle(d, 'DECLARATION BY DIRECTORS IN SUPPORT OF APPLICATION FOR STRIKING OFF'),
    d.p('We, the undersigned, being all the Directors of the Company, declare that:', justified),
    ...[
      ['(a)', 'the Company has not commenced business since incorporation, or has ceased business;'],
      ['(b)', 'the Company has no assets and no liabilities, including contingent liabilities;'],
      ['(c)', 'the Company has no outstanding tax liabilities (including income tax and goods and services tax) with the Inland Revenue Authority of Singapore, no outstanding Central Provident Fund contributions and no outstanding debts to any other government agency;'],
      ['(d)', 'there are no outstanding charges in the Company’s charge register;'],
      ['(e)', 'the Company is not involved in any legal proceedings, in or outside Singapore, is not subject to any scheme of arrangement and is not a party to any pending transaction;'],
      ['(f)', 'the Company has no outstanding penalties or fines payable to the Registrar of Companies; and'],
      ['(g)', 'all the members of the Company have consented to the application for striking off.'],
    ].map(([letter, text]) => d.p([letter, TAB, text], lettered)),
    d.p(t`Dated ${DECLARATION_DATE}`, { before: 240, after: 120 }),
    directorSignatures(d),
  ],
}));

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const SIGNING_DIRECTOR = 'Signing director';

export const LETTER_TO_FORMER_SECRETARY = document('Letter to Former Secretary', 'LETTER', 'Asks the former secretary or corporate secretarial firm to hand over the statutory records when the firm takes over. Signed by the director picked on Configure.', (d) => {
  d.namePicker('selectedDirector', SIGNING_DIRECTOR);
  return {
    body: [
      ...companyHeading(d, 240),
      d.p(t`${F.LETTER_DATE}`, { after: 240 }),
      d.p([F.PREVIOUS_SECRETARY], { after: 0 }),
      d.p([F.PREVIOUS_SECRETARY_ADDRESS], { after: 240 }),
      d.p('Dear Sirs,', { after: 240 }),
      d.p([bold('CHANGE OF COMPANY SECRETARY AND CORPORATE SECRETARIAL AGENT – '), F.COMPANY_NAME_UPPER], { after: 240 }),
      d.p(t`Please be informed that the Company has appointed ${bold(F.FIRM_NAME)} (UEN ${F.FIRM_UEN}) as its corporate secretarial agent, and ${F.NEW_SECRETARY_NAME} as its Company Secretary, with effect from ${F.EFFECTIVE_DATE}.`, justified),
      d.p(t`We should be grateful if you would hand over the following statutory records and documents of the Company to ${F.FIRM_NAME}:`, justified),
      ...[
        ['(a)', 'the Certificate of Incorporation and the Constitution;'],
        ['(b)', 'the minute books and the resolutions of the directors and members;'],
        ['(c)', 'the registers of directors, secretaries, auditors, members, transfers, allotments, charges, registrable controllers and nominee directors;'],
        ['(d)', 'the share certificate book, including counterfoils and cancelled certificates;'],
        ['(e)', 'the common seal, if any;'],
        ['(f)', 'copies of documents lodged with the Accounting and Corporate Regulatory Authority; and'],
        ['(g)', 'any other records of the Company in your possession.'],
      ].map(([letter, text]) => d.p([letter, TAB, text], lettered)),
      d.p('Please also let us know of any fees outstanding to you, and lodge the cessation of your appointment as secretary if you have not already done so.', { ...justified, before: 120 }),
      d.p('Thank you for your assistance.', { after: 360 }),
      d.p('Yours faithfully,', { after: 0 }),
      ...entitySignature(d, [F.COMPANY_NAME_UPPER], 'Director', 240, [F.PICKED_DIRECTOR_NAME]),
    ],
  };
});

export const REGISTERED_OFFICE_CONSENT = document('Consent to Use of Registered Office Address', 'LETTER', 'The firm consents to its address being the company’s registered office while it provides corporate secretarial services.', (d) => ({
  body: [
    ...toTheBoard(d),
    d.p([bold('CONSENT TO USE OF ADDRESS AS REGISTERED OFFICE')], { after: 240 }),
    d.p(t`${bold(F.FIRM_NAME)} (UEN ${F.FIRM_UEN}) hereby consents to its address at ${F.NEW_REGISTERED_ADDRESS} being used as the registered office of the Company with effect from ${F.EFFECTIVE_DATE}, for so long as the Company engages us to provide corporate secretarial services.`, justified),
    d.p('We will keep the registered office open and accessible to the public as the Companies Act 1967 requires, receive correspondence on the Company’s behalf and let the Company know promptly of any correspondence received. The Company shall change its registered office within 14 days after our engagement ends.', { ...justified, after: 360 }),
    d.p('Yours faithfully,', { after: 0 }),
    ...entitySignature(d, [F.FIRM_NAME], 'Director'),
  ],
}));

export const CORP_SEC_DOCUMENTS: readonly CorpSecDocument[] = [
  NOTICE_OF_AGM,
  CONSENT_TO_SHORT_NOTICE,
  AGM_ATTENDANCE_LIST,
  MINUTES_OF_AGM,
  PROXY_FORM,
  CORPORATE_REPRESENTATIVE,
  DIRECTOR_RESIGNATION_LETTER,
  DIRECTOR_CHANGE_OF_PARTICULARS,
  AUDITOR_CONSENT,
  NOMINEE_DIRECTOR_AGREEMENT,
  NOMINEE_DIRECTOR_INDEMNITY,
  APPLICATION_FOR_SHARES,
  SHARE_CERTIFICATE,
  INSTRUMENT_OF_TRANSFER,
  SOLVENCY_STATEMENT,
  DIVIDEND_VOUCHER,
  STRIKE_OFF_DECLARATION,
  LETTER_TO_FORMER_SECRETARY,
  REGISTERED_OFFICE_CONSENT,
];
