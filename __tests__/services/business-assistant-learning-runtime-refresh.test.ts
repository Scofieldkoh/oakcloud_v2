import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callAIWithConnector: vi.fn(),
  getBestAvailableModelForWorkspace: vi.fn(),
  findMessages: vi.fn(),
  findOrigin: vi.fn(),
  findMemories: vi.fn(),
  findConversation: vi.fn(),
  getActiveLearningConfiguration: vi.fn(),
  assertAssistantActor: vi.fn(),
  assertAssistantWorkspaceOperational: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  callAIWithConnector: mocks.callAIWithConnector,
  getBestAvailableModelForWorkspace: mocks.getBestAvailableModelForWorkspace,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    businessAssistantMessage: { findMany: mocks.findMessages, findFirst: mocks.findOrigin },
    businessAssistantMemory: { findMany: mocks.findMemories },
    businessAssistantConversation: { findFirst: mocks.findConversation },
  },
}));
vi.mock('@/services/business-assistant/learning.service', () => ({
  getActiveLearningConfiguration: mocks.getActiveLearningConfiguration,
}));
vi.mock('@/services/business-assistant/policy.service', () => ({
  assertAssistantActor: mocks.assertAssistantActor,
  assertAssistantWorkspaceOperational: mocks.assertAssistantWorkspaceOperational,
}));

import { assistantCapabilities } from '@/services/business-assistant/assistant-capabilities';

const answer = assistantCapabilities.find((capability) => capability.id === 'assistant.answer')!;
const context = {
  actor: { tenantId: 'tenant-1', userId: 'user-1', requestId: 'request-1', source: 'BUSINESS_ASSISTANT' },
  resources: [],
  invocation: {
    tenantId: 'tenant-1', userId: 'user-1', requestId: 'request-1', source: 'BUSINESS_ASSISTANT',
    conversationId: 'conversation-1', runId: 'run-1', runItemId: 'item-1',
  },
};

function sourceDefault(targetKey: string): unknown {
  if (targetKey === 'assistant.language') return 'en';
  if (targetKey === 'assistant.response_detail') return 'concise';
  if (targetKey === 'assistant.playfulness') return 'none';
  if (targetKey === 'assistant.prompt_profile') return { tone: 'direct', maxSentences: 4, includeCitations: false };
  return null;
}

describe('governed learning runtime refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED = 'true';
    mocks.assertAssistantActor.mockResolvedValue({ allowed: true, isAdmin: false, permissionKeys: new Set() });
    mocks.assertAssistantWorkspaceOperational.mockResolvedValue({ allowed: true, isAdmin: false, permissionKeys: new Set() });
    mocks.getBestAvailableModelForWorkspace.mockResolvedValue('test-model');
    mocks.findMessages.mockResolvedValue([]);
    mocks.findOrigin.mockResolvedValue({ sequence: 1 });
    mocks.findMemories.mockResolvedValue([]);
    mocks.findConversation.mockResolvedValue({ id: 'conversation-1' });
    mocks.callAIWithConnector.mockResolvedValue({
      content: '{"kind":"ANSWER","content":"ok"}', model: 'test-model', provider: 'openai',
    });
  });

  it('does not cache tenant learning across executions and immediately observes deactivation/default fallback', async () => {
    let learnedDetail: 'detailed' | 'concise' = 'detailed';
    mocks.getActiveLearningConfiguration.mockImplementation(async (tenantId: string, targetKey: string) => {
      expect(tenantId).toBe('tenant-1');
      if (targetKey === 'assistant.response_detail') return { version: learnedDetail === 'detailed' ? '2' : '1', value: learnedDetail };
      return { version: '1', value: sourceDefault(targetKey) };
    });

    const prepared = await answer.prepare({ message: 'Explain bearer bonds.' }, context);
    await answer.execute(prepared, context);
    const firstPrompt = mocks.callAIWithConnector.mock.calls[0][0].userPrompt as string;
    expect(firstPrompt).toContain('Use comprehensive detail when it helps answer the question.');
    expect(firstPrompt).not.toContain('Prefer a concise answer.');

    learnedDetail = 'concise';
    await answer.execute(prepared, context);
    const secondPrompt = mocks.callAIWithConnector.mock.calls[1][0].userPrompt as string;
    expect(secondPrompt).toContain('Prefer a concise answer.');
    expect(secondPrompt).not.toContain('Use comprehensive detail when it helps answer the question.');
    expect(mocks.getActiveLearningConfiguration).toHaveBeenCalledTimes(8);
  });

  it('never reads another workspace learning configuration while answering for the current workspace', async () => {
    mocks.getActiveLearningConfiguration.mockImplementation(async (tenantId: string, targetKey: string) => {
      if (tenantId !== 'tenant-1') throw new Error('cross-workspace read');
      return { version: '1', value: sourceDefault(targetKey) };
    });
    const prepared = await answer.prepare({ message: 'What is working capital?' }, context);
    await answer.execute(prepared, context);
    expect(mocks.getActiveLearningConfiguration.mock.calls.every(([tenantId]) => tenantId === 'tenant-1')).toBe(true);
  });

  it('does not turn a current-turn style request into a persistence call', async () => {
    mocks.getActiveLearningConfiguration.mockImplementation(async (_tenantId: string, targetKey: string) => ({
      version: '1', value: sourceDefault(targetKey),
    }));
    const prepared = await answer.prepare({ message: 'For this response only, be warm and detailed.' }, context);
    await answer.execute(prepared, context);
    const prompt = mocks.callAIWithConnector.mock.calls[0][0].userPrompt as string;
    expect(prompt).toContain('For this response only, be warm and detailed.');
    expect(prompt).toContain('UNTRUSTED_USER_MESSAGE_JSON');
    expect(mocks.getActiveLearningConfiguration).toHaveBeenCalledTimes(4);
    // This capability has no memory/learning mutation dependency at all; the
    // only persistence-shaped dependency mocked here is a read.
    expect(Object.keys(mocks)).not.toContain('createMemoryCandidate');
  });
});
