import {
  OAKDOC_DIRECTORS_REPEATER_TAG,
  OAKDOC_SHAREHOLDERS_REPEATER_TAG,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import type { PlaceholderDefinition } from '@/lib/validations/document-template';
import {
  BOARD_RESOLUTION_PLACEHOLDERS,
  buildDirectorsResolutionOakDocMaster,
  buildMembersResolutionOakDocMaster,
} from '@/content/resolution/board-resolution-oakdoc';
import { HEADING_STYLE } from '@/content/resolution/first-board-resolution-oakdoc';
import { ARIAL_10 } from '@/content/resolution/resolution-oakdoc-xml';
import {
  DocumentWriter,
  TAB,
  bold,
  t,
  type BuiltDocument,
  type Segment,
} from './corp-sec-oakdoc-kit';
import * as F from './corp-sec-fields';

/**
 * Corporate secretarial resolutions for a Singapore private company: the
 * resolution partials (each one numbered resolution, in Arial 10 like the
 * First Board Resolution), and the directors' and members' templates that
 * preset them for each piece of work (annual accounts, officer changes,
 * shares, company changes, bank, dividends, striking off). Every partial
 * can also be picked on any other resolution template on Configure.
 */

export interface CorpSecPartial {
  /** Stable partial name (letters, numbers, hyphens). */
  name: string;
  displayName: string;
  /** Default numbered heading. */
  header: string;
  build: () => BuiltDocument;
}

export const paragraph = { align: 'both' as const, after: 120 };
export const bullet = { indent: { left: 720, hanging: 360 }, after: 60 };

/** Builds once; the seed and the tests read the same bytes and placeholders. */
function once(build: () => BuiltDocument): () => BuiltDocument {
  let built: BuiltDocument | undefined;
  return () => (built ??= build());
}

export function partial(
  name: string,
  displayName: string,
  header: string,
  write: (d: DocumentWriter) => string[],
): CorpSecPartial {
  return {
    name,
    displayName,
    header,
    build: once(() => {
      const d = new DocumentWriter(ARIAL_10, 9500);
      // Each partial ends with an empty line, which spaces it from the next resolution.
      const body = [...write(d), d.gap(0)];
      return { bytes: d.package(body), placeholders: d.placeholders() };
    }),
  };
}

export type Lead = 'first' | 'further' | 'ordinary' | 'special' | 'noted' | 'furtherNoted' | 'confirmed';

const LEADS: Record<Lead, string> = {
  first: 'RESOLVED THAT ',
  further: 'FURTHER RESOLVED THAT ',
  // Members' resolutions say which kind they are.
  ordinary: 'RESOLVED AS AN ORDINARY RESOLUTION THAT ',
  special: 'RESOLVED AS A SPECIAL RESOLUTION THAT ',
  // What the members record rather than decide.
  noted: 'IT IS NOTED THAT ',
  furtherNoted: 'IT IS FURTHER NOTED THAT ',
  // What the Directors confirm as fact (a dormant company's declarations).
  confirmed: 'CONFIRMED THAT ',
};

export function resolved(d: DocumentWriter, segments: Segment[], kind: Lead = 'first'): string {
  return d.p([bold(LEADS[kind]), ...segments], paragraph);
}

/** "NAME (NRIC No. S1234567A)", or "(UEN 202624322D)" for a company. */
const CONTACT = t`${F.CONTACT_NAME_BOLD} (${F.CONTACT_ID_LABEL} ${F.CONTACT_ID})`;

/** "• NAME (NRIC No. ID)", then any details, for each contact on a named list. */
function contactList(d: DocumentWriter, listName: string, details: Segment[] = []): string {
  return d.contacts(listName, d.p(['•', TAB, ...CONTACT, ...details], bullet));
}

const LODGEMENT_TEXT = 'all necessary documents and forms be completed, signed and lodged with the Accounting and Corporate Regulatory Authority.';

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

export const LODGEMENT = partial('resolution-cosec-lodgement', 'General - Notification and Lodgement', 'NOTIFICATION AND LODGEMENT', (d) => [
  resolved(d, [LODGEMENT_TEXT]),
]);

export const AUTHORISATION = partial('resolution-cosec-authorisation', 'General - Authority to Sign', 'AUTHORITY TO SIGN', (d) => [
  resolved(d, ['any Director or the Secretary of the Company be authorised to sign all documents and to do all such acts and things as may be necessary to give effect to the above resolutions.']),
]);

// ---------------------------------------------------------------------------
// Annual compliance
// ---------------------------------------------------------------------------

export const APPROVE_FINANCIAL_STATEMENTS = partial('resolution-agm-approve-financial-statements', 'AGM - Approval of Financial Statements (Directors)', 'FINANCIAL STATEMENTS', (d) => [
  resolved(d, t`the financial statements of the Company for the financial year ended ${F.FS_PERIOD_END} be approved and the Directors’ Statement be adopted, the Independent Auditor’s Report on them, where the financial statements are audited, having been noted.`),
  resolved(d, ['any two Directors, or the sole Director where the Company has only one, be authorised to sign the Directors’ Statement and the statement of financial position on behalf of the Board.'], 'further'),
]);

export const RESOLUTIONS_IN_LIEU_OF_AGM = partial('resolution-agm-resolutions-in-lieu', 'AGM - Resolutions in Lieu of AGM (Directors)', 'RESOLUTIONS IN LIEU OF ANNUAL GENERAL MEETING', (d) => [
  resolved(d, t`in accordance with Section 175A of the Companies Act 1967, no annual general meeting be held for the financial year ended ${F.FS_PERIOD_END}, and that the financial statements be sent to all members within five months after the end of that financial year, together with members’ resolutions in writing under Section 184A of the Companies Act 1967 for their approval.`),
]);

export const CONVENE_AGM = partial('resolution-agm-convene', 'AGM - Convene Annual General Meeting (Directors)', 'ANNUAL GENERAL MEETING', (d) => [
  resolved(d, t`the Annual General Meeting of the Company be convened and held at ${F.AGM_VENUE} on ${F.AGM_DATE} at ${F.AGM_TIME}, and that the Secretary be authorised to issue the notice of the meeting to all members.`),
]);

export const RECEIVE_FINANCIAL_STATEMENTS = partial('resolution-agm-receive-financial-statements', 'AGM - Adoption of Financial Statements (Members)', 'FINANCIAL STATEMENTS AND DIRECTORS’ STATEMENT', (d) => [
  resolved(d, t`the ${F.FS_DOCUMENTS} for the financial year ended ${F.FS_PERIOD_END} be received, and are hereby approved and adopted by the members of the Company.`, 'ordinary'),
]);

export const DIRECTORS_FOR_RE_ELECTION = 'Directors for re-election';

export const RE_ELECT_DIRECTORS = partial('resolution-agm-re-elect-directors', 'AGM - Re-election of Directors (Members)', 'RE-ELECTION OF DIRECTORS', (d) => [
  d.repeat(OAKDOC_DIRECTORS_REPEATER_TAG, resolved(d, t`${F.DIRECTOR_NAME} (${F.DIRECTOR_ID_LABEL} ${F.DIRECTOR_ID}), who retires in accordance with the Constitution of the Company and, being eligible, has offered to be re-elected, be re-elected as a Director of the Company.`, 'ordinary'), DIRECTORS_FOR_RE_ELECTION),
]);

export const AUDIT_EXEMPTION_MEMBERS = partial('resolution-agm-audit-exemption', 'AGM - Audit Exemption (Members)', 'AUDIT EXEMPTION', (d) => [
  resolved(d, t`it be noted that the Company, being ${F.AUDIT_EXEMPTION_BASIS}, is exempt from having its financial statements audited, and that no auditor be appointed for so long as the Company remains so exempt.`, 'ordinary'),
]);

export const AUDIT_EXEMPTION_DIRECTORS = partial('resolution-agm-audit-exemption-directors', 'AGM - Audit Exemption (Directors)', 'AUDIT EXEMPTION', (d) => [
  resolved(d, t`the Directors, having considered the Company’s revenue, total assets and number of employees, note that the Company is ${F.AUDIT_EXEMPTION_BASIS} and that its financial statements for the financial year ended ${F.FS_PERIOD_END} are therefore not required to be audited.`),
]);

export const RE_APPOINT_AUDITORS = partial('resolution-agm-re-appoint-auditors', 'AGM - Re-appointment of Auditors (Members)', 'RE-APPOINTMENT OF AUDITORS', (d) => [
  resolved(d, t`${F.AUDITOR_NAME} be re-appointed as auditors of the Company to hold office until the conclusion of the next annual general meeting, and that the Directors be authorised to fix their remuneration.`, 'ordinary'),
]);

export const DIRECTORS_FEES = partial('resolution-agm-directors-fees', 'AGM - Directors’ Fees (Members)', 'DIRECTORS’ FEES', (d) => [
  resolved(d, t`the payment of Directors’ fees of S$${F.DIRECTORS_FEES} for the financial year ended ${F.FS_PERIOD_END} be approved.`, 'ordinary'),
]);

export const SHARE_ISSUE_MANDATE = partial('resolution-agm-share-issue-mandate', 'AGM - Authority to Allot and Issue Shares (Members)', 'AUTHORITY TO ALLOT AND ISSUE SHARES', (d) => [
  resolved(d, ['pursuant to Section 161 of the Companies Act 1967, authority be given to the Directors to allot and issue shares in the Company at any time, upon such terms and conditions, for such purposes and to such persons as the Directors may in their absolute discretion deem fit, and that this authority continue in force until the conclusion of the next annual general meeting of the Company or the expiration of the period within which the next annual general meeting is required by law to be held, whichever is earlier.'], 'ordinary'),
]);

// ---------------------------------------------------------------------------
// Officers and auditors
// ---------------------------------------------------------------------------

export const DIRECTOR_TO_BE_APPOINTED = 'Director to be appointed';

export const APPOINT_DIRECTOR = partial('resolution-officers-appoint-director', 'Officers - Appointment of Director', 'APPOINTMENT OF DIRECTOR', (d) => [
  d.contacts(DIRECTOR_TO_BE_APPOINTED, resolved(d, t`${CONTACT}, having consented to act, be appointed as a Director of the Company with effect from ${F.APPOINTMENT_DATE}.`)),
]);

export const DIRECTOR_RESIGNING = 'Director resigning';

export const DIRECTOR_RESIGNATION = partial('resolution-officers-director-resignation', 'Officers - Resignation of Director', 'RESIGNATION OF DIRECTOR', (d) => [
  d.repeat(F.DIRECTOR_OFFICERS_TAG, resolved(d, t`the resignation of ${F.OFFICER_NAME} (${F.OFFICER_ID_LABEL} ${F.OFFICER_ID}) as a Director of the Company with effect from ${F.CESSATION_DATE} be accepted, and that the Board record its appreciation for the services rendered.`), DIRECTOR_RESIGNING),
  resolved(d, ['it be noted that, after the resignation, the Company will continue to have at least one Director who is ordinarily resident in Singapore, as Section 145 of the Companies Act 1967 requires.'], 'further'),
]);

export const APPOINT_AUDITORS = partial('resolution-auditor-appoint', 'Auditor - Appointment of Auditors (Directors)', 'APPOINTMENT OF AUDITORS', (d) => [
  resolved(d, t`pursuant to ${F.AUDITOR_APPOINTMENT_BASIS}, ${F.NEW_AUDITOR_NAME}, having consented to act, be appointed as auditors of the Company to hold office until the conclusion of the next annual general meeting of the Company, at a remuneration to be fixed by the Directors.`),
]);

export const AUDITOR_RESIGNATION = partial('resolution-auditor-resignation', 'Auditor - Resignation of Auditors (Directors)', 'RESIGNATION OF AUDITORS', (d) => [
  resolved(d, t`the resignation of ${F.AUDITOR_NAME} as auditors of the Company with effect from ${F.AUDITOR_CESSATION_DATE} be accepted.`),
]);

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

export const APPLICANT_LIST = 'Applicant';
export const TRANSFEROR_LIST = 'Transferor';
export const TRANSFEREE_LIST = 'Transferee';

export const APPROVE_SHARE_ISSUE = partial('resolution-shares-section-161-approval', 'Shares - Approval to Issue Shares (Members)', 'ISSUE OF SHARES', (d) => [
  resolved(d, t`pursuant to Section 161 of the Companies Act 1967, approval be given to the Directors to allot and issue ${F.ALLOTMENT_SHARES} new ordinary shares in the capital of the Company at an issue price of S$${F.ISSUE_PRICE} per share, for a total consideration of S$${F.ALLOTMENT_CONSIDERATION}, to such persons and on such terms as the Directors may decide.`, 'ordinary'),
]);

export const WAIVE_PRE_EMPTION = partial('resolution-shares-waive-pre-emption', 'Shares - Waiver of Pre-emption Rights (Members)', 'WAIVER OF PRE-EMPTION RIGHTS', (d) => [
  resolved(d, t`the members waive any rights of pre-emption they may have under the Constitution of the Company in respect of the allotment and issue of the ${F.ALLOTMENT_SHARES} new ordinary shares.`, 'ordinary'),
]);

export const ALLOT_SHARES = partial('resolution-shares-allotment', 'Shares - Allotment of Shares (Directors)', 'ALLOTMENT OF SHARES', (d) => [
  resolved(d, t`the applications for an aggregate of ${F.ALLOTMENT_SHARES} ordinary shares in the capital of the Company at S$${F.ISSUE_PRICE} per share, for a total consideration of S$${F.ALLOTMENT_CONSIDERATION} payable in cash, from the following applicants be accepted, and that the shares be allotted and issued to them in accordance with their applications, credited as fully paid:`),
  contactList(d, APPLICANT_LIST, t`: ${F.APPLICANT_SHARES} shares for S$${F.APPLICANT_AMOUNT}`),
  d.gap(60),
  resolved(d, ['share certificates be issued to the allottees under the signature of two Directors, or a Director and the Secretary, and that a return of allotment be lodged with the Accounting and Corporate Regulatory Authority.'], 'further'),
]);

export const APPROVE_SHARE_TRANSFER = partial('resolution-shares-transfer', 'Shares - Transfer of Shares (Directors)', 'TRANSFER OF SHARES', (d) => [
  resolved(d, t`the transfer of ${F.TRANSFER_SHARES} ordinary shares in the capital of the Company, for a total consideration of S$${F.TRANSFER_CONSIDERATION}, from the Transferor(s) to the Transferee(s) named below be approved and registered, subject to the instrument of transfer being duly stamped:`),
  d.p([bold('Transferor(s)')], { after: 0, keepNext: true }),
  contactList(d, TRANSFEROR_LIST, t`: ${F.TRANSFEROR_SHARES} shares, for S$${F.TRANSFEROR_CONSIDERATION} (share certificate no. ${F.TRANSFEROR_CERTIFICATE})`),
  d.p([bold('Transferee(s)')], { before: 60, after: 0, keepNext: true }),
  contactList(d, TRANSFEREE_LIST, t`: ${F.TRANSFEREE_SHARES} shares`),
  d.gap(60),
  resolved(d, ['the share certificates of the Transferor(s) listed above be cancelled, that new share certificates be issued to the Transferee(s) (and balance certificates to the Transferor(s) for any shares not transferred), and that the transfer be lodged with the Accounting and Corporate Regulatory Authority.'], 'further'),
]);

export const SHAREHOLDERS_AFFECTED = 'Shareholders affected';

export const REDUCE_CAPITAL = partial('resolution-shares-capital-reduction', 'Shares - Reduction of Share Capital (Members)', 'REDUCTION OF SHARE CAPITAL', (d) => [
  resolved(d, t`pursuant to Section 78B of the Companies Act 1967 and the Constitution of the Company, the share capital of the Company be reduced by the cancellation of ${F.REDUCTION_SHARES} ordinary shares and the return of S$${F.REDUCTION_AMOUNT} to the shareholders listed below, as set out against their names, the Directors having made a solvency statement in relation to the reduction in accordance with Sections 7A and 78B of the Companies Act 1967:`, 'special'),
  d.repeat(OAKDOC_SHAREHOLDERS_REPEATER_TAG, d.p(t`•${TAB}${F.SHAREHOLDER_NAME} (${F.SHAREHOLDER_ID_LABEL} ${F.SHAREHOLDER_ID}): ${F.MEMBER_REDUCTION_SHARES} shares cancelled and S$${F.MEMBER_REDUCTION_AMOUNT} returned`, bullet), SHAREHOLDERS_AFFECTED),
]);

export const SHARE_BUY_BACK = partial('resolution-shares-buy-back', 'Shares - Share Buy-Back (Members)', 'SHARE BUY-BACK', (d) => [
  resolved(d, t`pursuant to Section 76C of the Companies Act 1967, the Directors be authorised to purchase on behalf of the Company up to ${F.BUYBACK_SHARES} ordinary shares in the capital of the Company by way of an off-market acquisition in accordance with an equal access scheme, at a price of S$${F.BUYBACK_PRICE} per share, payable out of the capital or profits of the Company, the Company being solvent within the meaning of Section 76F of the Companies Act 1967, and that this authority continue until the conclusion of the next annual general meeting of the Company.`, 'ordinary'),
]);

// ---------------------------------------------------------------------------
// Company changes
// ---------------------------------------------------------------------------

export const CHANGE_REGISTERED_OFFICE = partial('resolution-company-registered-office', 'Company - Change of Registered Office', 'CHANGE OF REGISTERED OFFICE', (d) => [
  resolved(d, t`the registered office of the Company be changed from ${F.REGISTERED_ADDRESS} to ${F.NEW_REGISTERED_ADDRESS} with effect from ${F.EFFECTIVE_DATE}.`),
]);

export const CHANGE_NAME = partial('resolution-company-change-of-name', 'Company - Change of Name (Members)', 'CHANGE OF NAME', (d) => [
  resolved(d, t`pursuant to Section 28 of the Companies Act 1967, the name of the Company be changed from ${F.COMPANY_NAME_UPPER} to ${F.NEW_COMPANY_NAME}, and that the name ${F.NEW_COMPANY_NAME} be substituted for ${F.COMPANY_NAME_UPPER} wherever the latter appears in the Constitution of the Company.`, 'special'),
]);

export const CHANGE_FINANCIAL_YEAR_END = partial('resolution-company-financial-year-end', 'Company - Change of Financial Year End', 'CHANGE OF FINANCIAL YEAR END', (d) => [
  resolved(d, t`the financial year end of the Company be changed from ${F.FINANCIAL_YEAR_END} to ${F.NEW_FINANCIAL_YEAR_END}, so that the current financial period of the Company ends on ${F.CURRENT_PERIOD_END}.`),
]);

export const CHANGE_PRIMARY_ACTIVITY = partial('resolution-company-primary-activity', 'Company - Change of Primary Activity (SSIC)', 'CHANGE OF PRINCIPAL ACTIVITY', (d) => [
  resolved(d, t`the primary activity of the Company be changed to ${F.NEW_PRIMARY_ACTIVITY}, in place of ${F.PRIMARY_ACTIVITY}.`),
]);

export const CHANGE_SECONDARY_ACTIVITY = partial('resolution-company-secondary-activity', 'Company - Change of Secondary Activity (SSIC)', 'CHANGE OF SECONDARY ACTIVITY', (d) => [
  resolved(d, t`the secondary activity of the Company be ${F.NEW_SECONDARY_ACTIVITY}, in place of any secondary activity previously registered.`),
]);

export const ADOPT_CONSTITUTION = partial('resolution-company-adopt-constitution', 'Company - Adoption of New Constitution (Members)', 'ADOPTION OF NEW CONSTITUTION', (d) => [
  resolved(d, t`the regulations contained in ${F.NEW_CONSTITUTION} be approved and adopted as the Constitution of the Company in substitution for, and to the exclusion of, the existing Constitution of the Company.`, 'special'),
]);

export const ALTER_CONSTITUTION = partial('resolution-company-alter-constitution', 'Company - Alteration of Constitution (Members)', 'ALTERATION OF CONSTITUTION', (d) => [
  resolved(d, ['pursuant to Section 26 of the Companies Act 1967, the Constitution of the Company be altered as follows:'], 'special'),
  d.p([F.CONSTITUTION_ALTERATIONS], { ...paragraph, indent: { left: 720 } }),
]);

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------

export const AUTHORISED_SIGNATORIES = 'Authorised signatories';

export const OPEN_BANK_ACCOUNT = partial('resolution-bank-open-account', 'Bank - Opening of Bank Account', 'OPENING OF BANK ACCOUNT', (d) => [
  resolved(d, t`an account be opened in the name of the Company with ${F.BANK_NAME} (the “Bank”), and that the Bank’s standard resolutions for the opening and operation of the account be adopted.`),
  resolved(d, ['the following persons be appointed as authorised signatories of the account:'], 'further'),
  contactList(d, AUTHORISED_SIGNATORIES),
  d.gap(60),
  resolved(d, t`the account be operated in accordance with the following signing mandate: ${F.SIGNING_MANDATE}`, 'further'),
]);

export const CHANGE_BANK_SIGNATORIES = partial('resolution-bank-change-signatories', 'Bank - Change of Authorised Signatories', 'CHANGE OF AUTHORISED SIGNATORIES', (d) => [
  resolved(d, t`the authorised signatories of account no. ${F.BANK_ACCOUNT_NO} maintained by the Company with ${F.BANK_NAME} be the following persons, in place of all previous authorised signatories:`),
  contactList(d, AUTHORISED_SIGNATORIES),
  d.gap(60),
  resolved(d, t`the account be operated in accordance with the following signing mandate: ${F.SIGNING_MANDATE}`, 'further'),
]);

export const CLOSE_BANK_ACCOUNT = partial('resolution-bank-close-account', 'Bank - Closure of Bank Account', 'CLOSURE OF BANK ACCOUNT', (d) => [
  resolved(d, t`account no. ${F.BANK_ACCOUNT_NO} maintained by the Company with ${F.BANK_NAME} be closed, and that any balance in the account be transferred to such other account of the Company as the Directors may direct.`),
]);

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

export const INTERIM_DIVIDEND = partial('resolution-dividend-interim', 'Dividend - Interim Dividend (Directors)', 'INTERIM DIVIDEND', (d) => [
  resolved(d, t`an interim one-tier tax-exempt dividend of S$${F.DIVIDEND_PER_SHARE} per ordinary share, amounting to S$${F.DIVIDEND_TOTAL} in total, in respect of the financial year ending ${F.DIVIDEND_PERIOD_END}, be declared and paid on ${F.DIVIDEND_PAYMENT_DATE} to the shareholders registered in the Register of Members on ${F.DIVIDEND_RECORD_DATE}, the Directors being satisfied that the Company has profits available for distribution and will remain solvent after the payment.`),
]);

export const FINAL_DIVIDEND = partial('resolution-dividend-final', 'Dividend - Final Dividend (Members)', 'FINAL DIVIDEND', (d) => [
  resolved(d, t`a final one-tier tax-exempt dividend of S$${F.DIVIDEND_PER_SHARE} per ordinary share, amounting to S$${F.DIVIDEND_TOTAL} in total, in respect of the financial year ended ${F.DIVIDEND_PERIOD_END}, as recommended by the Directors, be declared and paid on ${F.DIVIDEND_PAYMENT_DATE} to the shareholders registered in the Register of Members on ${F.DIVIDEND_RECORD_DATE}.`, 'ordinary'),
]);

// ---------------------------------------------------------------------------
// Striking off
// ---------------------------------------------------------------------------

export const STRIKE_OFF_APPLICATION = partial('resolution-strike-off-application', 'Striking Off - Application (Directors)', 'STRIKING OFF', (d) => [
  resolved(d, ['the Company, having ceased business and having no assets and no liabilities, apply to the Registrar of Companies under Section 344A of the Companies Act 1967 to strike the name of the Company off the register, and that any Director or the Secretary be authorised to submit the application and to sign all documents in connection with it.']),
]);

export const STRIKE_OFF_CONSENT = partial('resolution-strike-off-consent', 'Striking Off - Members’ Consent', 'STRIKING OFF', (d) => [
  resolved(d, ['the members consent to the Company applying to the Registrar of Companies under Section 344A of the Companies Act 1967 for the name of the Company to be struck off the register.'], 'ordinary'),
]);

export const CORP_SEC_PARTIALS: readonly CorpSecPartial[] = [
  LODGEMENT,
  AUTHORISATION,
  APPROVE_FINANCIAL_STATEMENTS,
  RESOLUTIONS_IN_LIEU_OF_AGM,
  CONVENE_AGM,
  RECEIVE_FINANCIAL_STATEMENTS,
  RE_ELECT_DIRECTORS,
  AUDIT_EXEMPTION_MEMBERS,
  AUDIT_EXEMPTION_DIRECTORS,
  RE_APPOINT_AUDITORS,
  DIRECTORS_FEES,
  SHARE_ISSUE_MANDATE,
  APPOINT_DIRECTOR,
  DIRECTOR_RESIGNATION,
  APPOINT_AUDITORS,
  AUDITOR_RESIGNATION,
  APPROVE_SHARE_ISSUE,
  WAIVE_PRE_EMPTION,
  ALLOT_SHARES,
  APPROVE_SHARE_TRANSFER,
  REDUCE_CAPITAL,
  SHARE_BUY_BACK,
  CHANGE_REGISTERED_OFFICE,
  CHANGE_NAME,
  CHANGE_FINANCIAL_YEAR_END,
  CHANGE_PRIMARY_ACTIVITY,
  CHANGE_SECONDARY_ACTIVITY,
  ADOPT_CONSTITUTION,
  ALTER_CONSTITUTION,
  OPEN_BANK_ACCOUNT,
  CHANGE_BANK_SIGNATORIES,
  CLOSE_BANK_ACCOUNT,
  INTERIM_DIVIDEND,
  FINAL_DIVIDEND,
  STRIKE_OFF_APPLICATION,
  STRIKE_OFF_CONSENT,
];

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface CorpSecResolutionTemplate {
  name: string;
  description: string;
  fileName: string;
  category: 'RESOLUTION';
  compositionType: 'RESOLUTION';
  placeholders: PlaceholderDefinition[];
  build: () => Uint8Array;
  /** Preset resolutions, in order. */
  partials: readonly CorpSecPartial[];
  /** Preset bold subject heading above the resolutions. */
  heading?: string;
}

/** Directors' and members' masters in Arial 10 with underlined headings, as the First Board Resolution. */
const directorsMaster = once(() => ({
  bytes: buildDirectorsResolutionOakDocMaster({ extraStyles: HEADING_STYLE, typeface: ARIAL_10 }),
  placeholders: BOARD_RESOLUTION_PLACEHOLDERS,
}));
const membersMaster = once(() => ({
  bytes: buildMembersResolutionOakDocMaster({ extraStyles: HEADING_STYLE, typeface: ARIAL_10 }),
  placeholders: BOARD_RESOLUTION_PLACEHOLDERS,
}));

export function template(
  signedBy: 'Board' | 'Members',
  subject: string,
  description: string,
  partials: readonly CorpSecPartial[],
  heading?: string,
): CorpSecResolutionTemplate {
  const name = `${signedBy} Resolution - ${subject}`;
  const master = signedBy === 'Board' ? directorsMaster : membersMaster;
  return {
    name,
    description: `${description} Add, remove or reorder resolutions on Configure.`,
    fileName: `${name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}.docx`,
    category: 'RESOLUTION',
    compositionType: 'RESOLUTION',
    placeholders: BOARD_RESOLUTION_PLACEHOLDERS,
    build: () => master().bytes,
    partials,
    ...(heading ? { heading } : {}),
  };
}

export const CORP_SEC_RESOLUTION_TEMPLATES: readonly CorpSecResolutionTemplate[] = [
  template('Board', 'Approval of Financial Statements', 'Directors approve the year’s financial statements and propose members’ resolutions in lieu of an AGM (swap in “Convene Annual General Meeting” to hold one).', [APPROVE_FINANCIAL_STATEMENTS, RESOLUTIONS_IN_LIEU_OF_AGM]),
  template('Members', 'In Lieu of AGM', 'Members’ written resolutions in place of the AGM: adopt the financial statements, re-elect directors, audit exemption (or re-appoint auditors), directors’ fees and the share issue mandate.', [RECEIVE_FINANCIAL_STATEMENTS, RE_ELECT_DIRECTORS, AUDIT_EXEMPTION_MEMBERS, DIRECTORS_FEES, SHARE_ISSUE_MANDATE]),
  template('Board', 'Audit Exemption', 'Directors note that the company is a small or dormant company exempt from audit for the year.', [AUDIT_EXEMPTION_DIRECTORS]),
  template('Board', 'Appointment of Director', 'Appoints the contact picked as “Director to be appointed” from the appointment date.', [APPOINT_DIRECTOR, AUTHORISATION, LODGEMENT]),
  template('Board', 'Resignation of Director', 'Accepts the resignation of the director ticked under “Director resigning”.', [DIRECTOR_RESIGNATION, LODGEMENT]),
  template('Board', 'Appointment of Auditors', 'Appoints auditors who have consented to act, before the first AGM or to fill a casual vacancy (otherwise members appoint them).', [APPOINT_AUDITORS, LODGEMENT]),
  template('Board', 'Resignation of Auditors', 'Accepts the resignation of the auditors on the company record.', [AUDITOR_RESIGNATION, LODGEMENT]),
  template('Members', 'Approval to Issue Shares', 'Members’ approval under Section 161 for the directors to issue new shares, with a waiver of pre-emption rights.', [APPROVE_SHARE_ISSUE, WAIVE_PRE_EMPTION]),
  template('Board', 'Allotment of Shares', 'Allots shares to the contacts on the “Applicant” list, with each applicant’s shares and amount (checked against the totals on Configure), issues certificates and lodges the return of allotment.', [ALLOT_SHARES, AUTHORISATION]),
  template('Board', 'Transfer of Shares', 'Approves a transfer between the contacts on the “Transferor” and “Transferee” lists, with each party’s shares (checked against the total on Configure), and replaces the share certificates.', [APPROVE_SHARE_TRANSFER, AUTHORISATION]),
  template('Members', 'Reduction of Share Capital', 'Special resolution reducing share capital under Section 78B, with each affected shareholder’s shares and capital returned, backed by the directors’ solvency statement.', [REDUCE_CAPITAL, LODGEMENT]),
  template('Members', 'Share Buy-Back', 'Authority for an off-market share buy-back on an equal access scheme.', [SHARE_BUY_BACK, LODGEMENT]),
  template('Board', 'Change of Registered Office', 'Moves the registered office to a new address from the effective date.', [CHANGE_REGISTERED_OFFICE, LODGEMENT]),
  template('Members', 'Change of Name', 'Special resolution changing the company’s name.', [CHANGE_NAME, LODGEMENT]),
  template('Board', 'Change of Financial Year End', 'Changes the financial year end and fixes when the current period ends.', [CHANGE_FINANCIAL_YEAR_END, LODGEMENT]),
  template('Board', 'Change of Business Activities (SSIC)', 'Changes the primary and secondary activities (SSIC). Remove the secondary activity resolution when it does not change.', [CHANGE_PRIMARY_ACTIVITY, CHANGE_SECONDARY_ACTIVITY, LODGEMENT]),
  template('Members', 'Constitution', 'Special resolution adopting a new constitution (or, with the alteration resolution, altering the existing one).', [ADOPT_CONSTITUTION, LODGEMENT]),
  template('Board', 'Bank Account', 'Opens a bank account with the contacts on the “Authorised signatories” list. Swap in the change of signatories or closure resolution as needed.', [OPEN_BANK_ACCOUNT]),
  template('Board', 'Interim Dividend', 'Declares an interim one-tier tax-exempt dividend.', [INTERIM_DIVIDEND]),
  template('Members', 'Final Dividend', 'Approves the final dividend the directors recommend.', [FINAL_DIVIDEND]),
  template('Board', 'Striking Off', 'Directors resolve to apply to strike the company off under Section 344A.', [STRIKE_OFF_APPLICATION]),
  template('Members', 'Striking Off', 'Members consent to the striking off application.', [STRIKE_OFF_CONSENT]),
];
