/** Company values a batch document can fill when missing (see `oakdoc-company-field-homes`). */
export const COMPANY_FIELD_HOME_IDS = [
  'uen',
  'incorporationDate',
  'financialYearEnd',
  'firstFinancialYearEnd',
  'registeredAddress',
  'paidUpCapital',
] as const;

export type CompanyFieldHomeId = typeof COMPANY_FIELD_HOME_IDS[number];

export function isCompanyFieldHomeId(value: string): value is CompanyFieldHomeId {
  return (COMPANY_FIELD_HOME_IDS as readonly string[]).includes(value);
}
