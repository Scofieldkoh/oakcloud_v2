import type {
  BillingFrequency,
  ServiceCadence,
} from '@/lib/validations/service-catalog';
import type { PlaceholderDefinition } from '@/types/placeholders';

export interface ServiceAgreementFeeLineInput {
  id?: string;
  clientKey: string;
  companyId: string;
  description: string;
  amount: string;
  currency: string;
  billingFrequency: BillingFrequency;
  customFrequencyLabel?: string | null;
  billingStartDate?: string | null;
  /** UI state: true when billingStartDate was explicitly entered by the user. */
  billingStartDateOverridden?: boolean;
  displayOrder: number;
}

export interface ServiceAgreementItemInput {
  id?: string;
  clientKey: string;
  variantId: string;
  entityIds: string[];
  startDate: string;
  /** UI state: true when startDate no longer follows the agreement date. */
  startDateOverridden?: boolean;
  endDate?: string | null;
  fieldValues: Record<string, string>;
  displayOrder: number;
  feeLines: ServiceAgreementFeeLineInput[];
}

export interface ServiceAgreementDraftInput {
  primaryCompanyId: string;
  authorizedContactIds: string[];
  authorizedRepresentativeRoles?: Record<string, string>;
  signerContactIds: string[];
  entityIds: string[];
  agreementDate: string;
  effectiveDate?: string | null;
  termMonths: number;
  items: ServiceAgreementItemInput[];
}

export interface ServiceAgreementEntityDto {
  id: string;
  companyId: string;
  nameSnapshot: string;
  uenSnapshot: string;
  displayOrder: number;
}

export interface ServiceAgreementFeeLineDto
  extends Omit<ServiceAgreementFeeLineInput, 'companyId' | 'clientKey'> {
  id: string;
  agreementEntityId: string;
  companyId: string;
  billingStartDate: string;
}

export interface ServiceAgreementItemDto
  extends Omit<ServiceAgreementItemInput, 'clientKey' | 'variantId' | 'entityIds' | 'feeLines'> {
  id: string;
  serviceVariantId: string;
  variantVersion: number;
  familyNameSnapshot: string;
  variantNameSnapshot: string;
  serviceCadence: ServiceCadence;
  customCadenceLabel: string | null;
  sowPartialId: string;
  partialVersion: number;
  partialContentSnapshot: string;
  partialPlaceholdersSnapshot: PlaceholderDefinition[];
  partialDependencySnapshot: Array<{
    id: string;
    name: string;
    version: number;
    updatedAt: string;
  }>;
  entityIds: string[];
  feeLines: ServiceAgreementFeeLineDto[];
  staleVariantVersion: boolean;
  stalePartialVersion: boolean;
}

export interface AuthorizedRepresentativeSnapshot {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

export interface ServiceAgreementDraftDto {
  id: string;
  generatedDocumentId: string;
  primaryCompanyId: string;
  authorizedContactIds: string[];
  signerContactIds: string[];
  authorizedRepresentativeSnapshots: AuthorizedRepresentativeSnapshot[];
  agreementDate: string;
  effectiveDate: string | null;
  termMonths: number;
  status: 'DRAFT' | 'EFFECTIVE' | 'CANCELLED';
  entities: ServiceAgreementEntityDto[];
  items: ServiceAgreementItemDto[];
  createdAt: string;
  updatedAt: string;
}
