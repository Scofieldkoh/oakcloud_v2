'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  isHttpRequestError,
  previewClientServiceDeadlineDraft,
  useCompanyObligations,
  useCreateManualClientService,
  useManualClientServiceCatalogOptions,
} from '@/hooks/use-client-services';
import type { ClientServiceDto, DuplicateClientServiceMatches, ManualClientServiceCatalogVariantOption } from '@/services/client-service';
import { OperationalServiceForm, companyObligationKey, toCompanyObligationsState } from './operational-service-form';
import { FirstFinancialPeriodDialog } from './first-financial-period-dialog';
import type { CompanyObligationStatus } from '@/services/compliance-monitoring/obligation-status';
import { ServiceCompanyContext } from './service-company-context';
import {
  catalogReplacementForVariant,
  createManualPayload,
  deadlineDraftPreviewPayload,
  emptyManualOperationalValues,
  impactWarningsToStrings,
  manualFormIsDirty,
  operationalErrorsFromServer,
  replacementValuesChanged,
  validateOperationalServiceValues,
  type DeadlinePreviewState,
  type OperationalFieldErrors,
  type OperationalServiceValues,
} from './client-service-form-state';

const CADENCE_LABEL_MAP: Record<string, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMI_ANNUALLY: 'Semi-annually',
  ANNUALLY: 'Annually',
  ONE_TIME: 'One-time',
  AD_HOC: 'Ad-hoc',
  CUSTOM: 'Custom',
};

const DRAFT_PREVIEW_DEBOUNCE_MS = 300;

