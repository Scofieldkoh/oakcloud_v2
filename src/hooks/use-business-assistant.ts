'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  businessAssistantAcceptedResponseSchema,
  businessAssistantCapabilityDescriptorSchema,
  businessAssistantConversationDetailSchema,
  businessAssistantConversationSummarySchema,
  businessAssistantRunDtoSchema,
  businessAssistantMemoryDtoSchema,
  businessAssistantLearningChangeDtoSchema,
  type BusinessAssistantAction,
  type BusinessAssistantTurnRequest,
  type BusinessAssistantMemoryAction,
  type BusinessAssistantLearningAction,
  type BusinessAssistantFeedback,
} from '@/lib/validations/business-assistant';

const base = '/api/business-assistant';
export class AssistantRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

export async function assistantRequest(path: string, workspaceId: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}workspaceId=${encodeURIComponent(workspaceId)}`;
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store', signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z.object({ error: z.union([z.string(), z.object({ message: z.string(), code: z.string().optional() })]), code: z.string().optional() }).safeParse(payload);
    const error = parsed.success ? parsed.data.error : 'The request could not be completed. Please try again.';
    throw new AssistantRequestError(typeof error === 'string' ? error : error.message,
      (typeof error === 'object' ? error.code : parsed.success ? parsed.data.code : undefined) ?? 'REQUEST_FAILED', response.status);
  }
  return payload;
}

const listSchema = z.object({
  conversations: z.array(businessAssistantConversationSummarySchema),
  capabilities: z.array(businessAssistantCapabilityDescriptorSchema),
  enabled: z.boolean().default(false), mutationsEnabled: z.boolean().default(false),
});

const correctionResponseSchema = z.object({
  correction: z.object({
    kind: z.literal('CORRECTION_PROPOSAL'),
    correctionOfReviewId: z.string().min(1),
    sourceRunId: z.string().min(1),
    runId: z.string().min(1),
    runItemId: z.string().min(1),
    proposalId: z.string().min(1),
    revision: z.number().int().positive(),
    duplicate: z.boolean(),
  }).strict(),
}).strict();

export type AssistantCorrectionResult = z.infer<typeof correctionResponseSchema>['correction'];
export interface AssistantCorrectionRequest {
  clientRequestId: string;
  reviewId: string;
  corrections: Array<{ findingId: string; value: unknown }>;
}

export function useAssistantConversations(workspaceId: string) {
  return useQuery({ queryKey: ['business-assistant', workspaceId, 'conversations'],
    queryFn: async ({ signal }) => listSchema.parse(await assistantRequest('/conversations', workspaceId, undefined, signal)),
    enabled: !!workspaceId, staleTime: 10_000, retry: false });
}

export function useAssistantConversation(workspaceId: string, id: string | null) {
  return useQuery({ queryKey: ['business-assistant', workspaceId, 'conversation', id],
    queryFn: async ({ signal }) => z.object({ conversation: businessAssistantConversationDetailSchema }).parse(
      await assistantRequest(`/conversations/${encodeURIComponent(id!)}`, workspaceId, undefined, signal)).conversation,
    enabled: !!workspaceId && !!id, retry: false,
    refetchInterval: (query) => query.state.data?.messages.some((message) => ['ACCEPTED', 'PROCESSING'].includes(message.status))
      || query.state.data?.runs.some((run) => !['COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(run.status)) ? 2000 : false,
  });
}

export function useAssistantRun(workspaceId: string, id: string) {
  return useQuery({ queryKey: ['business-assistant', workspaceId, 'run', id],
    queryFn: async ({ signal }) => z.object({ run: businessAssistantRunDtoSchema }).parse(
      await assistantRequest(`/runs/${encodeURIComponent(id)}`, workspaceId, undefined, signal)).run,
    enabled: !!workspaceId && !!id, retry: false,
    refetchInterval: (query) => query.state.data && ['COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'FAILED', 'CANCELLED', 'EXPIRED', 'WAITING_CONFIRMATION'].includes(query.state.data.status) ? false : 2000,
  });
}

export function useAssistantTurn(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: async (request: BusinessAssistantTurnRequest) =>
    businessAssistantAcceptedResponseSchema.parse(await assistantRequest('/turns', workspaceId, request)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['business-assistant', workspaceId] }), retry: false });
}

export function useAssistantAction(workspaceId: string, runId: string) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (action: BusinessAssistantAction) => assistantRequest(`/runs/${encodeURIComponent(runId)}/actions`, workspaceId, action),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['business-assistant', workspaceId] }), retry: false });
}

export function useAssistantCorrection(workspaceId: string, runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: AssistantCorrectionRequest) => correctionResponseSchema.parse(
      await assistantRequest(`/runs/${encodeURIComponent(runId)}/corrections`, workspaceId, { ...request, workspaceId })).correction,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['business-assistant', workspaceId] }),
    retry: false,
  });
}

export function useAssistantConversationAction(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, clientRequestId }: { id: string; action: 'ARCHIVE' | 'DELETE'; clientRequestId: string }) =>
      assistantRequest(`/conversations/${encodeURIComponent(id)}/actions`, workspaceId, { action, clientRequestId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['business-assistant', workspaceId] }), retry: false,
  });
}

export function useAssistantPreferences(workspaceId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const memories = useQuery({ queryKey: ['business-assistant', workspaceId, 'memories'], enabled: !!workspaceId && enabled, retry: false,
    queryFn: async ({ signal }) => z.object({ memories: z.array(businessAssistantMemoryDtoSchema) }).parse(await assistantRequest('/memories', workspaceId, undefined, signal)).memories });
  const learning = useQuery({ queryKey: ['business-assistant', workspaceId, 'learning'], enabled: !!workspaceId && enabled, retry: false,
    queryFn: async ({ signal }) => z.object({ changes: z.array(businessAssistantLearningChangeDtoSchema) }).parse(await assistantRequest('/learning-changes', workspaceId, undefined, signal)).changes });
  const action = useMutation({ mutationFn: ({ kind, id, body }: { kind: 'memories' | 'learning-changes'; id: string; body: BusinessAssistantMemoryAction | BusinessAssistantLearningAction }) =>
    assistantRequest(`/${kind}/${encodeURIComponent(id)}/actions`, workspaceId, body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['business-assistant', workspaceId] }), retry: false });
  return { memories, learning, action };
}

export function useAssistantFeedback(workspaceId: string) {
  return useMutation({ mutationFn: (body: BusinessAssistantFeedback) => assistantRequest('/feedback', workspaceId, body), retry: false });
}

export const assistantResourceOptionSchema = z.object({ resourceType: z.string(), resourceId: z.string(), title: z.string(),
  role: z.enum(['source', 'target', 'context']), description: z.string().optional() });
export type AssistantResourceOption = z.infer<typeof assistantResourceOptionSchema>;

export function useAssistantResources(workspaceId: string, query: string, enabled: boolean) {
  return useQuery({ queryKey: ['business-assistant', workspaceId, 'resources', query], enabled: !!workspaceId && enabled, retry: false,
    queryFn: async ({ signal }) => z.object({ resources: z.array(assistantResourceOptionSchema) }).parse(
      await assistantRequest(`/resources?query=${encodeURIComponent(query)}`, workspaceId, undefined, signal)).resources });
}
