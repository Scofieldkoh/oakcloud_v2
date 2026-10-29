import type {
  ClientServiceSource,
  ClientServiceStatus,
  ServiceCadence,
} from '@/generated/prisma';
import type { ServiceRosterSearch } from '@/lib/validations/service-roster';

export type { ServiceRosterSearch };

export interface ServiceRosterScope {
  tenantId: string;
  /** Undefined means tenant-wide access; [] means access to no companies. */
  companyIds?: string[];
  allCompaniesAccess?: boolean;
}

export interface ServiceRosterDeadline {
  id: string;
  milestoneKey: string;
  scheduleEntryKey: string;
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  calculatedDueDate: string;
  operativeDueDate: string;
  /** Alias used by event/table consumers that call this field dueDate. */
  dueDate: string;
  status: 'OPEN';
  origin: 'RULE' | 'MANUAL_TRIGGER';
}

export type ServiceRosterApplicabilityState =
  | 'APPLICABLE'
  | 'NOT_APPLICABLE'
  | 'MISSING_INPUT'
  | 'MIXED'
  | null;

export interface ServiceRosterWarningSummary {
  state: ServiceRosterApplicabilityState;
  applicabilityState: ServiceRosterApplicabilityState;
  hasWarning: boolean;
  ruleCount: number;
  applicableCount: number;
  notApplicableCount: number;
  missingInputCount: number;
  reasons: string[];
}

export interface ServiceRosterItem {
  id: string;
  companyId: string;
  agreementId: string | null;
  agreementItemId: string | null;
  serviceVariantId: string;
  company: {
    id: string;
    name: string;
    displayAlias: string | null;
    displayLabel: string;
    uen: string | null;
  };
  family: {
    id: string;
    name: string;
    displayColor: string;
  };
  familyName: string;
  familyDisplayColor: string;
  variant: {
    id: string;
    code: string | null;
    name: string;
    version: number | null;
    serviceCadence: ServiceCadence | null;
    customCadenceLabel: string | null;
  };
  /** Compatibility alias for consumers that use the catalog relation name. */
  serviceVariant: ServiceRosterItem['variant'];
  service: {
    id: string;
    name: string;
    source: ClientServiceSource;
    status: ClientServiceStatus;
    cadence: ServiceCadence;
    serviceCadence: ServiceCadence;
    customCadenceLabel: string | null;
    startDate: string;
    endDate: string | null;
  };
  serviceName: string;
  status: ClientServiceStatus;
  cadence: ServiceCadence;
  serviceCadence: ServiceCadence;
  customCadenceLabel: string | null;
  startDate: string;
  endDate: string | null;
  source: ClientServiceSource;
  hasRuleWarning: boolean;
  nextDeadline: ServiceRosterDeadline | null;
  applicability: ServiceRosterWarningSummary;
  applicabilityState: ServiceRosterApplicabilityState;
  ruleWarning: ServiceRosterWarningSummary;
  warning: ServiceRosterWarningSummary;
  /** Billing tracking projection used by the roster indicator. */
  billingDisposition?: 'CONFIGURED' | 'NOT_REQUIRED' | 'UNREVIEWED';
  billingNotRequiredReason?: string | null;
  billingCoverageIssue?: { severity: 'ERROR' | 'WARNING'; type: string; message?: string } | null;
  nextBilling?: {
    status: 'OPEN' | 'BILLED' | 'WAIVED' | 'CANCELLED';
    expectedDate: string;
    timingState: 'UPCOMING' | 'DUE' | 'OVERDUE' | null;
  } | null;
  updatedAt: string;
}

export interface ServiceRosterResult {
  items: ServiceRosterItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ServiceRosterFamily {
  id: string;
  name: string;
  displayColor: string;
}

export interface ServiceRosterDb {
  $queryRaw?: <T>(query: unknown) => Promise<T>;
  clientService: {
    findMany: (args: unknown) => Promise<unknown[]>;
    count: (args: unknown) => Promise<number>;
  };
}
