import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { BusinessAssistantCapability, CapabilityDescriptor, ResourceRef } from '@/services/business-assistant/contracts';
import { routeBusinessAssistantMessage } from '@/services/business-assistant/routing.service';
import { resolveConversationResourceContext, type ConversationContextStore } from '@/services/business-assistant/conversation-context';
import type { AssistantPolicyDecision } from '@/services/business-assistant/policy.service';

function capability(id: string, overrides: Partial<BusinessAssistantCapability> = {}): BusinessAssistantCapability {
  return {
    id,
    version: '1.0',
    contractVersion: '1',
    title: id,
    description: `${id} fixture`,
    executionKind: 'READ_ONLY',
    riskLevel: 'READ_ONLY',
    confirmationPolicy: 'NEVER',
    reviewPolicy: 'NOT_REQUIRED',
    approvalPolicyVersion: '1',
    requiredPermissions: [],
    inputSchema: z.object({ message: z.string() }).passthrough(),
    itemInputSchema: z.object({ message: z.string() }).passthrough(),
    outputSchema: z.unknown(),
    splitInput: () => [],
    prepare: async () => ({ status: 'PREPARED', items: [], preparedAt: new Date(0).toISOString(), preparedHash: '0'.repeat(64) }),
    execute: async () => ({ output: null, resources: [] }),
    ...overrides,
  } as BusinessAssistantCapability;
}

function descriptor(value: BusinessAssistantCapability): CapabilityDescriptor {
  return {
    id: value.id,
    version: value.version,
    title: value.title,
    description: value.description,
    executionKind: value.executionKind,
    riskLevel: value.riskLevel,
    confirmationPolicy: value.confirmationPolicy,
    reviewPolicy: value.reviewPolicy,
    requiredPermissions: [...value.requiredPermissions],
  };
}

function routingDependencies(capabilities: readonly BusinessAssistantCapability[], providerDecision?: (input: { capabilities: readonly CapabilityDescriptor[] }) => Promise<unknown>) {
  const allowed: AssistantPolicyDecision = { allowed: true, isAdmin: true, permissionKeys: new Set() };
  return {
    registry: {
      list: () => capabilities,
      get: (id: string, version?: string) => capabilities.find((candidate) => candidate.id === id && (!version || candidate.version === version)),
    },
    authorizeActor: async () => allowed,
    filterDescriptors: (_decision: AssistantPolicyDecision, values: readonly BusinessAssistantCapability[]) => values.map(descriptor),
    ...(providerDecision ? { providerDecision } : {}),
  };
}

const routeRequest = (message: string, resources: readonly ResourceRef[] = []) => ({
  tenantId: 'workspace-1',
  userId: 'user-1',
  message,
  resources,
});

const answer = capability('assistant.answer');
const lookup = capability('workspace.resource_lookup');
const profile = capability('company.profile_read');

