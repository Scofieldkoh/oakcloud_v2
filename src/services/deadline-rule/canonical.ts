import type {
  ApplicabilityDefinitionInput,
  DeadlineMilestoneInput,
  DeadlineParameterDefinitionInput,
  RuleRecurrenceInput,
} from '@/lib/validations/service-schedule';
import type { DeadlineRuleDraftInput } from '@/lib/validations/deadline-rule';
import { hashConfiguration } from '@/services/service-schedule/hash';

export interface CanonicalDeadlineRuleDefinition {
  schemaVersion: 1;
  code: string;
  name: string;
  description: string | null;
  recurrence: RuleRecurrenceInput;
  applicability: ApplicabilityDefinitionInput;
  parameters: Array<{
    key: string;
    label: string;
    description: string | null;
    type: DeadlineParameterDefinitionInput['type'];
    required: boolean;
    options?: string[];
  }>;
  milestones: Array<{
    key: string;
    name: string;
    description: string | null;
    type: DeadlineMilestoneInput['type'];
    generationMode: DeadlineMilestoneInput['generationMode'];
    expression: DeadlineMilestoneInput['expression'];
    businessDayAdjustment: DeadlineMilestoneInput['businessDayAdjustment'];
    displayOrder: number;
    isActive: boolean;
  }>;
}

type CanonicalInput = Pick<
  DeadlineRuleDraftInput,
  'code' | 'name' | 'description' | 'recurrence' | 'applicability' | 'parameters' | 'milestones'
>;

/**
 * Normalize one rule definition before hashing, auditing, or seeding it.
 * Relational rows and the canonical hash must always be derived from this
 * same bounded object so a definition cannot drift between storage paths.
 */
export function canonicalDeadlineRuleDefinition(
  input: CanonicalInput,
): CanonicalDeadlineRuleDefinition {
  return {
    schemaVersion: 1,
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    recurrence: input.recurrence,
    applicability: input.applicability,
    parameters: input.parameters.map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
      description: parameter.description ?? null,
      type: parameter.type,
      required: parameter.required,
      ...(parameter.options === undefined ? {} : { options: parameter.options }),
    })),
    milestones: input.milestones.map((milestone) => ({
      key: milestone.key,
      name: milestone.name,
      description: milestone.description ?? null,
      type: milestone.type,
      generationMode: milestone.generationMode,
      expression: milestone.expression,
      businessDayAdjustment: milestone.businessDayAdjustment,
      displayOrder: milestone.displayOrder,
      isActive: milestone.isActive,
    })),
  };
}

export function hashDeadlineRuleDefinition(input: CanonicalInput): string {
  return hashConfiguration(canonicalDeadlineRuleDefinition(input));
}
