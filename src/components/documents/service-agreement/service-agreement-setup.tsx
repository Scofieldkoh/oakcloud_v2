'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, ChevronDown, ChevronUp, ExternalLink, Search, UserRound } from 'lucide-react';
import { AsyncSearchSelect, type AsyncSearchSelectOption } from '@/components/ui/async-search-select';
import type { Company, DocumentContact } from '@/types/document-generation';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  insertRepresentativeByAuthority,
  moveRepresentative,
  rankAppointments,
} from '@/lib/representative-authority';

interface ServiceAgreementSetupProps {
  primaryCompany: Company | null;
  companies: Company[];
  contacts: DocumentContact[];
  entityIds: string[];
  authorizedContactIds: string[];
  authorizedRepresentativeRoles: Record<string, string>;
  signerContactIds: string[];
  onEntityIdsChange: (entityIds: string[]) => void;
  onBeforeEntityRemove?: (company: Company) => boolean;
  onRepresentativesChange: (
    contactIds: string[],
    roles: Record<string, string>,
  ) => void;
  onSignerContactIdsChange: (contactIds: string[]) => void;
  onSearchCompanies?: (query: string) => void;
  companySearchQuery?: string;
  companySearchLoading?: boolean;
  disabled?: boolean;
  /** Heading of the representatives list; the template author's section name when given. */
  representativesLabel?: string;
}

