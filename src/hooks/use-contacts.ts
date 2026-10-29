'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  usePersistSessionListSnapshot,
  useSessionListRestore,
} from '@/hooks/use-session-query-restore';
import type { Contact, ContactType } from '@/generated/prisma';
import type { CreateContactWithDetailsInput, UpdateContactInput } from '@/lib/validations/contact';
import type { ContactMatchResult } from '@/types/contact-identity';
import type {
  ContactDuplicateGroupsResult,
  MergeContactsInput,
  MergeContactsResult,
  RejectContactDuplicateInput,
} from '@/types/contact';

type CreateContactPayload = CreateContactWithDetailsInput & {
  tenantId?: string;
};

export class ContactMatchReviewRequiredError extends Error {
  readonly match: ContactMatchResult;

  constructor(message: string, match: ContactMatchResult) {
    super(message);
    this.name = 'ContactMatchReviewRequiredError';
    this.match = match;
  }
}

interface ContactWithCount extends Contact {
  _count?: {
    companyRelations: number;
  };
  defaultEmail?: string | null;
  defaultPhone?: string | null;
}

interface ContactWithRelationships extends Contact {
  companyRelations: Array<{
    id: string;
    relationship: string;
    isPrimary: boolean;
    company: {
      id: string;
      name: string;
      uen: string;
      status: string;
      deletedAt: string | null;
    };
  }>;
  officerPositions: Array<{
    id: string;
    role: string;
    appointmentDate: string | null;
    cessationDate: string | null;
    isCurrent: boolean;
    company: {
      id: string;
      name: string;
      uen: string;
    };
  }>;
  shareholdings: Array<{
    id: string;
    shareClass: string;
    numberOfShares: number;
    percentageHeld: number | null;
    isCurrent: boolean;
    company: {
      id: string;
      name: string;
      uen: string;
    };
  }>;
  hiddenCompanyCount?: number;  // Number of companies hidden due to RBAC
}

interface ContactSearchParams {
  query?: string;
  fullName?: string;
  contactType?: ContactType;
  identificationType?: 'NRIC' | 'FIN' | 'PASSPORT' | 'UEN' | 'OTHER';
  identificationNumber?: string;
  nationality?: string;
  email?: string;
  phone?: string;
  companyId?: string;
  companiesMin?: number;
  companiesMax?: number;
  page?: number;
  limit?: number;
  sortBy?: 'fullName' | 'contactType' | 'nationality' | 'companyRelationsCount' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  tenantId?: string;
}

interface ContactSearchResult {
  contacts: ContactWithCount[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function isContactSearchResult(value: unknown): value is ContactSearchResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ContactSearchResult>;
  return (
    !!candidate.contacts &&
    Array.isArray(candidate.contacts) &&
    typeof candidate.total === 'number' &&
    typeof candidate.totalPages === 'number'
  );
}

async function fetchContacts(params: ContactSearchParams): Promise<ContactSearchResult> {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      searchParams.set(key, String(value));
    }
  });

  const response = await fetch(`/api/contacts?${searchParams}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch contacts');
  }
  return response.json();
}

async function fetchContact(id: string, full = true): Promise<ContactWithRelationships> {
  const response = await fetch(`/api/contacts/${id}?full=${full}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch contact');
  }
  return response.json();
}

async function createContact(data: CreateContactPayload): Promise<Contact> {
  const response = await fetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    if (
      response.status === 409 &&
      error.code === 'CONTACT_MATCH_REVIEW_REQUIRED' &&
      error.match
    ) {
      throw new ContactMatchReviewRequiredError(
        error.error || 'Review the matching contact before continuing',
        error.match,
      );
    }
    throw new Error(error.error || 'Failed to create contact');
  }
  return response.json();
}

async function updateContact(id: string, data: Partial<UpdateContactInput>): Promise<Contact> {
  const response = await fetch(`/api/contacts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update contact');
  }
  return response.json();
}

async function deleteContact(id: string, reason: string): Promise<{ message: string; contact: Contact }> {
  const response = await fetch(`/api/contacts/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete contact');
  }
  return response.json();
}

async function restoreContact(id: string): Promise<{ message: string; contact: Contact }> {
  const response = await fetch(`/api/contacts/${id}?action=restore`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to restore contact');
  }
  return response.json();
}

interface LinkContactToCompanyParams {
  contactId: string;
  companyId: string;
  relationship: string;
  isPrimary?: boolean;
  // Officer-specific fields
  appointmentDate?: string;
  // Shareholder-specific fields
  numberOfShares?: number;
  shareClass?: string;
}

