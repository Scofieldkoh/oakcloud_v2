import { Prisma } from '@/generated/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { dateOnlySchema } from '@/lib/validations/service-schedule';
import type { ServiceVariantRuleAssociationInput } from '@/lib/validations/deadline-rule';

const parameterDefinitionSelect = {
  key: true,
  type: true,
  validation: true,
} as const;

type ParameterDefinition = {
  key: string;
  type: 'STRING' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'ENUM';
  validation: unknown;
};

type UsableRule = {
  id: string;
  currentVersion?: { parameterDefinitions: ParameterDefinition[] } | null;
  versions?: Array<{ parameterDefinitions: ParameterDefinition[] }>;
};

function validationOptions(value: unknown): string[] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const options = (value as Record<string, unknown>).options;
  return Array.isArray(options) && options.every((option) => typeof option === 'string')
    ? options
    : undefined;
}

function isTypedParameterValue(parameter: ParameterDefinition, value: unknown): boolean {
  switch (parameter.type) {
    case 'STRING':
      return typeof value === 'string';
    case 'INTEGER':
      return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
    case 'DECIMAL':
      return typeof value === 'number' && Number.isFinite(value);
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'DATE':
      return dateOnlySchema.safeParse(value).success;
    case 'ENUM': {
      const options = validationOptions(parameter.validation);
      return options !== undefined && typeof value === 'string' && options.includes(value);
    }
    default:
      return false;
  }
}

function validateParameterDefaults(
  ruleId: string,
  defaults: Record<string, unknown>,
  definitions: ParameterDefinition[],
): void {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  for (const [key, value] of Object.entries(defaults)) {
    const definition = byKey.get(key);
    if (!definition) {
      throw new ValidationError(`Unknown parameter default "${key}" for deadline rule ${ruleId}`);
    }
    if (!isTypedParameterValue(definition, value)) {
      throw new ValidationError(`Parameter default "${key}" does not match its ${definition.type} definition`);
    }
  }
}

/**
 * Resolve each referenced rule to its published version, or its unpublished
 * draft when no published version exists, and validate all association
 * defaults before any replacement rows are deleted.
 */
export async function validateVariantRuleAssociations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  associations: ServiceVariantRuleAssociationInput[],
): Promise<void> {
  const ruleIds = associations.map((association) => association.ruleId);
  if (ruleIds.length === 0) return;

  const rules = await tx.deadlineRule.findMany({
    where: {
      tenantId,
      id: { in: ruleIds },
      archivedAt: null,
      isActive: true,
    },
    select: {
      id: true,
      currentVersion: {
        select: {
          parameterDefinitions: { select: parameterDefinitionSelect },
        },
      },
      versions: {
        where: { state: 'DRAFT' },
        orderBy: { version: 'desc' },
        take: 1,
        select: {
          parameterDefinitions: { select: parameterDefinitionSelect },
        },
      },
    },
  }) as unknown as UsableRule[];

  if (rules.length !== ruleIds.length) {
    throw new NotFoundError('One or more deadline rules were not found in this workspace');
  }

  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  for (const association of associations) {
    const rule = byId.get(association.ruleId);
    if (!rule) {
      throw new NotFoundError('One or more deadline rules were not found in this workspace');
    }
    const usableVersion = rule.currentVersion ?? rule.versions?.[0] ?? null;
    const definitions = usableVersion?.parameterDefinitions ?? [];
    validateParameterDefaults(association.ruleId, association.parameterDefaults, definitions);
  }
}
