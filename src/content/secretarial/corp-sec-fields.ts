import {
  OAKDOC_DIVIDEND_PER_SHARE_KEY,
  oakDocOfficersRepeaterTag,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import { custom, field, personField } from './corp-sec-oakdoc-kit';

/**
 * Fields the corporate secretarial starters share. A custom field keeps one
 * key everywhere it is used, so Shared setup asks for it once when several
 * documents of a batch need it (the resolution, the application form and
 * the share certificate of one allotment, say).
 */

const LONG_DATE = 'd MMMM yyyy';

// Company record
export const COMPANY_NAME = field('company.name', 'Company Name', 'SAMPLE COMPANY PTE. LTD.');
export const COMPANY_NAME_UPPER = field('company.name', 'Company Name', 'SAMPLE COMPANY PTE. LTD.', { upper: true, bold: true });
export const COMPANY_UEN = field('company.uen', 'UEN', '202600001A');
export const REGISTERED_ADDRESS = field('company.registeredAddress', 'Full Address', '21 Bukit Batok Crescent, #25-72, WCEGA Tower, Singapore 658065');
export const LETTER_ADDRESS = field('company.address.letter', 'Company Letter Address', '21 Bukit Batok Crescent\n#25-72, WCEGA Tower\nSingapore 658065');
export const FINANCIAL_YEAR_END = field('company.financialYearEnd', 'Financial Year End', '31 December');
export const PRIMARY_ACTIVITY = field('company.primaryActivity', 'Primary Activity', '46900 | Wholesale trade of a variety of goods without a dominant product');
export const AUDITOR_NAME = field('company.auditorName', 'Auditor Name', 'SAMPLE & CO. PUBLIC ACCOUNTING CORPORATION', { bold: true });
export const RESOLUTION_DATE = field('resolution.date', 'Resolution Date', '3 October 2026', { dateFormat: LONG_DATE });

// Repeating people
export const DIRECTOR_NAME = field('director.name', 'Director Name', 'DIRECTOR NAME', { upper: true });
export const DIRECTOR_ID = field('director.identificationNumber', 'Director Identification Number', 'S1234567A');
export const DIRECTOR_ID_LABEL = field('director.idLabel', 'Director ID Type', 'NRIC No.');
export const SHAREHOLDER_NAME = field('shareholder.name', 'Shareholder Name', 'SHAREHOLDER NAME', { upper: true });
export const SHAREHOLDER_ID = field('shareholder.identificationNumber', 'Shareholder Identification Number', 'S7654321B');
export const SHAREHOLDER_ID_LABEL = field('shareholder.idLabel', 'Shareholder ID Type', 'NRIC No.');
export const SHAREHOLDER_IS_CORPORATE = 'shareholder.isCorporate';
/** "Yes" when the directors section lists more than one director: for "Director" or "Directors". */
export const DIRECTORS_ARE_PLURAL = 'directors.isPlural';
export const SHAREHOLDER_ADDRESS = field('shareholder.address', 'Shareholder Address', '456 Sample Road, Singapore 456456');
export const SHAREHOLDER_SHARES = field('shareholder.numberOfShares', 'Number of Shares', '3,500');
export const SHAREHOLDER_CLASS = field('shareholder.shareClass', 'Share Class', 'Ordinary', { titleCase: true });
export const SHAREHOLDER_DIVIDEND = field('shareholder.dividendAmount', 'Dividend Amount (shares x Dividend per share)', '350.00');
export const OFFICER_NAME = field('officer.name', 'Officer Name', 'OFFICER NAME', { upper: true, bold: true });
export const OFFICER_ID = field('officer.identificationNumber', 'Officer Identification Number', 'S2345678C');
export const OFFICER_ID_LABEL = field('officer.idLabel', 'Officer ID Type', 'NRIC No.');
export const OFFICER_ROLE = field('officer.role', 'Officer Role', 'Director');
export const SECRETARY_NAME = field('officer.name', 'Officer Name', 'SECRETARY NAME', { upper: true });
export const CONTACT_NAME = field('contact.name', 'Contact Name', 'CONTACT NAME', { upper: true });
export const CONTACT_NAME_BOLD = field('contact.name', 'Contact Name', 'CONTACT NAME', { upper: true, bold: true });
export const CONTACT_ID = field('contact.identificationNumber', 'Contact Identification Number', 'S1234567A');
/** "NRIC No.", "Passport No.", or "UEN" for a company. */
export const CONTACT_ID_LABEL = field('contact.idLabel', 'Contact ID Type', 'NRIC No.');
/** "Yes" for a company, blank for a person: for wording that differs. */
export const CONTACT_IS_CORPORATE = 'contact.isCorporate';
export const CONTACT_ADDRESS = field('contact.address', 'Contact Address', '21 Bukit Batok Crescent, #25-72, WCEGA Tower, Singapore 658065');
export const CONTACT_NATIONALITY = field('contact.nationality', 'Contact Nationality', 'Singaporean');

// The director a letter is from, or who chairs a meeting.
export const PICKED_DIRECTOR_NAME = field('selectedDirector.name', 'Director Name', 'DIRECTOR NAME', { upper: true });
export const PICKED_DIRECTOR_ID = field('selectedDirector.identificationNumber', 'Director Identification Number', 'S1234567A');
export const PICKED_DIRECTOR_ADDRESS = field('selectedDirector.address.full', 'Director Full Address', '1 Orchard Road, Singapore 238824');

/** Every kind of director, for sections that list directors from the officer record. */
export const DIRECTOR_OFFICERS_TAG = oakDocOfficersRepeaterTag([
  'DIRECTOR',
  'MANAGING_DIRECTOR',
  'ALTERNATE_DIRECTOR',
  'NOMINEE_DIRECTOR',
]);
export const SECRETARY_OFFICERS_TAG = oakDocOfficersRepeaterTag(['SECRETARY']);

// Annual compliance
export const FS_OPTIONS = [
  'audited financial statements of the Company together with the Directors’ Statement and the Independent Auditor’s Report',
  'unaudited financial statements of the Company together with the Directors’ Statement',
] as const;
export const FS_DOCUMENTS = custom('fs_documents', 'Financial statements', 'text', FS_OPTIONS[1], { choices: FS_OPTIONS });
export const FS_PERIOD_END = custom('fs_period_end', 'Financial year ended', 'date', '31 December 2026', { dateFormat: LONG_DATE });
export const FS_SENT_DATE = custom('fs_sent_date', 'Financial statements sent to members on', 'date', '12 May 2027', { dateFormat: LONG_DATE });
export const DIRECTORS_FEES = custom('directors_fees', 'Directors’ fees (S$)', 'currency', '0.00');
export const AGM_DATE = custom('agm_date', 'Meeting date', 'date', '30 June 2027', { dateFormat: LONG_DATE });
export const AGM_TIME = custom('agm_time', 'Meeting time', 'text', '10.00 a.m.');
export const AGM_VENUE = custom('agm_venue', 'Meeting venue', 'text', '21 Bukit Batok Crescent, #25-72, WCEGA Tower, Singapore 658065');
export const NOTICE_DATE = custom('notice_date', 'Date of notice', 'date', '1 June 2027', { dateFormat: LONG_DATE });
export const AUDIT_EXEMPTION_OPTIONS = [
  'a small company within the meaning of Section 205C of, and the Thirteenth Schedule to, the Companies Act 1967',
  'a dormant company within the meaning of Section 205B of the Companies Act 1967',
] as const;
export const AUDIT_EXEMPTION_BASIS = custom('audit_exemption_basis', 'Audit exemption', 'text', AUDIT_EXEMPTION_OPTIONS[0], { choices: AUDIT_EXEMPTION_OPTIONS });
// Dormant relevant company (directors' confirmations)
export const DORMANT_SINCE_OPTIONS = [
  'from the time of its incorporation',
  'since the end of the previous financial year',
] as const;
export const DORMANT_SINCE = custom('dormant_since', 'Dormant', 'text', DORMANT_SINCE_OPTIONS[0], { choices: DORMANT_SINCE_OPTIONS });
export const PREVIOUS_FS_PERIOD_END = custom('previous_fs_period_end', 'Previous financial year ended (if dormant since then)', 'date', '31 December 2025', { dateFormat: LONG_DATE, required: false });
export const PARENT_COMPANY_OPTIONS = ['No', 'Yes'] as const;
export const PARENT_COMPANY = custom('parent_company', 'Parent company that is not itself a subsidiary (group assets test)', 'text', PARENT_COMPANY_OPTIONS[0], { choices: PARENT_COMPANY_OPTIONS });
export const SOLVENCY_NOT_APPLICABLE = 'Not applicable (not an exempt private company)';
export const SOLVENCY_OPTIONS = ['is able', 'is unable', SOLVENCY_NOT_APPLICABLE] as const;
export const SOLVENCY = custom('solvency', 'Annual return solvency: the Company … to pay its debts', 'text', SOLVENCY_OPTIONS[0], { choices: SOLVENCY_OPTIONS });
export const AGM_AUDITOR_OPTIONS = [
  'To re-appoint the retiring auditors and to authorise the Directors to fix their remuneration.',
  'To note that the Company is exempt from having its financial statements audited and that no auditor is to be appointed.',
] as const;
export const AGM_AUDITOR_ITEM = custom('agm_auditor_item', 'Auditor business', 'text', AGM_AUDITOR_OPTIONS[1], { choices: AGM_AUDITOR_OPTIONS });

// Officers
export const APPOINTMENT_DATE = custom('appointment_date', 'Appointment date', 'date', '3 October 2026', { dateFormat: LONG_DATE });
export const CESSATION_DATE = custom('cessation_date', 'Cessation date', 'date', '31 October 2026', { dateFormat: LONG_DATE });
export const NEW_AUDITOR_NAME = custom('new_auditor_name', 'New auditor', 'text', 'SAMPLE & CO. PUBLIC ACCOUNTING CORPORATION', { upper: true, bold: true });
export const AUDITOR_APPOINTMENT_OPTIONS = [
  'Section 205(2) of the Companies Act 1967, the Company not having held its first annual general meeting',
  'Section 205(6) of the Companies Act 1967, to fill a casual vacancy in the office of auditor',
] as const;
export const AUDITOR_APPOINTMENT_BASIS = custom('auditor_appointment_basis', 'Directors appoint under', 'text', AUDITOR_APPOINTMENT_OPTIONS[0], { choices: AUDITOR_APPOINTMENT_OPTIONS });
export const NEW_AUDITOR_ADDRESS = custom('new_auditor_address', 'New auditor’s address', 'textarea', '1 Sample Road, #10-01\nSingapore 123456');
export const AUDITOR_CESSATION_DATE = custom('auditor_cessation_date', 'Auditor resigns on', 'date', '31 October 2026', { dateFormat: LONG_DATE });
export const CHANGED_PARTICULAR_OPTIONS = [
  'Residential address',
  'Name',
  'Identification number',
  'Nationality',
  'Email address',
  'Contact number',
] as const;
// Each director's own change, asked per director on Configure.
export const CHANGED_PARTICULAR = personField('changed_particular', 'Particular changed (e.g. Residential address)', 'text', CHANGED_PARTICULAR_OPTIONS[0]);
export const NEW_PARTICULARS = personField('new_particulars', 'New particulars', 'text', '10 New Road, #05-01, Singapore 123456');
export const EFFECTIVE_DATE = custom('effective_date', 'Effective date', 'date', '1 November 2026', { dateFormat: LONG_DATE });

// Shares
export const ALLOTMENT_SHARES = custom('allotment_shares', 'Total shares to be allotted', 'number', '3,500');
export const ISSUE_PRICE = custom('issue_price', 'Issue price per share (S$)', 'currency', '1.00');
export const ALLOTMENT_CONSIDERATION = custom('allotment_consideration', 'Total consideration (S$)', 'currency', '3,500.00');
// Each applicant's part of the allotment, adding up to the totals.
export const APPLICANT_SHARES = personField('shares', 'Shares allotted', 'number', '3,500', { totalOf: ALLOTMENT_SHARES });
export const APPLICANT_AMOUNT = personField('amount', 'Amount payable (S$)', 'currency', '3,500.00', { totalOf: ALLOTMENT_CONSIDERATION });
// The application form is one document per applicant, so its values have no total to meet.
export const APPLICATION_SHARES = personField('shares', 'Shares applied for', 'number', '3,500');
export const APPLICATION_AMOUNT = personField('amount', 'Amount payable (S$)', 'currency', '3,500.00');
export const APPLICATION_DATE = custom('application_date', 'Application date', 'date', '3rd', { dateFormat: 'do' });
export const APPLICATION_MONTH_YEAR = custom('application_date', 'Application date', 'date', 'October, 2026', { dateFormat: 'MMMM, yyyy' });
/** Who signs for a corporate party; printed only for a company. */
export const AUTHORISED_SIGNATORY = personField('authorised_signatory', 'Authorised signatory (companies only)', 'text', 'Yuly Mirawati', { required: false });
export const TRANSFER_SHARES = custom('transfer_shares', 'Shares transferred', 'number', '1,000');
export const TRANSFER_CONSIDERATION = custom('transfer_consideration', 'Transfer consideration (S$)', 'currency', '1,000.00');
export const TRANSFER_DATE = custom('transfer_date', 'Transfer date', 'date', '3 October 2026', { dateFormat: LONG_DATE });
// Each party's part of a transfer, adding up to the totals.
export const TRANSFEROR_SHARES = personField('shares', 'Shares transferred', 'number', '1,000', { totalOf: TRANSFER_SHARES });
export const TRANSFEROR_CONSIDERATION = personField('consideration', 'Consideration received (S$)', 'currency', '1,000.00', { totalOf: TRANSFER_CONSIDERATION });
export const TRANSFEROR_CERTIFICATE = personField('certificate_no', 'Share certificate no. to be cancelled', 'text', '1');
export const TRANSFEREE_SHARES = personField('shares', 'Shares received', 'number', '1,000', { totalOf: TRANSFER_SHARES });
// Each certificate's own number and shares.
export const CERTIFICATE_NO = personField('certificate_no', 'Certificate no.', 'text', '1');
export const CERTIFICATE_SHARES = personField('certificate_shares', 'Shares on this certificate', 'number', '3,500');
export const CERTIFICATE_DATE = custom('certificate_date', 'Certificate date', 'date', '3 October 2026', { dateFormat: LONG_DATE });
export const REDUCTION_SHARES = custom('reduction_shares', 'Shares cancelled', 'number', '5,000');
export const REDUCTION_AMOUNT = custom('reduction_amount', 'Capital returned (S$)', 'currency', '5,000.00');
export const MEMBER_REDUCTION_SHARES = personField('reduction_shares', 'Shares cancelled', 'number', '5,000', { totalOf: REDUCTION_SHARES });
export const MEMBER_REDUCTION_AMOUNT = personField('reduction_amount', 'Capital returned (S$)', 'currency', '5,000.00', { totalOf: REDUCTION_AMOUNT });
export const BUYBACK_SHARES = custom('buyback_shares', 'Maximum shares to buy back', 'number', '1,000');
export const BUYBACK_PRICE = custom('buyback_price', 'Price per share (S$)', 'currency', '1.00');

// Company changes
export const NEW_REGISTERED_ADDRESS = custom('new_registered_address', 'New registered office', 'text', '10 Anson Road, #20-05, International Plaza, Singapore 079903', { upper: true, bold: true });
export const NEW_COMPANY_NAME = custom('new_company_name', 'New company name', 'text', 'NEW NAME PTE. LTD.', { upper: true, bold: true });
export const NEW_FINANCIAL_YEAR_END = custom('new_financial_year_end', 'New financial year end (day and month)', 'text', '31 March', { bold: true });
export const CURRENT_PERIOD_END = custom('current_period_end', 'Current financial period ends on', 'date', '31 March 2027', { dateFormat: LONG_DATE, bold: true });
export const NEW_PRIMARY_ACTIVITY = custom('new_primary_activity', 'New primary activity (SSIC code | description)', 'text', '62011 | Development of software and applications (except games and cybersecurity software)', { bold: true });
export const NEW_SECONDARY_ACTIVITY = custom('new_secondary_activity', 'New secondary activity (SSIC code | description)', 'text', '70201 | Management consultancy services', { bold: true });
export const CONSTITUTION_OPTIONS = [
  'the model constitution prescribed under the Companies (Model Constitutions) Regulations 2015',
  'the document annexed to this resolution and, for the purpose of identification, signed by the members',
] as const;
export const NEW_CONSTITUTION = custom('new_constitution', 'Constitution adopted', 'text', CONSTITUTION_OPTIONS[0], { choices: CONSTITUTION_OPTIONS });
export const CONSTITUTION_ALTERATIONS = custom('constitution_alterations', 'Alterations to the constitution', 'textarea', 'By deleting Regulation 10 in its entirety and substituting it with the following: ...');

// Bank
export const BANK_NAME = custom('bank_name', 'Bank', 'text', 'DBS Bank Ltd.', { bold: true });
export const BANK_ACCOUNT_NO = custom('bank_account_no', 'Account number', 'text', '123-456789-0', { bold: true });
export const SIGNING_MANDATE = custom('signing_mandate', 'Signing mandate', 'textarea', 'Any one authorised signatory to sign singly.');

// Dividends
export const DIVIDEND_PER_SHARE = custom(OAKDOC_DIVIDEND_PER_SHARE_KEY, 'Dividend per share (S$)', 'currency', '0.10');
export const DIVIDEND_TOTAL = custom('dividend_total', 'Total dividend (S$)', 'currency', '1,000.00');
export const DIVIDEND_PERIOD_END = custom('dividend_period_end', 'Dividend for the financial year ending', 'date', '31 December 2026', { dateFormat: LONG_DATE });
export const DIVIDEND_RECORD_DATE = custom('dividend_record_date', 'Dividend record date (members registered on)', 'date', '1 December 2026', { dateFormat: LONG_DATE });
export const DIVIDEND_PAYMENT_DATE = custom('dividend_payment_date', 'Dividend payment date', 'date', '15 December 2026', { dateFormat: LONG_DATE });

// Letters
export const LETTER_DATE = custom('letter_date', 'Letter date', 'date', '3 October 2026', { dateFormat: LONG_DATE });
export const PREVIOUS_SECRETARY = custom('previous_secretary', 'Former secretary or corporate secretarial firm', 'text', 'Previous Corporate Services Pte. Ltd.', { bold: true });
export const PREVIOUS_SECRETARY_ADDRESS = custom('previous_secretary_address', 'Former secretary’s address', 'textarea', '1 Sample Road, #01-01\nSingapore 123456');
export const NEW_SECRETARY_NAME = custom('new_secretary_name', 'New company secretary', 'text', 'SECRETARY NAME', { upper: true, bold: true });
export const FIRM_NAME = 'OAKTREE ACCOUNTING & CORPORATE SOLUTIONS PTE. LTD.';
export const FIRM_UEN = '202437906H';