export function ServiceAgreementSetup({
  primaryCompany,
  companies,
  contacts,
  entityIds,
  authorizedContactIds,
  authorizedRepresentativeRoles,
  signerContactIds,
  onEntityIdsChange,
  onBeforeEntityRemove,
  onRepresentativesChange,
  onSignerContactIdsChange,
  onSearchCompanies,
  companySearchQuery = '',
  companySearchLoading = false,
  disabled = false,
  representativesLabel = 'Authorised representatives',
}: ServiceAgreementSetupProps) {
  const [contactQuery, setContactQuery] = useState('');
  const selectedIds = useMemo(() => new Set(entityIds), [entityIds]);
  const additionalCompanies = useMemo(
    () => companies.filter((company) => selectedIds.has(company.id) && company.id !== primaryCompany?.id),
    [companies, primaryCompany?.id, selectedIds],
  );
  const companyOptions = useMemo<Array<AsyncSearchSelectOption & { company: Company }>>(
    () => companies
      .filter((company) => company.id !== primaryCompany?.id && !selectedIds.has(company.id))
      .map((company) => ({
        id: company.id,
        label: company.name,
        description: company.uen || undefined,
        company,
      })),
    [companies, primaryCompany?.id, selectedIds],
  );
  const searchCompanies = onSearchCompanies ?? (() => undefined);
  const representativeIdSet = useMemo(
    () => new Set(authorizedContactIds),
    [authorizedContactIds],
  );
  const signerIdSet = useMemo(() => new Set(signerContactIds), [signerContactIds]);
  const normalizedContactQuery = contactQuery.trim().toLocaleLowerCase();
  const visibleContacts = useMemo(() => {
    const matching = contacts.filter((contact) =>
      !normalizedContactQuery || [
        contact.fullName,
        contact.designation,
        contact.email,
        contact.phone,
        ...(contact.appointments ?? []),
      ].some((value) => value?.toLocaleLowerCase().includes(normalizedContactQuery)));
    const rankById = new Map(authorizedContactIds.map((id, index) => [id, index]));
    return matching.toSorted((left, right) => {
      const leftRank = rankById.get(left.id);
      const rightRank = rankById.get(right.id);
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
      if (leftRank !== undefined) return -1;
      if (rightRank !== undefined) return 1;
      return 0;
    });
  }, [authorizedContactIds, contacts, normalizedContactQuery]);
  const missingContactDetails = useMemo(() => contacts.filter((contact) =>
    representativeIdSet.has(contact.id) && !contact.email && !contact.phone),
  [contacts, representativeIdSet]);

  const appointmentsFor = (contact: DocumentContact) => rankAppointments(
    contact.appointments?.length
      ? contact.appointments
      : contact.designation ? [contact.designation] : [],
  );
  const toggleRepresentative = (contact: DocumentContact) => {
    if (representativeIdSet.has(contact.id)) {
      const { [contact.id]: _removed, ...retainedRoles } = authorizedRepresentativeRoles;
      onRepresentativesChange(
        authorizedContactIds.filter((id) => id !== contact.id),
        retainedRoles,
      );
      return;
    }

    const defaultRole = appointmentsFor(contact)[0] ?? '';
    const roles = { ...authorizedRepresentativeRoles, [contact.id]: defaultRole };
    onRepresentativesChange(
      insertRepresentativeByAuthority(authorizedContactIds, contact.id, roles),
      roles,
    );
  };
  const toggleSigner = (contactId: string) => {
    const nextSignerIds = new Set(signerContactIds);
    if (nextSignerIds.has(contactId)) nextSignerIds.delete(contactId);
    else nextSignerIds.add(contactId);
    onSignerContactIdsChange(
      authorizedContactIds.filter((id) => nextSignerIds.has(id)),
    );
  };
  const changeAppointment = (contactId: string, role: string) => {
    onRepresentativesChange(authorizedContactIds, {
      ...authorizedRepresentativeRoles,
      [contactId]: role,
    });
  };
  const move = (contactId: string, direction: 'up' | 'down') => {
    onRepresentativesChange(
      moveRepresentative(authorizedContactIds, contactId, direction),
      authorizedRepresentativeRoles,
    );
  };
  const removeEntity = (company: Company) => {
    if (onBeforeEntityRemove && !onBeforeEntityRemove(company)) return;
    onEntityIdsChange(entityIds.filter((id) => id !== company.id));
  };
  return (
    <div className="space-y-4">
      <div className="mt-4">
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-text-secondary">
            {representativesLabel}
            <span className="ml-1 text-status-error" aria-hidden="true">*</span>
          </legend>
          <p className="text-xs text-text-muted">
            Select every representative, then choose one or more who will sign the agreement.
          </p>
          {contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-primary p-4 text-sm text-text-muted">
              No contacts are available for this company.
            </div>
          ) : (
            <>
              <div className="relative max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                <input
                  type="search"
                  value={contactQuery}
                  onChange={(event) => setContactQuery(event.target.value)}
                  disabled={disabled}
                  aria-label="Search authorised representatives"
                  placeholder="Search authorised representatives..."
                  className="min-h-11 w-full rounded-lg border border-border-primary bg-background-elevated py-2 pl-9 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 lg:min-h-9"
                />
              </div>
              <div className={cn(
                'max-h-[360px] max-w-xl overflow-y-auto rounded-lg border bg-background-primary',
                authorizedContactIds.length === 0 || signerContactIds.length === 0
                  ? 'border-status-error/40'
                  : 'border-border-primary',
              )}>
                {visibleContacts.map((contact) => {
                  const selected = representativeIdSet.has(contact.id);
                  const signer = signerIdSet.has(contact.id);
                  const representativeRank = authorizedContactIds.indexOf(contact.id);
                  const appointments = appointmentsFor(contact);
                  const selectedAppointment = authorizedRepresentativeRoles[contact.id]
                    ?? appointments[0]
                    ?? '';
                  const metadata = [contact.designation, contact.email, contact.phone]
                    .filter((value): value is string => Boolean(value));
                  return (
                    <div
                      key={contact.id}
                      data-representative-tile={selected ? '' : undefined}
                      className={cn(
                        'min-h-11 border-b border-border-secondary p-3 last:border-b-0',
                        selected && 'bg-oak-primary/5',
                        disabled && 'opacity-60',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRepresentative(contact)}
                            disabled={disabled}
                            aria-label={`Select ${contact.fullName} as an authorised representative`}
                            className="mt-1 h-4 w-4 shrink-0 accent-oak-primary"
                          />
                          {selected ? (
                            <span
                              aria-label={`${contact.fullName} rank ${representativeRank + 1}`}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-oak-primary text-xs font-semibold text-white"
                            >
                              {representativeRank + 1}
                            </span>
                          ) : (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
                              <UserRound className="h-4 w-4" aria-hidden="true" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <Link
                              href={`/contacts/${encodeURIComponent(contact.id)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              aria-label={`Open ${contact.fullName} contact details in a new tab`}
                              className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-oak-primary hover:underline"
                            >
                              <span className="truncate">{contact.fullName}</span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            </Link>
                            {metadata.length > 0 ? (
                              <span className="mt-0.5 block truncate text-xs text-text-muted">
                                {metadata.join(' · ')}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </div>
                      {selected ? (
                        <div className="mt-2 flex flex-wrap items-end gap-2 pl-7 sm:pl-11">
                          <label className="min-w-[12rem] flex-1 text-xs font-medium text-text-secondary">
                            Appointment
                            <select
                              value={selectedAppointment}
                              onChange={(event) => changeAppointment(contact.id, event.target.value)}
                              disabled={disabled}
                              aria-label={`Appointment for ${contact.fullName}`}
                              className="mt-1 min-h-11 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 lg:min-h-9"
                            >
                              {appointments.map((appointment) => (
                                <option key={appointment} value={appointment}>{appointment}</option>
                              ))}
                            </select>
                          </label>
                          <div className="flex items-center gap-1" aria-label={`Reorder ${contact.fullName}`}>
                            <button
                              type="button"
                              onClick={() => move(contact.id, 'up')}
                              disabled={disabled || representativeRank === 0}
                              aria-label={`Move ${contact.fullName} up`}
                              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border-primary text-text-secondary transition-colors hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-9 lg:min-w-9"
                            >
                              <ChevronUp className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => move(contact.id, 'down')}
                              disabled={disabled || representativeRank === authorizedContactIds.length - 1}
                              aria-label={`Move ${contact.fullName} down`}
                              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border-primary text-text-secondary transition-colors hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-9 lg:min-w-9"
                            >
                              <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border-primary px-3 text-xs font-medium text-text-secondary lg:min-h-9">
                            <input
                              type="checkbox"
                              checked={signer}
                              onChange={() => toggleSigner(contact.id)}
                              disabled={disabled || authorizedContactIds.length === 1}
                              aria-label={`Make ${contact.fullName} a signer`}
                              className="h-4 w-4 accent-oak-primary"
                            />
                            Signer
                          </label>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {visibleContacts.length === 0 ? (
                  <div className="p-5 text-center text-sm text-text-muted">
                    No contacts match your search.
                  </div>
                ) : null}
              </div>
            </>
          )}
          {authorizedContactIds.length === 0 ? (
            <p className="text-xs text-status-error" role="status">
              Select at least one authorised representative to continue.
            </p>
          ) : signerContactIds.length === 0 ? (
            <p className="text-xs text-status-error" role="status">
              Select at least one signer to continue.
            </p>
          ) : null}
          {missingContactDetails.length > 0 ? (
            <Alert variant="warning" compact title="Missing contact details">
              {missingContactDetails.map((contact) =>
                `${contact.fullName} has no email address or phone number.`).join(' ')}
            </Alert>
          ) : null}
        </fieldset>
      </div>
      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-text-primary">
          Appendix 3 - additional entities to add into the agreement
        </legend>
        <div className="mt-2 max-w-2xl">
          <AsyncSearchSelect
            value=""
            disabled={disabled}
            options={companyOptions}
            isLoading={companySearchLoading}
            searchQuery={companySearchQuery}
            onSearchChange={searchCompanies}
            onChange={(companyId) => {
              if (!companyId || selectedIds.has(companyId)) return;
              onEntityIdsChange([...entityIds, companyId]);
            }}
            placeholder="Search companies to add..."
            aria-label="Search additional agreement entities"
            icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
            emptySearchText="Start typing to search companies"
            noResultsText="No companies match that search"
          />
        </div>
        <div className="mt-2 space-y-1.5">
          {additionalCompanies.map((company) => (
            <label
              key={company.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm transition-colors hover:bg-background-secondary focus-within:ring-2 focus-within:ring-inset focus-within:ring-oak-primary/30"
            >
              <input
                type="checkbox"
                checked
                disabled={disabled}
                aria-label={`Remove ${company.name} from agreement entities`}
                onChange={() => removeEntity(company)}
                className="h-4 w-4 shrink-0 accent-oak-primary"
              />
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
                <Building2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-primary">{company.name}</span>
                {company.uen ? <span className="block truncate text-xs text-text-muted">{company.uen}</span> : null}
              </span>
            </label>
          ))}
          {additionalCompanies.length === 0 ? (
            <p className="text-sm text-text-muted">No additional entities selected.</p>
          ) : null}
        </div>
      </fieldset>
    </div>
  );
}
