'use client';

import type { CompanyProfileSectionId } from '@/lib/company-profile-sections';
import type { CompanyProfileSectionDto } from '@/services/company/profile-sections';
import { CompanyEditSection } from './company-edit-section';

export const companyProfileSectionOrder: Array<{ id: CompanyProfileSectionId; title: string }> = [
  { id: 'identity', title: 'Identity' },
  { id: 'addresses', title: 'Addresses' },
  { id: 'activities', title: 'Business activities' },
  { id: 'officers', title: 'Officers' },
  { id: 'shareholders', title: 'Shareholders' },
  { id: 'compliance', title: 'Compliance' },
  { id: 'capital', title: 'Capital' },
  { id: 'charges', title: 'Charges' },
  { id: 'additional', title: 'Additional company information' },
];

export interface CompanyEditWorkspaceProps {
  companyId: string;
  initialSections?: Record<string, CompanyProfileSectionDto>;
  onSave?: (section: CompanyProfileSectionId, data: unknown, version: string) => Promise<CompanyProfileSectionDto>;
}

export function CompanyEditWorkspace({ companyId, initialSections, onSave }: CompanyEditWorkspaceProps) {
  return <div className="space-y-4">{companyProfileSectionOrder.map(({ id, title }) => <CompanyEditSection key={id} companyId={companyId} section={id} title={title} initialData={initialSections?.[id]} onSave={onSave} />)}</div>;
}
