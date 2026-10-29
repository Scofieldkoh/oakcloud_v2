'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { CompanyAccentSection } from '@/components/companies/company-accent-section';
import type { CompanyProfileSectionId } from '@/lib/company-profile-sections';
import { CompanyProfileValueEditor } from './company-edit-section';
import { companyProfileSectionOrder } from './company-edit-workspace';
import { CompanyCreateSharePointField, type PendingSharePointSelection } from '@/components/companies/company-create-sharepoint-field';

export type CompanyCreateProfile = Record<CompanyProfileSectionId, unknown>;

export const emptyCompanyProfile: CompanyCreateProfile = {
  identity: {
    uen: '',
    name: '',
    displayAlias: null,
    entityType: 'PRIVATE_LIMITED',
    status: 'LIVE',
    statusDate: null,
    incorporationDate: null,
  },
  addresses: { registered: null, mailing: null },
  activities: { primary: null, secondary: null },
  officers: { officers: [] },
  shareholders: { shareholders: [] },
  compliance: {
    financialYearEndDay: null,
    financialYearEndMonth: null,
    fyeAsAtLastAr: null,
    homeCurrency: 'SGD',
    lastAgmDate: null,
    lastArFiledDate: null,
    accountsDueDate: null,
  },
  capital: {
    paidUpCapitalCurrency: 'SGD',
    paidUpCapitalAmount: null,
    issuedCapitalCurrency: 'SGD',
    issuedCapitalAmount: null,
    shareCapital: [],
  },
  charges: { charges: [] },
  additional: {
    formerName: null,
    dateOfNameChange: null,
    registrationDate: null,
    formerNames: [],
    auditor: null,
  },
};

interface CompanyCreateWorkspaceProps {
  onSubmit: (profile: CompanyCreateProfile) => void | Promise<void>;
  actions?: ReactNode;
  formId?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSharePointSelectionChange?: (selection: PendingSharePointSelection) => void;
}

export function CompanyCreateWorkspace({ onSubmit, actions, formId, onDirtyChange, onSharePointSelectionChange }: CompanyCreateWorkspaceProps) {
  const [profile, setProfile] = useState<CompanyCreateProfile>(emptyCompanyProfile);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit(profile);
  };

  return <form id={formId} aria-label="Add company" className="space-y-4" onSubmit={submit}>
    {companyProfileSectionOrder.map(({ id, title }) => (
      <CompanyAccentSection key={id} title={title}>
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <CompanyProfileValueEditor
            value={profile[id]}
            path={[id]}
            onChange={(value) => {
              setProfile((current) => ({ ...current, [id]: value }));
              onDirtyChange?.(true);
            }}
          />
        </div>
      </CompanyAccentSection>
    ))}
    <CompanyCreateSharePointField onChange={onSharePointSelectionChange ?? (() => undefined)} />
    {actions}
  </form>;
}
