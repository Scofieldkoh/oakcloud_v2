import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import type { ContactDetailType } from '@/generated/prisma';
import { ContactMatchReviewRequiredError } from '@/hooks/use-contacts';
import type { ContactResolutionInput } from '@/lib/validations/contact';

// ============================================================================
// TYPES
// ============================================================================

export interface ContactDetail {
  id: string;
  tenantId: string;
  contactId: string | null;
  companyId: string | null;
  detailType: ContactDetailType;
  value: string;
  label: string | null;
  purposes: string[];
  description: string | null;
  displayOrder: number;
  isPrimary: boolean;
  isPoc: boolean;
  createdAt: string;
  updatedAt: string;
  contact?: {
    id: string;
    fullName: string;
    contactType: string;
  } | null;
  company?: {
    id: string;
    name: string;
    uen: string;
  } | null;
}

export interface ContactWithDetails {
  contact: {
    id: string;
    fullName: string;
    contactType: string;
    relationship?: string;
  };
  details: ContactDetail[];
  isPoc: boolean; // Company-specific POC status
  isCurrent: boolean; // Whether contact has an active relationship to the company
}

export interface CompanyContactDetailsResponse {
  companyDetails: ContactDetail[];
  contactDetails: ContactWithDetails[];
  hasPoc: boolean;  // Whether any contact detail is marked as POC
}

export interface CreateContactDetailInput {
  detailType: ContactDetailType;
  value: string;
  label?: string;
  purposes?: string[];
  description?: string;
  displayOrder?: number;
  isPrimary?: boolean;
  isPoc?: boolean;
  contactId?: string;
  isCompanySpecific?: boolean;  // If true, the API will set companyId
  selectedCompanyId?: string;   // For standalone mode: selected company for company-specific details
}

export interface UpdateContactDetailInput {
  detailType?: ContactDetailType;
  value?: string;
  label?: string | null;
  purposes?: string[];
  description?: string | null;
  displayOrder?: number;
  isPrimary?: boolean;
  isPoc?: boolean;
}

export interface CreateContactWithDetailsInput {
  relationship: string;
  resolution?: ContactResolutionInput;
  contact: {
    contactType: 'INDIVIDUAL' | 'CORPORATE';
    firstName?: string;
    lastName?: string;
    corporateName?: string;
    corporateUen?: string;
    identificationType?: 'NRIC' | 'FIN' | 'PASSPORT' | 'UEN' | 'OTHER';
    identificationNumber?: string;
    nationality?: string;
    email?: string;
    phone?: string;
    fullAddress?: string;
  };
  contactDetails?: Array<{
    detailType: ContactDetailType;
    value: string;
    label?: string;
    purposes?: string[];
    description?: string;
    isPrimary?: boolean;
  }>;
}

// ============================================================================
// QUERY KEYS
// ============================================================================

export const contactDetailKeys = {
  all: ['contact-details'] as const,
  company: (companyId: string) => [...contactDetailKeys.all, 'company', companyId] as const,
  detail: (companyId: string, detailId: string) => [...contactDetailKeys.company(companyId), detailId] as const,
};

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Get all contact details for a company (including linked contacts' details)
 */
export function useCompanyContactDetails(companyId: string | null) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useQuery({
    queryKey: contactDetailKeys.company(companyId ?? ''),
    queryFn: async (): Promise<CompanyContactDetailsResponse> => {
      const url = activeTenantId
        ? `/api/companies/${companyId}/contact-details?tenantId=${activeTenantId}`
        : `/api/companies/${companyId}/contact-details`;
      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch contact details');
      }
      return response.json();
    },
    enabled: !!companyId,
  });
}

/**
 * Prefetch contact details for a company (for background loading)
 * This triggers the query but doesn't subscribe to updates
 */
