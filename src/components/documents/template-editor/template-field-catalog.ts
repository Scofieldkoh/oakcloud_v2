import { SERVICE_AGREEMENT_SLOTS } from '@/components/documents/template-editor/template-validation';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';

export type TemplateFieldBuilder =
  | 'loop-directors'
  | 'loop-shareholders'
  | 'condition'
  | 'signature-block';

export interface TemplateField {
  key: string;
  label: string;
  example: string;
  category: string;
  builder?: TemplateFieldBuilder;
}

export interface TemplateFieldCategory {
  key: string;
  label: string;
  fields: TemplateField[];
}

export const TEMPLATE_FIELD_CATEGORIES: readonly TemplateFieldCategory[] = [
  { key: 'agreement-blocks', label: 'Agreement blocks', fields: [
    { key: SERVICE_AGREEMENT_SLOTS.serviceSections, label: 'Service sections', example: 'Selected service scopes', category: 'Agreement blocks' },
    { key: SERVICE_AGREEMENT_SLOTS.feeTable, label: 'Fee table', example: 'Entity-specific service fees', category: 'Agreement blocks' },
    { key: SERVICE_AGREEMENT_SLOTS.entityAppendix, label: 'Entity appendix', example: 'Entity details and schedules', category: 'Agreement blocks' },
  ] },
  { key: 'company', label: 'Company', fields: [
    { key: 'company.name', label: 'Company Name', example: 'Sample Company Pte Ltd', category: 'Company' },
    { key: 'company.uen', label: 'UEN', example: '202312345A', category: 'Company' },
    { key: 'company.registeredAddress', label: 'Full Address', example: '123 Sample Street, Singapore 123456', category: 'Company' },
    { key: 'company.address.block', label: 'Block', example: '123', category: 'Company' },
    { key: 'company.address.street', label: 'Street Name', example: 'Sample Street', category: 'Company' },
    { key: 'company.address.level', label: 'Level', example: '01', category: 'Company' },
    { key: 'company.address.unit', label: 'Unit', example: '01', category: 'Company' },
    { key: 'company.address.building', label: 'Building Name', example: 'Sample Building', category: 'Company' },
    { key: 'company.address.postalCode', label: 'Postal Code', example: '123456', category: 'Company' },
    { key: 'company.address.letter', label: 'Company Letter Address', example: 'Sample Building\n123 Sample Street, #01-01\nSingapore  123456', category: 'Company' },
    { key: 'company.incorporationDate', label: 'Incorporation Date', example: '15 January 2023', category: 'Company' },
    { key: 'company.entityType', label: 'Entity Type', example: 'Private Limited Company', category: 'Company' },
    { key: 'company.capital', label: 'Share Capital', example: '$100,000', category: 'Company' },
    { key: 'company.paidUpCapital', label: 'Paid-up Capital', example: 'SGD 10,000.00', category: 'Company' },
    { key: 'company.primaryActivity', label: 'Primary Activity', example: '46900 | Wholesale trade of a variety of goods without a dominant product', category: 'Company' },
    { key: 'company.secondaryActivity', label: 'Secondary Activity', example: '70201 | Management consultancy services', category: 'Company' },
    { key: 'company.financialYearEnd', label: 'Financial Year End', example: '31 December', category: 'Company' },
    { key: 'company.firstFinancialYearEnd', label: 'First Financial Year End', example: '31 December 2026', category: 'Company' },
    { key: 'company.auditorName', label: 'Auditor Name', example: 'Sample & Co. Public Accounting Corporation', category: 'Company' },
    { key: 'company.auditorAddress', label: 'Auditor Address', example: '1 Sample Road, #10-01, Singapore 123456', category: 'Company' },
  ] },
  { key: 'selected-director', label: 'Selected Director', fields: [
    { key: 'selectedDirector.name', label: 'Director Name', example: 'John Tan Wei Ming', category: 'Selected Director' },
    { key: 'selectedDirector.detail', label: 'Director Detail', example: 'Director', category: 'Selected Director' },
    { key: 'selectedDirector.email', label: 'Director Email', example: 'john.tan@example.com', category: 'Selected Director' },
    { key: 'selectedDirector.phone', label: 'Director Phone', example: '+65 6123 4567', category: 'Selected Director' },
    { key: 'selectedDirector.address.full', label: 'Director Full Address', example: '456 Director Road, Singapore 456789', category: 'Selected Director' },
    { key: 'selectedDirector.address.letter', label: 'Director Letter Address', example: '456 Director Road\nSingapore  456789', category: 'Selected Director' },
    { key: 'selectedDirector.nationality', label: 'Director Nationality', example: 'Singaporean', category: 'Selected Director' },
    { key: 'selectedDirector.identificationNumber', label: 'Director Identification Number', example: 'S1234567A', category: 'Selected Director' },
    { key: 'selectedDirector.role', label: 'Director Role', example: 'Director', category: 'Selected Director' },
    { key: 'selectedDirector.appointmentDate', label: 'Director Appointment Date', example: '15 January 2023', category: 'Selected Director' },
  ] },
  { key: 'selected-shareholder', label: 'Selected Shareholder', fields: [
    { key: 'selectedShareholder.name', label: 'Shareholder Name', example: 'Mary Lee Mei Ling', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.detail', label: 'Shareholder Detail', example: 'Ordinary shareholder', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.email', label: 'Shareholder Email', example: 'mary.lee@example.com', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.phone', label: 'Shareholder Phone', example: '+65 6987 6543', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.address.full', label: 'Shareholder Full Address', example: '789 Shareholder Lane, Singapore 789012', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.address.letter', label: 'Shareholder Letter Address', example: '789 Shareholder Lane\nSingapore  789012', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.nationality', label: 'Shareholder Nationality', example: 'Singaporean', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.identificationNumber', label: 'Shareholder Identification Number', example: 'S7654321B', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.shareholderType', label: 'Shareholder Type', example: 'Individual', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.shareClass', label: 'Share Class', example: 'Ordinary', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.numberOfShares', label: 'Number of Shares', example: '50,000', category: 'Selected Shareholder' },
    { key: 'selectedShareholder.percentageHeld', label: 'Percentage Held', example: '50%', category: 'Selected Shareholder' },
  ] },
  { key: 'selected-contact', label: 'Selected Contact', fields: [
    { key: 'selectedContact.name', label: 'Contact Name', example: 'Alex Lim', category: 'Selected Contact' },
    { key: 'selectedContact.detail', label: 'Contact Detail', example: 'Company representative', category: 'Selected Contact' },
    { key: 'selectedContact.email', label: 'Contact Email', example: 'alex.lim@example.com', category: 'Selected Contact' },
    { key: 'selectedContact.phone', label: 'Contact Phone', example: '+65 6777 8899', category: 'Selected Contact' },
    { key: 'selectedContact.address.full', label: 'Contact Full Address', example: '321 Contact Avenue, Singapore 321654', category: 'Selected Contact' },
    { key: 'selectedContact.address.letter', label: 'Contact Letter Address', example: '321 Contact Avenue\nSingapore  321654', category: 'Selected Contact' },
    { key: 'selectedContact.nationality', label: 'Contact Nationality', example: 'Singaporean', category: 'Selected Contact' },
    { key: 'selectedContact.identificationNumber', label: 'Contact Identification Number', example: 'S2468135C', category: 'Selected Contact' },
    { key: 'selectedContact.contactType', label: 'Contact Type', example: 'Individual', category: 'Selected Contact' },
  ] },
  { key: 'loops', label: 'Loops', fields: [
    { key: 'directors', label: 'Directors loop', example: 'Repeat content for every director', category: 'Loops', builder: 'loop-directors' },
    { key: 'shareholders', label: 'Shareholders loop', example: 'Repeat content for every shareholder', category: 'Loops', builder: 'loop-shareholders' },
  ] },
  { key: 'conditions', label: 'Conditions', fields: [
    { key: 'condition', label: 'Conditional block', example: 'Show content when a field matches', category: 'Conditions', builder: 'condition' },
  ] },
  { key: 'signatures', label: 'Signature blocks', fields: [
    { key: 'signature-block', label: 'Signer signature block', example: 'Sign on behalf of client with name, designation and date for each signer', category: 'Signature blocks', builder: 'signature-block' },
  ] },
  { key: 'system', label: 'System', fields: [
    { key: 'system.currentDate', label: 'Current Date', example: '6 December 2024', category: 'System' },
    { key: 'system.generatedBy', label: 'Generated By', example: 'John Doe', category: 'System' },
    { key: 'system.preparerName', label: 'Preparer Name', example: 'John Doe', category: 'System' },
  ] },
  { key: 'modifiers', label: 'Modifiers', fields: [
    { key: 'UCASE({{field}})', label: 'Uppercase', example: 'SAMPLE COMPANY PTE LTD', category: 'Modifiers' },
    { key: 'LCASE({{field}})', label: 'Lowercase', example: 'sample company pte ltd', category: 'Modifiers' },
    { key: 'PCASE({{field}})', label: 'Proper Case', example: 'Sample Company Pte Ltd', category: 'Modifiers' },
    { key: 'DESIGNATION({{field}})', label: 'Designation Case', example: 'Director / CEO', category: 'Modifiers' },
  ] },
];

export function standardTemplateKeys(): ReadonlySet<string> {
  return new Set(
    TEMPLATE_FIELD_CATEGORIES.flatMap((category) => category.fields)
      .filter(
        (field) =>
          !field.builder &&
          !field.key.includes('{{') &&
          !field.key.startsWith('@'),
      )
      .map((field) => field.key),
  );
}

export function inferLegacyCustomPlaceholders(
  content: string,
  existing: CustomPlaceholderDefinition[],
): CustomPlaceholderDefinition[] {
  const existingKeys = new Set(existing.map((field) => field.key));
  const missingKeys = new Set<string>();
  const tokenPattern = /\{\{\s*custom\.([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(content)) !== null) {
    const key = match[1];
    if (!existingKeys.has(key) && !missingKeys.has(key)) {
      missingKeys.add(key);
    }
  }

  const inferred: CustomPlaceholderDefinition[] = Array.from(missingKeys).map(
    (key) => ({
      id: `legacy-custom-${key}`,
      key,
      label: key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' '),
      type: 'text',
      required: false,
      description: 'Recovered from existing template content.',
    }),
  );

  return [...existing, ...inferred];
}