describe('Business Assistant bounded routing', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('routes an ordinary general question to assistant.answer when provider answers are enabled', async () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'true');
    await expect(routeBusinessAssistantMessage(routeRequest('Explain deferred tax'), routingDependencies([answer, lookup])))
      .resolves.toEqual({ kind: 'ANSWER' });
  });

  it('routes workspace lookup deterministically without provider help', async () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'false');
    await expect(routeBusinessAssistantMessage(routeRequest('Find ABC Pte Ltd'), routingDependencies([lookup, answer])))
      .resolves.toEqual({ kind: 'CAPABILITY', capabilityId: 'workspace.resource_lookup', capabilityVersion: '1.0' });
  });

  it('routes a company-profile question when exactly one authorized company is in context', async () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'false');
    await expect(routeBusinessAssistantMessage(
      routeRequest('Who is the director?', [{ resourceType: 'company', resourceId: 'company-1', role: 'context' }]),
      routingDependencies([profile, lookup]),
    )).resolves.toEqual({ kind: 'CAPABILITY', capabilityId: 'company.profile_read', capabilityVersion: '1.0' });
  });

  it('clarifies a company-profile question with no company context', async () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'false');
    const result = await routeBusinessAssistantMessage(routeRequest('Who are the shareholders?'), routingDependencies([profile]));
    expect(result.kind).toBe('CLARIFICATION');
    if (result.kind === 'CLARIFICATION') expect(result.content).toMatch(/which company/i);
  });

  it('does not silently choose when multiple companies are in context', async () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'false');
    const result = await routeBusinessAssistantMessage(routeRequest('What is the FYE?', [
      { resourceType: 'company', resourceId: 'company-1', role: 'context' },
      { resourceType: 'company', resourceId: 'company-2', role: 'context' },
    ]), routingDependencies([profile]));
    expect(result.kind).toBe('CLARIFICATION');
    if (result.kind === 'CLARIFICATION') expect(result.content).toMatch(/more than one company/i);
  });

  it('asks for a BizFile attachment instead of constructing write input from free text', async () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'true');
    const result = await routeBusinessAssistantMessage(routeRequest('Upload this BizFile'), routingDependencies([answer, lookup]));
    expect(result.kind).toBe('CLARIFICATION');
    if (result.kind === 'CLARIFICATION') expect(result.content).toMatch(/attach|upload/i);
  });

  it('rejects an invalid model-selected capability outside the server-offered list', async () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'true');
    const result = await routeBusinessAssistantMessage(
      routeRequest('Please handle this'),
      routingDependencies([lookup], async () => ({ kind: 'CAPABILITY', capabilityId: 'invented.write', capabilityVersion: '9.9' })),
    );
    expect(result.kind).toBe('CLARIFICATION');
  });

  it('never offers an unauthorized capability to the provider router', async () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'true');
    const secret = capability('secret.read', { requiredPermissions: ['secret:read'] });
    const provider = vi.fn(async (input: { capabilities: readonly CapabilityDescriptor[] }) => {
      expect(input.capabilities.map((candidate) => candidate.id)).toEqual(['workspace.resource_lookup']);
      return { kind: 'CLARIFICATION', content: 'Please clarify.' };
    });
    const allowed: AssistantPolicyDecision = { allowed: true, isAdmin: false, permissionKeys: new Set(['company:read']) };
    const dependencies = {
      registry: {
        list: () => [lookup, secret],
        get: (id: string, version?: string) => [lookup, secret].find((candidate) => candidate.id === id && (!version || candidate.version === version)),
      },
      authorizeActor: async () => allowed,
      filterDescriptors: (_decision: AssistantPolicyDecision, values: readonly BusinessAssistantCapability[]) => values.filter((candidate) => candidate.id !== 'secret.read').map(descriptor),
      providerDecision: provider,
    };
    await routeBusinessAssistantMessage(routeRequest('Please handle this'), dependencies);
    expect(provider).toHaveBeenCalledOnce();
  });

  it('falls back safely when provider routing is disabled', async () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'false');
    const result = await routeBusinessAssistantMessage(routeRequest('Please handle this'), routingDependencies([lookup, answer]));
    expect(result.kind).toBe('CLARIFICATION');
  });
});

const currentCreatedAt = new Date('2026-09-17T00:10:00Z');

function contextStore(overrides: Partial<ConversationContextStore> = {}): ConversationContextStore {
  return {
    loadCurrentMessage: vi.fn(async () => ({ id: 'message-current', sequence: 10, resources: [], createdAt: currentCreatedAt })),
    loadRecentMessages: vi.fn(async () => []),
    loadRecentSuccessfulItems: vi.fn(async () => []),
    ...overrides,
  };
}

