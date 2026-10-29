'use client';

import type { CompanyWithRelations } from '@/services/company/types';
import { CompanyProfileSections } from './company-profile-sections';

interface CompanyProfileTabProps {
  company: CompanyWithRelations;
  companyId: string;
  can: { updateCompany: boolean; deleteOfficer?: boolean; deleteShareholder?: boolean };
  onRetrieveAcra?: () => void;
  isRetrievingAcra?: boolean;
}

export function CompanyProfileTab({ company, companyId, can, onRetrieveAcra, isRetrievingAcra }: CompanyProfileTabProps) {
  return (
    <CompanyProfileSections
      company={company}
      companyId={companyId}
      canEdit={can.updateCompany}
      onRetrieveAcra={onRetrieveAcra}
      isRetrievingAcra={isRetrievingAcra}
    />
  );
}
