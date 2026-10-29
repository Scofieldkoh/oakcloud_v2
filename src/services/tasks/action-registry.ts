import {
  TaskStageActionType,
  TaskStageOutcomeType,
  TaskStageStatus,
  type TaskStageActionType as TaskStageActionTypeValue,
} from '@/generated/prisma';
import { ValidationError } from '@/lib/errors';
import { z } from 'zod';
import type {
  ResolvedStageOutcome,
  StageActionAdapter,
  StageActionAdapterContext,
  StageActionBlocker,
  StageActionConfig,
  StageActionLaunch,
} from './types';

const checklistSchema = z.array(z.object({
  label: z.string().trim().min(1).max(300),
  position: z.number().int().nonnegative(),
}).strict()).optional();

const baseConfigSchema = z.object({
  checklistItems: checklistSchema,
}).strict();

const companyConfigSchema = baseConfigSchema.extend({
  allowCreate: z.boolean().optional(),
});

const documentConfigSchema = baseConfigSchema.extend({
  templateId: z.string().uuid().optional(),
  templateIds: z.array(z.string().uuid()).min(1).max(20).refine(
    (templateIds) => new Set(templateIds).size === templateIds.length,
    'Document templates must be distinct',
  ).optional(),
});

const esigningConfigSchema = baseConfigSchema.extend({
  signingOrder: z.enum(['PARALLEL', 'SEQUENTIAL', 'MIXED']).optional(),
  expiresInDays: z.number().int().positive().optional(),
  generatedDocumentId: z.string().uuid().optional(),
});

function parseWith(
  schema: z.ZodTypeAny,
  value: unknown,
): StageActionConfig {
  return schema.parse(value ?? {}) as StageActionConfig;
}

function launch(
  href: string | null,
  context: StageActionAdapterContext,
): StageActionLaunch {
  return {
    href,
    context: {
      taskId: context.stage.taskId,
      taskStageId: context.stage.id,
    },
  };
}

function noBlockers(): StageActionBlocker[] {
  return [];
}

function configQuery(
  path: string,
  values: Record<string, string | number | Array<string | number> | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, String(entry)));
    } else if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

const manualAdapter: StageActionAdapter = {
  actionType: TaskStageActionType.MANUAL,
  defaultIcon: 'CircleCheckBig',
  parseConfig: (value) => parseWith(baseConfigSchema, value),
  blockers: noBlockers,
  launch: (context) => launch(null, context),
  outcomeSummary: () => null,
  deriveStatus: () => TaskStageStatus.NOT_STARTED,
};

const companyAdapter: StageActionAdapter = {
  actionType: TaskStageActionType.COMPANY_PROFILE,
  defaultIcon: 'Building2',
  parseConfig: (value) => parseWith(companyConfigSchema, value),
  blockers: noBlockers,
  launch: (context) => {
    const config = companyConfigSchema.parse(context.stage.actionConfig ?? {});
    const href = context.stage.task?.companyId
      ? `/companies/${context.stage.task.companyId}`
      : config.allowCreate === false
        ? null
        : '/companies/new';
    return launch(href, context);
  },
  outcomeSummary: (outcome) => (
    outcome?.entity.kind === 'company'
      ? `Linked company: ${outcome.entity.name}`
      : null
  ),
  deriveStatus: (outcome) => (
    outcome?.entity.kind === 'company'
      ? TaskStageStatus.COMPLETED
      : TaskStageStatus.NOT_STARTED
  ),
};

function configuredDocumentTemplateIds(
  config: z.infer<typeof documentConfigSchema>,
): string[] | undefined {
  if (Array.isArray(config.templateIds)) return config.templateIds;
  return config.templateId ? [config.templateId] : undefined;
}

/** Template IDs a document-generation stage config names, if it is valid. */
export function readDocumentStageTemplateIds(actionConfig: unknown): string[] | undefined {
  const parsed = documentConfigSchema.safeParse(actionConfig ?? {});
  return parsed.success ? configuredDocumentTemplateIds(parsed.data) : undefined;
}

