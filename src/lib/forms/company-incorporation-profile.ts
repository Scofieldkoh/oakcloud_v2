/**
 * Intake profile for the Singapore Company Incorporation form template.
 *
 * Browser-safe: the public form uses it to stop a page from continuing while it has
 * an `error` issue, the review step lists the remaining items, and the submission
 * service uses it as the authoritative check. `error` issues block; `staff_review`
 * issues are stored with the response for the staff checklist and never block.
 */

import {
  COMPANY_TYPE,
  CONSTITUTION,
  DIRECTOR_ROLES,
  INCORPORATION_KEYS as K,
  OFFICE_CHOICE,
  PRIVATE_COMPANY_TYPES,
  PRIVATE_NAME_SUFFIXES,
  PUBLIC_NAME_SUFFIXES,
  PARTY_KIND,
  PARTY_ROLE,
  TICK,
  YES_NO,
  CAPITAL_CURRENCIES,
} from '@/lib/form-templates/sg-company-incorporation';
import { decimalUnits, formatDecimalUnits, parseDecimalString } from '@/lib/forms/decimal-string';
import { describeNameCheckAssessment, type NameCheckResultValue } from '@/lib/forms/name-check-result';

export type IncorporationIssueSeverity = 'error' | 'staff_review';
export type IncorporationIssueSection = 'company' | 'parties' | 'capital' | 'settings';

export interface IncorporationIssue {
  code: string;
  severity: IncorporationIssueSeverity;
  section: IncorporationIssueSection;
  message: string;
  fieldKey?: string;
  rowIndex?: number;
}

export interface IncorporationParty {
  rowIndex: number;
  kind: string;
  name: string;
  roles: string[];
  ownershipPercent: string | null;
  /** Whole number of shares from the percentage and total share count, when both are valid. */
  shares: string | null;
  email: string | null;
  registrationReference: string | null;
  resident: boolean;
  nomineeShareholder: boolean;
  nomineeDirector: boolean;
  shareholderNominator: string | null;
  directorNominator: string | null;
}

export interface IncorporationEvaluation {
  issues: IncorporationIssue[];
  parties: IncorporationParty[];
  /** Exact sum of shareholding percentages, as a decimal string. */
  ownershipTotal: string;
}

export interface IncorporationEvaluationOptions {
  /** Name-check results by field key (proposed and alternative names). */
  nameChecks?: Record<string, NameCheckResultValue | null | undefined>;
  /** Codes of the pinned SSIC catalogue. When omitted, membership is not checked. */
  ssicCodes?: ReadonlySet<string> | null;
  /** YYYY-MM-DD in Singapore time; defaults to the current date. */
  today?: string;
}

const PARTY_KEYS = [
  K.partyKind,
  K.partyName,
  K.partyRoles,
  K.ownershipPercent,
  K.partyEmail,
  K.partyRegistrationReference,
  K.partyResident,
  K.partyNomineeShareholder,
  K.partyNomineeDirector,
  K.partyShareholderNominator,
  K.partyDirectorNominator,
  K.partyIdNumber,
  K.partyNationality,
  K.partyIncorporationCountry,
  K.partyAddress,
  K.partyRegisteredAddress,
  K.partyPhone,
];

const NAME_KEYS = [
  [K.proposedName, 'The proposed name'],
  [K.alternativeName1, 'Alternative name 1'],
  [K.alternativeName2, 'Alternative name 2'],
] as const;

const CHOICE_DOMAINS: Record<string, readonly string[]> = {
  [K.companyType]: Object.values(COMPANY_TYPE),
  [K.nameSuffixPrivate]: PRIVATE_NAME_SUFFIXES,
  [K.nameSuffixPublic]: PUBLIC_NAME_SUFFIXES,
  [K.capitalCurrency]: CAPITAL_CURRENCIES,
  [K.capitalFullyPaid]: Object.values(YES_NO),
  [K.officeChoice]: Object.values(OFFICE_CHOICE),
  [K.rulesPreference]: Object.values(CONSTITUTION),
};

const TICK_KEYS = [K.nomineeDirectorService, K.secretaryService];

