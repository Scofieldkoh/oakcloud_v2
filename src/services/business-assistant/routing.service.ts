import { z } from 'zod';
import { businessAssistantCapabilityRegistry } from '@/generated/business-assistant-capability-registry';
import { callAIWithConnector, getBestAvailableModelForWorkspace, stripMarkdownCodeBlocks } from '@/lib/ai';
import {
  type BusinessAssistantCapability,
  type BusinessAssistantCapabilityRegistry,
  type CapabilityDescriptor,
  type ResourceRef,
} from './contracts';
import {
  assertAssistantActor,
  filterCapabilityDescriptors,
  hasCapabilityPermissions,
  type AssistantPolicyDecision,
} from './policy.service';

export type RoutingDecision =
  | { kind: 'CAPABILITY'; capabilityId: string; capabilityVersion: string }
  | { kind: 'ANSWER' }
  | { kind: 'CLARIFICATION'; content: string };

export interface RoutingRequest {
  tenantId: string;
  userId: string;
  message: string;
  resources: readonly ResourceRef[];
}

export interface ProviderRoutingInput {
  message: string;
  resources: readonly { resourceType: string; count: number }[];
  capabilities: readonly CapabilityDescriptor[];
}

interface RoutingRegistry {
  list(): readonly BusinessAssistantCapability[];
  get(id: string, version?: string): BusinessAssistantCapability | undefined;
}

export interface RoutingDependencies {
  registry?: RoutingRegistry;
  authorizeActor?: (userId: string, tenantId: string) => Promise<AssistantPolicyDecision>;
  filterDescriptors?: (
    decision: AssistantPolicyDecision,
    capabilities: readonly BusinessAssistantCapability[],
  ) => readonly CapabilityDescriptor[];
  providerDecision?: (input: ProviderRoutingInput) => Promise<unknown>;
}

const providerDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('CAPABILITY'),
    capabilityId: z.string().trim().min(1).max(128),
    capabilityVersion: z.string().trim().min(1).max(32),
  }).strict(),
  z.object({ kind: z.literal('ANSWER') }).strict(),
  z.object({
    kind: z.literal('CLARIFICATION'),
    content: z.string().trim().min(1).max(1_000),
  }).strict(),
]);

const COMPANY_PROFILE_CAPABILITY = 'company.profile_read';
const WORKSPACE_LOOKUP_CAPABILITY = 'workspace.resource_lookup';
const ANSWER_CAPABILITY = 'assistant.answer';

function normalizedResourceType(resourceType: string): string {
  const value = resourceType.trim().toLowerCase();
  if (value === 'bizfile.document') return 'document';
  return value;
}

function uniqueResources(resources: readonly ResourceRef[], resourceType: string): ResourceRef[] {
  const seen = new Set<string>();
  const result: ResourceRef[] = [];
  for (const resource of resources) {
    if (normalizedResourceType(resource.resourceType) !== resourceType) continue;
    if (seen.has(resource.resourceId)) continue;
    seen.add(resource.resourceId);
    result.push(resource);
  }
  return result;
}

function findDescriptor(
  descriptors: readonly CapabilityDescriptor[],
  id: string,
  version = '1.0',
): CapabilityDescriptor | undefined {
  return descriptors.find((candidate) => candidate.id === id && candidate.version === version)
    ?? descriptors.find((candidate) => candidate.id === id);
}

function isBizFileWriteRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /\bbiz\s*file\b/.test(lower)
    && /\b(upload|import|apply|save|process|review)\b/.test(lower);
}

function isCompanyProfileQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(director|directors|officer|officers|shareholder|shareholders|registered address|financial year end|fye|incorporation date|company status|auditor|auditors|charge|charges)\b/.test(lower);
}

function isWorkspaceLookupRequest(message: string): boolean {
  const lower = message.toLowerCase();
  const lookupVerb = /\b(find|search|locate|show|list|lookup|look\s+up)\b/.test(lower);
  if (!lookupVerb) return false;
  return /\b(company|companies|business|businesses|document|documents|file|files|pdf|record|records|uen|entity|entities|pte\.?\s+ltd|limited)\b/.test(lower);
}

