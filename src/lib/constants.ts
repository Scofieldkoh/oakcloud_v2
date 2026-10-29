/**
 * Centralized Constants
 *
 * This file contains all application constants and enum definitions.
 * Keep enums synced with Prisma schema (prisma/schema.prisma).
 *
 * Usage:
 *   import { OFFICER_ROLES, SHAREHOLDER_TYPES, IDENTIFICATION_TYPES } from '@/lib/constants';
 *
 *   // Get all roles for dropdown
 *   OFFICER_ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)
 *
 *   // Get label for a value
 *   getOfficerRoleLabel('DIRECTOR') // returns 'Director'
 */

/** Convert an enum-style value into a readable title-cased label. */
function titleCaseEnum(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// =============================================================================
// Officer Roles (sync with OfficerRole enum in schema.prisma)
// =============================================================================

export const OFFICER_ROLES = [
  { value: 'DIRECTOR', label: 'Director' },
  { value: 'MANAGING_DIRECTOR', label: 'Managing Director' },
  { value: 'ALTERNATE_DIRECTOR', label: 'Alternate Director' },
  { value: 'NOMINEE_DIRECTOR', label: 'Nominee Director' },
  { value: 'SECRETARY', label: 'Secretary' },
  { value: 'CEO', label: 'CEO' },
  { value: 'CFO', label: 'CFO' },
  { value: 'AUDITOR', label: 'Auditor' },
  { value: 'LIQUIDATOR', label: 'Liquidator' },
  { value: 'RECEIVER', label: 'Receiver' },
  { value: 'JUDICIAL_MANAGER', label: 'Judicial Manager' },
] as const;

export type OfficerRoleValue = (typeof OFFICER_ROLES)[number]['value'];

/** Get display label for an officer role */
export function getOfficerRoleLabel(value: string): string {
  const role = OFFICER_ROLES.find((r) => r.value === value);
  return role?.label || titleCaseEnum(value);
}

// =============================================================================
// Shareholder Types (sync with ShareholderType enum in schema.prisma)
// =============================================================================

export const SHAREHOLDER_TYPES = [
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'CORPORATE', label: 'Corporate' },
] as const;

export type ShareholderTypeValue = (typeof SHAREHOLDER_TYPES)[number]['value'];

/** Get display label for a shareholder type */
export function getShareholderTypeLabel(value: string): string {
  const type = SHAREHOLDER_TYPES.find((t) => t.value === value);
  return type?.label || titleCaseEnum(value);
}

// =============================================================================
// Identification Types (sync with IdentificationType enum in schema.prisma)
// =============================================================================

export const IDENTIFICATION_TYPES = [
  { value: 'NRIC', label: 'NRIC' },
  { value: 'FIN', label: 'FIN' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'UEN', label: 'UEN' },
  { value: 'OTHER', label: 'Other' },
] as const;

export type IdentificationTypeValue = (typeof IDENTIFICATION_TYPES)[number]['value'];

/** Get display label for an identification type */
export function getIdentificationTypeLabel(value: string): string {
  const type = IDENTIFICATION_TYPES.find((t) => t.value === value);
  return type?.label || titleCaseEnum(value);
}

// =============================================================================
// Contact Types (sync with ContactType enum in schema.prisma)
// =============================================================================

export const CONTACT_TYPES = [
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'CORPORATE', label: 'Corporate' },
] as const;

export type ContactTypeValue = (typeof CONTACT_TYPES)[number]['value'];

/** Get display label for a contact type */
export function getContactTypeLabel(value: string): string {
  const type = CONTACT_TYPES.find((t) => t.value === value);
  return type?.label || titleCaseEnum(value);
}

// =============================================================================
// Company Status (sync with CompanyStatus enum in schema.prisma)
// =============================================================================

export const COMPANY_STATUSES = [
  { value: 'LIVE', label: 'Live' },
  { value: 'STRUCK_OFF', label: 'Struck Off' },
  { value: 'WINDING_UP', label: 'Winding Up' },
  { value: 'DISSOLVED', label: 'Dissolved' },
  { value: 'IN_LIQUIDATION', label: 'In Liquidation' },
  { value: 'IN_RECEIVERSHIP', label: 'In Receivership' },
  { value: 'AMALGAMATED', label: 'Amalgamated' },
  { value: 'CONVERTED', label: 'Converted' },
  { value: 'OTHER', label: 'Other' },
] as const;

export type CompanyStatusValue = (typeof COMPANY_STATUSES)[number]['value'];

/** Get display label for a company status */
export function getCompanyStatusLabel(value: string): string {
  const status = COMPANY_STATUSES.find((s) => s.value === value);
  return status?.label || titleCaseEnum(value);
}

// =============================================================================
// Entity Types (sync with EntityType enum in schema.prisma)
// =============================================================================

export const ENTITY_TYPES = [
  { value: 'PRIVATE_LIMITED', label: 'Private Limited', shortLabel: 'Private Limited' },
  { value: 'EXEMPTED_PRIVATE_LIMITED', label: 'Exempted Private Limited Company', shortLabel: 'Exempted Private Limited' },
  { value: 'PUBLIC_LIMITED', label: 'Public Limited Company', shortLabel: 'Public Limited' },
  { value: 'PUBLIC_COMPANY_LIMITED_BY_GUARANTEE', label: 'Public Company Limited by Guarantee', shortLabel: 'Public Limited by Guarantee' },
  { value: 'SOLE_PROPRIETORSHIP', label: 'Sole Proprietorship', shortLabel: 'Sole Prop.' },
  { value: 'PARTNERSHIP', label: 'Partnership', shortLabel: 'Partnership' },
  { value: 'LIMITED_PARTNERSHIP', label: 'Limited Partnership', shortLabel: 'LP' },
  { value: 'LIMITED_LIABILITY_PARTNERSHIP', label: 'Limited Liability Partnership', shortLabel: 'LLP' },
  { value: 'FOREIGN_COMPANY', label: 'Foreign Company', shortLabel: 'Foreign' },
  { value: 'VARIABLE_CAPITAL_COMPANY', label: 'Variable Capital Company', shortLabel: 'VCC' },
  { value: 'OTHER', label: 'Other', shortLabel: 'Other' },
] as const;

export type EntityTypeValue = (typeof ENTITY_TYPES)[number]['value'];

/** Get display label for an entity type */
export function getEntityTypeLabel(value: string, short = false): string {
  const type = ENTITY_TYPES.find((t) => t.value === value);
  if (!type) return titleCaseEnum(value);
  return short ? type.shortLabel : type.label;
}

// =============================================================================
// Share Classes (common share classes, not an enum in Prisma)
// =============================================================================

export const SHARE_CLASSES = [
  { value: 'ORDINARY', label: 'Ordinary' },
  { value: 'PREFERENCE', label: 'Preference' },
  { value: 'REDEEMABLE', label: 'Redeemable' },
  { value: 'MANAGEMENT', label: 'Management' },
] as const;

export type ShareClassValue = (typeof SHARE_CLASSES)[number]['value'];

/** Get display label for a share class */
export function getShareClassLabel(value: string): string {
  const shareClass = SHARE_CLASSES.find((s) => s.value === value);
  return shareClass?.label || titleCaseEnum(value);
}
