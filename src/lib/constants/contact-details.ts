/**
 * Centralized constants for contact details.
 * Used across company contact details modal, contact details section, and related components.
 *
 * To add/edit constants:
 * 1. Modify the appropriate constant below
 * 2. Changes will automatically reflect across all components that import from this file
 */

import { Mail, Phone, Globe, FileText } from 'lucide-react';
import type { ContactDetailType } from '@/generated/prisma';

// ============================================================================
// DETAIL TYPE CONFIGURATION
// ============================================================================

export interface DetailTypeConfig {
  icon: typeof Mail;
  label: string;
  placeholder: string;
}

/**
 * Configuration for each contact detail type.
 * Used for icons, labels, and input placeholders.
 */
export const DETAIL_TYPE_CONFIG: Record<ContactDetailType, DetailTypeConfig> = {
  EMAIL: { icon: Mail, label: 'Email', placeholder: 'email@example.com' },
  PHONE: { icon: Phone, label: 'Phone', placeholder: '+65 1234 5678' },
  WEBSITE: { icon: Globe, label: 'Website', placeholder: 'https://example.com' },
  OTHER: { icon: FileText, label: 'Other', placeholder: 'Enter value' },
};

/**
 * Get configuration for a detail type
 */
export function getDetailTypeConfig(type: ContactDetailType): DetailTypeConfig {
  return DETAIL_TYPE_CONFIG[type];
}

/**
 * Get all detail types as options for select dropdowns
 */
export function getDetailTypeOptions(): Array<{ value: ContactDetailType; label: string }> {
  return (Object.keys(DETAIL_TYPE_CONFIG) as ContactDetailType[]).map((type) => ({
    value: type,
    label: DETAIL_TYPE_CONFIG[type].label,
  }));
}

// ============================================================================
// LABEL SUGGESTIONS
// ============================================================================

/**
 * Common label suggestions for contact details.
 * Used in datalists for autocomplete.
 */
export const LABEL_SUGGESTIONS = [
  'Main Office',
  'Account Receivable',
  'Account Payable',
  'Human Resources',
  'Sales',
  'Support',
  'Personal',
  'Work',
  'Home',
  'Emergency',
] as const;

export type LabelSuggestion = (typeof LABEL_SUGGESTIONS)[number];

// ============================================================================
// RELATIONSHIP OPTIONS
// ============================================================================

/**
 * Relationship options for linking contacts to companies.
 * Used when adding a new contact to a company.
 */
export const RELATIONSHIP_OPTIONS = [
  'Agent',
  'Authorized Representative',
  'Accountant',
  'Lawyer',
  'Consultant',
  'Vendor',
  'Customer',
  'Partner',
  'Other',
] as const;

export type RelationshipOption = (typeof RELATIONSHIP_OPTIONS)[number];

// ============================================================================
// FORM STATE TYPES
// ============================================================================

/**
 * Standard form state for editing contact details.
 * Used across multiple components for consistent form handling.
 */
export interface ContactDetailFormState {
  detailType: ContactDetailType;
  value: string;
  label: string;
  purposes: string[];
  isPrimary: boolean;
  isPoc: boolean;
}

/**
 * Create initial form state with defaults
 */
export function createInitialFormState(
  overrides?: Partial<ContactDetailFormState>
): ContactDetailFormState {
  return {
    detailType: 'EMAIL',
    value: '',
    label: '',
    purposes: [],
    isPrimary: false,
    isPoc: false,
    ...overrides,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get input type based on detail type
 */
export function getInputType(detailType: ContactDetailType): string {
  switch (detailType) {
    case 'EMAIL':
      return 'email';
    case 'WEBSITE':
      return 'url';
    case 'PHONE':
      return 'tel';
    default:
      return 'text';
  }
}
