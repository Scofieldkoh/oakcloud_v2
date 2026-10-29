import { z } from 'zod';
import { BIZFILE_CORRECTION_MAX_ITEMS } from '@/lib/bizfile-correction-contract';

export const businessAssistantResourceRefSchema = z.object({
  resourceType: z.string().trim().min(1).max(100),
  resourceId: z.string().trim().min(1).max(200),
  role: z.enum(['source', 'target', 'context']),
}).strict();

export const businessAssistantContextSchema = z.object({
  route: z.string().trim().max(500).optional(),
  workspaceId: z.string().trim().min(1).max(100).optional(),
  capabilityId: z.string().trim().min(1).max(200).optional(),
  capabilityVersion: z.string().trim().min(1).max(40).optional(),
  style: z.enum(['CASUAL', 'WORKING', 'APPROVAL', 'EXCEPTION', 'SENSITIVE']).optional(),
}).strict();

export const businessAssistantTurnRequestSchema = z.object({
  clientRequestId: z.string().trim().min(1).max(200),
  conversationId: z.string().trim().min(1).max(100).nullable().optional(),
  workspaceId: z.string().trim().min(1).max(100).nullable().optional(),
  message: z.string().trim().min(1).max(12_000),
  resources: z.array(businessAssistantResourceRefSchema).max(50).default([]),
  context: businessAssistantContextSchema.optional(),
  capabilityInput: z.unknown().optional(),
}).strict();

const clientActionBase = {
  clientRequestId: z.string().trim().min(1).max(200),
};

export const businessAssistantReviseActionSchema = z.object({
  ...clientActionBase,
  action: z.literal('REVISE'),
  proposalId: z.string().trim().min(1).max(100),
  revision: z.number().int().positive(),
  itemId: z.string().trim().min(1).max(200),
  patch: z.record(z.unknown()),
}).strict();

export const businessAssistantConfirmActionSchema = z.object({
  ...clientActionBase,
  action: z.literal('CONFIRM'),
  proposalId: z.string().trim().min(1).max(100),
  revision: z.number().int().positive(),
  itemIds: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.itemIds).size !== value.itemIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itemIds'], message: 'Item IDs must be unique' });
});

export const businessAssistantCancelActionSchema = z.object({
  ...clientActionBase,
  action: z.literal('CANCEL'),
  reason: z.string().trim().max(500).optional(),
}).strict();

export const businessAssistantRetryActionSchema = z.object({
  ...clientActionBase,
  action: z.literal('RETRY'),
  itemIds: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  stage: z.enum(['CLASSIFICATION', 'PREPARATION', 'EXECUTION', 'EFFECTS', 'READ_BACK', 'REVIEW']).optional(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.itemIds).size !== value.itemIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itemIds'], message: 'Item IDs must be unique' });
});

/**
 * A correction is a new proposal request. Values are checked against the
 * immutable review finding and the capability's canonical contract by the
 * service; keeping this boundary permissive lets each capability validate its
 * own fields.
 */
export const businessAssistantCorrectionRequestSchema = z.object({
  clientRequestId: z.string().trim().min(1).max(200),
  reviewId: z.string().trim().min(1).max(100),
  workspaceId: z.string().trim().min(1).max(200).optional(),
  corrections: z.array(z.object({
    findingId: z.string().trim().min(1).max(300),
    value: z.unknown(),
  }).strict()).min(1).max(BIZFILE_CORRECTION_MAX_ITEMS),
}).strict().superRefine((value, ctx) => {
  const findingIds = value.corrections.map((correction) => correction.findingId);
  if (new Set(findingIds).size !== findingIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['corrections'], message: 'Correction finding IDs must be unique' });
  }
});

export const businessAssistantActionSchema = z.union([
  businessAssistantReviseActionSchema,
  businessAssistantConfirmActionSchema,
  businessAssistantCancelActionSchema,
  businessAssistantRetryActionSchema,
]).superRefine((value, ctx) => {
  if ((value.action === 'CONFIRM' || value.action === 'RETRY') && new Set(value.itemIds).size !== value.itemIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itemIds'], message: 'Item IDs must be unique' });
  }
});

export const businessAssistantConversationActionSchema = z.union([
  z.object({ ...clientActionBase, action: z.literal('ARCHIVE'), reason: z.string().trim().max(500).optional() }).strict(),
  z.object({ ...clientActionBase, action: z.literal('DELETE'), reason: z.string().trim().max(500).optional() }).strict(),
]);

export const businessAssistantFeedbackSchema = z.object({
  clientEventId: z.string().trim().min(1).max(200),
  targetType: z.enum(['MESSAGE', 'RUN', 'ITEM', 'PROPOSAL', 'REVIEW', 'MEMORY']),
  targetId: z.string().trim().min(1).max(200),
  eventType: z.enum(['OUTCOME', 'SENTIMENT', 'REVIEW_FINDING', 'CORRECTNESS']),
  comment: z.string().trim().max(2_000).optional(),
  provenance: z.record(z.unknown()).optional(),
}).strict();

