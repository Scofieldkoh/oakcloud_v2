/**
 * Placeholder Types
 *
 * Centralized type definitions for document template placeholders.
 * These types are used across:
 * - Template editor (admin/template-partials/editor/page.tsx)
 * - Document generation wizard (document-generation-wizard.tsx)
 * - Document validation service (document-validation.service.ts)
 * - Placeholder resolver (placeholder-resolver.ts)
 */

import type { DocumentParty } from '@/lib/document-party';

export type PlaceholderValueType =
  | 'text'
  | 'date'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'textarea';

export type PlaceholderOwnerScope = {
  kind: 'template' | 'partial';
  id: string;
  label?: string;
};

export type PlaceholderSource =
  | 'company'
  | 'contact'
  | 'officer'
  | 'shareholder'
  | 'service'
  | 'custom'
  | 'system';

export interface CustomPlaceholderDefinition {
  id: string;
  key: string;
  label: string;
  type: PlaceholderValueType;
  /** Exact stored type; unsupported legacy values are preserve-only. */
  storedType?: string;
  /** Durable identity derived from stable owner scope and persisted ID/key. */
  fieldIdentity?: string;
  ownerScope?: PlaceholderOwnerScope;
  storagePersistedId?: string;
  preserveOnly?: boolean;
  required: boolean;
  /** False authoring default stays distinct from an omitted stored property. */
  storageRequiredWasExplicit?: boolean;
  defaultValue?: string;
  description?: string;
  linkedTo?: string;
  sourcePartial?: string;
  storageSource?: PlaceholderSource;
  /** Exact stored source string, including unknown forward-compatible values. */
  storageRawSource?: string;
  storagePath?: string;
  storageCategory?: string;
  /** Complete original definition, including unknown forward metadata. */
  storageDefinition?: Record<string, unknown>;
}

export interface PlaceholderDefinition {
  key: string;
  required?: boolean;
  minItems?: number;
  maxItems?: number;
  linkedTo?: string;
  sourcePartial?: string;
}

export interface MergedPlaceholder extends CustomPlaceholderDefinition {
  source: 'template' | 'partial';
  sourceName?: string;
  sourceDisplayName?: string;
}

export interface PlaceholderRequirement {
  key: string;
  source: PlaceholderSource;
  required: boolean;
  minItems?: number;
  maxItems?: number;
  linkedTo?: string;
}

export interface AddressData {
  block: string;
  street: string;
  level: string;
  unit: string;
  building: string;
  postalCode: string;
  letter?: string;
}

export interface MockCompanyData {
  name: string;
  uen: string;
  registeredAddress: string;
  address: AddressData;
  incorporationDate: Date;
  entityType: string;
  capital: number;
}

export interface MockDirectorData {
  name: string;
  identificationNumber: string;
  nationality: string;
  role: string;
  address: string;
}

export interface MockShareholderData {
  name: string;
  shareClass: string;
  numberOfShares: number;
  percentageHeld: number;
  identificationNumber: string;
  nationality: string;
}

export type CustomData = Record<string, string | number | Date | undefined>;

export interface SystemData {
  currentDate: Date;
  generatedBy: string;
  preparerName?: string;
  tenantName?: string;
}

export interface MockDataValues {
  company: MockCompanyData;
  directors: MockDirectorData[];
  shareholders: MockShareholderData[];
  selectedDirector?: DocumentParty;
  selectedShareholder?: DocumentParty;
  selectedContact?: DocumentParty;
  custom: CustomData;
  system: SystemData;
}

export interface TemplatePartialData {
  id: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  content?: string;
  placeholders?: unknown;
}

// Resolver data types remain exported from @/lib/placeholder-resolver.ts.
