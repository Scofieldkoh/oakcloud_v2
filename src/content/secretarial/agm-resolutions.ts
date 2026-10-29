import { OAKDOC_DIRECTORS_REPEATER_TAG } from '@/lib/document-editor/oakdoc-repeater-definitions';
import {
  TAB,
  bold,
  t,
  whenBlank,
  whenEquals,
  whenNotEquals,
  whenSet,
  type DocumentWriter,
  type Segment,
} from './corp-sec-oakdoc-kit';
import {
  AUDIT_EXEMPTION_MEMBERS,
  DIRECTORS_FOR_RE_ELECTION,
  RECEIVE_FINANCIAL_STATEMENTS,
  bullet,
  paragraph,
  partial,
  resolved,
  template,
  type CorpSecPartial,
  type CorpSecResolutionTemplate,
} from './corp-sec-resolutions';
import * as F from './corp-sec-fields';

/**
 * Written resolutions for the yearly cycle of a private company that does
 * not hold an AGM, from the firm's Word references: members' resolutions
 * dispensing with AGMs (s.175A(1)(a)), for financial statements sent within
 * the s.203 period (s.175A(1)(b)) and for a dormant relevant company
 * (s.175A(1)(c), s.201A, s.205B), and the directors' confirmations for a
 * dormant relevant company. Each template reuses the corporate secretarial
 * partials that already fit (adoption of financial statements, audit
 * exemption) and adds the partials below.
 */

const ACT = 'the Companies Act 1967';

// For the one financial year only, as the firm prefers to decide each year.
export const DISPENSE_WITH_AGM = partial('resolution-agm-dispense', 'AGM - Dispense with AGM (Members)', 'DISPENSATION WITH ANNUAL GENERAL MEETING', (d) => [
  resolved(d, t`pursuant to Section 175A of ${ACT}, the Company dispense with the holding of an annual general meeting for the financial year ended ${F.FS_PERIOD_END}, and that the matters which would otherwise be dealt with at that meeting be dealt with by these written resolutions under Section 184A of ${ACT}.`),
]);

export const FINANCIAL_STATEMENTS_SENT = partial('resolution-agm-financial-statements-sent', 'AGM - Financial Statements Sent, No AGM (Members)', 'NO ANNUAL GENERAL MEETING', (d) => [
  resolved(d, t`the ${F.FS_DOCUMENTS} for the financial year ended ${F.FS_PERIOD_END} were sent to all members of the Company on ${F.FS_SENT_DATE}, within the period required by Section 203(1)(b) of ${ACT}, and that no member has given notice under Section 175A(4) of ${ACT} requiring the Company to hold an annual general meeting for that financial year.`, 'noted'),
  resolved(d, [`accordingly, no annual general meeting be held for that financial year, as Section 175A(1)(b) of ${ACT} permits, and that the matters which would otherwise be dealt with at that meeting be dealt with by these written resolutions under Section 184A of ${ACT}.`]),
]);

/** "(a)<tab>text", one of a lettered list. */
function item(d: DocumentWriter, letter: string, segments: Segment[] | string): string {
  return d.p([`(${letter})`, TAB, ...(typeof segments === 'string' ? [segments] : segments)], bullet);
}

/** A lead in bold followed by text that does not start with a space ("NOTED THAT, based on ..."). */
function lead(d: DocumentWriter, words: string, text: string): string {
  return d.p([bold(words), text], paragraph);
}