export function usePrefetchCompanyContactDetails(companyId: string | null, enabled: boolean = true) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  useQuery({
    queryKey: contactDetailKeys.company(companyId ?? ''),
    queryFn: async (): Promise<CompanyContactDetailsResponse> => {
      const url = activeTenantId
        ? `/api/companies/${companyId}/contact-details?tenantId=${activeTenantId}`
        : `/api/companies/${companyId}/contact-details`;
      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch contact details');
      }
      return response.json();
    },
    enabled: !!companyId && enabled,
    // Lower priority - don't block other queries
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Create a new company-level or contact-level contact detail
 */
export function useCreateContactDetail(companyId: string) {
  const queryClient = useQueryClient();
  const { error } = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: async (data: CreateContactDetailInput) => {
      const response = await fetch(`/api/companies/${companyId}/contact-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, tenantId: activeTenantId }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create contact detail');
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      // Invalidate company contact details
      queryClient.invalidateQueries({ queryKey: contactDetailKeys.company(companyId) });
      // If adding to a contact, also invalidate that contact's queries
      if (variables.contactId) {
        queryClient.invalidateQueries({ queryKey: ['contact', variables.contactId] });
        queryClient.invalidateQueries({ queryKey: ['contacts'] });
      }
    },
    onError: (err: Error) => {
      error(err.message);
    },
  });
}

/**
 * Update a contact detail
 */
export function useUpdateContactDetail(companyId: string) {
  const queryClient = useQueryClient();
  const { error } = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: async ({ detailId, data }: { detailId: string; data: UpdateContactDetailInput }) => {
      const response = await fetch(`/api/companies/${companyId}/contact-details/${detailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, tenantId: activeTenantId }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update contact detail');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactDetailKeys.company(companyId) });
    },
    onError: (err: Error) => {
      error(err.message);
    },
  });
}

/**
 * Delete a contact detail
 */
export function useDeleteContactDetail(companyId: string) {
  const queryClient = useQueryClient();
  const { error } = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: async (detailId: string) => {
      const url = activeTenantId
        ? `/api/companies/${companyId}/contact-details/${detailId}?tenantId=${activeTenantId}`
        : `/api/companies/${companyId}/contact-details/${detailId}`;
      const response = await fetch(url, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to delete contact detail');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactDetailKeys.company(companyId) });
    },
    onError: (err: Error) => {
      error(err.message);
    },
  });
}

/**
 * Toggle POC status for a contact linked to a company
 * This sets isPoc on the CompanyContact relationship (company-specific)
 */
export function useToggleContactPoc(companyId: string) {
  const queryClient = useQueryClient();
  const { error } = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: async ({ contactId, isPoc }: { contactId: string; isPoc: boolean }) => {
      const response = await fetch(`/api/companies/${companyId}/contact-details/toggle-poc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, isPoc, tenantId: activeTenantId }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to toggle POC');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactDetailKeys.company(companyId) });
    },
    onError: (err: Error) => {
      error(err.message);
    },
  });
}

/**
 * Create a new contact with details and link to company
 */
export function useCreateContactWithDetails(companyId: string) {
  const queryClient = useQueryClient();
  const { error } = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: async (data: CreateContactWithDetailsInput) => {
      const response = await fetch(`/api/companies/${companyId}/contact-details/create-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, tenantId: activeTenantId }),
      });
      if (!response.ok) {
        const err = await response.json();
        if (
          response.status === 409 &&
          err.code === 'CONTACT_MATCH_REVIEW_REQUIRED' &&
          err.match
        ) {
          throw new ContactMatchReviewRequiredError(
            err.error || 'Review the matching contact before continuing',
            err.match,
          );
        }
        throw new Error(err.error || 'Failed to create contact');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactDetailKeys.company(companyId) });
      // Also invalidate company query to refresh linked contacts
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    },
    onError: (err: Error) => {
      if (err instanceof ContactMatchReviewRequiredError) return;
      error(err.message);
    },
  });
}

/**
 * Export contact details for selected companies
 */
export function useExportContactDetails() {
  const { error } = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: async (companyIds: string[]) => {
      const response = await fetch('/api/companies/export-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyIds, tenantId: activeTenantId }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to export contact details');
      }

      // Get filename from response headers
      const disposition = response.headers.get('Content-Disposition');
      let filename = 'contact-details.xlsx';
      if (disposition) {
        const matches = disposition.match(/filename="(.+)"/);
        if (matches && matches[1]) {
          filename = matches[1];
        }
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      return { success: true };
    },
    onError: (err: Error) => {
      error(err.message);
    },
  });
}

