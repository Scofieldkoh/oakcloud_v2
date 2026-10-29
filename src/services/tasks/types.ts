import type {
  Prisma,
  TaskStageActionType as PrismaTaskStageActionType,
  TaskStageOutcomeType as PrismaTaskStageOutcomeType,
  TaskStageStatus as PrismaTaskStageStatus,
} from '@/generated/prisma';
import type {
  CreateTaskPipelineInput,
  UpdateTaskPipelineInput,
} from '@/lib/validations/task-pipeline';
import type {
  CreateTaskInput,
  TaskStageOutcomeInput,
  UpdateTaskMetadataInput,
} from '@/lib/validations/task';

export interface TaskMutationActor {
  userId?: string;
}

export interface ChecklistDefinition {
  label: string;
  position: number;
}

export interface StageActionConfig {
  checklistItems?: ChecklistDefinition[];
  [key: string]: unknown;
}

export interface StageActionBlocker {
  code: string;
  message: string;
}

export interface TaskLaunchContext {
  taskId: string;
  taskStageId: string;
  returnTo?: string;
}

export type TaskEsigningPreparationStatus =
  | 'WAITING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT';

export interface TaskEsigningPreparationSnapshot {
  id: string;
  taskId: string;
  taskStageId: string;
  status: TaskEsigningPreparationStatus;
  blockingStage: {
    id: string;
    name: string;
    status: TaskStageStatus;
  } | null;
  generatedDocumentId: string | null;
  esigningEnvelopeId: string | null;
  lastError: string | null;
}
export type StageOutcomeSummary = string | null;

export interface StageActionLaunch {
  href: string | null;
  context: TaskLaunchContext;
}

export interface StageOutcomeReference {
  type: PrismaTaskStageOutcomeType;
  companyId?: string | null;
  generatedDocumentId?: string | null;
  documentGenerationBatchId?: string | null;
  esigningEnvelopeId?: string | null;
}

export interface StageActionRecord {
  id: string;
  tenantId: string;
  taskId: string;
  actionType: PrismaTaskStageActionType;
  actionConfig: Prisma.JsonValue | null;
  status: PrismaTaskStageStatus;
  task?: {
    companyId?: string | null;
  };
  outcome?: StageOutcomeReference | null;
}

export interface StageActionAdapterContext {
  tenantId: string;
  stage: StageActionRecord;
  /** Configured document templates with approved Word replacements applied. */
  resolvedTemplateIds?: string[];
}

export interface ResolvedStageOutcome {
  type: PrismaTaskStageOutcomeType;
  entity:
    | { kind: 'company'; id: string; name: string }
    | { kind: 'generatedDocument'; id: string; title: string; status: string }
    | {
      kind: 'esigningEnvelope';
      id: string;
      title: string;
      status: string;
      requiredSignatures: number;
      completedSignatures: number;
    };
}

export interface StageActionAdapter {
  actionType: PrismaTaskStageActionType;
  defaultIcon: string;
  parseConfig(value: unknown): StageActionConfig;
  blockers(context: StageActionAdapterContext): StageActionBlocker[];
  launch(context: StageActionAdapterContext): StageActionLaunch;
  outcomeSummary(outcome: ResolvedStageOutcome | null): StageOutcomeSummary;
  deriveStatus(outcome: ResolvedStageOutcome | null): PrismaTaskStageStatus;
}

export type TaskStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

export type TaskStageStatus =
  | 'NOT_STARTED'
  | 'WAITING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'FAILED';

export type TaskStageActionType =
  | 'MANUAL'
  | 'COMPANY_PROFILE'
  | 'DOCUMENT_GENERATION'
  | 'ESIGNING';

export type TaskStageOutcomeType =
  | 'COMPANY'
  | 'GENERATED_DOCUMENT'
  | 'ESIGNING_ENVELOPE';

