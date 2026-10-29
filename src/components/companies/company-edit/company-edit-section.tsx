'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { CompanyAccentSection } from '@/components/companies/company-accent-section';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { Toggle } from '@/components/ui/toggle';
import { COMPANY_ALIAS_MAX_LENGTH } from '@/lib/company-display-label';
import type { CompanyProfileSectionId } from '@/lib/company-profile-sections';
import { COMPANY_PROFILE_NUMBER_FIELDS } from '@/lib/validations/company-profile';
import type { CompanyProfileSectionDto } from '@/services/company/profile-sections';
import {
  CompanyProfileConflictError,
  CompanyProfileSectionError,
  useCompanyProfileSection,
  useSaveCompanyProfileSection,
} from '@/hooks/use-company-profile-sections';
import { CompanyPersonContactLinker } from './company-person-contact-linker';
import { COMPANY_PROFILE_FIELD_OPTIONS } from './company-profile-field-options';

const objectDefaults: Record<string, Record<string, unknown>> = {
  registered: { block: '', streetName: '', level: '', unit: '', buildingName: '', postalCode: '', country: 'Singapore', effectiveFrom: null },
  mailing: { block: '', streetName: '', level: '', unit: '', buildingName: '', postalCode: '', country: 'Singapore' },
  primary: { code: '', description: '' },
  secondary: { code: '', description: '' },
  auditor: { name: '', address: '', appointmentDate: null },
};

const arrayDefaults: Record<string, Record<string, unknown>> = {
  officers: { name: '', role: 'DIRECTOR', identificationType: null, identificationNumber: '', nationality: '', address: '', appointmentDate: null, cessationDate: null, isCurrent: true },
  shareholders: { name: '', shareholderType: 'INDIVIDUAL', isNominee: false, identificationType: null, identificationNumber: '', nationality: '', placeOfOrigin: '', address: '', shareClass: 'ORDINARY', numberOfShares: 0, percentageHeld: null, currency: 'SGD', isCurrent: true },
  shareCapital: { shareClass: 'ORDINARY', currency: 'SGD', numberOfShares: 0, parValue: null, totalValue: 0, isPaidUp: true, isTreasury: false },
  charges: { chargeNumber: '', chargeType: '', description: '', chargeHolderName: '', amountSecured: null, amountSecuredText: '', currency: 'SGD', registrationDate: null, dischargeDate: null, isFullyDischarged: false },
  formerNames: { formerName: '', effectiveFrom: '', effectiveTo: null },
};

function words(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
}