export function ClientServiceCreator({
  companyId,
  isOpen,
  onClose,
  onCreated,
}: {
  companyId: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (service: ClientServiceDto) => void;
}) {
  const catalog = useManualClientServiceCatalogOptions(companyId, isOpen);
  const createService = useCreateManualClientService();
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [values, setValues] = useState<OperationalServiceValues>(emptyManualOperationalValues);
  const [replacement, setReplacement] = useState<OperationalServiceValues | null>(null);
  const [errors, setErrors] = useState<OperationalFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateClientServiceMatches | null>(null);
  const [pendingVariantId, setPendingVariantId] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [deadlinePreview, setDeadlinePreview] = useState<DeadlinePreviewState>({ state: 'IDLE', items: [], warnings: [] });
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTokenRef = useRef(0);

  const pending = createService.isPending;
  const selectedVariant = catalog.data?.variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const selectedVariantMissing = Boolean(
    selectedVariantId && catalog.data && !selectedVariant,
  );
  const selectorError = errors.serviceVariantId
    ?? (selectedVariantMissing
      ? 'This catalog service is no longer available. Choose another service.'
      : undefined);
  const selectOptions = useMemo(() => (catalog.data?.variants ?? []).map((variant) => ({
    value: variant.id,
    label: variant.name,
    group: variant.family.name,
    description: variant.customCadenceLabel ?? (CADENCE_LABEL_MAP[variant.serviceCadence] ?? variant.serviceCadence),
  })), [catalog.data]);
  const dirty = manualFormIsDirty(selectedVariantId, values);
  const selectedProfiles = selectedVariant?.monitoringProfiles ?? [];
  const [obligationStatuses, setObligationStatuses] = useState<Record<string, CompanyObligationStatus>>({});
  const [engagementStartYa, setEngagementStartYa] = useState<number | null>(null);
  const [firstPeriodOpen, setFirstPeriodOpen] = useState(false);
  const companyObligations = useCompanyObligations(
    companyId,
    { profiles: selectedProfiles, start: values.startDate || null, end: values.endDate || null, fromYa: engagementStartYa },
    isOpen && selectedProfiles.length > 0,
  );

  const runDraftPreview = useCallback(async () => {
    if (!selectedVariant) return;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    const token = previewTokenRef.current + 1;
    previewTokenRef.current = token;
    setDeadlinePreview((previous) => ({
      state: 'LOADING',
      items: 'items' in previous ? previous.items : [],
      warnings: 'warnings' in previous ? previous.warnings : [],
    }));
    try {
      const result = await previewClientServiceDeadlineDraft(
        deadlineDraftPreviewPayload(companyId, selectedVariant.id, values),
        controller.signal,
      );
      if (token !== previewTokenRef.current || controller.signal.aborted) return;
      setDeadlinePreview({
        state: 'SUCCESS',
        items: result.projectedDeadlines,
        warnings: impactWarningsToStrings(result.warnings),
        fingerprint: '',
        payloadHash: '',
      });
    } catch (error) {
      if (controller.signal.aborted || token !== previewTokenRef.current) return;
      setDeadlinePreview({
        state: 'ERROR',
        items: [],
        warnings: [],
        message: error instanceof Error ? error.message : 'Deadline preview failed.',
      });
    }
  }, [companyId, selectedVariant, values]);

  useEffect(() => {
    if (!isOpen || !selectedVariant) return;
    const timeout = setTimeout(() => {
      void runDraftPreview();
    }, DRAFT_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [isOpen, selectedVariant, values, runDraftPreview]);

  useEffect(() => {
    if (!isOpen) {
      previewAbortRef.current?.abort();
      previewTokenRef.current += 1;
    }
  }, [isOpen]);

  const abortDraftPreview = () => {
    previewAbortRef.current?.abort();
    previewTokenRef.current += 1;
  };

  const applyVariant = (variant: ManualClientServiceCatalogVariantOption) => {
    const next = catalogReplacementForVariant(variant);
    setValues((current) => ({ ...next, status: current.status, startDate: current.startDate, endDate: current.endDate }));
    setReplacement(next);
    setSelectedVariantId(variant.id);
    setObligationStatuses({});
    setEngagementStartYa(null);
    setErrors({});
    setDuplicates(null);
    setFormError('');
  };

  const requestVariantChange = (variantId: string) => {
    const next = catalog.data?.variants.find((variant) => variant.id === variantId);
    if (!next) return;
    if (replacement && replacementValuesChanged(values, replacement)) {
      setPendingVariantId(variantId);
      return;
    }
    applyVariant(next);
  };

  const confirmVariantChange = () => {
    const next = catalog.data?.variants.find((variant) => variant.id === pendingVariantId);
    if (next) applyVariant(next);
    setPendingVariantId(null);
  };

  const requestClose = () => {
    if (pending) return;
    if (dirty) {
      setCloseConfirmOpen(true);
      return;
    }
    abortDraftPreview();
    onClose();
  };

  const confirmClose = () => {
    setCloseConfirmOpen(false);
    setDuplicates(null);
    setFormError('');
    setErrors({});
    setValues(emptyManualOperationalValues());
    setSelectedVariantId('');
    setObligationStatuses({});
    setEngagementStartYa(null);
    setReplacement(null);
    abortDraftPreview();
    onClose();
  };

  const submit = async (confirmDuplicate: boolean) => {
    if (!selectedVariantId) return;
    if (!selectedVariant) {
      setErrors((current) => ({
        ...current,
        serviceVariantId: 'This catalog service is no longer available. Choose another service.',
      }));
      return;
    }
    const validationErrors = validateOperationalServiceValues(values);
    if (Object.values(validationErrors).some(Boolean)) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setFormError('');
    try {
      const created = await createService.mutateAsync({
        companyId,
        data: {
          ...createManualPayload(selectedVariantId, values, confirmDuplicate),
          companyObligationStatuses: selectedProfiles.length > 0 ? Object.entries(obligationStatuses).map(([key, status]) => {
            const [obligationCode, periodKey] = key.split('|') as [string, string];
            return { obligationCode, periodKey, status };
          }) : [],
          engagementStartYearOfAssessment: selectedProfiles.length > 0 ? engagementStartYa : null,
        },
      });
      abortDraftPreview();
      onCreated(created);
    } catch (error) {
      if (isHttpRequestError(error, 409) && error.body.duplicates) {
        setDuplicates(error.body.duplicates);
        return;
      }
      if (isHttpRequestError(error, 400) && error.code === 'VALIDATION_ERROR') {
        const nextErrors = operationalErrorsFromServer(error.details, values);
        setErrors(nextErrors);
        setFormError(
          Object.keys(nextErrors).length > 0
            ? 'Review the highlighted fields and try again.'
            : error.message,
        );
        return;
      }
      if (isHttpRequestError(error, 404)) {
        setErrors({ serviceVariantId: error.message });
        return;
      }
      setFormError(error instanceof Error ? error.message : 'Unable to create service.');
    }
  };

  const serviceSelector = (
    <div>
      <SearchableSelect
        label="Service"
        placeholder="Select service"
        options={selectOptions}
        value={selectedVariantId}
        onChange={requestVariantChange}
        disabled={pending}
        loading={catalog.isLoading}
        groupBy="group"
        clearable={false}
        error={selectorError}
      />
      {catalog.isLoading ? <p role="status" className="mt-1.5 text-xs text-text-secondary">Loading service catalog…</p> : null}
      {!catalog.isLoading && catalog.error ? <p className="mt-1.5 text-xs text-status-error">{catalog.error instanceof Error ? catalog.error.message : 'This catalog service is no longer available.'} Choose another catalog service to continue.</p> : null}
      {!catalog.isLoading && !catalog.error && (catalog.data?.variants.length ?? 0) === 0 ? <p className="mt-1.5 text-xs text-text-secondary">No active services are available in the catalog.</p> : null}
    </div>
  );

  return <>
    <Modal isOpen={isOpen} onClose={requestClose} title="Add service" description="Add an operational service from the service catalog." size="wide" closeOnEscape={!pending} closeOnOverlayClick={!pending}>
      <ModalBody className="h-[80vh] min-h-[640px] max-h-[85vh] space-y-4 overflow-y-auto">
        <ServiceCompanyContext
          companyName={catalog.data?.companyContext?.name}
          uen={catalog.data?.companyContext?.uen}
        />
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        {duplicates ? (
          <div role="alert" className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-sm">
            <p className="font-medium text-text-primary">A matching client service already exists ({duplicates.total} matching).</p>
            <ul className="mt-2 space-y-1 text-text-secondary">
              {duplicates.items.slice(0, 5).map((item) => (
                <li key={item.id}>{item.serviceName} · {item.startDate} · {item.status} · {item.source === 'MANUAL' ? 'Added manually' : 'Service agreement'}</li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setDuplicates(null)}>Cancel</Button>
              <Button size="sm" variant="primary" disabled={pending} isLoading={pending} onClick={() => submit(true)}>Add anyway</Button>
            </div>
          </div>
        ) : null}
        <OperationalServiceForm
          mode="create"
          values={values}
          onChange={setValues}
          errors={errors}
          disabled={pending}
          sectionsDisabled={!selectedVariant}
          monitoringProfiles={selectedProfiles}
          companyObligations={selectedProfiles.length > 0 ? toCompanyObligationsState(companyObligations) : undefined}
          companyObligationStatuses={obligationStatuses}
          onCompanyObligationStatusChange={(item, status) => setObligationStatuses((current) => ({ ...current, [companyObligationKey(item)]: status }))}
          onConfirmFirstPeriod={() => setFirstPeriodOpen(true)}
          engagementStartYearOfAssessment={engagementStartYa}
          onEngagementStartChange={(yearOfAssessment) => {
            setEngagementStartYa(yearOfAssessment);
            // Let the new start decide Pending filing and To be confirmed rows.
            setObligationStatuses((current) => Object.fromEntries(Object.entries(current)
              .filter(([, status]) => status !== 'PENDING_FILING' && status !== 'TO_BE_CONFIRMED')));
          }}
          serviceSelector={serviceSelector}
          deadlinePreview={deadlinePreview}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={pending} onClick={requestClose}>Cancel</Button>
        <Button isLoading={pending} disabled={!selectedVariant || pending} onClick={() => submit(false)}>Add service</Button>
      </ModalFooter>
    </Modal>
    <FirstFinancialPeriodDialog
      companyId={companyId}
      isOpen={firstPeriodOpen}
      onClose={() => setFirstPeriodOpen(false)}
      suggestion={companyObligations.data?.firstPeriodSuggestion ?? null}
    />
    <ConfirmDialog
      isOpen={Boolean(pendingVariantId)}
      onClose={() => setPendingVariantId(null)}
      onConfirm={confirmVariantChange}
      title="Discard catalog changes?"
      description="Changing the service discards modified cadence, service fields, and fees. Status and dates are kept."
      confirmLabel="Discard changes"
      variant="danger"
    />
    <ConfirmDialog
      isOpen={closeConfirmOpen}
      onClose={() => setCloseConfirmOpen(false)}
      onConfirm={confirmClose}
      title="Discard this draft?"
      description="Closing the form discards the service draft you have entered."
      confirmLabel="Discard"
      variant="danger"
    />
  </>;
}
