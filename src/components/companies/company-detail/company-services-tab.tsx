'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import Link from 'next/link';
import { BriefcaseBusiness, History, Pencil, Plus, Search, X } from 'lucide-react';
import { CompanyAccentSection } from '@/components/companies/company-accent-section';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { formatDate } from '@/lib/utils';
import { useClientServices, useRetryServiceAgreementActivation } from '@/hooks/use-client-services';
import { useServicesWorkspaceSettings } from '@/hooks/use-services-workspace-settings';
import type { ClientServiceDto } from '@/services/client-service';
import { ClientServiceEditor } from './client-service-editor';
import { ClientServiceCreator } from './client-service-creator';
import { ManualCycleDialog } from '@/components/services/deadlines/manual-cycle-dialog';
import { tieredPricingSummary } from '@/services/billing/tiered-pricing';

const label = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
const currencySymbols: Record<string, string> = { SGD: 'S$', USD: 'US$', EUR: '\u20ac', GBP: '\u00a3', JPY: '\u00a5', HKD: 'HK$', AUD: 'A$', MYR: 'RM' };
function formatFixedCurrency(amount: string, currency: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) return `${currency} ${amount}`;
  const integer = match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return `${currencySymbols[currency] ?? `${currency} `}${integer}.${fraction}`;
}