function fieldLabel(path: string[]): string {
  const meaningful = path.filter((part) => !/^\d+$/.test(part));
  const last = meaningful.at(-1) ?? 'value';
  if (last === 'displayAlias') return 'ALIAS';
  if (last === 'accountsDueDate') return 'Annual return due date';
  const parent = meaningful.at(-2);
  const prefix = parent === 'registered' || parent === 'mailing' ? `${words(parent)} ` : '';
  const label = `${prefix}${words(last)}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function isDateField(key: string): boolean {
  return /date|effectiveFrom|effectiveTo|fyeAsAtLastAr/i.test(key);
}

export function CompanyProfileValueEditor({ value, path, onChange }: { value: unknown; path: string[]; onChange: (value: unknown) => void }) {
  const key = path.at(-1) ?? '';
  const label = fieldLabel(path);
  if (Array.isArray(value)) {
    const contactKind = key === 'officers' ? 'officer' : key === 'shareholders' ? 'shareholder' : null;
    return <div className="space-y-3 sm:col-span-2">
      <div className="flex items-center justify-between"><p className="label mb-0">{label}</p><Button size="xs" variant="secondary" onClick={() => onChange([...value, { ...(arrayDefaults[key] ?? {}) }])} leftIcon={<Plus />}>Add {words(key).replace(/s$/, '')}</Button></div>
      {value.map((item, index) => <div key={index} className="rounded-lg border border-border-primary bg-background-primary p-3">
        <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-text-secondary">{label} {index + 1}</p><Button size="xs" variant="ghost" iconOnly aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} leftIcon={<Trash2 />} /></div>
        {contactKind && item && typeof item === 'object' ? <CompanyPersonContactLinker kind={contactKind} label={`${label} ${index + 1}`} value={item as Record<string, unknown>} onChange={(next) => onChange(value.map((entry, itemIndex) => itemIndex === index ? next : entry))} /> : null}
        <CompanyProfileValueEditor value={item} path={[...path, String(index)]} onChange={(next) => onChange(value.map((entry, itemIndex) => itemIndex === index ? next : entry))} />
      </div>)}
    </div>;
  }
  if (value && typeof value === 'object') {
    return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:col-span-2">{Object.entries(value as Record<string, unknown>).filter(([child]) => child !== 'id' && child !== 'contactId').map(([child, childValue]) => <CompanyProfileValueEditor key={child} value={childValue} path={[...path, child]} onChange={(next) => onChange({ ...(value as Record<string, unknown>), [child]: next })} />)}</div>;
  }
  if (value === null && objectDefaults[key]) {
    return <div><p className="label">{label}</p><Button variant="secondary" size="xs" onClick={() => onChange({ ...objectDefaults[key] })}>Add {words(key)}</Button></div>;
  }
  if (typeof value === 'boolean') {
    return <Toggle size="sm" labelPosition="top" label={label} checked={value} onChange={onChange} />;
  }
  const numeric = typeof value === 'number' || (value == null && COMPANY_PROFILE_NUMBER_FIELDS.has(key));
  const enumOptions = COMPANY_PROFILE_FIELD_OPTIONS[key];
  if (enumOptions) {
    return <div className="block text-sm">
      <SearchableSelect label={label} options={enumOptions} value={typeof value === 'string' ? value : ''} onChange={onChange} showKeyboardHints={false} />
    </div>;
  }
  if (isDateField(key)) {
    return <SingleDateInput label={label} value={value == null ? '' : String(value)} onChange={(next) => onChange(next || null)} />;
  }
  return <label className="block text-sm"><span className="label">{label}</span><input aria-label={label} className="input input-sm w-full" type={numeric ? 'number' : 'text'} step={numeric ? 'any' : undefined} maxLength={key === 'displayAlias' ? COMPANY_ALIAS_MAX_LENGTH : undefined} value={value == null ? '' : String(value)} onChange={(event) => onChange(numeric ? (event.target.value === '' ? null : Number(event.target.value)) : (event.target.value || ''))} />{key === 'displayAlias' ? <span className="mt-1 block text-xs text-text-muted">Short company alias; maximum {COMPANY_ALIAS_MAX_LENGTH} characters</span> : null}</label>;
}

export interface CompanyEditSectionProps {
  companyId: string;
  section: CompanyProfileSectionId;
  title: string;
  initialData?: CompanyProfileSectionDto;
  onSave?: (section: CompanyProfileSectionId, data: unknown, version: string) => Promise<CompanyProfileSectionDto>;
}

export function CompanyEditSection({ companyId, section, title, initialData, onSave }: CompanyEditSectionProps) {
  const query = useCompanyProfileSection(companyId, section, initialData);
  const mutation = useSaveCompanyProfileSection(companyId, section);
  const [draft, setDraft] = useState<unknown>(initialData?.data);
  const [version, setVersion] = useState(initialData?.version ?? '');
  const [baseline, setBaseline] = useState<unknown>(initialData?.data);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<CompanyProfileSectionDto | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  useEffect(() => {
    if (dirty) setJustSaved(false);
  }, [dirty]);

  useEffect(() => {
    if (!query.data || dirty) return;
    setDraft(query.data.data);
    setBaseline(query.data.data);
    setVersion(query.data.version);
  }, [dirty, query.data]);
  const save = async () => {
    if (!dirty) return;
    setError(null);
    setLatest(null);
    try {
      const saved = onSave ? await onSave(section, draft, version) : await mutation.mutateAsync({ data: draft, ifMatchVersion: version });
      setDraft(saved.data);
      setBaseline(saved.data);
      setVersion(saved.version);
      setJustSaved(true);
    } catch (caught) {
      const conflictLatest = caught instanceof CompanyProfileConflictError ? caught.latest : caught && typeof caught === 'object' && 'latest' in caught ? (caught as { latest: CompanyProfileSectionDto }).latest : null;
      if (conflictLatest) setLatest(conflictLatest);
      const issues = caught instanceof CompanyProfileSectionError ? caught.issues : [];
      const message = caught instanceof Error ? caught.message : 'Failed to save section';
      // Name the fields at fault, since the editor does not mark them itself.
      setError(issues.length > 0
        ? `Please correct these fields: ${issues.map((issue) => `${fieldLabel(issue.path.split('.'))} (${issue.message})`).join('; ')}`
        : message);
    }
  };

  if (query.isLoading || draft === undefined) return <div className="card p-4 text-sm text-text-secondary">Loading {title}…</div>;
  return <CompanyAccentSection title={title} actions={<div className="flex items-center gap-2">{justSaved ? <span role="status" className="flex items-center gap-1 text-xs text-status-success"><CheckCircle2 className="h-3.5 w-3.5" />Saved</span> : null}<Button size="xs" variant="secondary" disabled={!dirty} onClick={() => { setDraft(baseline); setError(null); setLatest(null); }}>Cancel</Button><Button size="xs" onClick={save} isLoading={mutation.isPending} disabled={!dirty} aria-label={`Save ${title}`}>Save section</Button></div>}>
    {error ? <div className="border-b border-status-error/30 bg-status-error/5 px-4 py-3 text-sm text-status-error"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</div>{latest ? <Button className="mt-2" size="xs" variant="secondary" onClick={() => { setDraft(latest.data); setBaseline(latest.data); setVersion(latest.version); setLatest(null); setError(null); }}>Reload latest section</Button> : null}</div> : null}
    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2"><CompanyProfileValueEditor value={draft} path={[section]} onChange={setDraft} /></div>
  </CompanyAccentSection>;
}