// Defines "the Act" and "the Financial Year" for the resolutions after it.
export const DORMANT_COMPANY = partial('resolution-agm-dormant-company', 'AGM - Dormant Relevant Company (Members)', 'DORMANT RELEVANT COMPANY', (d) => [
  resolved(d, t`the Directors have confirmed that the Company satisfies the requirements of a dormant relevant company under ${ACT} (the “Act”) for the financial year ended ${F.FS_PERIOD_END} (the “Financial Year”), including the applicable dormancy and asset criteria, and that no notice requiring the preparation of financial statements or an audit has been received in respect of the Financial Year.`, 'noted'),
  lead(d, 'IT IS FURTHER NOTED THAT', ', subject to compliance with the applicable statutory requirements:'),
  item(d, 'a', 'the Directors are exempt from preparing financial statements for the Financial Year under Section 201A of the Act;'),
  item(d, 'b', 'the Company is exempt from audit requirements for the Financial Year under Section 205B of the Act; and'),
  item(d, 'c', 'the Company, being a private company and a dormant relevant company, is not required to hold an Annual General Meeting for the Financial Year under Section 175A of the Act, subject to the right of any member to require one to be held in accordance with the Act.'),
]);

/** Every director ticked, named, "Director" or "Directors" by how many are ticked. */
function reElectAllDirectors(name: string, displayName: string, retiring: string): CorpSecPartial {
  return partial(name, displayName, 'RE-ELECTION OF DIRECTORS', (d) => [
    d.when(whenSet(F.DIRECTORS_ARE_PLURAL), resolved(d, [`the following Directors, ${retiring} and having offered themselves for re-election, be re-elected as Directors of the Company:`], 'ordinary')),
    d.when(whenBlank(F.DIRECTORS_ARE_PLURAL), resolved(d, [`the following Director, ${retiring} and having offered to be re-elected, be re-elected as a Director of the Company:`], 'ordinary')),
    d.repeat(OAKDOC_DIRECTORS_REPEATER_TAG, d.p(['•', TAB, ...t`${F.DIRECTOR_NAME} (${F.DIRECTOR_ID_LABEL} ${F.DIRECTOR_ID})`], bullet), DIRECTORS_FOR_RE_ELECTION),
  ]);
}

/** Whether retiring under the Constitution or of their own accord. */
export const RE_ELECT_ALL_DIRECTORS = reElectAllDirectors(
  'resolution-agm-re-elect-all-directors',
  'AGM - Re-election of All Directors (Members)',
  'retiring from office whether pursuant to the Constitution of the Company or voluntarily, and being eligible',
);

/** Retiring under the Constitution only, as the dormant company resolution words it. */
export const RE_ELECT_RETIRING_DIRECTORS = reElectAllDirectors(
  'resolution-agm-re-elect-retiring-directors',
  'AGM - Re-election of Directors Retiring under the Constitution (Members)',
  'retiring from office in accordance with the Constitution of the Company, and being eligible',
);

export const FILE_ANNUAL_RETURN = partial('resolution-agm-annual-return', 'AGM - Filing of Annual Return (Members)', 'FILING OF ANNUAL RETURN', (d) => [
  resolved(d, t`the Company Secretary and/or ${F.FIRM_NAME} be authorised to lodge the annual return of the Company for the financial year ended ${F.FS_PERIOD_END} under Section 197 of ${ACT}, and any other returns relating to it, with the Accounting and Corporate Regulatory Authority for and on behalf of the Company.`),
]);

// ---------------------------------------------------------------------------
// Dormant relevant company: the Directors' confirmations
// ---------------------------------------------------------------------------

const NO_TRANSACTIONS = t`no accounting transactions have occurred during the financial year ended ${F.FS_PERIOD_END} (the “Financial Year”), other than transactions disregarded for the purpose of determining dormancy under ${ACT} (the “Act”).`;

// Defines "the Act" and "the Financial Year" for the resolutions after it.
export const DORMANCY_DIRECTORS = partial('resolution-agm-dormancy-directors', 'AGM - Dormancy (Directors)', 'DORMANCY', (d) => [
  d.when(whenEquals(F.DORMANT_SINCE, F.DORMANT_SINCE_OPTIONS[0]), resolved(d, t`the Company has been dormant ${F.DORMANT_SINCE}, and that ${NO_TRANSACTIONS}`, 'confirmed')),
  d.when(whenEquals(F.DORMANT_SINCE, F.DORMANT_SINCE_OPTIONS[1]), resolved(d, t`the Company has been dormant ${F.DORMANT_SINCE} ended ${F.PREVIOUS_FS_PERIOD_END}, and that ${NO_TRANSACTIONS}`, 'confirmed')),
]);

