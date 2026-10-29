'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompanyProfileSectionId } from '@/lib/company-profile-sections';
import type { CompanyProfileSectionDto } from '@/services/company/profile-sections';

export class CompanyProfileConflictError<T = unknown> extends Error {
  constructor(public readonly latest: CompanyProfileSectionDto<T>) {
    super('This section changed after you opened it');
  }
}

export class CompanyProfileSectionError extends Error {
  constructor(message: string, public readonly issues: Array<{ path: string; message: string }> = []) {
    super(message);
  }
}

export const companyProfileSectionKey = (companyId: string, section: CompanyProfileSectionId) =>
  ['company-profile-section', companyId, section] as const;

async function getSection<T>(companyId: string, section: CompanyProfileSectionId): Promise<CompanyProfileSectionDto<T>> {
  const response = await fetch(`/api/companies/${companyId}/profile/${section}`);
  const body = await response.json();
  if (!response.ok) throw new CompanyProfileSectionError(body.error || 'Failed to load section', body.issues);
  return body;
}

async function patchSection<T>(
  companyId: string,
  section: CompanyProfileSectionId,
  input: { ifMatchVersion: string; data: T; reason?: string },
): Promise<CompanyProfileSectionDto<T>> {
  const response = await fetch(`/api/companies/${companyId}/profile/${section}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (response.status === 409) throw new CompanyProfileConflictError<T>(body.latest);
  if (!response.ok) throw new CompanyProfileSectionError(body.error || 'Failed to save section', body.issues);
  return body;
}

export function useCompanyProfileSection<T>(
  companyId: string,
  section: CompanyProfileSectionId,
  initialData?: CompanyProfileSectionDto<T>,
) {
  return useQuery({
    queryKey: companyProfileSectionKey(companyId, section),
    queryFn: () => getSection<T>(companyId, section),
    initialData,
  });
}

export function useSaveCompanyProfileSection<T>(companyId: string, section: CompanyProfileSectionId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ifMatchVersion: string; data: T; reason?: string }) =>
      patchSection(companyId, section, input),
    onSuccess: (dto) => {
      queryClient.setQueryData(companyProfileSectionKey(companyId, section), dto);
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    },
  });
}
