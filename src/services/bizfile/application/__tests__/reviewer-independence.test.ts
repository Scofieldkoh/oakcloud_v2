import { describe, expect, it } from 'vitest';
import { assertIndependentReviewerContext } from '../reviewer-independence';

describe('independent reviewer context boundary', () => {
  it('allows only scalar routing and audit identifiers', () => {
    expect(() => assertIndependentReviewerContext({
      reviewRunId: 'review-1',
      workspaceId: 'workspace-1',
      reviewerVersion: 'p12-v1',
      requestedAt: '2026-09-10T10:00:00.000Z',
      correlationId: 'corr-1',
    })).not.toThrow();
  });

  it.each([
    ['planner history', { plannerHistory: ['conclusion'] }],
    ['renamed planner material', { upstreamReasoning: 'looks correct' }],
    ['assistant memory', { assistantMemory: { preference: 'pass it' } }],
    ['persona', { persona: 'friendly reviewer' }],
    ['mutation handle', { mutationTools: ['write-company'] }],
    ['nested arbitrary data', { correlationId: { hidden: 'payload' } }],
  ])('rejects %s rather than exposing it to review', (_label, context) => {
    expect(() => assertIndependentReviewerContext(context)).toThrow();
  });
});
