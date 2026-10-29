/**
 * Singapore Company Incorporation form template (version 4).
 *
 * The manifest compiles to ordinary Oakcloud Forms field definitions. Field keys are
 * stable: the intake profile (src/lib/forms/company-incorporation-profile.ts) and the
 * staff review read answers by these keys, so a change to keys, options or conditions
 * needs a new template version rather than an edit to this one.
 */

import type { FieldConditionInput, FormFieldInput } from '@/lib/validations/form-builder';

export const SG_COMPANY_INCORPORATION_TEMPLATE_KEY = 'sg_company_incorporation';
export const SG_COMPANY_INCORPORATION_TEMPLATE_VERSION = 4;
export const SG_COMPANY_INCORPORATION_TITLE = 'Singapore Company Incorporation';
/** Date the ACRA guidance and links below were last checked against the official pages. */
export const SG_COMPANY_INCORPORATION_GUIDANCE_REVIEWED_ON = '2026-09-29';
export const SG_COMPANY_INCORPORATION_PARTY_SECTION_KEY = 'parties_section';

export const INCORPORATION_KEYS = {
  contactName: 'contact_name',
  contactEmail: 'contact_email',
  contactPhone: 'contact_phone',
  companyEmail: 'company_email',
  companyType: 'company_type',
  nameSuffixPrivate: 'name_suffix_private',
  nameSuffixPublic: 'name_suffix_public',
  proposedName: 'proposed_name',
  alternativeName1: 'alternative_name_1',
  alternativeName2: 'alternative_name_2',
  primarySsic: 'primary_ssic',
  secondarySsic: 'secondary_ssic',
  businessDescription: 'business_description',
  partyKind: 'party_kind',
  partyName: 'party_name',
  partyRoles: 'party_roles',
  ownershipPercent: 'ownership_percent',
  partyIdNumber: 'party_id_number',
  partyRegistrationReference: 'party_registration_reference',
  partyNationality: 'party_nationality',
  partyIncorporationCountry: 'party_incorporation_country',
  partyAddress: 'party_address',
  partyRegisteredAddress: 'party_registered_address',
  partyPhone: 'party_phone',
  partyEmail: 'party_email',
  partyResident: 'party_resident',
  partyNomineeShareholder: 'party_nominee_shareholder',
  partyNomineeDirector: 'party_nominee_director',
  partyShareholderNominator: 'party_shareholder_nominator',
  partyDirectorNominator: 'party_director_nominator',
  capitalAmount: 'capital_amount',
  capitalCurrency: 'capital_currency',
  shareCount: 'share_count',
  capitalFullyPaid: 'capital_fully_paid',
  capitalPaidAmount: 'capital_paid_amount',
  nomineeDirectorService: 'nominee_director_service',
  secretaryService: 'secretary_service',
  officeChoice: 'office_choice',
  officePostalCode: 'office_postal_code',
  officeBlockStreet: 'office_block_street',
  officeBuilding: 'office_building',
  officeUnit: 'office_unit',
  firstFye: 'first_fye',
  rulesPreference: 'rules_preference',
  customConstitution: 'custom_constitution',
  otherNotes: 'other_notes',
} as const;


const K = INCORPORATION_KEYS;

export const ACRA_GUIDANCE_LINKS = {
  businessName: 'https://www.acra.gov.sg/register/business/choosing-reserving-a-business-name/choosing/',
  nameApplication: 'https://www.acra.gov.sg/resources/guides-forms/apply-for-new-business-entity-name/',
  ssic: 'https://www.acra.gov.sg/register/business/choosing-reserving-a-business-name/finding-the-right-ssic-code/',
  referralAuthorities: 'https://www.acra.gov.sg/register/business/choosing-reserving-a-business-name/referral-authorities/',
  directors: 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/',
  companyType: 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/choosing-a-company-type/',
  shareCapital: 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/deciding-on-share-capital-share-types/',
  nomineeRegisters: 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/maintaining-local-companys-information-registers/rond-rons/filing-to-the-central-rond-rons/',
  controllers: 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/maintaining-local-companys-information-registers/rorc/registrable-controllers/',
  bizfileIncorporation: 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/registering-via-bizfile/',
  financialYearEnd: 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/choosing-a-companys-financial-year-end/',
  companiesActS198: 'https://sso.agc.gov.sg/Act/CoA1967?WholeDoc=1',
  constitution: 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/company-constitution/',
  modelConstitution: 'https://isomer-user-content.by.gov.sg/277/8bb59a89-7efe-43ac-a438-711a0cb504b3/Model%20Constitution.pdf',
} as const;