async function linkContactToCompany(
  params: LinkContactToCompanyParams
): Promise<{ message: string }> {
  const { contactId, ...body } = params;
  const response = await fetch(`/api/contacts/${contactId}?action=link-company`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to link contact to company');
  }
  return response.json();
}

async function unlinkContactFromCompany(
  contactId: string,
  companyId: string,
  relationship: string
): Promise<{ message: string }> {
  const response = await fetch(`/api/contacts/${contactId}?action=unlink-company`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, relationship }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to unlink contact from company');
  }
  return response.json();
}

export function useContacts(
  params: ContactSearchParams = {},
  options: { restoreSession?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const restoreSession = options.restoreSession === true;
  const queryKey = ['contacts', params] as const;
  const { initialData, restoredFromSession } = useSessionListRestore<ContactSearchResult>(
    queryClient,
    queryKey,
    { enabled: restoreSession, validate: isContactSearchResult },
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchContacts(params),
    staleTime: 2 * 60 * 1000, // Serve cached data immediately, then refresh on mount/focus.
    gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache
    // Refresh on every mount while still serving cached data instantly.
    refetchOnMount: 'always',
    initialData,
    initialDataUpdatedAt: restoredFromSession ? 0 : undefined,
    placeholderData: (previousData) => previousData, // Keep previous data visible while fetching
  });

  usePersistSessionListSnapshot(queryKey, restoreSession ? query.data : undefined);

  return query;
}

export function useContact(id: string, full = true) {
  return useQuery({
    queryKey: ['contact', id, full],
    queryFn: () => fetchContact(id, full),
    enabled: !!id,
    staleTime: 2 * 60 * 1000, // Serve cached data immediately, then refresh on mount/focus.
    gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache
    refetchOnMount: 'always',
  });
}

/**
 * Prefetch a single contact's data on hover for faster navigation
 */
export function usePrefetchContact() {
  const queryClient = useQueryClient();

  return (id: string, full = true) => {
    queryClient.prefetchQuery({
      queryKey: ['contact', id, full],
      queryFn: () => fetchContact(id, full),
      staleTime: 5 * 60 * 1000, // 5 minutes
    });
  };
}

/**
 * Prefetch contacts list data
 */
export function usePrefetchContacts() {
  const queryClient = useQueryClient();

  return (params: ContactSearchParams = {}) => {
    queryClient.prefetchQuery({
      queryKey: ['contacts', params],
      queryFn: () => fetchContacts(params),
      staleTime: 5 * 60 * 1000, // 5 minutes
    });
  };
}

export function useCreateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateContactPayload) => createContact(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<UpdateContactInput> }) =>
      updateContact(id, data),
    onSuccess: async (_, { id }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
        queryClient.invalidateQueries({ queryKey: ['contact', id] }),
      ]);
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      deleteContact(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useRestoreContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => restoreContact(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact', id] });
    },
  });
}

/**
 * Bulk delete multiple contacts
 */
async function bulkDeleteContacts(ids: string[], reason: string): Promise<{ deleted: number; message: string }> {
  const response = await fetch('/api/contacts/bulk', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, reason }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to delete contacts');
  }

  return response.json();
}

export function useBulkDeleteContacts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string }) =>
      bulkDeleteContacts(ids, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useLinkContactToCompany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: LinkContactToCompanyParams) => linkContactToCompany(params),
    onSuccess: (_, { contactId, companyId }) => {
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
      // Also invalidate contact-details query for the company
      queryClient.invalidateQueries({ queryKey: ['contact-details', 'company', companyId] });
    },
  });
}

export function useUnlinkContactFromCompany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      contactId,
      companyId,
      relationship,
    }: {
      contactId: string;
      companyId: string;
      relationship: string;
    }) => unlinkContactFromCompany(contactId, companyId, relationship),
    onSuccess: (_, { contactId, companyId }) => {
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
      // Also invalidate contact-details query for the company
      queryClient.invalidateQueries({ queryKey: ['contact-details', 'company', companyId] });
    },
  });
}

// Remove officer position (mark as ceased)
async function removeOfficerPosition(
  companyId: string,
  officerId: string
): Promise<{ success: boolean }> {
  const response = await fetch(`/api/companies/${companyId}/officers/${officerId}?action=cease`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove officer');
  }
  return response.json();
}

export function useRemoveOfficerPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ officerId, companyId }: { contactId: string; officerId: string; companyId: string }) =>
      removeOfficerPosition(companyId, officerId),
    onSuccess: (_, { contactId, companyId }) => {
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    },
  });
}

// Remove shareholding (mark as former)
async function removeShareholding(
  companyId: string,
  shareholderId: string
): Promise<{ success: boolean }> {
  const response = await fetch(`/api/companies/${companyId}/shareholders/${shareholderId}?action=cease`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove shareholder');
  }
  return response.json();
}