export type TaskPipelineCreatePayload = CreateTaskPipelineInput;
export type TaskPipelineUpdatePayload = UpdateTaskPipelineInput;
export type TaskCreatePayload = CreateTaskInput;
export type TaskUpdatePayload = UpdateTaskMetadataInput;
export type TaskStageOutcomePayload = TaskStageOutcomeInput;

export interface TaskPipelineDuplicatePayload {
  name?: string;
}

export interface ArchivePayload {
  reason: string;
}

export interface ArchiveResult {
  id: string;
  archived: true;
}

export interface TaskListItem {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string } | null;
  owner: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  pipelineVersion: {
    id: string;
    version: number;
    pipeline: { id: string; name: string };
  };
  stages: TaskStageSummary[];
}

export interface TaskStageSummary {
  id: string;
  name: string;
  position: number;
  actionType: TaskStageActionType;
  icon: string;
  isRequired: boolean;
  status: TaskStageStatus;
}

export interface TaskListResponse {
  tasks: TaskListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TaskStageDetail extends TaskStageSummary {
  taskId: string;
  description: string | null;
  notes: string | null;
  skipReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  assigneeId: string | null;
  assignee: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  checklistItems: Array<{
    id: string;
    label: string;
    position: number;
    isCompleted: boolean;
    completedAt: string | null;
  }>;
  outcome: {
    id: string;
    type: TaskStageOutcomeType;
    companyId: string | null;
    generatedDocumentId: string | null;
    esigningEnvelopeId: string | null;
  } | null;
  blockers: StageActionBlocker[];
  launch: StageActionLaunch;
  outcomeSummary: StageOutcomeSummary;
}

export type TaskResourceState = 'available' | 'pending' | 'unavailable';

interface TaskResourceBase {
  id: string | null;
  state: TaskResourceState;
  label: string;
  reason: string | null;
}

export interface TaskCompanyResource extends TaskResourceBase {
  kind: 'company';
  name: string | null;
  uen: string | null;
  href: string | null;
}

export interface TaskGeneratedDocumentResource extends TaskResourceBase {
  kind: 'generatedDocument';
  title: string | null;
  status: string | null;
  href: string | null;
}

export interface TaskEsigningDocumentResource {
  id: string;
  fileName: string;
  originalPdfHref: string;
  signedPdfHref: string | null;
}

export type TaskSignerLinkState = 'available' | 'waiting' | 'finished';

export interface TaskEsigningSignerResource {
  id: string;
  name: string;
  email: string | null;
  status: string;
  signingOrder: number | null;
  linkState: TaskSignerLinkState;
}

export interface TaskEsigningEnvelopeResource extends TaskResourceBase {
  kind: 'esigningEnvelope';
  title: string | null;
  status: string | null;
  pdfGenerationStatus: string | null;
  expiresAt: string | null;
  completedSignatures: number;
  requiredSignatures: number;
  href: string | null;
  canGenerateSignerLink: boolean;
  generatedDocumentIds?: string[];
  documents: TaskEsigningDocumentResource[];
  signers: TaskEsigningSignerResource[];
}

export type TaskResource =
  | TaskCompanyResource
  | TaskGeneratedDocumentResource
  | TaskEsigningEnvelopeResource;

export interface TaskResourceStage {
  id: string;
  name: string;
  position: number;
  actionType: TaskStageActionType;
  status: TaskStageStatus;
  description: string | null;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  assignee: { id: string; name: string; email: string } | null;
  checklist: Array<{ id: string; label: string; isCompleted: boolean }>;
  blockers: StageActionBlocker[];
  resources: TaskResource[];
}

export interface TaskResourcesResponse {
  task: {
    id: string;
    title: string;
    status: TaskStatus;
    dueDate: string | null;
    company: { id: string; name: string; uen: string; href: string } | null;
    owner: { id: string; name: string; email: string } | null;
    pipelineName: string;
  };
  stages: TaskResourceStage[];
  hasPendingResources: boolean;
}