const ROW_CHOICE_DOMAINS: Record<string, readonly string[]> = {
  [K.partyKind]: Object.values(PARTY_KIND),
  [K.partyRoles]: Object.values(PARTY_ROLE),
  [K.partyResident]: [TICK],
  [K.partyNomineeShareholder]: [TICK],
  [K.partyNomineeDirector]: [TICK],
};

const MAX_PRIVATE_SHAREHOLDERS = 50;
const MAX_EXEMPT_PRIVATE_SHAREHOLDERS = 20;
const PERCENT_SCALE = decimalUnits(100);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function choiceValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (isRecord(value) && typeof value.value === 'string') return value.value.trim();
  return '';
}

function choiceValues(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = choiceValue(value);
    return single ? [single] : [];
  }
  return value.map(choiceValue).filter(Boolean);
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function rowValue(answers: Record<string, unknown>, key: string, rowIndex: number): unknown {
  const value = answers[key];
  return Array.isArray(value) ? value[rowIndex] : undefined;
}

function isTicked(value: unknown): boolean {
  return choiceValues(value).includes(TICK);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isRealIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function addMonthsIso(value: string, months: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

function singaporeToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

const NAME_ENDING = /(^|[\s(])\(?(pte\.?|private|sdn\.?|sendirian)?\)?\s*(ltd\.?|limited|bhd\.?|berhad)\)?$|(^|[\s(])\(?(llc|law corporation)\)?$/i;

/** True when the name already carries an ending such as "Pte. Ltd." or "Limited". */
export function nameIncludesEnding(name: string): boolean {
  return NAME_ENDING.test(name.trim());
}

export function hasShareCapital(answers: Record<string, unknown>): boolean {
  return choiceValue(answers[K.companyType]) !== COMPANY_TYPE.publicGuarantee;
}

/** The ending chosen for the company type, e.g. "Pte. Ltd.". */
export function selectedNameSuffix(answers: Record<string, unknown>): string {
  const companyType = choiceValue(answers[K.companyType]) || COMPANY_TYPE.exemptPrivate;
  return PRIVATE_COMPANY_TYPES.includes(companyType)
    ? choiceValue(answers[K.nameSuffixPrivate]) || PRIVATE_NAME_SUFFIXES[0]
    : choiceValue(answers[K.nameSuffixPublic]) || PUBLIC_NAME_SUFFIXES[0];
}

function partyLabel(party: Pick<IncorporationParty, 'name' | 'rowIndex'>): string {
  return party.name || `Person ${party.rowIndex + 1}`;
}

function getPartyRowCount(answers: Record<string, unknown>): number {
  let count = 0;
  for (const key of PARTY_KEYS) {
    const value = answers[key];
    if (Array.isArray(value)) count = Math.max(count, value.length);
  }
  return Math.min(count, 50);
}

function isDirector(party: Pick<IncorporationParty, 'kind' | 'roles'>): boolean {
  return party.kind !== PARTY_KIND.organisation && party.roles.some((role) => DIRECTOR_ROLES.includes(role));
}

/** Shares for a percentage of the total, or null when it is not a whole number. */
function sharesForPercent(percentUnits: bigint, shareCount: bigint): bigint | null {
  const scaled = percentUnits * shareCount;
  return scaled % PERCENT_SCALE === BigInt(0) ? scaled / PERCENT_SCALE : null;
}

function parseShareCount(answers: Record<string, unknown>): bigint | null {
  const text = textValue(answers[K.shareCount]);
  return /^\d{1,15}$/.test(text) && BigInt(text) > BigInt(0) ? BigInt(text) : null;
}

export function extractIncorporationParties(answers: Record<string, unknown>): IncorporationParty[] {
  const parties: IncorporationParty[] = [];
  const rowCount = getPartyRowCount(answers);
  const shareCount = parseShareCount(answers);
  const withCapital = hasShareCapital(answers);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const kind = choiceValue(rowValue(answers, K.partyKind, rowIndex));
    const name = textValue(rowValue(answers, K.partyName, rowIndex));
    const roles = choiceValues(rowValue(answers, K.partyRoles, rowIndex));
    const isShareholder = roles.includes(PARTY_ROLE.shareholder);
    const percentText = isShareholder && withCapital ? textValue(rowValue(answers, K.ownershipPercent, rowIndex)) : '';
    const email = textValue(rowValue(answers, K.partyEmail, rowIndex));
    const registrationReference = textValue(rowValue(answers, K.partyRegistrationReference, rowIndex));

    if (!name && roles.length === 0 && !percentText && !email && !registrationReference) continue;

    const percentUnits = parseDecimalString(percentText);
    const shares = shareCount !== null && percentUnits !== null ? sharesForPercent(percentUnits, shareCount) : null;
    const nomineeShareholder = isShareholder && isTicked(rowValue(answers, K.partyNomineeShareholder, rowIndex));
    const directorLike = kind !== PARTY_KIND.organisation && roles.some((role) => DIRECTOR_ROLES.includes(role));
    const secretaryLike = kind !== PARTY_KIND.organisation && roles.includes(PARTY_ROLE.secretary);
    const nomineeDirector = directorLike && isTicked(rowValue(answers, K.partyNomineeDirector, rowIndex));

    parties.push({
      rowIndex,
      kind,
      name,
      roles,
      ownershipPercent: percentText || null,
      shares: shares !== null ? shares.toString() : null,
      email: email || null,
      registrationReference: registrationReference || null,
      resident: (directorLike || secretaryLike) && isTicked(rowValue(answers, K.partyResident, rowIndex)),
      nomineeShareholder,
      nomineeDirector,
      shareholderNominator: nomineeShareholder ? textValue(rowValue(answers, K.partyShareholderNominator, rowIndex)) || null : null,
      directorNominator: nomineeDirector ? textValue(rowValue(answers, K.partyDirectorNominator, rowIndex)) || null : null,
    });
  }

  return parties;
}

export function evaluateCompanyIncorporationAnswers(
  answers: Record<string, unknown>,
  options: IncorporationEvaluationOptions = {}
): IncorporationEvaluation {
  const issues: IncorporationIssue[] = [];
  const add = (issue: IncorporationIssue) => issues.push(issue);
  const today = options.today ?? singaporeToday();
  const nameChecks = options.nameChecks ?? {};

  // --- Option membership (direct API payloads) ----------------------------
  for (const [key, domain] of Object.entries(CHOICE_DOMAINS)) {
    const value = choiceValue(answers[key]);
    if (value && !domain.includes(value)) {
      add({ code: 'invalid_option', severity: 'error', section: 'company', fieldKey: key, message: `Select a valid option for ${key.replace(/_/g, ' ')}.` });
    }
  }
  for (const key of TICK_KEYS) {
    if (choiceValues(answers[key]).some((value) => value !== TICK)) {
      add({ code: 'invalid_option', severity: 'error', section: 'capital', fieldKey: key, message: `Select a valid option for ${key.replace(/_/g, ' ')}.` });
    }
  }

  // --- Company name -------------------------------------------------------
  const companyType = choiceValue(answers[K.companyType]) || COMPANY_TYPE.exemptPrivate;
  const withCapital = hasShareCapital(answers);
  const seenCompanyNames = new Set<string>();
  for (const [key, label] of NAME_KEYS) {
    const name = textValue(answers[key]);
    if (!name) continue;

    if (nameIncludesEnding(name)) {
      add({ code: 'name_includes_suffix', severity: 'error', section: 'company', fieldKey: key, message: `${label}: leave out the ending such as “Pte. Ltd.” or “Limited”. It is added from Name ending.` });
    }
    const normalized = normalizeName(name);
    if (seenCompanyNames.has(normalized)) {
      add({ code: 'name_repeated', severity: 'error', section: 'company', fieldKey: key, message: `${label} is the same as another name you entered.` });
    }
    seenCompanyNames.add(normalized);

    const check = nameChecks[key];
    const current = check && check.name === name ? check : null;
    if (!current) {
      add({ code: 'name_not_checked', severity: 'staff_review', section: 'company', fieldKey: key, message: `${label} has not been checked yet. Our team will check it.` });
    } else if (current.assessment !== 'AVAILABLE') {
      add({ code: `name_${current.assessment.toLowerCase()}`, severity: 'staff_review', section: 'company', fieldKey: key, message: `${label}: ${describeNameCheckAssessment(current.assessment).title}` });
    }
  }

  // --- Business activity --------------------------------------------------
  const primarySsic = choiceValue(answers[K.primarySsic]);
  const secondarySsic = choiceValue(answers[K.secondarySsic]);
  if (!primarySsic) {
    add({ code: 'ssic_primary_missing', severity: 'error', section: 'company', fieldKey: K.primarySsic, message: 'Select a primary business activity.' });
  }
  if (options.ssicCodes) {
    if (primarySsic && !options.ssicCodes.has(primarySsic)) {
      add({ code: 'ssic_primary_unknown', severity: 'error', section: 'company', fieldKey: K.primarySsic, message: 'Select a primary business activity from the list.' });
    }
    if (secondarySsic && !options.ssicCodes.has(secondarySsic)) {
      add({ code: 'ssic_secondary_unknown', severity: 'error', section: 'company', fieldKey: K.secondarySsic, message: 'Select a secondary business activity from the list.' });
    }
  }
  if (primarySsic && secondarySsic && primarySsic === secondarySsic) {
    add({ code: 'ssic_secondary_duplicate', severity: 'error', section: 'company', fieldKey: K.secondarySsic, message: 'The secondary activity must differ from the primary activity.' });
  }
  if (!textValue(answers[K.businessDescription])) {
    add({ code: 'business_description_missing', severity: 'error', section: 'company', fieldKey: K.businessDescription, message: 'Enter a brief business description.' });
  }

  // --- Parties ------------------------------------------------------------
  const parties = extractIncorporationParties(answers);
  let total = BigInt(0);
  let shareholderCount = 0;

  for (const party of parties) {
    const label = partyLabel(party);
    for (const [key, domain] of Object.entries(ROW_CHOICE_DOMAINS)) {
      const values = choiceValues(rowValue(answers, key, party.rowIndex));
      if (values.some((value) => !domain.includes(value))) {
        add({ code: 'invalid_option', severity: 'error', section: 'parties', fieldKey: key, rowIndex: party.rowIndex, message: `${label}: select a valid option.` });
      }
    }
    if (new Set(party.roles).size !== party.roles.length) {
      add({ code: 'party_roles_duplicate', severity: 'error', section: 'parties', fieldKey: K.partyRoles, rowIndex: party.rowIndex, message: `${label}: each role can be selected once.` });
    }
    if (party.roles.length === 0) {
      add({ code: 'party_roles_missing', severity: 'error', section: 'parties', fieldKey: K.partyRoles, rowIndex: party.rowIndex, message: `${label}: select at least one role.` });
    }
    if (party.kind === PARTY_KIND.organisation && party.roles.some((role) => role !== PARTY_ROLE.shareholder)) {
      add({ code: 'organisation_officer', severity: 'error', section: 'parties', fieldKey: K.partyRoles, rowIndex: party.rowIndex, message: `${label}: a company can only be a shareholder.` });
    }
    if (party.nomineeShareholder && !party.shareholderNominator) {
      add({ code: 'nominator_missing', severity: 'error', section: 'parties', fieldKey: K.partyShareholderNominator, rowIndex: party.rowIndex, message: `${label}: enter the shareholder nominator’s full name.` });
    }
    if (party.nomineeDirector && !party.directorNominator) {
      add({ code: 'nominator_missing', severity: 'error', section: 'parties', fieldKey: K.partyDirectorNominator, rowIndex: party.rowIndex, message: `${label}: enter the director nominator’s full name.` });
    }

    if (!party.roles.includes(PARTY_ROLE.shareholder)) continue;
    shareholderCount += 1;
    if (companyType === COMPANY_TYPE.exemptPrivate && party.kind === PARTY_KIND.organisation) {
      add({ code: 'exempt_private_corporate_shareholder', severity: 'error', section: 'parties', fieldKey: K.partyKind, rowIndex: party.rowIndex, message: `${label}: an exempt private company can only have individuals as shareholders. Choose Private company limited by shares on page 1 instead.` });
    }
    if (!withCapital) continue;
    const units = parseDecimalString(party.ownershipPercent);
    if (units === null) {
      add({ code: 'ownership_invalid', severity: 'error', section: 'parties', fieldKey: K.ownershipPercent, rowIndex: party.rowIndex, message: `${label}: enter the shareholding percentage.` });
      continue;
    }
    if (units <= BigInt(0) || units > PERCENT_SCALE) {
      add({ code: 'ownership_out_of_range', severity: 'error', section: 'parties', fieldKey: K.ownershipPercent, rowIndex: party.rowIndex, message: `${label}: a shareholding must be more than 0% and no more than 100%.` });
      continue;
    }
    total += units;
  }

  const totalText = formatDecimalUnits(total);
  if (parties.length === 0) {
    add({ code: 'no_parties', severity: 'error', section: 'parties', fieldKey: K.partyName, message: 'Add at least one shareholder and one director.' });
  } else {
    if (shareholderCount === 0) {
      add({ code: 'no_shareholder', severity: 'error', section: 'parties', fieldKey: K.partyRoles, message: 'Add at least one shareholder.' });
    } else if (withCapital && total !== PERCENT_SCALE) {
      add({ code: 'ownership_total', severity: 'error', section: 'parties', fieldKey: K.ownershipPercent, message: `Shareholdings total ${totalText}%. They must add up to exactly 100%.` });
    }
    if (!parties.some(isDirector)) {
      add({ code: 'no_director', severity: 'error', section: 'parties', fieldKey: K.partyRoles, message: 'Add at least one director. A director must be an individual.' });
    }
    const shareholderLimit = companyType === COMPANY_TYPE.exemptPrivate
      ? MAX_EXEMPT_PRIVATE_SHAREHOLDERS
      : PRIVATE_COMPANY_TYPES.includes(companyType) ? MAX_PRIVATE_SHAREHOLDERS : null;
    if (shareholderLimit !== null && shareholderCount > shareholderLimit) {
      add({ code: 'too_many_shareholders', severity: 'error', section: 'parties', fieldKey: K.partyRoles, message: `${companyType === COMPANY_TYPE.exemptPrivate ? 'An exempt private' : 'A private'} company can have at most ${shareholderLimit} shareholders.` });
    }
  }

  const directors = parties.filter(isDirector);
  const secretaries = parties.filter((party) => party.roles.includes(PARTY_ROLE.secretary));
  for (const secretary of secretaries) {
    if (secretary.kind === PARTY_KIND.organisation || secretary.resident) continue;
    add({
      code: 'secretary_not_resident',
      severity: 'error',
      section: 'parties',
      fieldKey: K.partyResident,
      rowIndex: secretary.rowIndex,
      message: `${partyLabel(secretary)}: a company secretary must live in Singapore. Tick “Lives in Singapore”, or remove the role and tick our company secretary service on the next page.`,
    });
  }
  if (directors.length === 1 && secretaries.some((party) => party.rowIndex === directors[0].rowIndex)) {
    add({ code: 'secretary_sole_director', severity: 'error', section: 'parties', fieldKey: K.partyRoles, rowIndex: directors[0].rowIndex, message: `${partyLabel(directors[0])}: the company secretary cannot also be the only director.` });
  }

  const seenNames = new Set<string>();
  for (const party of parties) {
    const normalized = normalizeName(party.name);
    if (!normalized) continue;
    if (seenNames.has(normalized)) {
      add({ code: 'party_duplicate_name', severity: 'error', section: 'parties', fieldKey: K.partyName, rowIndex: party.rowIndex, message: `${party.name} is listed more than once. Add each person once and tick all their roles.` });
    }
    seenNames.add(normalized);
  }

  // --- Capital and services -----------------------------------------------
  const capitalText = textValue(answers[K.capitalAmount]);
  const capitalUnits = parseDecimalString(capitalText);
  if (capitalText) {
    if (capitalUnits === null) {
      add({ code: 'capital_invalid', severity: 'error', section: 'capital', fieldKey: K.capitalAmount, message: 'Enter the share capital as an amount, for example 1000.' });
    } else if (capitalUnits <= BigInt(0)) {
      add({ code: 'capital_not_positive', severity: 'error', section: 'capital', fieldKey: K.capitalAmount, message: 'Share capital must be more than zero.' });
    }
  }

  const shareCountText = textValue(answers[K.shareCount]);
  const shareCount = parseShareCount(answers);
  if (shareCountText && shareCount === null) {
    add({ code: 'share_count_invalid', severity: 'error', section: 'capital', fieldKey: K.shareCount, message: 'Enter the number of shares as a whole number of at least 1.' });
  }
  if (shareCount !== null) {
    const fractional = parties.filter((party) => party.roles.includes(PARTY_ROLE.shareholder) && party.ownershipPercent && parseDecimalString(party.ownershipPercent) !== null && party.shares === null);
    if (fractional.length > 0) {
      add({
        code: 'share_count_fractional',
        severity: 'error',
        section: 'capital',
        fieldKey: K.shareCount,
        message: `With ${shareCount.toString()} shares, ${fractional.map(partyLabel).join(', ')} would hold part of a share. Choose a number of shares that divides evenly, for example 100 or 1,000.`,
      });
    }
  }

  if (choiceValue(answers[K.capitalFullyPaid]) === YES_NO.no) {
    const paidText = textValue(answers[K.capitalPaidAmount]);
    const paidUnits = parseDecimalString(paidText);
    if (paidText && paidUnits === null) {
      add({ code: 'paid_invalid', severity: 'error', section: 'capital', fieldKey: K.capitalPaidAmount, message: 'Enter the amount paid as a number.' });
    } else if (paidUnits !== null && capitalUnits !== null && paidUnits >= capitalUnits) {
      add({ code: 'paid_not_partial', severity: 'error', section: 'capital', fieldKey: K.capitalPaidAmount, message: 'The amount paid must be less than the share capital. Choose Yes if it will be fully paid.' });
    }
  }

  if (parties.length > 0 && directors.length > 0 && !directors.some((party) => party.resident) && !isTicked(answers[K.nomineeDirectorService])) {
    add({
      code: 'no_resident_director',
      severity: 'error',
      section: 'capital',
      fieldKey: K.nomineeDirectorService,
      message: 'None of the directors lives in Singapore. Tick the nominee director service, or go back and tick “Lives in Singapore” for a director who does.',
    });
  }

  if (parties.length > 0 && secretaries.length === 0 && !isTicked(answers[K.secretaryService])) {
    add({
      code: 'no_secretary',
      severity: 'error',
      section: 'capital',
      fieldKey: K.secretaryService,
      message: 'No one is listed as company secretary. Tick the company secretary service, or go back and give a person the Company secretary role.',
    });
  }

  // --- Registered office and other details --------------------------------
  if (choiceValue(answers[K.officeChoice]) === OFFICE_CHOICE.own) {
    const postalCode = textValue(answers[K.officePostalCode]);
    if (postalCode && !/^\d{6}$/.test(postalCode)) {
      add({ code: 'office_postal_code_invalid', severity: 'error', section: 'settings', fieldKey: K.officePostalCode, message: 'Enter a 6-digit Singapore postal code.' });
    }
  }

  const firstFye = textValue(answers[K.firstFye]);
  if (firstFye) {
    if (!isRealIsoDate(firstFye)) {
      add({ code: 'fye_invalid', severity: 'error', section: 'settings', fieldKey: K.firstFye, message: 'Enter a valid first financial year end date.' });
    } else if (firstFye > addMonthsIso(today, 18)) {
      add({ code: 'fye_over_18_months', severity: 'staff_review', section: 'settings', fieldKey: K.firstFye, message: 'The first financial year end is more than 18 months away, so ACRA’s approval may be needed. We will check it with you.' });
    }
  }

  return { issues, parties, ownershipTotal: totalText };
}

export function hasBlockingIncorporationIssue(evaluation: Pick<IncorporationEvaluation, 'issues'>): boolean {
  return evaluation.issues.some((issue) => issue.severity === 'error');
}