export const businessAssistantMemoryActionSchema = z.discriminatedUnion('action', [
  z.object({ clientRequestId: z.string().trim().min(1).max(200), action: z.literal('CONFIRM'), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ clientRequestId: z.string().trim().min(1).max(200), action: z.literal('REVISE'), expectedVersion: z.number().int().positive(), key: z.string().trim().min(1).max(100).optional(), value: z.unknown().optional() }).strict(),
  z.object({ clientRequestId: z.string().trim().min(1).max(200), action: z.literal('DEACTIVATE'), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ clientRequestId: z.string().trim().min(1).max(200), action: z.literal('DELETE'), expectedVersion: z.number().int().positive() }).strict(),
]);

export const businessAssistantLearningActionSchema = z.discriminatedUnion('action', [
  z.object({ clientRequestId: z.string().trim().min(1).max(200), action: z.literal('EVALUATE'), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ clientRequestId: z.string().trim().min(1).max(200), action: z.literal('APPROVE'), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ clientRequestId: z.string().trim().min(1).max(200), action: z.literal('PROMOTE'), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ clientRequestId: z.string().trim().min(1).max(200), action: z.literal('ROLLBACK'), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ clientRequestId: z.string().trim().min(1).max(200), action: z.literal('REJECT'), expectedVersion: z.number().int().positive() }).strict(),
]);

export const businessAssistantSafeErrorSchema = z.object({
  code: z.enum([
    'VALIDATION_FAILED', 'FORBIDDEN', 'NOT_FOUND', 'PROPOSAL_STALE', 'APPROVAL_EXPIRED',
    'ACTION_CONFLICT', 'RATE_LIMITED', 'OUTCOME_UNKNOWN', 'EVIDENCE_UNAVAILABLE',
    'CAPABILITY_VERSION_UNAVAILABLE', 'WORKSPACE_PAUSED', 'INTERNAL_ERROR',
  ]),
  message: z.string().trim().min(1).max(500),
  retryable: z.boolean().optional(),
  details: z.unknown().optional(),
}).strict();

export const businessAssistantCapabilityDescriptorSchema = z.object({
  id: z.string().trim().min(1).max(200),
  version: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1_000),
  executionKind: z.enum(['READ_ONLY', 'CANONICAL_WRITE']),
  riskLevel: z.enum(['READ_ONLY', 'STANDARD_WRITE', 'SENSITIVE_WRITE']),
  confirmationPolicy: z.enum(['NONE', 'ALWAYS', 'CONDITIONAL']),
  reviewPolicy: z.enum(['NONE', 'REQUIRED']),
  requiredPermissions: z.array(z.string().trim().min(1).max(100)).max(50),
}).strict();

export const businessAssistantAcceptedResponseSchema = z.object({
  type: z.literal('accepted'),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  runId: z.string().min(1).nullable().optional(),
  duplicate: z.boolean().optional(),
  statusUrl: z.string().max(500).optional(),
}).strict();

export const businessAssistantMessageDtoSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  role: z.enum(['USER', 'ASSISTANT', 'SYSTEM']),
  type: z.enum(['INPUT', 'ANSWER', 'CLARIFICATION', 'PROPOSAL', 'RESULT', 'ERROR']),
  status: z.enum(['ACCEPTED', 'PROCESSING', 'PROCESSED', 'FAILED']),
  content: z.string().nullable(),
  payload: z.unknown().nullable().optional(),
  resources: z.array(businessAssistantResourceRefSchema).optional(),
  createdAt: z.string(),
}).strict();

export const businessAssistantConversationSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  ownerId: z.string().min(1),
  title: z.string().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'DELETED']),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessage: businessAssistantMessageDtoSchema.nullable().optional(),
  capabilities: z.array(businessAssistantCapabilityDescriptorSchema),
}).strict();

export const businessAssistantConversationDetailSchema = businessAssistantConversationSummarySchema.extend({
  messages: z.array(businessAssistantMessageDtoSchema),
  runs: z.array(z.object({ id: z.string(), capabilityId: z.string(), capabilityVersion: z.string(), status: z.string(), updatedAt: z.string() }).strict()),
}).strict();