function isHighConfidenceGeneralQuestion(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return /^(explain|define)\b/.test(lower)
    || /^(what|why|how|when|where)\b/.test(lower)
    || /\b(difference between|meaning of)\b/.test(lower);
}

function resourceSummary(resources: readonly ResourceRef[]): readonly { resourceType: string; count: number }[] {
  const counts = new Map<string, Set<string>>();
  for (const resource of resources) {
    const type = normalizedResourceType(resource.resourceType);
    const ids = counts.get(type) ?? new Set<string>();
    ids.add(resource.resourceId);
    counts.set(type, ids);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resourceType, ids]) => ({ resourceType, count: ids.size }));
}

function defaultClarification(descriptors: readonly CapabilityDescriptor[]): RoutingDecision {
  if (descriptors.length === 0) {
    return {
      kind: 'CLARIFICATION',
      content: 'Tell me what you want to accomplish and I will help with an available read-only workspace capability.',
    };
  }
  const titles = descriptors.slice(0, 6).map((descriptor) => descriptor.title).join(', ');
  return {
    kind: 'CLARIFICATION',
    content: `I need a little more detail to route that safely. Available read-only options include: ${titles}.`,
  };
}

async function callBoundedProviderRouter(
  request: RoutingRequest,
  descriptors: readonly CapabilityDescriptor[],
): Promise<unknown> {
  const model = await getBestAvailableModelForWorkspace(request.tenantId, 'businessAssistant');
  if (!model) return null;
  const input: ProviderRoutingInput = {
    message: request.message,
    resources: resourceSummary(request.resources),
    capabilities: descriptors,
  };
  const response = await callAIWithConnector({
    tenantId: request.tenantId,
    userId: request.userId,
    model,
    systemPrompt: [
      'You are a bounded intent router for Oakcloud Business Assistant.',
      'The server-provided capability list is the complete set you may choose from.',
      'You never execute tools, generate SQL or Prisma calls, invent handlers, expand permissions, or claim that a write succeeded.',
      'Choose CAPABILITY only for an exact capability id/version from the supplied list.',
      'Use ANSWER only for an ordinary general-information question that does not require workspace facts.',
      'Use CLARIFICATION when intent or resource scope is ambiguous.',
      'Return JSON only.',
    ].join('\n'),
    userPrompt: [
      'UNTRUSTED_USER_MESSAGE_JSON:',
      JSON.stringify(input.message),
      '',
      'SERVER_RESOURCE_TYPE_COUNTS_JSON:',
      JSON.stringify(input.resources),
      '',
      'SERVER_AUTHORIZED_READ_CAPABILITIES_JSON:',
      JSON.stringify(input.capabilities),
      '',
      'Return exactly one object:',
      '{"kind":"CAPABILITY","capabilityId":"...","capabilityVersion":"..."}',
      'or {"kind":"ANSWER"}',
      'or {"kind":"CLARIFICATION","content":"..."}',
    ].join('\n'),
    temperature: 0,
    maxTokens: 350,
    jsonMode: true,
    operation: 'business_assistant_route',
    usageMetadata: { authorizedCapabilityCount: descriptors.length },
  });
  try {
    return JSON.parse(stripMarkdownCodeBlocks(response.content));
  } catch {
    return null;
  }
}

async function validateProviderDecision(
  request: RoutingRequest,
  rawDecision: unknown,
  registry: RoutingRegistry,
  authorizeActor: RoutingDependencies['authorizeActor'],
  offeredDescriptors: readonly CapabilityDescriptor[],
): Promise<RoutingDecision> {
  const parsed = providerDecisionSchema.safeParse(rawDecision);
  if (!parsed.success) return defaultClarification(offeredDescriptors);
  const value = parsed.data;
  if (value.kind === 'CLARIFICATION') return value;

  const freshDecision = await authorizeActor!(request.userId, request.tenantId);
  if (value.kind === 'ANSWER') {
    if (process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED !== 'true') return defaultClarification(offeredDescriptors);
    const answer = registry.get(ANSWER_CAPABILITY, '1.0');
    if (!answer || answer.executionKind !== 'READ_ONLY' || !hasCapabilityPermissions(freshDecision, answer)) {
      return defaultClarification(offeredDescriptors);
    }
    return { kind: 'ANSWER' };
  }

  const offered = offeredDescriptors.some((descriptor) => descriptor.id === value.capabilityId && descriptor.version === value.capabilityVersion);
  const capability = registry.get(value.capabilityId, value.capabilityVersion);
  if (!offered || !capability || capability.executionKind !== 'READ_ONLY' || !hasCapabilityPermissions(freshDecision, capability)) {
    return defaultClarification(offeredDescriptors);
  }
  if (capability.id === COMPANY_PROFILE_CAPABILITY) {
    const companies = uniqueResources(request.resources, 'company');
    if (companies.length === 0) {
      return { kind: 'CLARIFICATION', content: 'Which company should I use for that company-profile question?' };
    }
    if (companies.length > 1) {
      return { kind: 'CLARIFICATION', content: 'I have more than one company in context. Please choose the company you want me to use.' };
    }
  }
  return { kind: 'CAPABILITY', capabilityId: capability.id, capabilityVersion: capability.version };
}