export function useRemoveShareholding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shareholderId, companyId }: { contactId: string; shareholderId: string; companyId: string }) =>
      removeShareholding(companyId, shareholderId),
    onSuccess: (_, { contactId, companyId }) => {
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    },
  });
}

// Update officer position
async function updateOfficerPosition(
  contactId: string,
  officerId: string,
  data: { role?: string | null; appointmentDate?: string | null; cessationDate?: string | null }
): Promise<{ message: string }> {
  const response = await fetch(`/api/contacts/${contactId}?action=update-officer`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ officerId, ...data }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update officer position');
  }
  return response.json();
}

export function useUpdateOfficerPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      contactId,
      officerId,
      data,
    }: {
      contactId: string;
      officerId: string;
      companyId: string;
      data: { role?: string | null; appointmentDate?: string | null; cessationDate?: string | null };
    }) => updateOfficerPosition(contactId, officerId, data),
    onSuccess: (_, { contactId, companyId }) => {
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    },
  });
}

// Update shareholding
async function updateShareholding(
  contactId: string,
  shareholderId: string,
  data: { numberOfShares?: number; shareClass?: string }
): Promise<{ message: string }> {
  const response = await fetch(`/api/contacts/${contactId}?action=update-shareholder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shareholderId, ...data }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update shareholding');
  }
  return response.json();
}

export function useUpdateShareholding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      contactId,
      shareholderId,
      data,
    }: {
      contactId: string;
      shareholderId: string;
      companyId: string;
      data: { numberOfShares?: number; shareClass?: string };
    }) => updateShareholding(contactId, shareholderId, data),
    onSuccess: (_, { contactId, companyId }) => {
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    },
  });
}

// ============================================================================
// Contact Link Info (for delete confirmation)
// ============================================================================

export interface ContactLinkInfo {
  hasLinks: boolean;
  companyRelationCount: number;
  officerPositionCount: number;
  shareholdingCount: number;
  chargeHolderCount: number;
  totalLinks: number;
}

async function fetchContactLinkInfo(id: string): Promise<ContactLinkInfo> {
  const res = await fetch(`/api/contacts/${id}/links`);
  if (!res.ok) {
    throw new Error('Failed to fetch contact link info');
  }
  return res.json();
}

export function useContactLinkInfo(id: string | null) {
  return useQuery({
    queryKey: ['contact-links', id],
    queryFn: () => fetchContactLinkInfo(id!),
    enabled: !!id,
    staleTime: 30000, // Cache for 30 seconds
  });
}

async function fetchContactDuplicateGroups(page: number, limit: number): Promise<ContactDuplicateGroupsResult> {
  const response = await fetch(`/api/contacts/duplicates?page=${page}&limit=${limit}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to load duplicate recommendations');
  }
  return response.json();
}

type RejectContactDuplicateMutationInput = RejectContactDuplicateInput & { deferInvalidation?: boolean };

async function rejectContactDuplicate(input: RejectContactDuplicateMutationInput): Promise<{ rejected: true }> {
  const { deferInvalidation: _deferInvalidation, ...payload } = input;
  const response = await fetch('/api/contacts/duplicates/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to reject duplicate recommendation');
  }
  return response.json();
}

async function mergeContacts(input: MergeContactsInput): Promise<MergeContactsResult> {
  const response = await fetch('/api/contacts/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to merge contacts');
  }
  return response.json();
}

export function useContactDuplicateGroups(page = 1, limit = 20, enabled = true) {
  return useQuery({
    queryKey: ['contact-duplicates', page, limit],
    queryFn: () => fetchContactDuplicateGroups(page, limit),
    enabled,
    staleTime: 30_000,
  });
}

function invalidateDuplicateReviewQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['contacts'] }),
    queryClient.invalidateQueries({ queryKey: ['contact-stats'] }),
    queryClient.invalidateQueries({ queryKey: ['contact-duplicates'] }),
  ]);
}

export function useRejectContactDuplicate() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: rejectContactDuplicate,
    onSuccess: (_result, input) => input.deferInvalidation
      ? undefined
      : invalidateDuplicateReviewQueries(queryClient),
  });
  return {
    ...mutation,
    invalidateQueries: () => invalidateDuplicateReviewQueries(queryClient),
  };
}

export function useMergeContacts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mergeContacts,
    onSuccess: () => invalidateDuplicateReviewQueries(queryClient),
  });
}

// Type exports for convenience
export type { ContactWithCount, ContactWithRelationships, ContactSearchParams, ContactSearchResult };
