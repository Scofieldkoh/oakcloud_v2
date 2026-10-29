'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CompanyAccentSection } from '@/components/companies/company-accent-section';
import { getCompanyDisplayLabel } from '@/lib/company-display-label';
import type { CompanyWithRelations } from '@/services/company/types';
import { addMonthsClamped, type DateOnly } from '@/services/service-schedule';
import { ActiveBadge, OfficerRoleBadge, ShareholderTypeBadge } from './company-profile-badges';
import { CompanySharePointFolderField } from '@/components/companies/company-sharepoint-folder-field';

function day(value: Date | string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-SG', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function money(currency: string, value: number | string | { toString(): string }): string {
  const amount = Number(value.toString());
  return `${currency} ${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function number(value: number): string {
  return value.toLocaleString('en-SG');
}

function attributedCapital(input: {
  currency: string;
  shareholderShares: number;
  classShares: number;
  classValue: number | string | { toString(): string };
}) {
  const classValue = Number(input.classValue.toString());
  if (input.classShares <= 0 || !Number.isFinite(classValue)) return null;
  return {
    currency: input.currency,
    amount: ((input.shareholderShares / input.classShares) * classValue).toFixed(2),
  };
}

function title(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

function previousMonth(value: Date | string | null | undefined): DateOnly | null {
  if (!value) return null;
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : isoDate(value);
  if (!date) return null;
  try {
    return addMonthsClamped(date as DateOnly, -1);
  } catch {
    return null;
  }
}

function acraSourceBadge(
  company: CompanyWithRelations,
  acraField: 'annualReturnDate' | 'accountDueDate',
) {
  const record = company.acraRecord;
  if (!record?.dataAsOf) return null;
  const acraValue = isoDate(record[acraField]);
  if (!acraValue) return null;
  const stored = acraField === 'annualReturnDate' ? company.lastArFiledDate : company.accountsDueDate;
  const storedValue = isoDate(stored ? new Date(stored).toISOString() : null);
  if (storedValue !== acraValue) return null;
  return <span className="badge badge-neutral">ACRA {day(record.dataAsOf.slice(0, 10))}</span>;
}

function Section({ title: heading, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return <CompanyAccentSection title={heading} actions={actions}>{children}</CompanyAccentSection>;
}

function Filter({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-white">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-3.5 w-3.5 rounded-sm border-white/50 accent-white" />
    {label}
  </label>;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">{children}</p>;
}

export function CompanyProfileSections({ company, companyId, canEdit = false, onRetrieveAcra, isRetrievingAcra }: { company: CompanyWithRelations; companyId: string; canEdit?: boolean; onRetrieveAcra?: () => void; isRetrievingAcra?: boolean }) {
  const firstPeriod = company.financialPeriods?.[0] ?? null;
  const [showCeased, setShowCeased] = useState(false);
  const [showFormer, setShowFormer] = useState(false);
  const [showDischarged, setShowDischarged] = useState(false);
  const officers = (company.officers ?? []).filter((officer) => showCeased || (officer.isCurrent && !officer.cessationDate));
  const shareholders = (company.shareholders ?? []).filter((shareholder) => showFormer || shareholder.isCurrent);
  const charges = (company.charges ?? []).filter((charge) => showDischarged || !charge.isFullyDischarged);
  const registered = company.addresses?.find((address) => address.addressType === 'REGISTERED_OFFICE' && address.isCurrent);
  const mailing = company.addresses?.find((address) => address.addressType === 'MAILING' && address.isCurrent);

  return <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
    <div className="space-y-3 lg:col-span-2">
      <Section title="Addresses">
        <div className="space-y-3 p-3 text-sm text-text-primary">
          <div>
            <FieldLabel>Registered office</FieldLabel>
            <p>{registered ? <>{registered.fullAddress}{registered.effectiveFrom ? ` (effective from: ${day(registered.effectiveFrom)})` : ''}</> : '-'}</p>
          </div>
          <div className="border-t border-border-primary pt-3">
            <FieldLabel>Mailing address</FieldLabel>
            <p>{mailing?.fullAddress ?? '-'}</p>
          </div>
        </div>
      </Section>

      <Section title="Business activities">
        <div className="grid gap-4 p-3 text-sm sm:grid-cols-2 sm:gap-8">
          <div><FieldLabel>Primary activity</FieldLabel><p>{company.primarySsicCode ? `${company.primarySsicCode} · ${company.primarySsicDescription ?? ''}` : '-'}</p></div>
          <div><FieldLabel>Secondary activity</FieldLabel><p>{company.secondarySsicCode ? `${company.secondarySsicCode} · ${company.secondarySsicDescription ?? ''}` : '-'}</p></div>
        </div>
      </Section>

      <Section title="Officers" actions={<div className="flex items-center gap-3"><span className="text-xs font-medium">{(company.officers ?? []).filter((item) => item.isCurrent && !item.cessationDate).length} active</span><Filter label="Show ceased" checked={showCeased} onChange={setShowCeased} /></div>}>
        <div className="divide-y divide-border-primary px-3">
          {officers.length ? officers.map((officer) => <div key={officer.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">{officer.contactId ? <Link href={`/contacts/${officer.contactId}`} className="text-oak-primary hover:underline">{officer.name}</Link> : <span>{officer.name}</span>}<OfficerRoleBadge role={officer.role} /></div>
              <p className="mt-1 text-xs text-text-secondary">{officer.appointmentDate ? `Appointed ${day(officer.appointmentDate)}` : 'Appointment date unavailable'}{officer.nationality ? ` · ${officer.nationality}` : ''}{officer.cessationDate ? ` · Ceased ${day(officer.cessationDate)}` : ''}</p>
            </div>
            {officer.isCurrent && !officer.cessationDate ? <ActiveBadge /> : null}
          </div>) : <p className="py-3 text-sm text-text-secondary">No officer records</p>}
        </div>
      </Section>

      <Section title="Shareholders" actions={<div className="flex items-center gap-3"><span className="text-xs font-medium">{(company.shareholders ?? []).filter((item) => item.isCurrent).length} current</span><Filter label="Show former" checked={showFormer} onChange={setShowFormer} /></div>}>
        <div className="divide-y divide-border-primary px-3">
          {shareholders.length ? shareholders.map((shareholder) => {
            const shareClass = company.shareCapital?.find((capital) => !capital.isTreasury && capital.shareClass.toLowerCase() === (shareholder.shareClass ?? 'ORDINARY').toLowerCase());
            const attributed = shareClass ? attributedCapital({
              currency: shareholder.currency ?? shareClass.currency,
              shareholderShares: shareholder.numberOfShares,
              classShares: shareClass.numberOfShares,
              classValue: shareClass.totalValue,
            }) : null;
            const ownership = shareholder.percentageHeld == null ? null : Number(shareholder.percentageHeld);
            return <div key={shareholder.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                <span>{shareholder.contactId ? <Link href={`/contacts/${shareholder.contactId}`} className="text-oak-primary hover:underline">{shareholder.name}</Link> : shareholder.name}{ownership == null ? '' : ` (${ownership.toLocaleString('en-SG')}% ownership)`}</span>
                <ShareholderTypeBadge type={shareholder.shareholderType ?? 'INDIVIDUAL'} />
                {shareholder.isNominee ? <span className="badge badge-neutral">Nominee</span> : null}
              </div>
              <p className="mt-1 text-xs text-text-secondary">{attributed ? money(attributed.currency, attributed.amount) : 'Value unavailable'} / {number(shareholder.numberOfShares)} {title(shareholder.shareClass ?? 'ORDINARY')} Shares</p>
            </div>;
          }) : <p className="py-3 text-sm text-text-secondary">No shareholder records</p>}
        </div>
      </Section>

      <Section title="Additional company information">
        <div className="grid gap-4 border-b border-border-primary p-3 text-sm sm:grid-cols-2">
          <div><FieldLabel>ALIAS</FieldLabel><p>{getCompanyDisplayLabel(company)}</p></div>
        </div>
        <div className="divide-y divide-border-primary text-sm">
          <CompanySharePointFolderField company={company} canEdit={canEdit} />
          <details className="group px-3 py-2.5">
            <summary className="cursor-pointer font-medium text-text-primary">Company history</summary>
            <div className="mt-3 space-y-2 text-text-secondary">
              {company.formerNames?.length ? company.formerNames.map((record) => <p key={record.id}>{record.formerName} ({day(record.effectiveFrom)}{record.effectiveTo ? ` – ${day(record.effectiveTo)}` : ''})</p>) : <p>No former names</p>}
              {company.registrationDate ? <p>Registered {day(company.registrationDate)}</p> : null}
            </div>
          </details>
          <details className="group px-3 py-2.5">
            <summary className="cursor-pointer font-medium text-text-primary">Auditor</summary>
            <div className="mt-3 space-y-1 text-text-secondary">{company.auditor ? <><p>{company.auditor.name}</p>{company.auditor.address ? <p>{company.auditor.address}</p> : null}{company.auditor.appointmentDate ? <p>Appointed {day(company.auditor.appointmentDate)}</p> : null}</> : <p>No auditor recorded</p>}</div>
          </details>
        </div>
      </Section>
    </div>

    <aside className="space-y-3">
      <Section title="Compliance" actions={onRetrieveAcra ? (
        <button
          type="button"
          onClick={onRetrieveAcra}
          disabled={isRetrievingAcra}
          className="rounded border border-white/50 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRetrievingAcra ? 'Retrieving…' : 'Retrieve ACRA'}
        </button>
      ) : undefined}>
        <div className="grid grid-cols-2 gap-4 p-3 text-sm">
          <div><FieldLabel>Incorporation date</FieldLabel><p>{day(company.incorporationDate)}</p></div>
          <div><FieldLabel>Home currency</FieldLabel><p>{company.homeCurrency ?? '-'}</p></div>
          <div><FieldLabel>Financial year end</FieldLabel><p>{company.financialYearEndDay && company.financialYearEndMonth ? `${company.financialYearEndDay} ${new Date(2000, company.financialYearEndMonth - 1).toLocaleString('en-SG', { month: 'long' })}` : '-'}</p></div>
          <div><FieldLabel>First financial year end</FieldLabel><p>{firstPeriod ? day(firstPeriod.periodEnd) : '-'}</p></div>
          <div><FieldLabel>Last AGM</FieldLabel><p>{day(company.lastAgmDate)}</p></div>
          <div><FieldLabel>Last annual return</FieldLabel><p className="flex flex-wrap items-center gap-1.5">{day(company.lastArFiledDate)}{acraSourceBadge(company, 'annualReturnDate')}</p></div>
          <div><FieldLabel>Next AGM due date</FieldLabel><p>{day(previousMonth(company.accountsDueDate))}</p></div>
          <div><FieldLabel>Annual return due date</FieldLabel><p className="flex flex-wrap items-center gap-1.5">{day(company.accountsDueDate)}{acraSourceBadge(company, 'accountDueDate')}</p></div>
          <div><FieldLabel>FYE as at last AR</FieldLabel><p>{day(company.fyeAsAtLastAr)}</p></div>
        </div>
      </Section>

      <Section title="Capital">
        <div className="grid grid-cols-2 gap-4 p-3 text-sm">
          <div><FieldLabel>Paid-up capital</FieldLabel><p>{company.paidUpCapitalAmount == null ? '-' : money(company.paidUpCapitalCurrency ?? company.homeCurrency ?? 'SGD', company.paidUpCapitalAmount)}</p></div>
          <div><FieldLabel>Issued capital</FieldLabel><p>{company.issuedCapitalAmount == null ? '-' : money(company.issuedCapitalCurrency ?? company.homeCurrency ?? 'SGD', company.issuedCapitalAmount)}</p></div>
        </div>
        <details open className="border-t border-border-primary px-3 py-2.5 text-sm">
          <summary className="cursor-pointer font-medium text-oak-primary">Show share capital breakdown</summary>
          <div className="mt-3 space-y-2 text-text-secondary">{company.shareCapital?.length ? company.shareCapital.map((capital) => <p key={capital.id}>{money(capital.currency, capital.totalValue)} / {number(capital.numberOfShares)} {title(capital.shareClass)} Shares{capital.isTreasury ? ' · Treasury' : ''}{capital.parValue != null ? ` · Par ${money(capital.currency, capital.parValue)}` : ''}</p>) : <p>No class breakdown</p>}</div>
        </details>
      </Section>

      <Section title="Charges" actions={<Filter label="Show discharged" checked={showDischarged} onChange={setShowDischarged} />}>
        <div className="divide-y divide-border-primary px-3">
          {charges.length ? charges.map((charge) => <div key={charge.id} className="flex items-center justify-between gap-3 py-3 text-sm">
            <div><p className="font-medium text-text-primary">{charge.chargeHolderName}</p><p className="mt-1 text-xs text-text-secondary">{[charge.chargeType, charge.registrationDate ? `Registered ${day(charge.registrationDate)}` : null, charge.amountSecured != null ? money(charge.currency ?? company.homeCurrency ?? 'SGD', charge.amountSecured) : charge.amountSecuredText].filter(Boolean).join(' · ')}</p></div>
            {!charge.isFullyDischarged ? <ActiveBadge /> : null}
          </div>) : <p className="py-3 text-sm text-text-secondary">No charge records</p>}
        </div>
      </Section>

      <Section title="Documents" actions={<span className="text-xs font-medium">{company._count?.documents ?? 0}</span>}>
        <div className="p-3">
          <Link href={`/processing?companyId=${companyId}`} className="btn-secondary btn-sm w-full justify-center">
            View All Documents
          </Link>
        </div>
      </Section>
    </aside>
  </div>;
}