export interface IncorporationGuidanceItem {
  id: string;
  /** Field key the guidance sits on, or the section heading key. */
  fieldKey: string;
  links: Array<{ label: string; url: string }>;
  reviewedOn: string;
  textVersion: number;
}

function link(url: string, label: string): string {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

/** G01–G12 from the handover plan, with the field each one is published on. */
export const SG_COMPANY_INCORPORATION_GUIDANCE: IncorporationGuidanceItem[] = [
  { id: 'G01', fieldKey: K.proposedName, links: [{ label: 'ACRA: Choosing a business name', url: ACRA_GUIDANCE_LINKS.businessName }] },
  { id: 'G02', fieldKey: K.companyType, links: [{ label: 'ACRA: Choosing a company type', url: ACRA_GUIDANCE_LINKS.companyType }] },
  { id: 'G03', fieldKey: K.primarySsic, links: [{ label: 'ACRA: Finding the right SSIC code', url: ACRA_GUIDANCE_LINKS.ssic }] },
  { id: 'G04', fieldKey: K.businessDescription, links: [{ label: 'ACRA: Referral authorities', url: ACRA_GUIDANCE_LINKS.referralAuthorities }] },
  { id: 'G05', fieldKey: 'parties_guidance', links: [{ label: 'ACRA: Directors and key officers', url: ACRA_GUIDANCE_LINKS.directors }] },
  { id: 'G06', fieldKey: K.capitalAmount, links: [{ label: 'ACRA: Share capital and share types', url: ACRA_GUIDANCE_LINKS.shareCapital }] },
  {
    id: 'G08',
    fieldKey: 'parties_guidance',
    links: [
      { label: 'ACRA: Nominee directors and shareholders', url: ACRA_GUIDANCE_LINKS.nomineeRegisters },
      { label: 'ACRA: Registrable controllers', url: ACRA_GUIDANCE_LINKS.controllers },
    ],
  },
  { id: 'G09', fieldKey: K.officeChoice, links: [{ label: 'ACRA: Incorporation particulars', url: ACRA_GUIDANCE_LINKS.bizfileIncorporation }] },
  { id: 'G10', fieldKey: 'services_guidance', links: [{ label: 'ACRA: Directors and company secretary', url: ACRA_GUIDANCE_LINKS.directors }] },
  {
    id: 'G11',
    fieldKey: K.firstFye,
    links: [
      { label: 'ACRA: Choosing a financial year end', url: ACRA_GUIDANCE_LINKS.financialYearEnd },
      { label: 'Companies Act 1967, section 198', url: ACRA_GUIDANCE_LINKS.companiesActS198 },
    ],
  },
  {
    id: 'G12',
    fieldKey: K.rulesPreference,
    links: [
      { label: 'Model constitution currently in force (PDF)', url: ACRA_GUIDANCE_LINKS.modelConstitution },
      { label: 'ACRA: Company constitution', url: ACRA_GUIDANCE_LINKS.constitution },
    ],
  },
].map((item) => ({ ...item, reviewedOn: SG_COMPANY_INCORPORATION_GUIDANCE_REVIEWED_ON, textVersion: 3 }));

function guidanceLinks(id: string): string {
  const item = SG_COMPANY_INCORPORATION_GUIDANCE.find((entry) => entry.id === id);
  if (!item) return '';
  return item.links.map((entry) => link(entry.url, entry.label)).join(' · ');
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export const COMPANY_TYPE = {
  exemptPrivate: 'exempt_private_limited',
  privateLimited: 'private_limited',
  publicLimited: 'public_limited',
  publicGuarantee: 'public_guarantee',
} as const;
/** Company types whose name ends with "Pte. Ltd." or "Private Limited". */
export const PRIVATE_COMPANY_TYPES: readonly string[] = [COMPANY_TYPE.exemptPrivate, COMPANY_TYPE.privateLimited];
/** Name endings the respondent can choose; the value is the ending itself. */
export const PRIVATE_NAME_SUFFIXES = [
  'Private Limited', 'Pte. Ltd.', 'Private Ltd.', 'Pte. Limited',
  'Sendirian Berhad', 'Sdn. Bhd.', 'Sendirian Bhd.', 'Sdn. Berhad',
  '(Private) Limited', '(Private) Ltd.', '(Pte.) Limited',
  '(Sendirian) Berhad', '(Sendirian) Bhd.', '(Sdn.) Berhad',
  '(Pte. Ltd.)', '(Private Limited)', '(Private Ltd.)', '(Pte. Limited)',
  '(Sendirian Berhad)', '(Sendirian Bhd.)', '(Sdn. Bhd.)', '(Sdn. Berhad)',
  'LLC', 'Law Corporation', '(LLC)', '(Law Corporation)',
] as const;
export const PUBLIC_NAME_SUFFIXES = ['Limited', 'Ltd.', 'Berhad', 'Bhd.'] as const;
export const PARTY_KIND = { individual: 'individual', organisation: 'organisation' } as const;
export const PARTY_ROLE = {
  shareholder: 'shareholder',
  director: 'director',
  managingDirector: 'managing_director',
  ceo: 'ceo',
  secretary: 'secretary',
} as const;
export const PARTY_ROLE_LABELS: Record<string, string> = {
  [PARTY_ROLE.shareholder]: 'Shareholder',
  [PARTY_ROLE.director]: 'Director',
  [PARTY_ROLE.managingDirector]: 'Managing director',
  [PARTY_ROLE.ceo]: 'CEO',
  [PARTY_ROLE.secretary]: 'Company secretary',
};
/** Roles that make a person a director of the company. */
export const DIRECTOR_ROLES: readonly string[] = [PARTY_ROLE.director, PARTY_ROLE.managingDirector];
export const OFFICE_CHOICE = { own: 'own_address', firmService: 'firm_service' } as const;
export const CONSTITUTION = {
  modelAtAdoption: 'acra_model_at_adoption',
  modelFromTimeToTime: 'acra_model_time_to_time',
  custom: 'custom',
} as const;
export const YES_NO = { yes: 'yes', no: 'no' } as const;
export const TICK = 'yes';

export const CAPITAL_CURRENCIES = ['SGD', 'USD', 'EUR', 'GBP', 'AUD', 'CNY', 'HKD', 'JPY', 'MYR', 'IDR', 'INR', 'THB'];

// ---------------------------------------------------------------------------
// Field builders
// ---------------------------------------------------------------------------

type FieldDraft = Omit<FormFieldInput, 'position' | 'isRequired' | 'hideLabel' | 'isReadOnly' | 'layoutWidth'> & {
  isRequired?: boolean;
  hideLabel?: boolean;
  isReadOnly?: boolean;
  layoutWidth?: FormFieldInput['layoutWidth'];
};

const eq = (fieldKey: string, value: string): FieldConditionInput => ({ fieldKey, operator: 'equals', value });
const contains = (fieldKey: string, value: string): FieldConditionInput => ({ fieldKey, operator: 'contains', value });
const notEmpty = (fieldKey: string): FieldConditionInput => ({ fieldKey, operator: 'not_empty' });
const all = (...rules: FieldConditionInput[]): FieldConditionInput => ({ logic: 'and', rules });
const any = (...rules: FieldConditionInput[]): FieldConditionInput => ({ logic: 'or', rules });

function choices(entries: Array<[string, string]>, defaultValue?: string) {
  return entries.map(([value, label]) => ({ value, label, ...(value === defaultValue ? { defaultSelected: true } : {}) }));
}

function pageBreak(key: string, label: string): FieldDraft {
  return { type: 'PAGE_BREAK', key, label };
}

function heading(key: string, label: string, subtext?: string): FieldDraft {
  return { type: 'PARAGRAPH', inputType: 'info_heading_2', key, label, subtext: subtext ?? null };
}

/** The label names the block in the builder; respondents see only the subtext. */
function info(key: string, label: string, html: string, extra: Partial<FieldDraft> = {}): FieldDraft {
  return {
    type: 'PARAGRAPH',
    inputType: 'info_text',
    key,
    label,
    subtext: html,
    validation: { infoInlineCard: true, infoShowInPdf: false },
    ...extra,
  };
}

/** Longer guidance opened from the field's info button, so it does not change the field's height. */
function requirements(html: string): Pick<FieldDraft, 'helpText'> & { validation: Record<string, unknown> } {
  return { helpText: html, validation: { tooltipEnabled: true, tooltipMode: 'inline' } };
}

function withValidation<T extends { validation: Record<string, unknown> }>(draft: T, validation: Record<string, unknown>): T {
  return { ...draft, validation: { ...draft.validation, ...validation } };
}

function tickBox(key: string, label: string, optionLabel: string, extra: Partial<FieldDraft> = {}): FieldDraft {
  return {
    type: 'MULTIPLE_CHOICE',
    key,
    label,
    hideLabel: true,
    options: choices([[TICK, optionLabel]]),
    ...extra,
  };
}

export interface SgCompanyIncorporationBuildOptions {
  firmName: string;
  /** Tenant's built-in SSIC 2025 option preset. */
  ssicPresetId: string;
  /** Tenant's built-in nationalities option preset. */
  nationalityPresetId: string;
  /** Tenant's built-in countries option preset. */
  countryPresetId: string;
}

function buildFieldDrafts(options: SgCompanyIncorporationBuildOptions): FieldDraft[] {
  const firm = options.firmName.trim() || 'our firm';
  const isShareholder = contains(K.partyRoles, PARTY_ROLE.shareholder);
  const isIndividual = eq(K.partyKind, PARTY_KIND.individual);
  const isOrganisation = eq(K.partyKind, PARTY_KIND.organisation);
  const isDirector = all(isIndividual, any(contains(K.partyRoles, PARTY_ROLE.director), contains(K.partyRoles, PARTY_ROLE.managingDirector)));
  const isSecretary = all(isIndividual, contains(K.partyRoles, PARTY_ROLE.secretary));
  const isPrivateType = any(...PRIVATE_COMPANY_TYPES.map((type) => eq(K.companyType, type)));
  const isPublicType = all(...PRIVATE_COMPANY_TYPES.map((type) => ({ fieldKey: K.companyType, operator: 'not_equals' as const, value: type })));
  const hasShareCapital = { fieldKey: K.companyType, operator: 'not_equals' as const, value: COMPANY_TYPE.publicGuarantee };
  const ownOffice = eq(K.officeChoice, OFFICE_CHOICE.own);
  const nameWithoutEnding = 'Enter the name without “Pte. Ltd.” or “Limited”. The ending you choose above is added for you, and the name check ignores it.';

  return [
    // -----------------------------------------------------------------------
    // Page 1 — Company details
    // -----------------------------------------------------------------------
    heading('step_company_details', 'Company details'),
    info(
      'intro_notice',
      'Introduction',
      '<p>Tell us about the company you want to incorporate in Singapore and the people involved. You can save your progress and come back later.</p>'
        + `<p><strong>Submitting this form does not reserve a name or register the company. ${firm} will review it and handle the ACRA filing.</strong></p>`,
    ),
    { type: 'SHORT_TEXT', inputType: 'text', key: K.contactName, label: 'Your name', placeholder: 'The person we should contact', isRequired: true, validation: { maxLength: 200 } },
    { type: 'SHORT_TEXT', inputType: 'email', key: K.contactEmail, label: 'Your email', isRequired: true, layoutWidth: 50, validation: { maxLength: 320 } },
    { type: 'SHORT_TEXT', inputType: 'phone', key: K.contactPhone, label: 'Your mobile number', isRequired: true, layoutWidth: 50, validation: { splitPhoneCountryCode: true, phoneDefaultCountryCode: '+65' } },

    heading('section_company_name', 'Company name and type'),
    {
      type: 'DROPDOWN',
      key: K.companyType,
      label: 'Company type',
      isRequired: true,
      options: choices([
        [COMPANY_TYPE.exemptPrivate, 'Exempt private company limited by shares'],
        [COMPANY_TYPE.privateLimited, 'Private company limited by shares'],
        [COMPANY_TYPE.publicLimited, 'Public company limited by shares'],
        [COMPANY_TYPE.publicGuarantee, 'Public company limited by guarantee'],
      ]),
      ...withValidation(requirements(
        '<p><strong>Exempt private company:</strong> up to 20 shareholders, all of them individuals. Most small businesses start as one.</p>'
          + '<p><strong>Private company:</strong> up to 50 shareholders, which can include companies.</p>'
          + '<p><strong>Public company limited by shares:</strong> can have more than 50 shareholders and offer shares to the public.</p>'
          + `<p><strong>Public company limited by guarantee:</strong> has members instead of shareholders and no share capital; usually for non-profit activities. ${guidanceLinks('G02')}</p>`,
      ), { defaultValue: COMPANY_TYPE.exemptPrivate }),
    },
    {
      type: 'DROPDOWN',
      key: K.nameSuffixPrivate,
      label: 'Name ending',
      subtext: nameWithoutEnding,
      isRequired: true,
      condition: isPrivateType,
      options: choices(PRIVATE_NAME_SUFFIXES.map((suffix) => [suffix, suffix])),
      validation: { defaultValue: 'Pte. Ltd.' },
    },
    {
      type: 'DROPDOWN',
      key: K.nameSuffixPublic,
      label: 'Name ending',
      subtext: nameWithoutEnding,
      isRequired: true,
      condition: isPublicType,
      options: choices(PUBLIC_NAME_SUFFIXES.map((suffix) => [suffix, suffix])),
      validation: { defaultValue: 'Limited' },
    },
    {
      type: 'COMPANY_NAME_CHECK',
      key: K.proposedName,
      label: 'Proposed company name',
      placeholder: 'e.g. Harbourline Trading',
      subtext: `Select Check name to look for similar registered names. This check does not reserve the name. ${guidanceLinks('G01')}`,
      isRequired: true,
      ...withValidation(requirements(
        '<p>Avoid names identical to a registered or reserved name, and undesirable or legally protected names.</p>'
          + '<p>Words such as “Singapore”, “Holdings” or “Group”, and the name ending, are disregarded when names are compared.</p>',
      ), { nameCheckMode: 'advisory', maxLength: 300 }),
    },
    {
      type: 'COMPANY_NAME_CHECK',
      key: K.alternativeName1,
      label: 'Alternative name 1',
      placeholder: 'Used if the proposed name is not available',
      isRequired: true,
      validation: { nameCheckMode: 'advisory', maxLength: 300 },
    },
    {
      type: 'COMPANY_NAME_CHECK',
      key: K.alternativeName2,
      label: 'Alternative name 2',
      placeholder: 'Optional',
      validation: { nameCheckMode: 'advisory', maxLength: 300 },
    },

    heading('section_business_activity', 'Business activities'),
    {
      type: 'DROPDOWN',
      key: K.primarySsic,
      label: 'Primary business activity (SSIC)',
      placeholder: 'Search by activity or 5-digit code',
      subtext: `Choose the activity that best describes the business. ${guidanceLinks('G03')}`,
      isRequired: true,
      optionPresetId: options.ssicPresetId,
    },
    {
      type: 'DROPDOWN',
      key: K.secondarySsic,
      label: 'Secondary business activity (SSIC)',
      placeholder: 'Optional: search by activity or 5-digit code',
      optionPresetId: options.ssicPresetId,
    },
    {
      type: 'LONG_TEXT',
      key: K.businessDescription,
      label: 'Brief business description',
      placeholder: 'e.g. Retail sale of home furniture through an online store',
      subtext: `One to three sentences on the main products or services. Some activities need another agency’s approval. ${guidanceLinks('G04')}`,
      isRequired: true,
      validation: { maxLength: 1000 },
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'email',
      key: K.companyEmail,
      label: 'Company email',
      placeholder: 'e.g. admin@yourcompany.com',
      isRequired: true,
      ...requirements('<p>ACRA records an email address for the company. It can be a shared mailbox or your own email.</p>'),
      validation: { maxLength: 320, tooltipEnabled: true, tooltipMode: 'inline' },
    },

    // -----------------------------------------------------------------------
    // Page 2 — Shareholders and officers
    // -----------------------------------------------------------------------
    pageBreak('page_parties', 'Shareholders and officers'),
    heading('step_parties', 'Shareholders and officers'),
    info(
      'parties_guidance',
      'About shareholders and officers',
      '<p>Add each person or company once and tick every role they will hold. Shareholdings must total 100%, and the company needs at least one director who is an individual. A company can be a shareholder but cannot hold any other role. A company secretary must live in Singapore. For a company limited by guarantee, tick Shareholder for each member.</p>'
        + `<p>${guidanceLinks('G05')} · ${guidanceLinks('G08')}</p>`,
    ),
    {
      type: 'PAGE_BREAK',
      inputType: 'repeat_start',
      key: SG_COMPANY_INCORPORATION_PARTY_SECTION_KEY,
      label: 'Shareholders and officers',
      validation: {
        repeatMinItems: 1,
        repeatMaxItems: 50,
        repeatAddLabel: 'Add another person or company',
        repeatItemLabel: 'Person',
        repeatTotalFieldKey: K.ownershipPercent,
        repeatTotalLabel: 'Total shareholding',
        repeatTotalSuffix: '%',
        repeatTotalTarget: 100,
      },
    },
    {
      type: 'SINGLE_CHOICE',
      key: K.partyKind,
      label: 'This is',
      isRequired: true,
      layoutWidth: 50,
      options: choices([
        [PARTY_KIND.individual, 'An individual'],
        [PARTY_KIND.organisation, 'A company'],
      ], PARTY_KIND.individual),
      validation: { choiceLayout: 'chips' },
    },
    {
      type: 'MULTIPLE_CHOICE',
      key: K.partyRoles,
      label: 'Roles',
      isRequired: true,
      // Officer roles are offered to individuals only; a company can only be a shareholder.
      options: choices(Object.entries(PARTY_ROLE_LABELS)).map((option) => (
        option.value === PARTY_ROLE.shareholder ? option : { ...option, condition: isIndividual }
      )),
      validation: { choiceLayout: 'chips', layoutBreakBefore: true },
    },
    {
      type: 'PARAGRAPH',
      inputType: 'info_text',
      key: 'party_organisation_role_notice',
      label: 'Company role notice',
      subtext: 'A company can only be a shareholder. Untick the other roles.',
      condition: all(
        isOrganisation,
        any(
          contains(K.partyRoles, PARTY_ROLE.director),
          contains(K.partyRoles, PARTY_ROLE.managingDirector),
          contains(K.partyRoles, PARTY_ROLE.ceo),
          contains(K.partyRoles, PARTY_ROLE.secretary),
        ),
      ),
      validation: { infoStopsProgress: true, infoShowInPdf: false },
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'text',
      key: K.partyName,
      label: 'Full name',
      placeholder: 'As in NRIC, passport or company registration',
      isRequired: true,
      layoutWidth: 50,
      validation: { maxLength: 300 },
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'text',
      key: K.partyIdNumber,
      label: 'Passport/FIN/NRIC number',
      isRequired: true,
      layoutWidth: 50,
      condition: isIndividual,
      validation: { maxLength: 40 },
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'text',
      key: K.partyRegistrationReference,
      label: 'UEN or registration number',
      isRequired: true,
      layoutWidth: 50,
      condition: isOrganisation,
      validation: { maxLength: 60 },
    },
    {
      type: 'DROPDOWN',
      key: K.partyNationality,
      label: 'Nationality',
      placeholder: 'Select nationality',
      isRequired: true,
      layoutWidth: 50,
      condition: isIndividual,
      optionPresetId: options.nationalityPresetId,
    },
    {
      type: 'DROPDOWN',
      key: K.partyIncorporationCountry,
      label: 'Place of incorporation',
      placeholder: 'Select country',
      isRequired: true,
      layoutWidth: 50,
      condition: isOrganisation,
      optionPresetId: options.countryPresetId,
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'text',
      key: K.partyAddress,
      label: 'Residential address',
      placeholder: 'Block, street, unit, postal code and country',
      isRequired: true,
      condition: isIndividual,
      validation: { maxLength: 500, layoutBreakBefore: true },
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'text',
      key: K.partyRegisteredAddress,
      label: 'Registered address',
      placeholder: 'Block, street, unit, postal code and country',
      isRequired: true,
      condition: isOrganisation,
      validation: { maxLength: 500, layoutBreakBefore: true },
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'phone',
      key: K.partyPhone,
      label: 'Contact number',
      isRequired: true,
      layoutWidth: 50,
      validation: { splitPhoneCountryCode: true, phoneDefaultCountryCode: '+65' },
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'email',
      key: K.partyEmail,
      label: 'Email',
      isRequired: true,
      layoutWidth: 50,
      validation: { maxLength: 320 },
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'number',
      key: K.ownershipPercent,
      label: 'Shareholding (%)',
      placeholder: 'e.g. 60',
      isRequired: true,
      layoutWidth: 50,
      condition: all(isShareholder, hasShareCapital),
      validation: { min: 0, max: 100 },
    },
    tickBox(K.partyResident, 'Singapore resident', 'Lives in Singapore (citizen, PR, or Employment Pass, EntrePass or Dependant’s Pass holder)', {
      condition: any(isDirector, isSecretary),
      validation: { layoutBreakBefore: true },
    }),
    tickBox(K.partyNomineeShareholder, 'Nominee shareholder', 'Holds these shares on behalf of someone else', {
      condition: isShareholder,
    }),
    {
      type: 'SHORT_TEXT',
      inputType: 'text',
      key: K.partyShareholderNominator,
      label: 'Shareholder nominator',
      placeholder: 'Full name of the person or company the shares are held for',
      isRequired: true,
      condition: all(isShareholder, notEmpty(K.partyNomineeShareholder)),
      validation: { maxLength: 300 },
    },
    tickBox(K.partyNomineeDirector, 'Nominee director', 'Acts as director on someone else’s instructions', {
      condition: isDirector,
    }),
    {
      type: 'SHORT_TEXT',
      inputType: 'text',
      key: K.partyDirectorNominator,
      label: 'Director nominator',
      placeholder: 'Full name of the person or company whose instructions they act on',
      isRequired: true,
      condition: all(isDirector, notEmpty(K.partyNomineeDirector)),
      validation: { maxLength: 300 },
    },
    { type: 'PAGE_BREAK', inputType: 'repeat_end', key: 'parties_section_end', label: 'End of shareholders and officers' },

    // -----------------------------------------------------------------------
    // Page 3 — Share capital and our services
    // -----------------------------------------------------------------------
    pageBreak('page_capital', 'Share capital and services'),
    { ...heading('step_capital', 'Share capital'), condition: hasShareCapital },
    {
      type: 'SHORT_TEXT',
      inputType: 'number',
      key: K.capitalAmount,
      label: 'Issued share capital',
      placeholder: 'e.g. 1000',
      isRequired: true,
      layoutWidth: 50,
      condition: hasShareCapital,
      ...requirements(`<p>The total amount the shareholders put in for their shares. The minimum is 1. All shares are ordinary shares paid in cash. ${guidanceLinks('G06')}</p>`),
      validation: { min: 0, tooltipEnabled: true, tooltipMode: 'inline' },
    },
    {
      type: 'DROPDOWN',
      key: K.capitalCurrency,
      label: 'Currency',
      isRequired: true,
      layoutWidth: 25,
      condition: hasShareCapital,
      options: choices(CAPITAL_CURRENCIES.map((code) => [code, code])),
      validation: { defaultValue: 'SGD' },
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'number',
      key: K.shareCount,
      label: 'Number of shares',
      placeholder: 'e.g. 1000',
      isRequired: true,
      layoutWidth: 25,
      condition: hasShareCapital,
      ...requirements('<p>Each shareholder’s percentage must work out to a whole number of shares. For example, with 1,000 shares a 33.3% holding is 333 shares.</p>'),
      validation: { min: 1, tooltipEnabled: true, tooltipMode: 'inline' },
    },
    {
      type: 'SINGLE_CHOICE',
      key: K.capitalFullyPaid,
      label: 'Will the share capital be fully paid at incorporation?',
      isRequired: true,
      condition: hasShareCapital,
      options: choices([[YES_NO.yes, 'Yes'], [YES_NO.no, 'No']], YES_NO.yes),
      validation: { choiceInlineRight: true },
    },
    {
      type: 'SHORT_TEXT',
      inputType: 'number',
      key: K.capitalPaidAmount,
      label: 'Amount paid at incorporation',
      placeholder: 'e.g. 0',
      isRequired: true,
      layoutWidth: 50,
      condition: all(hasShareCapital, eq(K.capitalFullyPaid, YES_NO.no)),
      validation: { min: 0 },
    },

    heading('section_services', 'Our services'),
    info(
      'services_guidance',
      'About our services',
      `<p>Every company needs at least one director who lives in Singapore, and a company secretary who lives in Singapore. If none of the people you listed fills a role, tick the service and ${firm} will provide it. ${guidanceLinks('G10')}</p>`,
    ),
    tickBox(K.nomineeDirectorService, 'Nominee director service', `${firm} to provide a Singapore-resident nominee director`),
    tickBox(K.secretaryService, 'Company secretary service', `${firm} to act as company secretary`),

    // -----------------------------------------------------------------------
    // Page 4 — Registered office and other details
    // -----------------------------------------------------------------------
    pageBreak('page_settings', 'Registered office and other details'),
    heading('step_office', 'Registered office'),
    {
      type: 'SINGLE_CHOICE',
      key: K.officeChoice,
      label: 'Registered office address',
      subtext: `A Singapore address where the company’s records are kept. It cannot be a PO box. ${guidanceLinks('G09')}`,
      isRequired: true,
      options: choices([
        [OFFICE_CHOICE.own, 'Use our own Singapore address'],
        [OFFICE_CHOICE.firmService, `Use ${firm}’s registered office service`],
      ]),
    },
    { type: 'SHORT_TEXT', inputType: 'text', key: K.officeBlockStreet, label: 'Block/house number and street', isRequired: true, layoutWidth: 75, condition: ownOffice, validation: { maxLength: 200 } },
    { type: 'SHORT_TEXT', inputType: 'text', key: K.officeUnit, label: 'Unit', placeholder: 'e.g. #05-12', layoutWidth: 25, condition: ownOffice, validation: { maxLength: 30 } },
    { type: 'SHORT_TEXT', inputType: 'text', key: K.officeBuilding, label: 'Building', placeholder: 'Optional', layoutWidth: 75, condition: ownOffice, validation: { maxLength: 200 } },
    { type: 'SHORT_TEXT', inputType: 'text', key: K.officePostalCode, label: 'Postal code', placeholder: '6 digits', isRequired: true, layoutWidth: 25, condition: ownOffice, validation: { minLength: 6, maxLength: 6 } },

    heading('section_financial_year', 'Financial year end'),
    {
      type: 'SHORT_TEXT',
      inputType: 'date',
      key: K.firstFye,
      label: 'First financial year end',
      isRequired: true,
      ...requirements(`<p>The date the company’s first financial year ends. Later financial years run for 12 months. The first financial year cannot be longer than 18 months from incorporation without ACRA’s approval.</p><p>If you are unsure, 31 December or the end of the month before the first anniversary of incorporation are common choices. ${guidanceLinks('G11')}</p>`),
      validation: { minDate: 'today', tooltipEnabled: true, tooltipMode: 'inline' },
    },

    heading('section_constitution', 'Company constitution'),
    {
      type: 'SINGLE_CHOICE',
      key: K.rulesPreference,
      label: 'Company constitution',
      subtext: `The constitution sets the company’s rules. Most companies adopt ACRA’s model constitution. ${guidanceLinks('G12')}`,
      isRequired: true,
      options: choices([
        [CONSTITUTION.modelAtAdoption, 'ACRA model constitution as in force at the time of adoption (later changes to the model do not apply)'],
        [CONSTITUTION.modelFromTimeToTime, 'ACRA model constitution as may be in force from time to time (later changes apply automatically)'],
        [CONSTITUTION.custom, 'Our own constitution (upload it below)'],
      ]),
    },
    {
      type: 'FILE_UPLOAD',
      key: K.customConstitution,
      label: 'Constitution file',
      subtext: 'PDF, JPEG or PNG, up to 10 MB.',
      isRequired: true,
      condition: eq(K.rulesPreference, CONSTITUTION.custom),
      validation: { maxFileSizeMb: 10, allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] },
    },

    heading('section_other', 'Anything else'),
    {
      type: 'LONG_TEXT',
      key: K.otherNotes,
      label: 'Additional instructions',
      placeholder: 'Optional',
      validation: { maxLength: 3000 },
    },
  ];
}

export function buildSgCompanyIncorporationFields(options: SgCompanyIncorporationBuildOptions): FormFieldInput[] {
  return buildFieldDrafts(options).map((draft, position) => ({
    ...draft,
    isRequired: draft.isRequired ?? false,
    hideLabel: draft.hideLabel ?? false,
    isReadOnly: draft.isReadOnly ?? false,
    layoutWidth: draft.layoutWidth ?? 100,
    position,
  }));
}

export function buildSgCompanyIncorporationSettings(input: {
  firmName: string;
  notificationEmails?: string[];
}): Record<string, unknown> {
  const firm = input.firmName.trim() || 'our firm';
  return {
    drafts: { enabled: true, autoDeleteDays: 30 },
    notifications: {
      completionRecipientEmails: input.notificationEmails ?? [],
      attachmentMode: 'link_only',
    },
    completion: {
      reviewStep: true,
      reviewTitle: 'Review and submit',
      reviewIntro: 'Check your answers. Use Edit to change anything before you submit.',
      submitLabel: 'Submit company details',
      successTitle: 'Company details submitted',
      successMessage: `Reference: {reference}. ${firm} will review the details and send the KYC forms to each person listed.`,
      showPdfActions: true,
    },
  };
}