const documentAdapter: StageActionAdapter = {
  actionType: TaskStageActionType.DOCUMENT_GENERATION,
  defaultIcon: 'FileText',
  parseConfig: (value) => parseWith(documentConfigSchema, value),
  blockers: noBlockers,
  launch: (context) => {
    const generatedDocumentId = (
      context.stage.outcome?.type === TaskStageOutcomeType.GENERATED_DOCUMENT
        ? context.stage.outcome.generatedDocumentId
        : null
    );
    const documentGenerationBatchId = (
      context.stage.outcome?.type === TaskStageOutcomeType.GENERATED_DOCUMENT
        ? context.stage.outcome.documentGenerationBatchId
        : null
    );
    if (generatedDocumentId && context.stage.status === TaskStageStatus.COMPLETED) {
      return launch(`/generated-documents/${generatedDocumentId}`, context);
    }
    if (generatedDocumentId && context.stage.status === TaskStageStatus.IN_PROGRESS) {
      return launch(configQuery('/generated-documents/generate', {
        ...(documentGenerationBatchId
          ? { batch: documentGenerationBatchId }
          : { draft: generatedDocumentId }),
      }), context);
    }
    const config = documentConfigSchema.parse(context.stage.actionConfig ?? {});
    const templateIds = context.resolvedTemplateIds ?? configuredDocumentTemplateIds(config);
    return launch(configQuery('/generated-documents/generate', {
      templateId: templateIds,
      companyId: context.stage.task?.companyId ?? undefined,
    }), context);
  },
  outcomeSummary: (outcome) => (
    outcome?.entity.kind === 'generatedDocument'
      ? `${outcome.entity.title} (${outcome.entity.status})`
      : null
  ),
  deriveStatus: (outcome) => {
    if (outcome?.entity.kind !== 'generatedDocument') {
      return TaskStageStatus.NOT_STARTED;
    }
    return outcome.entity.status === 'FINALIZED'
      ? TaskStageStatus.COMPLETED
      : TaskStageStatus.IN_PROGRESS;
  },
};

const esigningAdapter: StageActionAdapter = {
  actionType: TaskStageActionType.ESIGNING,
  defaultIcon: 'PenLine',
  parseConfig: (value) => parseWith(esigningConfigSchema, value),
  blockers: noBlockers,
  launch: (context) => {
    if (
      context.stage.outcome?.type === TaskStageOutcomeType.ESIGNING_ENVELOPE
      && context.stage.outcome.esigningEnvelopeId
    ) {
      return launch(
        `/esigning/${context.stage.outcome.esigningEnvelopeId}`,
        context,
      );
    }
    const config = esigningConfigSchema.parse(context.stage.actionConfig ?? {});
    return launch(configQuery('/esigning', {
      signingOrder: config.signingOrder,
      expiresInDays: config.expiresInDays,
      generatedDocumentId: config.generatedDocumentId,
    }), context);
  },
  outcomeSummary: (outcome) => (
    outcome?.entity.kind === 'esigningEnvelope'
      ? `${outcome.entity.title}: ${outcome.entity.completedSignatures}/${outcome.entity.requiredSignatures} signed`
      : null
  ),
  deriveStatus: (outcome) => {
    if (outcome?.entity.kind !== 'esigningEnvelope') {
      return TaskStageStatus.NOT_STARTED;
    }
    if (['DECLINED', 'EXPIRED', 'VOIDED', 'CANCELLED'].includes(outcome.entity.status)) {
      return TaskStageStatus.FAILED;
    }
    if (
      outcome.entity.status === 'COMPLETED'
      && outcome.entity.requiredSignatures > 0
      && outcome.entity.completedSignatures >= outcome.entity.requiredSignatures
    ) {
      return TaskStageStatus.COMPLETED;
    }
    return TaskStageStatus.IN_PROGRESS;
  },
};

export const stageActionRegistry: Readonly<Record<TaskStageActionTypeValue, StageActionAdapter>> = {
  MANUAL: manualAdapter,
  COMPANY_PROFILE: companyAdapter,
  DOCUMENT_GENERATION: documentAdapter,
  ESIGNING: esigningAdapter,
};

export function getStageActionAdapter(actionType: TaskStageActionTypeValue): StageActionAdapter {
  const adapter = stageActionRegistry[actionType];
  if (!adapter) {
    throw new ValidationError(`Unsupported task stage action: ${actionType}`);
  }
  return adapter;
}

const expectedOutcomeType: Partial<Record<TaskStageActionTypeValue, string>> = {
  COMPANY_PROFILE: TaskStageOutcomeType.COMPANY,
  DOCUMENT_GENERATION: TaskStageOutcomeType.GENERATED_DOCUMENT,
  ESIGNING: TaskStageOutcomeType.ESIGNING_ENVELOPE,
};

export function assertOutcomeMatchesAction(
  actionType: TaskStageActionTypeValue,
  outcomeType: string,
) {
  const expected = expectedOutcomeType[actionType];
  if (!expected || expected !== outcomeType) {
    throw new ValidationError(
      `Outcome type ${outcomeType} does not match ${actionType} stage action`,
    );
  }
}

export function resolveStageActionOutcome(
  actionType: TaskStageActionTypeValue,
  outcome: ResolvedStageOutcome | null,
) {
  if (outcome) {
    assertOutcomeMatchesAction(actionType, outcome.type);
  }
  const adapter = getStageActionAdapter(actionType);
  return {
    status: adapter.deriveStatus(outcome),
    summary: adapter.outcomeSummary(outcome),
  };
}
