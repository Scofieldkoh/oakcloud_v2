/**
 * Customer due diligence (CDD) form for a corporate client, sent before the
 * firm acts as its corporate service provider or filing agent: the
 * company's details, the purpose of the relationship and source of funds,
 * each director, shareholder, beneficial owner and authorised person (with
 * identity documents and politically exposed person questions), and the
 * client's declaration. A plain form, not a guided template: staff review
 * and publish it in the builder like any other.
 */

import type { FieldConditionInput, FormFieldInput } from '@/lib/validations/form-builder';

export const SG_CUSTOMER_DUE_DILIGENCE_TITLE = 'Customer Due Diligence (Corporate Client)';
export const SG_CUSTOMER_DUE_DILIGENCE_TAG = 'cdd';

type FieldDraft = Omit<FormFieldInput, 'position' | 'isRequired' | 'hideLabel' | 'isReadOnly' | 'layoutWidth'> & {
  isRequired?: boolean;
  hideLabel?: boolean;
  layoutWidth?: FormFieldInput['layoutWidth'];
};

const YES = 'yes';
const NO = 'no';

const eq = (fieldKey: string, value: string): FieldConditionInput => ({ fieldKey, operator: 'equals', value });

function choices(entries: Array<[string, string]>) {
  return entries.map(([value, label]) => ({ value, label }));
}

function yesNo(key: string, label: string, extra: Partial<FieldDraft> = {}): FieldDraft {
  return {
    type: 'SINGLE_CHOICE',
    key,
    label,
    isRequired: true,
    options: choices([[YES, 'Yes'], [NO, 'No']]),
    validation: { choiceInlineRight: true },
    ...extra,
  };
}

function details(key: string, label: string, condition: FieldConditionInput): FieldDraft {
  return { type: 'LONG_TEXT', key, label, isRequired: true, condition, validation: { maxLength: 2000 } };
}

function heading(key: string, label: string): FieldDraft {
  return { type: 'PARAGRAPH', inputType: 'info_heading_2', key, label };
}

function info(key: string, label: string, html: string): FieldDraft {
  return { type: 'PARAGRAPH', inputType: 'info_text', key, label, subtext: html, validation: { infoInlineCard: true, infoShowInPdf: false } };
}

function text(key: string, label: string, extra: Partial<FieldDraft> = {}): FieldDraft {
  return { type: 'SHORT_TEXT', inputType: 'text', key, label, isRequired: true, validation: { maxLength: 300 }, ...extra };
}

const IDENTITY_FILES = { maxFileSizeMb: 10, allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] };

export interface SgCustomerDueDiligenceOptions {
  firmName: string;
  /** Tenant's built-in nationalities option preset. */
  nationalityPresetId: string;
  /** Tenant's built-in countries option preset. */
  countryPresetId: string;
}

