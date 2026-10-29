export interface IndependentReviewerContext extends Record<string, unknown> {
  reviewRunId?: string;
  workspaceId?: string;
  reviewerVersion?: string;
  requestedAt?: string;
  correlationId?: string;
}

const ALLOWED_REVIEW_CONTEXT_KEYS = new Set<keyof IndependentReviewerContext>([
  'reviewRunId',
  'workspaceId',
  'reviewerVersion',
  'requestedAt',
  'correlationId',
]);

function isScalar(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

/**
 * The independent reviewer receives only routing/audit identifiers. It must not
 * receive planner traces, conclusions, assistant memory, persona, prompts, tool
 * descriptions, or mutation handles under either known or newly invented keys.
 */
export function assertIndependentReviewerContext(
  context: Record<string, unknown> | undefined,
): asserts context is IndependentReviewerContext | undefined {
  if (!context) return;
  for (const [key, value] of Object.entries(context)) {
    if (!ALLOWED_REVIEW_CONTEXT_KEYS.has(key as keyof IndependentReviewerContext)) {
      throw new Error(`Independent reviewer context contains non-allowlisted key: ${key}`);
    }
    if (!isScalar(value)) {
      throw new Error(`Independent reviewer context key ${key} must be a scalar audit identifier.`);
    }
  }
}
