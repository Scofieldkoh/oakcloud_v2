import type { BillingTiming, PostpaidTrigger } from '@/services/billing/postpaid-triggers';
import type { TieredPricing } from '@/services/billing/tiered-pricing';
import type { BillingFrequency, ClientServiceSource, ClientServiceStatus, ServiceAgreementActivationStatus, ServiceAgreementStatus, ServiceCadence } from '@/generated/prisma';
import type { ClientServiceDeadlineRuleInput } from '@/lib/validations/client-service';
import type { ScheduleEntryInput } from '@/lib/validations/service-schedule';
import type { BillingScheduleConfigV1 } from '@/services/billing/types';
import type { DateOnly } from '@/services/service-schedule';
import type { DeadlineMaterializationPolicy } from '@/services/schedule-reconciliation';

export type ClientServiceProjectedDeadlineDto = {
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  materializationPolicy: DeadlineMaterializationPolicy;
  periodKey: string;
  milestoneKey: string;
  milestoneName: string;
  scheduleEntryKey: string;
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  calculatedDueDate: DateOnly;
  explanation: string[];
};

export interface ClientServiceOpenDeadlineOccurrenceDto {
  id: string;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  periodKey: string;
  milestoneKey: string;
  milestoneName: string;
  scheduleEntryKey: string;
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  calculatedDueDate: DateOnly;
  operativeDueDate: DateOnly;
  origin: 'RULE' | 'MANUAL_TRIGGER';
  notes: string | null;
}

export interface AgreementSummary {
  title: string;
  status: ServiceAgreementStatus;
  activationStatus: ServiceAgreementActivationStatus;
  generatedDocumentId: string;
  href: string;
}

export interface DuplicateClientServiceSummary {
  id: string;
  serviceName: string;
  startDate: string;
  status: ClientServiceStatus;
  source: ClientServiceSource;
}

export interface DuplicateClientServiceMatches {
  total: number;
  items: DuplicateClientServiceSummary[];
}

export type ManualClientServiceCatalogFieldType = 'text' | 'date' | 'number' | 'currency' | 'boolean' | 'textarea';

export interface ManualClientServiceCatalogField {
  key: string;
  label: string;
  type: ManualClientServiceCatalogFieldType;
  defaultValue: string | null;
}

export interface ManualClientServiceCatalogFeeTemplate {
  description: string;
  defaultAmount: string | null;
  currency: string;
  billingFrequency: BillingFrequency;
  customFrequencyLabel: string | null;
  billingTiming: BillingTiming;
  postpaidTrigger: PostpaidTrigger | null;
  /** Postpaid only: quantity tiers; null for a fixed amount. */
  tieredPricing?: TieredPricing | null;
  displayOrder: number;
}

export interface ManualClientServiceCatalogVariantOption {
  id: string;
  name: string;
  family: { id: string; name: string; displayColor: string };
  serviceCadence: ServiceCadence;
  customCadenceLabel: string | null;
  /** Company statutory monitoring this service starts once saved. */
  monitoringProfiles?: Array<'CORPORATE_TAX' | 'CORPORATE_SECRETARIAL' | 'NOMINEE_DIRECTOR'>;
  fields: ManualClientServiceCatalogField[];
  feeTemplates: ManualClientServiceCatalogFeeTemplate[];
  deadlineRules: ManualClientServiceCatalogDeadlineRule[];
}

export interface ManualClientServiceCatalogParameterDefinition {
  key: string;
  label: string;
  description: string | null;
  type: 'DATE' | 'INTEGER' | 'DECIMAL' | 'STRING' | 'BOOLEAN' | 'ENUM';
  required: boolean;
  defaultValue: unknown;
  validation: unknown;
  helpText: string | null;
  displayOrder: number;
}

export interface ManualClientServiceCatalogDeadlineRule {
  ruleId: string;
  code: string;
  name: string;
  enabledByDefault: boolean;
  parameterDefaults: Record<string, unknown>;
  scheduleDefaults: ScheduleEntryInput[];
  parameters: ManualClientServiceCatalogParameterDefinition[];
  currentVersionId: string;
}