export function CompanyServicesTab({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState<'ACTIVE' | 'PAUSED' | 'ENDED' | undefined>();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [retryError, setRetryError] = useState('');
  const [editing, setEditing] = useState<ClientServiceDto | null>(null);
  const [triggering, setTriggering] = useState<ClientServiceDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdService, setCreatedService] = useState<ClientServiceDto | null>(null);
  const { data, isLoading, error, refetch } = useClientServices(companyId, { query: deferredQuery || undefined, status, page, limit });
  const workspaceSettings = useServicesWorkspaceSettings();
  const canTrigger = canEdit
    && workspaceSettings.data?.workspaceEnabled === true
    && workspaceSettings.data?.deadlineWritesEnabled === true;
  const retryActivation = useRetryServiceAgreementActivation();
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / limit));
  const filtered = Boolean(query.trim()) || Boolean(status);

  const viewCreatedService = () => {
    if (!createdService) return;
    const queryExcludes = Boolean(query.trim()) && ![createdService.serviceName, createdService.familyName]
      .some((value) => value.toLowerCase().includes(query.trim().toLowerCase()));
    const statusExcludes = Boolean(status) && status !== createdService.status;
    if (queryExcludes) setQuery('');
    if (statusExcludes) setStatus(undefined);
    if (queryExcludes || statusExcludes) setPage(1);
    setEditing(createdService);
  };

  useEffect(() => { setPage(1); }, [deferredQuery, status]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  if (isLoading) return <div className="space-y-3" aria-label="Loading services"><div className="h-10 skeleton" /><div className="h-24 skeleton" /></div>;
  if (error) return <Alert variant="error">{error instanceof Error ? error.message : 'Unable to load services'}</Alert>;

  const services = data?.services ?? [];
  const activations = data?.activations ?? [];
  return <div className="space-y-4">
    {retryError ? <Alert variant="error">{retryError}</Alert> : null}
    {createdService ? (
      <Alert variant="success" className="flex-wrap">
        <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
          <span>{createdService.serviceName} was added.</span>
          <Button size="xs" variant="secondary" onClick={viewCreatedService}>View service</Button>
        </div>
      </Alert>
    ) : null}
    {activations.map((activation) => {
      const failed = activation.activationStatus.startsWith('FAILED');
      return <Alert key={activation.agreementId} variant={failed ? 'error' : 'warning'}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><span className="font-medium">{activation.title}</span><span className="ml-2">{failed ? activation.activationLastError ?? 'Activation failed' : 'Service activation is pending.'}</span></div>
          {failed && canEdit && activation.canRetry ? <Button size="xs" variant="secondary" isLoading={retryActivation.isPending} onClick={async () => { setRetryError(''); try { await retryActivation.mutateAsync({ agreementId: activation.agreementId, companyId }); } catch (retryFailure) { setRetryError(retryFailure instanceof Error ? retryFailure.message : 'Unable to retry activation.'); } }} aria-label="Retry activation">Retry</Button> : null}
        </div>
      </Alert>;
    })}
    <CompanyAccentSection title="Services" actions={<span className="text-xs font-medium text-white">{data?.total ?? 0}</span>}>
      <div className="flex flex-col gap-3 border-b border-border-primary p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input aria-label="Search services" className="input input-sm w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services" />
          {query ? <button type="button" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-background-tertiary rounded" aria-label="Clear service search"><X className="h-3.5 w-3.5 text-text-muted" /></button> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-2" aria-label="Service status filters">{[undefined, 'ACTIVE', 'PAUSED', 'ENDED'].map((value) => <Button key={value ?? 'ALL'} size="xs" variant={status === value ? 'primary' : 'secondary'} onClick={() => setStatus(value as typeof status)}>{value ? label(value) : 'All'}</Button>)}</div>
          {canEdit ? <Button size="xs" variant="secondary" leftIcon={<Plus />} onClick={() => setCreating(true)} aria-label="Add service">Add service</Button> : null}
        </div>
      </div>
      {services.length === 0 ? <div className="flex flex-col items-center px-4 py-10 text-center sm:py-12"><BriefcaseBusiness className="mx-auto mb-3 h-10 w-10 text-text-muted" /><h3 className="font-medium text-text-primary">{filtered ? 'No matching services' : 'No services yet'}</h3><p className="mt-1 text-sm text-text-secondary">{filtered ? 'Try adjusting your search or status filter.' : 'Services appear here when they are added manually or activated from a Service Agreement.'}</p>{!filtered && canEdit ? <Button className="mt-4" size="sm" variant="secondary" leftIcon={<Plus />} onClick={() => setCreating(true)}>Add service</Button> : null}</div> : <div className="divide-y divide-border-primary">{services.map((service) => {
        const fee = service.feeLines[0];
        const additionalFeeCount = service.feeLines.length - 1;
        return <article key={service.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium text-text-primary">{service.serviceName}</h3><span className={`badge ${service.status === 'ACTIVE' ? 'badge-success' : service.status === 'PAUSED' ? 'badge-warning' : 'badge-neutral'}`}>{label(service.status)}</span></div><p className="mt-1 text-sm text-text-secondary">{service.familyName}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted"><span>{label(service.serviceCadence)}</span><span>{formatDate(service.startDate)}{service.endDate ? ` \u2013 ${formatDate(service.endDate)}` : ''}</span>{fee ? <span>{fee.tieredPricing ? tieredPricingSummary(fee.tieredPricing) : formatFixedCurrency(fee.amount, fee.currency)} {fee.billingTiming === 'POSTPAID' ? 'postpaid' : label(fee.billingFrequency).toLowerCase()}{additionalFeeCount > 0 ? ` \u00b7 ${additionalFeeCount} additional fee${additionalFeeCount === 1 ? '' : 's'}` : ''}</span> : null}</div>{service.source === 'MANUAL' ? (
          <span className="mt-2 inline-flex text-sm text-text-muted">Added manually</span>
        ) : service.agreement ? (
          <Link className="mt-2 inline-flex text-sm text-oak-light hover:underline" href={service.agreement.href}>
            {service.agreement.title || 'Service Agreement'}
          </Link>
        ) : null}</div>{canEdit ? <div className="flex flex-wrap gap-2">{canTrigger ? <Button size="xs" variant="secondary" className="min-h-11" leftIcon={<History />} onClick={() => setTriggering(service)} aria-label={`Trigger historical cycle for ${service.serviceName}`}>Trigger cycle</Button> : null}<Button size="xs" variant="secondary" className="min-h-11" leftIcon={<Pencil />} onClick={() => setEditing(service)} aria-label="Edit service">Edit</Button></div> : null}</article>;
      })}</div>}
      {(data?.total ?? 0) > limit ? <div className="border-t border-border-primary"><Pagination page={page} totalPages={totalPages} total={data?.total ?? 0} limit={limit} onPageChange={setPage} onLimitChange={(nextLimit) => { setLimit(nextLimit); setPage(1); }} /></div> : null}
    </CompanyAccentSection>
    {editing ? <ClientServiceEditor key={editing.id} service={editing} isOpen onClose={() => setEditing(null)} /> : null}
    {creating ? <ClientServiceCreator companyId={companyId} isOpen onClose={() => setCreating(false)} onCreated={(service) => { setCreating(false); setCreatedService(service); }} /> : null}
    {canTrigger && triggering ? <ManualCycleDialog clientServiceId={triggering.id} isOpen canApply={canTrigger} onClose={() => setTriggering(null)} onApplied={() => { setTriggering(null); void refetch?.(); }} /> : null}
  </div>;
}
