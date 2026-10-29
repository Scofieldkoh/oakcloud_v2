import { describe, expect, it } from 'vitest';
import {
  BUSINESS_ASSISTANT_PURGE_ORDER,
  assertAssistantDestructivePurgeAllowed,
  assistantRetentionClass,
  mustPreserveAssistantDelegate,
} from '@/services/business-assistant/retention-policy';

describe('Business Assistant retention policy guardrails', () => {
  it('preserves immutable receipts, effects, evidence, audit history, context, and referenced documents', () => {
    expect(assistantRetentionClass('bizFileOperationReceipt')).toBe('IMMUTABLE_OPERATION');
    expect(assistantRetentionClass('bizFileOperationEvidence')).toBe('IMMUTABLE_OPERATION');
    expect(assistantRetentionClass('bizFileOperationEffectIntent')).toBe('IMMUTABLE_OPERATION');
    expect(assistantRetentionClass('businessAssistantReview')).toBe('AUDIT_HISTORY');
    expect(assistantRetentionClass('businessAssistantConversation')).toBe('USER_CONTEXT');
    expect(assistantRetentionClass('businessAssistantFeedback')).toBe('USER_CONTEXT');
    expect(assistantRetentionClass('businessAssistantMemory')).toBe('USER_CONTEXT');
    expect(assistantRetentionClass('document')).toBe('REFERENCED_SOURCE');
    expect(mustPreserveAssistantDelegate('company')).toBe(false);
  });

  it('keeps destructive purge disabled while any owner/legal-hold/source decision is unresolved', () => {
    expect(() => assertAssistantDestructivePurgeAllowed()).toThrow(/destructive purge is disabled/i);
    expect(() => assertAssistantDestructivePurgeAllowed({ approved: true, legalHoldChecked: false, referencedSourceChecked: true, policyVersion: 'retention-v1' })).toThrow();
    expect(() => assertAssistantDestructivePurgeAllowed({ approved: true, legalHoldChecked: true, referencedSourceChecked: false, policyVersion: 'retention-v1' })).toThrow();
    expect(() => assertAssistantDestructivePurgeAllowed({ approved: true, legalHoldChecked: true, referencedSourceChecked: true })).toThrow();
  });

  it('allows an explicitly versioned policy decision without performing a purge itself', () => {
    expect(() => assertAssistantDestructivePurgeAllowed({ approved: true, legalHoldChecked: true, referencedSourceChecked: true, policyVersion: 'owner-approved-v1' })).not.toThrow();
  });

  it('orders dependent assistant rows before immutable canonical operation records', () => {
    const item = BUSINESS_ASSISTANT_PURGE_ORDER.indexOf('businessAssistantRunItem');
    const run = BUSINESS_ASSISTANT_PURGE_ORDER.indexOf('businessAssistantRun');
    const effect = BUSINESS_ASSISTANT_PURGE_ORDER.indexOf('bizFileOperationEffectIntent');
    const evidence = BUSINESS_ASSISTANT_PURGE_ORDER.indexOf('bizFileOperationEvidence');
    const receipt = BUSINESS_ASSISTANT_PURGE_ORDER.indexOf('bizFileOperationReceipt');
    expect(item).toBeLessThan(run);
    expect(run).toBeLessThan(effect);
    expect(effect).toBeLessThan(evidence);
    expect(evidence).toBeLessThan(receipt);
  });
});