export interface CompanyComplianceContext {
  id: string;
  name?: string | null;
  uen?: string | null;
  accountsDueDate?: string | null;
  financialYearEndDay?: number | null;
  financialYearEndMonth?: number | null;
  incorporationDate?: string | null;
}

export interface ManualClientServiceCatalogOptionsResponse {
  variants: ManualClientServiceCatalogVariantOption[];
  companyContext?: CompanyComplianceContext | null;
}

export interface ClientServiceFeeLineDto {
  id: string;
  description: string;
  amount: string;
  currency: string;
  billingFrequency: BillingFrequency;
  customFrequencyLabel: string | null;
  billingStartDate: string | null;
  scheduleConfig: BillingScheduleConfigV1 | null;
  billingTiming: BillingTiming;
  postpaidTrigger: PostpaidTrigger | null;
  /** Postpaid only: quantity tiers; null for a fixed amount. */
  tieredPricing?: TieredPricing | null;
  displayOrder: number;
}

export interface ClientServiceOpenBillingOccurrenceDto {
  id: string;
  feeLineId: string;
  description: string;
  amount: string;
  currency: string;
  billingFrequency: BillingFrequency;
  customFrequencyLabel: string | null;
  /** Set on postpaid entries: the filing that raised the bill. */
  postpaidTrigger?: PostpaidTrigger | null;
  /** Tiered postpaid entries: the quantity billed, null until entered. */
  quantity?: string | null;
  /** Set when the fee line is priced by quantity tiers. */
  tieredPricing?: TieredPricing | null;
  billingPeriodKey: string;
  scheduleEntryKey: string;
  calculatedExpectedDate: DateOnly;
  operativeExpectedDate: DateOnly;
  status: 'OPEN';
  notes: string | null;
}

export interface ClientServiceDeadlineRuleDto extends Omit<ClientServiceDeadlineRuleInput, 'parameterValues'> {
  id: string;
  parameterValues: Record<string, unknown>;
  lastEvaluatedVersionId: string | null;
  applicabilityState: 'APPLICABLE' | 'NOT_APPLICABLE' | 'MISSING_INPUT';
  applicabilityReason: string | null;
  configHash: string | null;
  updatedAt: string;
  rule: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    archivedAt: string | null;
    currentVersionId: string | null;
    currentVersion: {
      id: string;
      version: number;
      configHash: string;
      recurrence: unknown;
      applicability: unknown;
      parameters: ManualClientServiceCatalogParameterDefinition[];
    } | null;
  } | null;
}

export interface ClientServiceDto {
  id: string;
  companyId: string;
  company: {
    name: string;
    uen: string | null;
  };
  source: ClientServiceSource;
  agreementId: string | null;
  agreementItemId: string | null;
  serviceVariantId: string;
  familyName: string;
  serviceName: string;
  status: ClientServiceStatus;
  serviceCadence: ServiceCadence;
  customCadenceLabel: string | null;
  startDate: string;
  endDate: string | null;
  billingDisposition: 'CONFIGURED' | 'NOT_REQUIRED' | 'UNREVIEWED';
  billingNotRequiredReason: string | null;
  fieldValues: Record<string, string>;
  feeLines: ClientServiceFeeLineDto[];
  openDeadlineOccurrences?: ClientServiceOpenDeadlineOccurrenceDto[];
  openBillingOccurrences?: ClientServiceOpenBillingOccurrenceDto[];
  deadlineRules: ClientServiceDeadlineRuleDto[];
  agreement: AgreementSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceAgreementActivationDto {
  agreementId: string;
  status: ServiceAgreementStatus;
  activationStatus: ServiceAgreementActivationStatus;
  activationAttemptCount: number;
  activationLastError: string | null;
}

export interface CompanyServiceActivationDto {
  agreementId: string;
  title: string;
  activationStatus: ServiceAgreementActivationStatus;
  activationLastError: string | null;
  canRetry: boolean;
}
