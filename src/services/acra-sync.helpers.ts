/**
 * ACRA dataset CSV row mapping and entity filtering helpers
 *
 * The data.gov.sg "ACRA Information on Corporate Entities" CSVs contain
 * entities of every type and status. We only keep potential name conflicts:
 * local and foreign companies whose status is not a "dead" one (struck off,
 * deregistered, dissolved, amalgamated).
 */

const MAX_UEN_LENGTH = 32;
const MAX_NAME_LENGTH = 500;
const MAX_STATUS_LENGTH = 200;
const MAX_TYPE_LENGTH = 100;
const MAX_CONSTITUTION_LENGTH = 500;
const MAX_DATE_LENGTH = 50;
const MAX_ADDRESS_PART_LENGTH = 500;
const MAX_CODE_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_COUNT_LENGTH = 20;
const MAX_ADDRESS_LENGTH = 1000;

/** Entity types that can block a proposed company name. */
export const ALLOWED_ENTITY_TYPES = new Set<string>([
  'local company',
  'foreign company',
]);

// Entities with these statuses no longer exist and cannot block a name.
const DEAD_STATUS_PATTERN = /struck off|deregistered|dissolved|amalgamated/;

export interface MappedAcraRow {
  uen: string;
  entityName: string;
  entityStatus: string;
  entityType: string;
  companyTypeDescription: string;
  registrationIncorporateDate: string;
  block: string;
  streetName: string;
  levelNo: string;
  unitNo: string;
  buildingName: string;
  postalCode: string;
  /** Derived from the address parts, e.g. "123 MAIN STREET ACME BUILDING #05-01 SINGAPORE 123456". */
  address: string;
  accountDueDate: string;
  annualReturnDate: string;
  primarySsicCode: string;
  primarySsicDescription: string;
  secondarySsicCode: string;
  secondarySsicDescription: string;
  noOfOfficers: string;
  formerEntityName1: string;
  uenOfAuditFirm1: string;
}

/**
 * Check whether an entity status means the entity no longer exists.
 */
export function isDeadEntityStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return !normalized || normalized === 'na' || DEAD_STATUS_PATTERN.test(normalized);
}

/**
 * Check whether an entity type is one we store (local/foreign companies).
 */
export function isAllowedEntityType(type: string): boolean {
  return ALLOWED_ENTITY_TYPES.has(type.trim().toLowerCase());
}

function trimmed(value: string | undefined, maxLength: number): string {
  return (value ?? '').trim().slice(0, maxLength);
}

/**
 * Normalize a CSV date (DD/MM/YYYY) to ISO (YYYY-MM-DD) so values sort and
 * filter chronologically. Non-date values are returned as-is.
 */
export function normalizeCsvDate(value: string): string {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return value.trim();
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Derive a displayable address from the ACRA address parts.
 *
 * Format: `{block} {street} {building} #{level}-{unit} SINGAPORE {postal}`
 * with the empty parts skipped.
 */
export function deriveAddress(parts: {
  block: string;
  streetName: string;
  buildingName: string;
  levelNo: string;
  unitNo: string;
  postalCode: string;
}): string {
  const segments: string[] = [];

  const blockAndStreet = [parts.block, parts.streetName].filter(Boolean).join(' ');
  if (blockAndStreet) segments.push(blockAndStreet);
  if (parts.buildingName) segments.push(parts.buildingName);

  if (parts.levelNo || parts.unitNo) {
    segments.push(`#${parts.levelNo}${parts.unitNo ? `-${parts.unitNo}` : ''}`);
  }

  if (segments.length === 0) return '';

  segments.push('SINGAPORE');
  if (parts.postalCode) segments.push(parts.postalCode);

  return segments.join(' ');
}

/**
 * Map one fast-csv object row (headers: true) to a storeable entity row.
 *
 * Returns null for rows that are missing identifiers or that are filtered
 * out (non-allowed entity types, dead statuses).
 */
export function mapCsvRow(row: Record<string, string>): MappedAcraRow | null {
  if (!row || typeof row !== 'object') return null;

  const uen = trimmed(row.uen, MAX_UEN_LENGTH);
  const entityName = trimmed(row.entity_name, MAX_NAME_LENGTH);
  const entityStatus = trimmed(row.entity_status_description, MAX_STATUS_LENGTH);
  const entityType = trimmed(row.entity_type_description, MAX_TYPE_LENGTH);

  if (!uen || !entityName) return null;
  if (!isAllowedEntityType(entityType)) return null;
  if (isDeadEntityStatus(entityStatus)) return null;

  const block = trimmed(row.block, MAX_CODE_LENGTH);
  const streetName = trimmed(row.street_name, MAX_ADDRESS_PART_LENGTH);
  const levelNo = trimmed(row.level_no, MAX_CODE_LENGTH);
  const unitNo = trimmed(row.unit_no, MAX_CODE_LENGTH);
  const buildingName = trimmed(row.building_name, MAX_ADDRESS_PART_LENGTH);
  const postalCode = trimmed(row.postal_code, MAX_CODE_LENGTH);

  return {
    uen,
    entityName,
    entityStatus,
    entityType,
    companyTypeDescription: trimmed(
      row.company_type_description,
      MAX_CONSTITUTION_LENGTH
    ),
    registrationIncorporateDate: normalizeCsvDate(
      trimmed(row.registration_incorporate_date, MAX_DATE_LENGTH)
    ),
    block,
    streetName,
    levelNo,
    unitNo,
    buildingName,
    postalCode,
    address: trimmed(
      deriveAddress({ block, streetName, buildingName, levelNo, unitNo, postalCode }),
      MAX_ADDRESS_LENGTH
    ),
    accountDueDate: normalizeCsvDate(trimmed(row.account_due_date, MAX_DATE_LENGTH)),
    annualReturnDate: normalizeCsvDate(trimmed(row.annual_return_date, MAX_DATE_LENGTH)),
    primarySsicCode: trimmed(row.primary_ssic_code, MAX_CODE_LENGTH),
    primarySsicDescription: trimmed(row.primary_ssic_description, MAX_DESCRIPTION_LENGTH),
    secondarySsicCode: trimmed(row.secondary_ssic_code, MAX_CODE_LENGTH),
    secondarySsicDescription: trimmed(row.secondary_ssic_description, MAX_DESCRIPTION_LENGTH),
    noOfOfficers: trimmed(row.no_of_officers, MAX_COUNT_LENGTH),
    formerEntityName1: trimmed(row.former_entity_name1, MAX_NAME_LENGTH),
    uenOfAuditFirm1: trimmed(row.uen_of_audit_firm1, MAX_UEN_LENGTH),
  };
}