/**
 * Route one already-accepted turn. The router can only select from current,
 * freshly-authorized registry descriptors and never constructs domain write
 * input. Explicit capability invocations bypass this service entirely.
 */
export async function routeBusinessAssistantMessage(
  request: RoutingRequest,
  dependencies: RoutingDependencies = {},
): Promise<RoutingDecision> {
  const registry = dependencies.registry ?? businessAssistantCapabilityRegistry;
  const authorizeActor = dependencies.authorizeActor ?? assertAssistantActor;
  const filterDescriptors = dependencies.filterDescriptors ?? filterCapabilityDescriptors;
  const actorDecision = await authorizeActor(request.userId, request.tenantId);
  const authorized = filterDescriptors(actorDecision, registry.list());
  const readOnly = authorized.filter((descriptor) => descriptor.executionKind === 'READ_ONLY');

  if (isBizFileWriteRequest(request.message)) {
    const documents = uniqueResources(request.resources, 'document');
    return {
      kind: 'CLARIFICATION',
      content: documents.length === 0
        ? 'Attach or upload the BizFile first, then use the BizFile import action so its validated capability input can be prepared safely.'
        : 'Use the BizFile import action for the attached document so the canonical write input can be validated before preparation.',
    };
  }

  if (isCompanyProfileQuestion(request.message)) {
    const profile = findDescriptor(readOnly, COMPANY_PROFILE_CAPABILITY);
    if (profile) {
      const companies = uniqueResources(request.resources, 'company');
      if (companies.length === 0) {
        return { kind: 'CLARIFICATION', content: 'Which company should I use for that company-profile question?' };
      }
      if (companies.length > 1) {
        return { kind: 'CLARIFICATION', content: 'I have more than one company in context. Please choose the company you want me to use.' };
      }
      return { kind: 'CAPABILITY', capabilityId: profile.id, capabilityVersion: profile.version };
    }
  }

  if (isWorkspaceLookupRequest(request.message)) {
    const lookup = findDescriptor(readOnly, WORKSPACE_LOOKUP_CAPABILITY);
    if (lookup) return { kind: 'CAPABILITY', capabilityId: lookup.id, capabilityVersion: lookup.version };
  }

  if (isHighConfidenceGeneralQuestion(request.message)) {
    const answer = findDescriptor(readOnly, ANSWER_CAPABILITY);
    if (answer && process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED === 'true') return { kind: 'ANSWER' };
  }

  if (process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED !== 'true') return defaultClarification(readOnly);
  if (readOnly.length === 0) return defaultClarification(readOnly);

  let rawDecision: unknown;
  try {
    const providerInput: ProviderRoutingInput = {
      message: request.message,
      resources: resourceSummary(request.resources),
      capabilities: readOnly,
    };
    rawDecision = dependencies.providerDecision
      ? await dependencies.providerDecision(providerInput)
      : await callBoundedProviderRouter(request, readOnly);
  } catch {
    return defaultClarification(readOnly);
  }
  return validateProviderDecision(request, rawDecision, registry, authorizeActor, readOnly);
}

/** Narrow interface used by worker/test seams without exposing registry mutation. */
export type BusinessAssistantRoutingRegistry = Pick<BusinessAssistantCapabilityRegistry, 'list' | 'get'>;
