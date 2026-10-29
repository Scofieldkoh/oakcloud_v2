'use client';

import { cn } from '@/lib/utils';
import { useEffect, useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { AsyncSearchSelect, type AsyncSearchSelectOption } from '@/components/ui/async-search-select';
import type { Company, DocumentContact } from '@/types/document-generation';
import type {
  BatchItemConfiguration,
  MasterFieldCatalogue,
  ServiceAgreementWorkspaceState,
} from '@/types/document-generation-batch';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { FormInput } from '@/components/ui/form-input';
import { formatAgreementTerm } from '@/lib/document-editor/oakdoc-context';
import { ServiceAgreementSetup } from '@/components/documents/service-agreement/service-agreement-setup';
import { ServiceSelectionStep } from '@/components/documents/service-agreement/service-selection-step';
import type {
  EditableBatchItem,
} from './batch-workspace-state';
import { BatchSection } from './batch-section';
import { rankAppointments } from '@/lib/representative-authority';
import type { OakDocRepeaterSectionSummary } from '@/lib/document-editor/oakdoc-custom-fields';
import { joinRepeaterSectionNames, repeaterSectionNames } from './template-party-needs';

export interface ServiceAgreementConfigProps {
  item: EditableBatchItem;
  primaryCompany: Company | null;
  companies: Company[];
  contacts: DocumentContact[];
  masterFields: MasterFieldCatalogue;
  effectiveMasterValues: Record<string, string>;
  onPatch: (patch: Partial<BatchItemConfiguration>) => void;
  disabled?: boolean;
  companySearchQuery?: string;
  onCompanySearch?: (query: string) => void;
  companySearchLoading?: boolean;
  onPrimaryCompanyChange?: (companyId: string | null, company: Company | null) => void;
  /** Names the author gave the template's entities, representatives and signers sections. */
  repeaterSections?: OakDocRepeaterSectionSummary | null;
}

function emptyWorkspace(primaryCompanyId: string | null): ServiceAgreementWorkspaceState {
  return {
    authorizedContactIds: [],
    authorizedRepresentativeRoles: {},
    signerContactIds: [],
    entityIds: primaryCompanyId ? [primaryCompanyId] : [],
    agreementDate: new Date().toISOString().slice(0, 10),
    effectiveDate: null,
    termMonths: 12,
    items: [],
  };
}

export function ServiceAgreementConfig({
  item,
  primaryCompany,
  companies,
  contacts,
  masterFields,
  effectiveMasterValues,
  onPatch,
  disabled = false,
  companySearchQuery = '',
  onCompanySearch = () => undefined,
  companySearchLoading = false,
  onPrimaryCompanyChange,
  repeaterSections = null,
}: ServiceAgreementConfigProps) {
  // The author's section names replace the generic headings.
  const partiesTitle = joinRepeaterSectionNames([
    ...repeaterSectionNames(repeaterSections, 'agreementEntities'),
    ...repeaterSectionNames(repeaterSections, 'authorisedRepresentatives'),
    ...repeaterSectionNames(repeaterSections, 'signers'),
  ]);
  const representativesLabel = joinRepeaterSectionNames(
    repeaterSectionNames(repeaterSections, 'authorisedRepresentatives'),
  );
  const workspace = item.configuration.serviceAgreement
    ?? emptyWorkspace(primaryCompany?.id ?? null);
  const inferredRepresentativeRoles = useMemo(() => {
    const roles = { ...(workspace.authorizedRepresentativeRoles ?? {}) };
    const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
    let changed = false;
    for (const contactId of workspace.authorizedContactIds) {
      if (roles[contactId]?.trim()) continue;
      const contact = contactById.get(contactId);
      if (!contact) continue;
      const defaultRole = rankAppointments(
        contact.appointments?.length
          ? contact.appointments
          : contact.designation ? [contact.designation] : [],
      )[0];
      if (!defaultRole) continue;
      roles[contactId] = defaultRole;
      changed = true;
    }
    return changed ? roles : null;
  }, [contacts, workspace.authorizedContactIds, workspace.authorizedRepresentativeRoles]);
  useEffect(() => {
    if (!inferredRepresentativeRoles) return;
    onPatch({
      serviceAgreement: {
        ...workspace,
        authorizedRepresentativeRoles: inferredRepresentativeRoles,
      },
    });
  }, [inferredRepresentativeRoles, onPatch, workspace]);
  const updateWorkspace = (patch: Partial<ServiceAgreementWorkspaceState>) => {
    onPatch({
      serviceAgreement: { ...workspace, ...patch },
    });
  };
  const entities = companies.filter((company) =>
    workspace.entityIds.includes(company.id));

  const titleMissing = item.configuration.title.trim().length === 0;
  const partiesComplete = workspace.authorizedContactIds.length > 0
    && workspace.signerContactIds.length > 0
    && workspace.entityIds.length > 0;
  const servicesComplete = workspace.items.length > 0;
  const requiredSharedFields = masterFields.fields.filter(
    (field) => field.requiredTemplateIds.includes(item.templateId),
  );
  const sharedMissing = requiredSharedFields.filter(
    (field) => !(effectiveMasterValues[field.key] ?? '').trim(),
  ).length;
  const companyOptions = useMemo<Array<AsyncSearchSelectOption & { company: Company }>>(() => {
    const byId = new Map<string, AsyncSearchSelectOption & { company: Company }>();
    for (const company of [primaryCompany, ...companies]) {
      if (!company || byId.has(company.id)) continue;
      byId.set(company.id, {
        id: company.id,
        label: company.name,
        description: company.uen || undefined,
        company,
      });
    }
    return [...byId.values()];
  }, [companies, primaryCompany]);
  const representativeContacts = useMemo(() => {
    const byId = new Map(contacts.map((contact) => [contact.id, contact]));
    for (const snapshot of item.serviceAgreement?.authorizedRepresentativeSnapshots ?? []) {
      if (byId.has(snapshot.id) || !workspace.authorizedContactIds.includes(snapshot.id)) continue;
      byId.set(snapshot.id, {
        id: snapshot.id,
        fullName: snapshot.name,
        email: snapshot.email,
        phone: snapshot.phone,
        designation: snapshot.role,
        appointments: snapshot.role ? [snapshot.role] : [],
      });
    }
    return [...byId.values()];
  }, [contacts, item.serviceAgreement?.authorizedRepresentativeSnapshots, workspace.authorizedContactIds]);

  return (
    <div className="space-y-3">
      <BatchSection
        title="Details"
        status={{
          complete: !titleMissing,
          label: titleMissing ? 'Title required' : 'Complete',
        }}
        collapsible={false}
      >
        <label className="block max-w-xl">
          <span className="text-sm font-medium text-text-primary">
            Document title
            <span className="ml-1 text-status-error" aria-hidden="true">*</span>
          </span>
          <input
            type="text"
            value={item.configuration.title}
            onChange={(event) => onPatch({ title: event.target.value })}
            disabled={disabled}
            aria-label="Document title"
            aria-required="true"
            aria-invalid={titleMissing || undefined}
            className={cn(
              'mt-1 min-h-11 w-full rounded-lg border bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 lg:min-h-10',
              titleMissing ? 'border-status-error/60' : 'border-border-primary',
            )}
          />
          {!titleMissing && (
            <span className="mt-1 block text-xs text-text-muted">
              {'Keep {{template_name}}_{{company_name}}_{{date}} to use the agreement date, or replace it with your own title.'}
            </span>
          )}
        </label>
      </BatchSection>

      <BatchSection title="Agreement details">
        <div className="grid max-w-full gap-4 sm:grid-cols-[17rem_minmax(22rem,44rem)]">
          <div className="block">
            <label htmlFor="agreement-date" className="mb-1.5 block text-sm font-medium text-text-primary">
              Agreement date
            </label>
            <SingleDateInput
              id="agreement-date"
              showTodayButton
              value={workspace.agreementDate}
              onChange={(next) => updateWorkspace({
                agreementDate: next,
                items: next
                  ? workspace.items.map((service) => {
                      const startDateOverridden = service.startDateOverridden
                        ?? service.startDate !== workspace.agreementDate;
                      return startDateOverridden
                        ? service
                        : { ...service, startDate: next, startDateOverridden: false };
                    })
                  : workspace.items,
              })}
              disabled={disabled}
              ariaLabel="Agreement date"
              className="w-[17rem] max-w-full"
              controlClassName="h-11"
            />
          </div>
          <div className="block">
            <AsyncSearchSelect
              label="Primary company"
              value={primaryCompany?.id ?? ''}
              options={companyOptions}
              isLoading={companySearchLoading}
              searchQuery={companySearchQuery}
              onSearchChange={onCompanySearch}
              onChange={(companyId, option) => {
                onPrimaryCompanyChange?.(companyId || null, option?.company ?? null);
              }}
              placeholder="Search primary company..."
              className="w-full max-w-none"
              allowReselect
              icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
              emptySearchText="Start typing to search companies"
              noResultsText="No companies match that search"
              disabled={disabled}
              controlClassName=""
            />
          </div>
        </div>
        <div className="mt-4 grid max-w-full gap-4 sm:grid-cols-[17rem_11rem]">
          <div className="block">
            <label htmlFor="agreement-effective-date" className="mb-1.5 block text-sm font-medium text-text-primary">
              Effective date
            </label>
            <SingleDateInput
              id="agreement-effective-date"
              showTodayButton
              value={workspace.effectiveDate ?? ''}
              onChange={(next) => updateWorkspace({ effectiveDate: next || null })}
              placeholder="Agreement date"
              disabled={disabled}
              ariaLabel="Effective date"
              className="w-[17rem] max-w-full"
              controlClassName="h-11"
            />
            <p className="mt-1 text-xs text-text-muted">Leave empty to use the agreement date.</p>
          </div>
          <FormInput
            id="agreement-term-months"
            label="Term (months)"
            type="number"
            min={1}
            max={1200}
            step={1}
            inputMode="numeric"
            value={workspace.termMonths}
            onChange={(event) => {
              const months = Number.parseInt(event.target.value, 10);
              updateWorkspace({ termMonths: Number.isFinite(months) ? months : 0 });
            }}
            error={formatAgreementTerm(workspace.termMonths) ? undefined : 'Enter at least 1 month.'}
            hint={`Shown in the agreement as "${formatAgreementTerm(workspace.termMonths) ?? ''}".`}
            disabled={disabled}
            containerClassName="w-44 max-w-full"
          />
        </div>
      </BatchSection>

      <BatchSection
        title={partiesTitle ?? 'Entities and representative'}
        status={{
          complete: partiesComplete,
          label: partiesComplete
            ? 'Complete'
            : workspace.authorizedContactIds.length === 0
              ? 'Representative required'
              : workspace.signerContactIds.length === 0
                ? 'Signer required'
              : 'Entity required',
        }}
      >
        <ServiceAgreementSetup
          primaryCompany={primaryCompany}
          companies={companies}
          contacts={representativeContacts}
          companySearchQuery={companySearchQuery}
          onSearchCompanies={onCompanySearch}
          companySearchLoading={companySearchLoading}
          entityIds={workspace.entityIds}
          authorizedContactIds={workspace.authorizedContactIds}
          authorizedRepresentativeRoles={workspace.authorizedRepresentativeRoles ?? {}}
          signerContactIds={workspace.signerContactIds}
          onEntityIdsChange={(entityIds) => updateWorkspace({ entityIds })}
          onRepresentativesChange={(authorizedContactIds, authorizedRepresentativeRoles) => {
            const currentSignerIds = new Set(workspace.signerContactIds);
            const retainedSignerIds = authorizedContactIds.filter((id) =>
              currentSignerIds.has(id));
            updateWorkspace({
              authorizedContactIds,
              authorizedRepresentativeRoles,
              signerContactIds: authorizedContactIds.length === 1
                ? [authorizedContactIds[0]]
                : retainedSignerIds,
            });
          }}
          onSignerContactIdsChange={(signerContactIds) =>
            updateWorkspace({ signerContactIds })}
          disabled={disabled}
          representativesLabel={representativesLabel ?? undefined}
        />
      </BatchSection>

      <BatchSection
        title="Services and fees"
        status={{
          complete: servicesComplete,
          label: servicesComplete
            ? `${workspace.items.length} service${workspace.items.length === 1 ? '' : 's'}`
            : 'At least one service required',
        }}
      >
        <ServiceSelectionStep
          entities={entities}
          agreementDate={workspace.agreementDate}
          items={workspace.items}
          onChange={(items) => updateWorkspace({ items })}
        />
      </BatchSection>

      {masterFields.fields.length > 0 && (
        <BatchSection
          title="Shared values"
          defaultOpen={false}
          status={requiredSharedFields.length > 0
            ? {
                complete: sharedMissing === 0,
                label: sharedMissing === 0 ? 'Complete' : `${sharedMissing} missing`,
              }
            : null}
        >
          <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {masterFields.fields.map((field) => (
              <div
                key={field.id}
                className="rounded-lg border border-border-primary bg-background-primary p-3"
              >
                <dt className="text-xs font-medium text-text-secondary">{field.label}</dt>
                <dd className="mt-1 text-sm text-text-primary">
                  {effectiveMasterValues[field.key] || '—'}
                </dd>
              </div>
            ))}
          </dl>
        </BatchSection>
      )}
    </div>
  );
}