// ============================================================================
// CONTACT-LEVEL CONTACT DETAILS HOOKS
// ============================================================================

/**
 * Query keys for contact-level contact details
 */
export const contactLevelDetailKeys = {
  all: ['contact-level-details'] as const,
  contact: (contactId: string) => [...contactLevelDetailKeys.all, 'contact', contactId] as const,
  contactGrouped: (contactId: string) => [...contactLevelDetailKeys.all, 'contact', contactId, 'grouped'] as const,
  detail: (contactId: string, detailId: string) => [...contactLevelDetailKeys.contact(contactId), detailId] as const,
};

/**
 * Response type for grouped contact details
 */
export interface GroupedContactDetailsResponse {
  defaultDetails: ContactDetail[];
  companyDetails: Array<{
    companyId: string;
    companyName: string;
    companyUen: string;
    details: ContactDetail[];
  }>;
}

/**
 * Get all contact details for a specific contact
 */
export function useContactDetails(contactId: string | null) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useQuery({
    queryKey: contactLevelDetailKeys.contact(contactId ?? ''),
    queryFn: async (): Promise<ContactDetail[]> => {
      const url = activeTenantId
        ? `/api/contacts/${contactId}/contact-details?tenantId=${activeTenantId}`
        : `/api/contacts/${contactId}/contact-details`;
      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch contact details');
      }
      return response.json();
    },
    enabled: !!contactId,
  });
}

/**
 * Get contact details for a contact, grouped by company
 * Returns default details (not company-specific) and company-specific details per company
 */
export function useContactDetailsGrouped(contactId: string | null) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useQuery({
    queryKey: contactLevelDetailKeys.contactGrouped(contactId ?? ''),
    queryFn: async (): Promise<GroupedContactDetailsResponse> => {
      const url = activeTenantId
        ? `/api/contacts/${contactId}/contact-details?tenantId=${activeTenantId}&grouped=true`
        : `/api/contacts/${contactId}/contact-details?grouped=true`;
      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch contact details');
      }
      return response.json();
    },
    enabled: !!contactId,
  });
}

/**
 * Create a new contact detail for a contact
 */
export function useCreateContactLevelDetail(contactId: string) {
  const queryClient = useQueryClient();
  const { error } = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: async (data: Omit<CreateContactDetailInput, 'contactId'>) => {
      const response = await fetch(`/api/contacts/${contactId}/contact-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, tenantId: activeTenantId }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create contact detail');
      }
      return response.json();
    },
    onSuccess: () => {
      // Invalidate contact-level details
      queryClient.invalidateQueries({ queryKey: contactLevelDetailKeys.contact(contactId) });
      // Also invalidate contact query
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (err: Error) => {
      error(err.message);
    },
  });
}

/**
 * Update a contact detail for a contact
 */
export function useUpdateContactLevelDetail(contactId: string) {
  const queryClient = useQueryClient();
  const { error } = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: async ({ detailId, data }: { detailId: string; data: UpdateContactDetailInput }) => {
      const response = await fetch(`/api/contacts/${contactId}/contact-details/${detailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, tenantId: activeTenantId }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update contact detail');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactLevelDetailKeys.contact(contactId) });
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
    },
    onError: (err: Error) => {
      error(err.message);
    },
  });
}

/**
 * Delete a contact detail for a contact
 */
export function useDeleteContactLevelDetail(contactId: string) {
  const queryClient = useQueryClient();
  const { error } = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: async (detailId: string) => {
      const url = activeTenantId
        ? `/api/contacts/${contactId}/contact-details/${detailId}?tenantId=${activeTenantId}`
        : `/api/contacts/${contactId}/contact-details/${detailId}`;
      const response = await fetch(url, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to delete contact detail');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactLevelDetailKeys.contact(contactId) });
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
    },
    onError: (err: Error) => {
      error(err.message);
    },
  });
}
