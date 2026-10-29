/**
 * Centralized automation purposes for contact details.
 * Used for tagging email addresses with their intended automation use.
 *
 * To add/edit purposes:
 * 1. Add/modify entries in the AUTOMATION_PURPOSES array
 * 2. The changes will automatically reflect across:
 *    - Company Contact Details modal
 *    - Contact page (contact details section)
 *    - Export functionality
 */

export interface AutomationPurpose {
  /** Unique identifier stored in database */
  value: string;
  /** Display label shown in UI */
  label: string;
  /** Tooltip description explaining the purpose */
  description: string;
}

/**
 * Available automation purposes for email contact details.
 * These define which automated communications an email address should receive.
 */
export const AUTOMATION_PURPOSES: AutomationPurpose[] = [
  {
    value: 'FINANCE',
    label: 'Finance matters',
    description: 'Finance-related communications (invoices, statements, receipts, etc.)',
  },
  {
    value: 'HR',
    label: 'HR matters',
    description: 'HR-related communications (payroll, leave, employment matters, etc.)',
  },
] as const;

/**
 * Get automation purpose by value
 */
export function getAutomationPurpose(value: string): AutomationPurpose | undefined {
  return AUTOMATION_PURPOSES.find((p) => p.value === value);
}

/**
 * Get automation purpose label by value
 */
export function getAutomationPurposeLabel(value: string): string {
  return getAutomationPurpose(value)?.label ?? value;
}

/**
 * Validate that all provided purpose values are valid
 */
export function validatePurposes(purposes: string[]): boolean {
  const validValues = new Set(AUTOMATION_PURPOSES.map((p) => p.value));
  return purposes.every((p) => validValues.has(p));
}