describe('Business Assistant durable conversation resource context', () => {
  const input = { tenantId: 'workspace-1', userId: 'user-1', conversationId: 'conversation-1', messageId: 'message-current' };

  it('lets the newest source for a resource type shadow stale older refs while retaining other resource types', async () => {
    const store = contextStore({
      loadCurrentMessage: vi.fn(async () => ({ id: 'message-current', sequence: 10, resources: [
        { resourceType: 'company', resourceId: 'company-current', role: 'context' },
      ], createdAt: currentCreatedAt })),
      loadRecentMessages: vi.fn(async () => [
        { id: 'message-current', sequence: 10, role: 'USER', status: 'PROCESSING', resources: [{ resourceType: 'company', resourceId: 'company-current', role: 'context' }], createdAt: currentCreatedAt },
        { id: 'answer-9', sequence: 9, role: 'ASSISTANT', status: 'PROCESSED', resources: [{ resourceType: 'company', resourceId: 'company-assistant', role: 'target' }], createdAt: new Date('2026-09-17T00:09:00Z') },
        { id: 'user-8', sequence: 8, role: 'USER', status: 'PROCESSED', resources: [{ resourceType: 'document', resourceId: 'document-old', role: 'source' }], createdAt: new Date('2026-09-17T00:08:00Z') },
      ]),
      loadRecentSuccessfulItems: vi.fn(async () => [
        { resources: [{ resourceType: 'company', resourceId: 'company-run', role: 'target' }, { resourceType: 'company', resourceId: 'company-assistant', role: 'context' }], updatedAt: new Date('2026-09-17T00:09:30Z') },
      ]),
    });
    const result = await resolveConversationResourceContext(input, {
      store,
      maxResources: 3,
      authorizeResource: async () => true,
    });
    expect(result.map((resource) => resource.resourceId)).toEqual(['company-current', 'document-old']);
  });

  it('orders successful assistant and run resources by actual recency', async () => {
    const store = contextStore({
      loadRecentMessages: vi.fn(async () => [
        { id: 'message-current', sequence: 10, role: 'USER', status: 'PROCESSING', resources: [], createdAt: currentCreatedAt },
        { id: 'answer-9', sequence: 9, role: 'ASSISTANT', status: 'PROCESSED', resources: [{ resourceType: 'company', resourceId: 'company-older-answer', role: 'target' }], createdAt: new Date('2026-09-17T00:08:00Z') },
      ]),
      loadRecentSuccessfulItems: vi.fn(async () => [
        { resources: [{ resourceType: 'company', resourceId: 'company-newer-run', role: 'target' }], updatedAt: new Date('2026-09-17T00:09:00Z') },
      ]),
    });
    const result = await resolveConversationResourceContext(input, { store, authorizeResource: async () => true });
    expect(result.map((resource) => resource.resourceId)).toEqual(['company-newer-run']);
  });

  it('retains multiple refs from the same newest source so real ambiguity is not silently collapsed', async () => {
    const store = contextStore({
      loadCurrentMessage: vi.fn(async () => ({ id: 'message-current', sequence: 10, resources: [
        { resourceType: 'company', resourceId: 'company-1', role: 'context' },
        { resourceType: 'company', resourceId: 'company-2', role: 'context' },
      ], createdAt: currentCreatedAt })),
    });
    const result = await resolveConversationResourceContext(input, { store, authorizeResource: async () => true });
    expect(result.map((resource) => resource.resourceId)).toEqual(['company-1', 'company-2']);
  });

  it('drops a resource when fresh authorization is revoked', async () => {
    const store = contextStore({
      loadCurrentMessage: vi.fn(async () => ({ id: 'message-current', sequence: 10, resources: [{ resourceType: 'company', resourceId: 'revoked', role: 'context' }], createdAt: currentCreatedAt })),
    });
    const result = await resolveConversationResourceContext(input, {
      store,
      authorizeResource: async ({ resource }) => resource.resourceId !== 'revoked',
    });
    expect(result).toEqual([]);
  });

  it('scopes every durable lookup to the current workspace, user, and conversation', async () => {
    const store = contextStore();
    await resolveConversationResourceContext(input, { store, authorizeResource: async () => true });
    expect(store.loadCurrentMessage).toHaveBeenCalledWith(input);
    expect(store.loadRecentMessages).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'workspace-1', userId: 'user-1', conversationId: 'conversation-1' }));
    expect(store.loadRecentSuccessfulItems).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'workspace-1', userId: 'user-1', conversationId: 'conversation-1', createdBefore: currentCreatedAt }));
  });

  it('does not resolve context for an archived/deleted or otherwise unavailable current conversation message', async () => {
    const store = contextStore({ loadCurrentMessage: vi.fn(async () => null) });
    await expect(resolveConversationResourceContext(input, { store, authorizeResource: async () => true })).resolves.toEqual([]);
    expect(store.loadRecentMessages).not.toHaveBeenCalled();
    expect(store.loadRecentSuccessfulItems).not.toHaveBeenCalled();
  });
});
