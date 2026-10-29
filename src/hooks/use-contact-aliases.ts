'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Types
export interface ContactAlias {
  id: string;
  companyId: string | null;
  companyName: string | null;
  rawName: string;
  confidence: number;
  createdAt: string;
  type: 'vendor' | 'customer';
  isTenantWide: boolean;
}

export interface ContactAliasesResponse {
  vendorAliases: ContactAlias[];
  customerAliases: ContactAlias[];
  totalCount: number;
}

export interface CreateAliasInput {
  type: 'vendor' | 'customer';
  companyId?: string | null;
  rawName: string;
}

export interface DeleteAliasInput {
  type: 'vendor' | 'customer';
  aliasId: string;
}

// API Functions
async function fetchContactAliases(contactId: string): Promise<ContactAliasesResponse> {
  const response = await fetch(`/api/contacts/${contactId}/aliases`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch aliases');
  }
  return response.json();
}

async function createContactAlias(
  contactId: string,
  data: CreateAliasInput
): Promise<{ message: string }> {
  const response = await fetch(`/api/contacts/${contactId}/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create alias');
  }
  return response.json();
}

async function deleteContactAlias(
  contactId: string,
  data: DeleteAliasInput
): Promise<{ message: string }> {
  const response = await fetch(`/api/contacts/${contactId}/aliases`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete alias');
  }
  return response.json();
}

// Hooks
export function useContactAliases(contactId: string | null) {
  return useQuery({
    queryKey: ['contact-aliases', contactId],
    queryFn: () => fetchContactAliases(contactId!),
    enabled: !!contactId,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateContactAlias(contactId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateAliasInput) => createContactAlias(contactId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact-aliases', contactId] });
    },
  });
}

export function useDeleteContactAlias(contactId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: DeleteAliasInput) => deleteContactAlias(contactId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact-aliases', contactId] });
    },
  });
}