export const businessAssistantRunItemDtoSchema = z.object({
  id: z.string(),
  itemKey: z.string(),
  ordinal: z.number().int().nonnegative(),
  lifecycleState: z.string(),
  executionOutcome: z.string(),
  reviewOutcome: z.string(),
  requiredEffectStatus: z.string(),
  dispositionReason: z.string().nullable().optional(),
  operationId: z.string().nullable().optional(),
  output: z.unknown().nullable().optional(),
  receipt: z.unknown().nullable().optional(),
  presentation: z.unknown().nullable().optional(),
  reviews: z.array(z.object({
    id: z.string(),
    attemptNumber: z.number().int().positive(),
    verdict: z.string(),
    executionConformance: z.string(),
    sourceAlignment: z.string(),
    evidence: z.unknown(),
    findings: z.unknown(),
    coverage: z.unknown(),
    schemaVersion: z.string(),
    promptVersion: z.string(),
    providerVersion: z.string().nullable().optional(),
    createdAt: z.string(),
  }).strict()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const businessAssistantProposalDtoSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  status: z.string(),
  preparedArtifact: z.unknown(),
  preparedHash: z.string(),
  eligibleItems: z.array(z.string()),
  eligibleBindings: z.array(z.object({
    itemId: z.string(),
    itemKey: z.string(),
    preparedHash: z.string(),
  }).strict()).optional(),
  effectManifest: z.unknown().nullable().optional(),
  presentation: z.object({
    sections: z.array(z.object({ id: z.string(), title: z.string(), kind: z.string(), value: z.unknown() }).strict()),
    allowedActions: z.array(z.string()).optional(),
  }).nullable().optional(),
  expiresAt: z.string(),
  createdAt: z.string(),
}).strict();

export const businessAssistantRunDtoSchema = z.object({
  id: z.string(),
  conversationId: z.string().nullable(),
  capabilityId: z.string(),
  capabilityVersion: z.string(),
  contractVersion: z.string(),
  schemaVersion: z.string(),
  status: z.string(),
  resources: z.array(businessAssistantResourceRefSchema),
  items: z.array(businessAssistantRunItemDtoSchema),
  proposal: businessAssistantProposalDtoSchema.nullable().optional(),
  aggregate: z.object({ status: z.string(), counts: z.record(z.number().int().nonnegative()) }).strict(),
  cancellationRequestedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  allowedActions: z.array(z.enum(['REVISE', 'CONFIRM', 'CANCEL', 'RETRY'])),
}).strict();

export const businessAssistantMemoryDtoSchema = z.object({
  id: z.string(),
  scope: z.enum(['SESSION', 'USER', 'TENANT']),
  conversationId: z.string().nullable().optional(),
  capabilityId: z.string().nullable().optional(),
  capabilityVersion: z.string().nullable().optional(),
  key: z.string(),
  value: z.unknown(),
  provenance: z.unknown(),
  evidenceCount: z.number().int().nonnegative(),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  state: z.enum(['CANDIDATE', 'ACTIVE', 'REJECTED', 'DEACTIVATED', 'SUPERSEDED', 'EXPIRED', 'DELETED']),
  version: z.number().int().positive(),
  effectiveAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  allowedActions: z.array(z.enum(['CONFIRM', 'REVISE', 'DEACTIVATE', 'DELETE'])),
}).strict();

export const businessAssistantLearningChangeDtoSchema = z.object({
  id: z.string(),
  targetKey: z.string(),
  targetKind: z.enum(['PREFERENCE', 'PROMPT_PROFILE']),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  baselineVersion: z.string(),
  candidateVersion: z.string(),
  candidateValue: z.unknown().nullable().optional(),
  evidence: z.unknown(),
  evaluation: z.unknown().nullable().optional(),
  state: z.enum(['CANDIDATE', 'EVALUATING', 'EVALUATED', 'APPROVED', 'PROMOTED', 'ROLLED_BACK', 'REJECTED']),
  expectedVersion: z.number().int().positive(),
  rollbackTarget: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  allowedActions: z.array(z.enum(['EVALUATE', 'APPROVE', 'PROMOTE', 'ROLLBACK', 'REJECT'])),
}).strict();

export const businessAssistantCursorSchema = z.string().trim().max(500).optional();

export type BusinessAssistantResourceRef = z.infer<typeof businessAssistantResourceRefSchema>;
export type BusinessAssistantTurnRequest = z.infer<typeof businessAssistantTurnRequestSchema>;
export type BusinessAssistantAction = z.infer<typeof businessAssistantActionSchema>;
export type BusinessAssistantCorrectionRequest = z.infer<typeof businessAssistantCorrectionRequestSchema>;
export type BusinessAssistantConversationAction = z.infer<typeof businessAssistantConversationActionSchema>;
export type BusinessAssistantFeedback = z.infer<typeof businessAssistantFeedbackSchema>;
export type BusinessAssistantMemoryAction = z.infer<typeof businessAssistantMemoryActionSchema>;
export type BusinessAssistantLearningAction = z.infer<typeof businessAssistantLearningActionSchema>;
export type BusinessAssistantCapabilityDescriptor = z.infer<typeof businessAssistantCapabilityDescriptorSchema>;
export type BusinessAssistantMessageDto = z.infer<typeof businessAssistantMessageDtoSchema>;
export type BusinessAssistantConversationSummary = z.infer<typeof businessAssistantConversationSummarySchema>;
export type BusinessAssistantConversationDetail = z.infer<typeof businessAssistantConversationDetailSchema>;
export type BusinessAssistantRunDto = z.infer<typeof businessAssistantRunDtoSchema>;
export type BusinessAssistantMemoryDto = z.infer<typeof businessAssistantMemoryDtoSchema>;
export type BusinessAssistantLearningChangeDto = z.infer<typeof businessAssistantLearningChangeDtoSchema>;
