import { describe, expect, it } from 'vitest';
import { assistantCapabilities } from '@/services/company/assistant-capabilities';

const actor = {
  tenantId: 'workspace-1',
  userId: 'user-1',
  requestId: 'request-1',
  source: 'test',
};

describe('company.profile_read splitInput worker envelope', () => {
  it('accepts the worker resource wrapper while keeping conversational input minimal', () => {
    const capability = assistantCapabilities[0];
    const parts = capability.splitInput({
      message: 'Who is the director?',
      resources: [{ resourceType: 'company', resourceId: 'company-1', role: 'context' }],
    }, actor);

    expect(parts).toEqual([
      { itemKey: 'company.profile_read', input: { message: 'Who is the director?' } },
    ]);
    expect(capability.inputSchema.safeParse({ message: 'Who is the director?' }).success).toBe(true);
    expect(capability.inputSchema.safeParse({ message: 'Who is the director?', companyId: 'company-1' }).success).toBe(false);
  });
});
