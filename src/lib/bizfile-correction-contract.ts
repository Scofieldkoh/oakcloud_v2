export const BIZFILE_CORRECTION_FINDING_CODES = [
  'SELECTED_FIELD_MISMATCH',
  'PERSISTED_FIELD_MISSING',
  'APPROVED_FIELD_MISMATCH',
] as const;

export const BIZFILE_CORRECTION_MAX_ITEMS = 20;

/**
 * Factual review paths that have a deterministic scalar or one-to-one target
 * in the canonical BizFile writer. Collection rows stay excluded until an
 * identity-aware correction contract exists.
 */
export const BIZFILE_CORRECTION_SOURCE_PATHS = {
  'entityDetails.name': 'entityDetails.name',
  'entityDetails.displayAlias': 'entityDetails.displayAlias',
  'entityDetails.formerName': 'entityDetails.formerName',
  'entityDetails.dateOfNameChange': 'entityDetails.dateOfNameChange',
  'entityDetails.entityType': 'entityDetails.entityType',
  'entityDetails.status': 'entityDetails.status',
  'entityDetails.statusDate': 'entityDetails.statusDate',
  'entityDetails.incorporationDate': 'entityDetails.incorporationDate',
  'entityDetails.registrationDate': 'entityDetails.registrationDate',
  'ssicActivities.primary.code': 'ssicActivities.primary.code',
  'ssicActivities.primary.description': 'ssicActivities.primary.description',
  'ssicActivities.secondary.code': 'ssicActivities.secondary.code',
  'ssicActivities.secondary.description': 'ssicActivities.secondary.description',
  'financialYear.endDay': 'financialYear.endDay',
  'financialYear.endMonth': 'financialYear.endMonth',
  'compliance.lastAgmDate': 'compliance.lastAgmDate',
  'compliance.lastArFiledDate': 'compliance.lastArFiledDate',
  'compliance.accountsDueDate': 'compliance.accountsDueDate',
  'compliance.fyeAsAtLastAr': 'compliance.fyeAsAtLastAr',
  homeCurrency: 'homeCurrency',
  paidUpCapital: 'paidUpCapital',
  issuedCapital: 'issuedCapital',
  'addresses.registered': 'registeredAddress',
  'addresses.mailing': 'mailingAddress',
  auditor: 'auditor',
  treasuryShares: 'treasuryShares',
} as const satisfies Readonly<Record<string, string>>;