const NOT_LISTED = 'the Company is neither a listed company nor a subsidiary of a listed company';
const TOTAL_ASSETS = 'the total assets of the Company did not exceed S$500,000 at any time during the Financial Year';

// The group test applies only to a parent company that is not itself a subsidiary.
export const RELEVANT_COMPANY_DIRECTORS = partial('resolution-agm-relevant-company-directors', 'AGM - Relevant Company Status (Directors)', 'RELEVANT COMPANY STATUS', (d) => [
  resolved(d, ['the Company satisfies the requirements of a “relevant company” under the Act, in that:'], 'confirmed'),
  d.when(whenEquals(F.PARENT_COMPANY, 'No'), [
    item(d, 'a', `${NOT_LISTED}; and`),
    item(d, 'b', `${TOTAL_ASSETS}.`),
  ]),
  d.when(whenEquals(F.PARENT_COMPANY, 'Yes'), [
    item(d, 'a', `${NOT_LISTED};`),
    item(d, 'b', `${TOTAL_ASSETS}; and`),
    item(d, 'c', 'where the Company is a parent company which is not itself a subsidiary of another corporation, the consolidated total assets of its group did not exceed S$500,000 at any time during the Financial Year.'),
  ]),
]);

const NO_AUDIT_NOTICE = 'no notice has been received requiring the Company to obtain an audit of its accounts for the Financial Year';
const RECORDS_KEPT = 'the accounting and other records required to be kept by the Company have been properly maintained in accordance with the Act';

// Item (e), the annual return solvency declaration, is for exempt private companies only.
export const DORMANT_DECLARATION_DIRECTORS = partial('resolution-agm-dormant-declaration-directors', 'AGM - Dormant Company Declaration (Directors)', 'DIRECTORS’ DECLARATION', (d) => [
  lead(d, 'CONFIRMED THAT', ':'),
  item(d, 'a', 'the Company has remained dormant throughout the Financial Year;'),
  item(d, 'b', 'no notice has been received requiring the Directors to comply with the financial reporting requirements otherwise applicable under the Act for the Financial Year;'),
  d.when(whenEquals(F.SOLVENCY, F.SOLVENCY_NOT_APPLICABLE), [
    item(d, 'c', `${NO_AUDIT_NOTICE}; and`),
    item(d, 'd', `${RECORDS_KEPT}.`),
  ]),
  d.when(whenNotEquals(F.SOLVENCY, F.SOLVENCY_NOT_APPLICABLE), [
    item(d, 'c', `${NO_AUDIT_NOTICE};`),
    item(d, 'd', `${RECORDS_KEPT}; and`),
    item(d, 'e', t`for the purpose of the Annual Return solvency declaration, the Company ${F.SOLVENCY} to pay its debts as and when they fall due.`),
  ]),
]);

export const DORMANT_EXEMPTIONS_DIRECTORS = partial('resolution-agm-dormant-exemptions-directors', 'AGM - Dormant Company Exemptions (Directors)', 'STATUTORY EXEMPTIONS', (d) => [
  lead(d, 'NOTED THAT', ', based on the foregoing confirmations:'),
  item(d, 'a', 'the Directors are entitled to exemption from the requirements to prepare financial statements for the Financial Year under Section 201A of the Act, subject to the requisite statement by the Directors being lodged with the Registrar in accordance with the Act;'),
  item(d, 'b', 'the Company qualifies for exemption from audit requirements for the Financial Year under Section 205B of the Act; and'),
  item(d, 'c', 'the Company, being a private company and a dormant relevant company at the end of the Financial Year, is not required to hold an Annual General Meeting for the Financial Year under Section 175A of the Act, subject to the right of any member to require an Annual General Meeting in accordance with the Act.'),
]);

