import type {
  DeadlineRuleDraftInput,
  SearchDeadlineRulesInput,
  ServiceVariantRuleAssociationInput,
} from '@/lib/validations/deadline-rule';
import type { TenantAwareParams } from '@/lib/types';

export type { DeadlineRuleDraftInput, SearchDeadlineRulesInput, ServiceVariantRuleAssociationInput };
export type DeadlineRuleActor = TenantAwareParams;

export interface DeadlineRuleParameterDto {
  id: string;
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

export interface DeadlineMilestoneDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  type: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  generationMode: 'ONCE_PER_CYCLE' | 'ONCE_PER_SCHEDULE_ENTRY';
  expression: unknown;
  businessDayAdjustment: 'NONE' | 'PREVIOUS' | 'NEXT';
  displayOrder: number;
  isActive: boolean;
}

export interface DeadlineRuleVersionDto {
  id: string;
  ruleId: string;
  version: number;
  state: 'DRAFT' | 'PUBLISHED';
  schemaVersion: number;
  recurrence: unknown;
  applicability: unknown;
  configHash: string;
  draftRevision: number;
  publishedAt: Date | null;
  publishedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  parameters: DeadlineRuleParameterDto[];
  milestones: DeadlineMilestoneDto[];
}

export interface ServiceVariantRuleAssociationDto {
  id: string;
  serviceVariantId: string;
  ruleId: string;
  enabledByDefault: boolean;
  parameterDefaults: Record<string, unknown>;
  scheduleDefaults: unknown[];
  displayOrder: number;
  archivedAt: Date | null;
}

export interface DeadlineRuleDto {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  archivedAt: Date | null;
  archivedById: string | null;
  archiveReason: string | null;
  currentVersionId: string | null;
  currentVersion: DeadlineRuleVersionDto | null;
  draft: DeadlineRuleVersionDto | null;
  versions: DeadlineRuleVersionDto[];
  variantAssociations: ServiceVariantRuleAssociationDto[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DeadlineRuleListDto {
  rules: DeadlineRuleDto[];
  total: number;
  page: number;
  limit: number;
}
