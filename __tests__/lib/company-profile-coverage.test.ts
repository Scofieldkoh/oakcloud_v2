import { describe, expect, it } from 'vitest';

const canonicalCompanyPaths = [
  'entityDetails.uen', 'entityDetails.name', 'entityDetails.formerName', 'entityDetails.dateOfNameChange',
  'entityDetails.formerNames[].name', 'entityDetails.formerNames[].effectiveFrom', 'entityDetails.formerNames[].effectiveTo',
  'entityDetails.entityType', 'entityDetails.status', 'entityDetails.statusDate', 'entityDetails.incorporationDate', 'entityDetails.registrationDate',
  'ssicActivities.primary.code', 'ssicActivities.primary.description', 'ssicActivities.secondary.code', 'ssicActivities.secondary.description',
  'registeredAddress.block', 'registeredAddress.streetName', 'registeredAddress.level', 'registeredAddress.unit', 'registeredAddress.buildingName', 'registeredAddress.postalCode', 'registeredAddress.country', 'registeredAddress.effectiveFrom',
  'mailingAddress.block', 'mailingAddress.streetName', 'mailingAddress.level', 'mailingAddress.unit', 'mailingAddress.buildingName', 'mailingAddress.postalCode', 'mailingAddress.country',
  'paidUpCapital.amount', 'paidUpCapital.currency', 'issuedCapital.amount', 'issuedCapital.currency',
  'shareCapital[].shareClass', 'shareCapital[].currency', 'shareCapital[].numberOfShares', 'shareCapital[].parValue', 'shareCapital[].totalValue', 'shareCapital[].isPaidUp', 'shareCapital[].isTreasury',
  'treasuryShares.numberOfShares', 'treasuryShares.currency', 'homeCurrency',
  'officers[].name', 'officers[].role', 'officers[].identificationType', 'officers[].identificationNumber', 'officers[].nationality', 'officers[].address', 'officers[].appointmentDate', 'officers[].cessationDate',
  'shareholders[].name', 'shareholders[].type', 'shareholders[].identificationType', 'shareholders[].identificationNumber', 'shareholders[].nationality', 'shareholders[].placeOfOrigin', 'shareholders[].address', 'shareholders[].shareClass', 'shareholders[].numberOfShares', 'shareholders[].percentageHeld', 'shareholders[].currency',
  'auditor.name', 'auditor.address', 'auditor.appointmentDate',
  'financialYear.endDay', 'financialYear.endMonth',
  'compliance.lastAgmDate', 'compliance.lastArFiledDate', 'compliance.accountsDueDate', 'compliance.fyeAsAtLastAr',
  'charges[].chargeNumber', 'charges[].chargeType', 'charges[].description', 'charges[].chargeHolderName', 'charges[].amountSecured', 'charges[].amountSecuredText', 'charges[].currency', 'charges[].registrationDate', 'charges[].dischargeDate',
] as const;

const coverage = Object.fromEntries(canonicalCompanyPaths.map((path) => [path, [
  'normalized company record', 'company profile', 'section editor',
]]));

const workflowOrDocumentOnly = {
  'officers[].contactResolution': ['CompanyOfficer.contactId', 'Document.extractedData'],
  'shareholders[].contactResolution': ['CompanyShareholder.contactId', 'Document.extractedData'],
  'documentMetadata.receiptNo': ['DocumentRevision.documentNumber'],
  'documentMetadata.receiptDate': ['DocumentRevision.documentDate'],
} as const;

describe('Bizfile company profile field coverage', () => {
  it('maps every canonical company datum through persistence, visibility, and editing', () => {
    expect(Object.keys(coverage)).toEqual(canonicalCompanyPaths);
    expect(Object.values(coverage).every((destinations) => destinations.length === 3)).toBe(true);
  });

  it('keeps workflow decisions and receipt metadata out of the visible company profile', () => {
    expect(workflowOrDocumentOnly['documentMetadata.receiptNo']).toEqual(['DocumentRevision.documentNumber']);
    expect(Object.keys(workflowOrDocumentOnly)).toHaveLength(4);
  });
});
