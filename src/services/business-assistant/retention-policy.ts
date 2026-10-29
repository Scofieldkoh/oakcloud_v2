export type AssistantRetentionClass =
  | 'IMMUTABLE_OPERATION'
  | 'AUDIT_HISTORY'
  | 'USER_CONTEXT'
  | 'REFERENCED_SOURCE'
  | 'OUTSIDE_ASSISTANT';

/**
 * P15 intentionally does not invent legal retention periods. Until an owner
 * approves them, destructive purge remains disabled and these dependency
 * classes define what must be preserved together during backup/restore.
 */
const retentionClassByDelegate: Readonly<Record<string, AssistantRetentionClass>> = {
  bizFileOperationReceipt: 'IMMUTABLE_OPERATION',
  bizFileOperationEvidence: 'IMMUTABLE_OPERATION',
  bizFileOperationEffectIntent: 'IMMUTABLE_OPERATION',
  businessAssistantApproval: 'AUDIT_HISTORY',
  businessAssistantReview: 'AUDIT_HISTORY',
  businessAssistantRunStep: 'AUDIT_HISTORY',
  businessAssistantActionRequest: 'AUDIT_HISTORY',
  businessAssistantLearningChange: 'AUDIT_HISTORY',
  businessAssistantLearningActiveTarget: 'AUDIT_HISTORY',
  businessAssistantConversation: 'USER_CONTEXT',
  businessAssistantMessage: 'USER_CONTEXT',
  businessAssistantFeedback: 'USER_CONTEXT',
  businessAssistantMemory: 'USER_CONTEXT',
  businessAssistantRun: 'USER_CONTEXT',
  businessAssistantRunItem: 'USER_CONTEXT',
  businessAssistantProposal: 'USER_CONTEXT',
  document: 'REFERENCED_SOURCE',
};

export const BUSINESS_ASSISTANT_PURGE_ORDER = [
  'businessAssistantLearningActiveTarget',
  'businessAssistantLearningChange',
  'businessAssistantFeedback',
  'businessAssistantMemory',
  'businessAssistantReview',
  'businessAssistantApproval',
  'businessAssistantProposal',
  'businessAssistantRunStep',
  'businessAssistantActionRequest',
  'businessAssistantRunItem',
  'businessAssistantRun',
  'businessAssistantMessage',
  'businessAssistantConversation',
  'bizFileOperationEffectIntent',
  'bizFileOperationEvidence',
  'bizFileOperationReceipt',
] as const;

export interface AssistantPurgePolicyDecision {
  approved: boolean;
  legalHoldChecked: boolean;
  referencedSourceChecked: boolean;
  policyVersion?: string;
}

export class AssistantPurgePolicyUnresolvedError extends Error {
  constructor(message = 'Business Assistant destructive purge is disabled until retention and legal-hold policy is explicitly approved.') {
    super(message);
    this.name = 'AssistantPurgePolicyUnresolvedError';
  }
}

export function assistantRetentionClass(delegate: string): AssistantRetentionClass {
  return retentionClassByDelegate[delegate]
    ?? (delegate.startsWith('businessAssistant') ? 'AUDIT_HISTORY' : delegate.startsWith('bizFileOperation') ? 'IMMUTABLE_OPERATION' : 'OUTSIDE_ASSISTANT');
}

export function mustPreserveAssistantDelegate(delegate: string): boolean {
  return assistantRetentionClass(delegate) !== 'OUTSIDE_ASSISTANT';
}

/**
 * Referenced source documents may only be purged after an explicit source
 * reachability/legal-hold check. The generic assistant never cascades into the
 * document store on its own.
 */
export function assertAssistantDestructivePurgeAllowed(decision?: AssistantPurgePolicyDecision): void {
  if (!decision?.approved || !decision.legalHoldChecked || !decision.referencedSourceChecked || !decision.policyVersion?.trim()) {
    throw new AssistantPurgePolicyUnresolvedError();
  }
}
