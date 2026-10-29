/**
 * Filing status choices for company obligations. Kept free of server imports
 * so client components can use them.
 */

export const COMPANY_OBLIGATION_STATUSES = [
  'TO_BE_CONFIRMED',
  'PENDING_FILING',
  'FILED',
  'MANAGED_EXTERNALLY',
  'NOT_REQUIRED',
] as const;

export type CompanyObligationStatus = typeof COMPANY_OBLIGATION_STATUSES[number];

export const COMPANY_OBLIGATION_STATUS_LABELS: Record<CompanyObligationStatus, string> = {
  TO_BE_CONFIRMED: 'To be confirmed',
  PENDING_FILING: 'Pending filing',
  FILED: 'Filed',
  MANAGED_EXTERNALLY: 'Managed externally',
  NOT_REQUIRED: 'Not required',
};

export function isCompanyObligationStatus(value: unknown): value is CompanyObligationStatus {
  return typeof value === 'string' && (COMPANY_OBLIGATION_STATUSES as readonly string[]).includes(value);
}

/** The status a stored company occurrence reads as. */
export function companyObligationStatusOf(occurrence: {
  status: string;
  filingResponsibility: string | null;
}): CompanyObligationStatus {
  if (occurrence.status === 'COMPLETED') return 'FILED';
  if (occurrence.status === 'WAIVED') return 'NOT_REQUIRED';
  if (occurrence.filingResponsibility === 'EXTERNAL_PROVIDER' || occurrence.filingResponsibility === 'CLIENT') {
    return 'MANAGED_EXTERNALLY';
  }
  if (occurrence.filingResponsibility === 'OAKCLOUD') return 'PENDING_FILING';
  return 'TO_BE_CONFIRMED';
}