export const DORMANT_ANNUAL_RETURN_DIRECTORS = partial('resolution-agm-dormant-annual-return-directors', 'AGM - Dormant Company Declarations and Annual Return (Directors)', 'APPROVAL OF STATUTORY DECLARATIONS AND FILING OF ANNUAL RETURN', (d) => [
  resolved(d, ['the statutory statements and declarations by the Directors reflecting the confirmations set out in paragraph 3 be and are hereby approved for lodgement or declaration to the Registrar, as applicable, in connection with the Company’s Annual Return for the Financial Year.']),
  resolved(d, [`any one Director, the Company Secretary, or ${F.FIRM_NAME} be and is hereby authorised to prepare and lodge the Company’s Annual Return for the Financial Year with the Accounting and Corporate Regulatory Authority, together with the requisite statutory statements and declarations duly made by the Directors, and to do all such acts and things as may be necessary to give effect to these resolutions.`], 'further'),
]);

/** The partials this module adds; the templates also preset existing corporate secretarial ones. */
export const AGM_PARTIALS: readonly CorpSecPartial[] = [
  DISPENSE_WITH_AGM,
  FINANCIAL_STATEMENTS_SENT,
  DORMANT_COMPANY,
  RE_ELECT_ALL_DIRECTORS,
  RE_ELECT_RETIRING_DIRECTORS,
  FILE_ANNUAL_RETURN,
  DORMANCY_DIRECTORS,
  RELEVANT_COMPANY_DIRECTORS,
  DORMANT_DECLARATION_DIRECTORS,
  DORMANT_EXEMPTIONS_DIRECTORS,
  DORMANT_ANNUAL_RETURN_DIRECTORS,
];

export const AGM_RESOLUTION_TEMPLATES: readonly CorpSecResolutionTemplate[] = [
  template('Members', 'Dispense with AGM', 'All members resolve under Section 175A to dispense with the AGM for the financial year, then adopt the financial statements, note the audit exemption, re-elect the directors and authorise the annual return. For audited accounts, swap the audit exemption for “Re-appointment of Auditors”.', [DISPENSE_WITH_AGM, RECEIVE_FINANCIAL_STATEMENTS, AUDIT_EXEMPTION_MEMBERS, RE_ELECT_ALL_DIRECTORS, FILE_ANNUAL_RETURN]),
  template('Members', 'Financial Statements Sent (No AGM)', 'No AGM because the financial statements were sent to members within five months of the year end (Section 175A(1)(b)): adopt them, record the send date, note the audit exemption, re-elect the directors and authorise the annual return.', [RECEIVE_FINANCIAL_STATEMENTS, FINANCIAL_STATEMENTS_SENT, AUDIT_EXEMPTION_MEMBERS, RE_ELECT_ALL_DIRECTORS, FILE_ANNUAL_RETURN]),
  template('Members', 'Dormant Company', 'Members note the Directors’ confirmation that the company is a dormant relevant company, so need not prepare financial statements (Section 201A), have them audited (Section 205B) or hold an AGM (Section 175A), then re-elect the directors retiring under the Constitution and authorise the annual return.', [DORMANT_COMPANY, RE_ELECT_RETIRING_DIRECTORS, FILE_ANNUAL_RETURN]),
  template('Board', 'Dormant Company', 'Directors confirm the company has been dormant and is a relevant company (total assets up to S$500,000), make the dormancy declarations (with the annual return solvency declaration for an exempt private company), note the exemptions under Sections 201A, 205B and 175A, and approve the declarations and the annual return.', [DORMANCY_DIRECTORS, RELEVANT_COMPANY_DIRECTORS, DORMANT_DECLARATION_DIRECTORS, DORMANT_EXEMPTIONS_DIRECTORS, DORMANT_ANNUAL_RETURN_DIRECTORS], 'DORMANT RELEVANT COMPANY'),
];