function buildFieldDrafts(options: SgCustomerDueDiligenceOptions): FieldDraft[] {
  const firm = options.firmName.trim() || 'our firm';
  return [
    // Page 1: the company
    heading('step_company', 'About the company'),
    info('intro', 'Introduction', `<p>As a registered filing agent and corporate service provider, ${firm} must verify who it acts for and who ultimately owns and controls the company. Please answer every question; we may ask for more documents.</p>`),
    text('company_name', 'Company name'),
    text('company_uen', 'UEN or registration number', { layoutWidth: 50, validation: { maxLength: 60 } }),
    { type: 'DROPDOWN', key: 'company_country', label: 'Place of incorporation', isRequired: true, layoutWidth: 50, optionPresetId: options.countryPresetId },
    text('company_address', 'Registered address', { validation: { maxLength: 500 } }),
    text('business_address', 'Principal place of business, if different', { isRequired: false, validation: { maxLength: 500 } }),
    { type: 'LONG_TEXT', key: 'nature_of_business', label: 'What does the company do?', isRequired: true, validation: { maxLength: 2000 } },
    text('countries_of_operation', 'Countries the company does business in', { validation: { maxLength: 500 } }),
    text('contact_name', 'Your name'),
    { type: 'SHORT_TEXT', inputType: 'email', key: 'contact_email', label: 'Your email', isRequired: true, layoutWidth: 50, validation: { maxLength: 320 } },
    { type: 'SHORT_TEXT', inputType: 'phone', key: 'contact_phone', label: 'Your mobile number', isRequired: true, layoutWidth: 50, validation: { splitPhoneCountryCode: true, phoneDefaultCountryCode: '+65' } },

    heading('section_relationship', 'Our services and your funds'),
    {
      type: 'MULTIPLE_CHOICE',
      key: 'services',
      label: 'Services you want from us',
      isRequired: true,
      options: choices([
        ['corporate_secretarial', 'Corporate secretarial'],
        ['nominee_director', 'Nominee director'],
        ['registered_office', 'Registered office address'],
        ['accounting', 'Accounting and bookkeeping'],
        ['tax', 'Tax'],
        ['payroll', 'Payroll'],
      ]),
    },
    {
      type: 'MULTIPLE_CHOICE',
      key: 'source_of_funds',
      label: 'Source of the company’s funds',
      isRequired: true,
      options: choices([
        ['revenue', 'Business revenue'],
        ['shareholder_capital', 'Capital from shareholders'],
        ['loans', 'Bank or shareholder loans'],
        ['investment', 'Investment returns'],
        ['other', 'Other'],
      ]),
    },
    details('source_of_funds_other', 'Describe the other source of funds', { fieldKey: 'source_of_funds', operator: 'contains', value: 'other' }),
    yesNo('sanctioned_countries', 'Does the company deal with any country subject to United Nations or Singapore sanctions?'),
    details('sanctioned_countries_details', 'Which countries, and what dealings?', eq('sanctioned_countries', YES)),

    // Page 2: the people
    { type: 'PAGE_BREAK', key: 'page_people', label: 'Directors, shareholders and owners' },
    heading('step_people', 'Directors, shareholders and beneficial owners'),
    info('people_guidance', 'About the people', '<p>Add every director, every shareholder, every individual who ultimately owns or controls more than 25% of the company (directly or through other companies), and every person authorised to act for the company. For a corporate shareholder, also add the individuals who own or control it.</p>'),
    {
      type: 'PAGE_BREAK',
      inputType: 'repeat_start',
      key: 'people_section',
      label: 'Directors, shareholders and owners',
      validation: { repeatMinItems: 1, repeatMaxItems: 30, repeatAddLabel: 'Add another person or company', repeatItemLabel: 'Person' },
    },
    {
      type: 'SINGLE_CHOICE',
      key: 'person_kind',
      label: 'This is',
      isRequired: true,
      layoutWidth: 50,
      options: choices([['individual', 'An individual'], ['organisation', 'A company']]),
      validation: { choiceLayout: 'chips' },
    },
    {
      type: 'MULTIPLE_CHOICE',
      key: 'person_roles',
      label: 'Roles',
      isRequired: true,
      options: choices([
        ['director', 'Director'],
        ['shareholder', 'Shareholder'],
        ['beneficial_owner', 'Beneficial owner (more than 25%)'],
        ['authorised_person', 'Authorised to act for the company'],
      ]),
    },
    text('person_name', 'Full name (as in identity document or registration)'),
    text('person_id', 'NRIC, passport or UEN', { layoutWidth: 50, validation: { maxLength: 60 } }),
    { type: 'DROPDOWN', key: 'person_nationality', label: 'Nationality', isRequired: true, layoutWidth: 50, condition: eq('person_kind', 'individual'), optionPresetId: options.nationalityPresetId },
    { type: 'DROPDOWN', key: 'person_country', label: 'Place of incorporation', isRequired: true, layoutWidth: 50, condition: eq('person_kind', 'organisation'), optionPresetId: options.countryPresetId },
    { type: 'SHORT_TEXT', inputType: 'date', key: 'person_birth_date', label: 'Date of birth', isRequired: true, layoutWidth: 50, condition: eq('person_kind', 'individual') },
    text('person_address', 'Residential or registered address', { validation: { maxLength: 500 } }),
    { type: 'SHORT_TEXT', inputType: 'number', key: 'person_ownership', label: 'Shareholding or ownership (%)', layoutWidth: 50, validation: { min: 0, max: 100 } },
    yesNo('person_pep', 'Is this person, or a family member or close associate, a politically exposed person (holding or having held a prominent public function in Singapore or elsewhere)?', { condition: eq('person_kind', 'individual') }),
    details('person_pep_details', 'Give the position held and the country', eq('person_pep', YES)),
    {
      type: 'FILE_UPLOAD',
      key: 'person_identity_document',
      label: 'Identity document (NRIC or passport) or business profile',
      subtext: 'PDF, JPEG or PNG, up to 10 MB.',
      isRequired: true,
      validation: IDENTITY_FILES,
    },
    {
      type: 'FILE_UPLOAD',
      key: 'person_address_proof',
      label: 'Proof of residential address (dated within the last 3 months)',
      subtext: 'Not needed for a Singapore NRIC holder whose NRIC shows the current address.',
      condition: eq('person_kind', 'individual'),
      validation: IDENTITY_FILES,
    },
    { type: 'PAGE_BREAK', inputType: 'repeat_end', key: 'people_section_end', label: 'End of people' },

    // Page 3: declarations
    { type: 'PAGE_BREAK', key: 'page_declaration', label: 'Declaration' },
    heading('step_declaration', 'Declaration'),
    yesNo('criminal_proceedings', 'Has the company, or any person listed, been convicted of an offence involving fraud or dishonesty, or is any of them subject to investigation or proceedings?'),
    details('criminal_proceedings_details', 'Give details', eq('criminal_proceedings', YES)),
    {
      type: 'FILE_UPLOAD',
      key: 'company_documents',
      label: 'Company documents (constitution and, for a foreign company, its certificate of incorporation)',
      subtext: 'Optional for a Singapore company; we obtain its business profile from ACRA.',
      validation: { ...IDENTITY_FILES, allowMultipleFiles: true },
    },
    {
      type: 'MULTIPLE_CHOICE',
      key: 'declaration',
      label: 'Declaration',
      hideLabel: true,
      isRequired: true,
      options: choices([[YES, `I declare that the information given is true and complete, that I will tell ${firm} promptly of any change, and that I consent to ${firm} screening the company and the people listed against sanctions and other lists.`]]),
    },
    text('declarant_name', 'Name of person making this declaration', { layoutWidth: 50 }),
    text('declarant_designation', 'Designation', { layoutWidth: 50 }),
  ];
}

export function buildSgCustomerDueDiligenceFields(options: SgCustomerDueDiligenceOptions): FormFieldInput[] {
  return buildFieldDrafts(options).map((draft, position) => ({
    ...draft,
    isRequired: draft.isRequired ?? false,
    hideLabel: draft.hideLabel ?? false,
    isReadOnly: false,
    layoutWidth: draft.layoutWidth ?? 100,
    position,
  }));
}

export function buildSgCustomerDueDiligenceSettings(firmName: string): Record<string, unknown> {
  const firm = firmName.trim() || 'our firm';
  return {
    drafts: { enabled: true, autoDeleteDays: 30 },
    notifications: { completionRecipientEmails: [], attachmentMode: 'link_only' },
    completion: {
      reviewStep: true,
      reviewTitle: 'Review and submit',
      reviewIntro: 'Check your answers. Use Edit to change anything before you submit.',
      submitLabel: 'Submit',
      successTitle: 'Thank you',
      successMessage: `Reference: {reference}. ${firm} will review the information and contact you if anything else is needed.`,
      showPdfActions: true,
    },
  };
}
