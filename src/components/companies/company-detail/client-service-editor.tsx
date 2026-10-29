'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormInput } from '@/components/ui/form-input';
import type { ClientServiceDto } from '@/services/client-service';
import {
  fetchObligationQuantityPrompts,
  isHttpRequestError,
  previewClientServiceDeadlineImpact,
  useArchiveClientService,
  useClientService,
  useCompanyObligations,
  useSetCompanyObligationStatus,
  useSetEngagementStart,
  useDeleteClientServicePermanently,
  useUpdateClientService,
} from '@/hooks/use-client-services';
import { OperationalServiceForm, toCompanyObligationsState } from './operational-service-form';
import { FirstFinancialPeriodDialog } from './first-financial-period-dialog';
import { BillingQuantityDialog, type BillingQuantityPromptItem } from '@/components/services/shared/billing-quantity-fields';
import type { PostpaidQuantityInput } from '@/services/billing/postpaid';
import type { CompanyObligationPreviewItem } from '@/services/compliance-monitoring/writer';
import type { CompanyObligationStatus } from '@/services/compliance-monitoring/obligation-status';
import { ServiceCompanyContext } from './service-company-context';
import {
  deadlineImpactPayload,
  deadlineImpactPayloadHash,
  deadlineRuleInputs,
  impactWarningsToStrings,
  operationalFieldValues,
  updateFeeLines,
  validateOperationalServiceValues,
  valuesFromClientService,
  type DeadlinePreviewState,
  type OperationalFieldErrors,
  type OperationalServiceValues,
} from './client-service-form-state';

const PREVIEW_DEBOUNCE_MS = 300;

export function ClientServiceEditor({
  service,
  isOpen,
  onClose,
  readOnly = false,
}: {
  service: ClientServiceDto;
  isOpen: boolean;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const initialValues = valuesFromClientService(service);
  const [serviceName, setServiceName] = useState(service.serviceName);
  const [familyName, setFamilyName] = useState(service.familyName);
  const [values, setValues] = useState<OperationalServiceValues>(initialValues);
  const [initialDeadlineRules, setInitialDeadlineRules] = useState(() => deadlineRuleInputs(initialValues));
  const [updatedAt, setUpdatedAt] = useState(service.updatedAt);
  const [fieldErrors, setFieldErrors] = useState<OperationalFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [hasConflict, setHasConflict] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [previewPending, setPreviewPending] = useState(false);
  const [deadlinePreview, setDeadlinePreview] = useState<DeadlinePreviewState>({ state: 'IDLE', items: [], warnings: [] });
  const saveLockRef = useRef(false);
  const saveAttemptRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTokenRef = useRef(0);
  const payloadHashRef = useRef('');
  const fingerprintRef = useRef<string | null>(null);
  const errorId = useId();
  const companyObligations = useCompanyObligations(service.companyId, { serviceId: service.id }, isOpen);
  const setObligationStatus = useSetCompanyObligationStatus(service.companyId);
  const setEngagementStart = useSetEngagementStart(service.companyId);
  const [firstPeriodOpen, setFirstPeriodOpen] = useState(false);
  const [obligationError, setObligationError] = useState('');
  const [quantityPrompt, setQuantityPrompt] = useState<{
    item: CompanyObligationPreviewItem;
    status: CompanyObligationStatus;
    prompts: BillingQuantityPromptItem[];
  } | null>(null);
  const saveObligationStatus = (item: CompanyObligationPreviewItem, status: CompanyObligationStatus, billingQuantities?: PostpaidQuantityInput[]) => {
    setObligationError('');
    return setObligationStatus.mutateAsync({
      obligationCode: item.obligationCode,
      periodKey: item.periodKey,
      status,
      ...(billingQuantities?.length ? { billingQuantities } : {}),
    })
      .then(() => undefined)
      .catch((error: unknown) => setObligationError(error instanceof Error ? error.message : 'Unable to save the filing status.'));
  };
  const update = useUpdateClientService();
  const archive = useArchiveClientService();
  const permanentDelete = useDeleteClientServicePermanently();
  const latestService = useClientService(service.id);
  const busy = previewPending || update.isPending || archive.isPending || permanentDelete.isPending;

  const agreementBacked = service.source === 'AGREEMENT';
  const editDescription = agreementBacked
    ? 'Operational edits do not change the signed agreement.'
    : 'This service was added manually. Operational changes are recorded in the audit history.';
  const archiveDescription = agreementBacked
    ? 'Archiving removes this operational service without changing the signed agreement.'
    : 'Archiving removes this manually added service from the active company view.';

  const runDeadlinePreview = useCallback(async (
    payload: ReturnType<typeof deadlineImpactPayload>,
    hash: string,
  ) => {
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    const token = previewTokenRef.current + 1;
    previewTokenRef.current = token;
    payloadHashRef.current = hash;
    fingerprintRef.current = null;
    setDeadlinePreview((previous) => ({
      state: 'LOADING',
      items: 'items' in previous ? previous.items : [],
      warnings: 'warnings' in previous ? previous.warnings : [],
    }));
    try {
      const result = await previewClientServiceDeadlineImpact(service.id, payload, controller.signal);
      if (token !== previewTokenRef.current || controller.signal.aborted) return;
      if (typeof result.previewFingerprint !== 'string' || !result.previewFingerprint) {
        throw new Error('Unable to verify the deadline impact preview. Please try again.');
      }
      fingerprintRef.current = result.previewFingerprint;
      setDeadlinePreview({
        state: 'SUCCESS',
        items: result.projectedDeadlines,
        warnings: impactWarningsToStrings(result.warnings),
        fingerprint: result.previewFingerprint,
        payloadHash: hash,
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
  }, [service.id]);

  useEffect(() => {
    if (!isOpen || readOnly) return;
    const payload = deadlineImpactPayload(values, updatedAt);
    const hash = deadlineImpactPayloadHash(payload);
    const timeout = setTimeout(() => {
      void runDeadlinePreview(payload, hash);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [isOpen, readOnly, values, updatedAt, service.id, runDeadlinePreview]);

  useEffect(() => {
    if (!isOpen) {
      previewAbortRef.current?.abort();
      previewTokenRef.current += 1;
    }
  }, [isOpen]);

  const closeEditor = () => {
    previewAbortRef.current?.abort();
    previewTokenRef.current += 1;
    onClose();
  };

  const replaceForm = (next: ClientServiceDto) => {
    const nextValues = valuesFromClientService(next);
    setServiceName(next.serviceName);
    setFamilyName(next.familyName);
    setValues(nextValues);
    setInitialDeadlineRules(deadlineRuleInputs(nextValues));
    setUpdatedAt(next.updatedAt);
    setFieldErrors({});
  };

  const validate = () => {
    const errors = validateOperationalServiceValues(values);
    if (!serviceName.trim()) errors.serviceName = 'Service name is required.';
    if (!familyName.trim()) errors.familyName = 'Service family is required.';
    setFieldErrors(errors);
    return Object.values(errors).find(Boolean) ?? '';
  };

  const save = async () => {
    if (saveLockRef.current || busy) return;
    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    if (hasConflict) {
      setFormError('Reload the latest service before saving again.');
      return;
    }
    setFormError('');
    saveLockRef.current = true;
    const attempt = saveAttemptRef.current + 1;
    saveAttemptRef.current = attempt;
    previewAbortRef.current?.abort();
    const abortController = new AbortController();
    previewAbortRef.current = abortController;
    setPreviewPending(true);
    // Capture one immutable payload before starting any asynchronous work.
    const submitValues = JSON.parse(JSON.stringify(values)) as OperationalServiceValues;
    const submitServiceName = serviceName;
    const submitFamilyName = familyName;
    try {
      const nextDeadlineRules = deadlineRuleInputs(submitValues);
      const deadlineRulesChanged = JSON.stringify(nextDeadlineRules) !== JSON.stringify(initialDeadlineRules);
      const scheduleSnapshot = {
        status: submitValues.status,
        serviceCadence: submitValues.serviceCadence,
        customCadenceLabel: submitValues.serviceCadence === 'CUSTOM' ? submitValues.customCadenceLabel : null,
        startDate: submitValues.startDate,
        endDate: submitValues.endDate || null,
        fieldValues: operationalFieldValues(submitValues),
      };
      const initialScheduleSnapshot = {
        status: initialValues.status,
        serviceCadence: initialValues.serviceCadence,
        customCadenceLabel: initialValues.serviceCadence === 'CUSTOM' ? initialValues.customCadenceLabel : null,
        startDate: initialValues.startDate,
        endDate: initialValues.endDate || null,
        fieldValues: operationalFieldValues(initialValues),
      };
      const scheduleFieldsChanged = JSON.stringify(scheduleSnapshot) !== JSON.stringify(initialScheduleSnapshot);
      const impactRequired = deadlineRulesChanged || scheduleFieldsChanged;
      const impactPayload = deadlineImpactPayload(submitValues, updatedAt);
      const submitHash = deadlineImpactPayloadHash(impactPayload);
      let impactFingerprint: string | undefined;
      if (impactRequired) {
        if (fingerprintRef.current !== null && payloadHashRef.current === submitHash) {
          impactFingerprint = fingerprintRef.current;
        } else {
          const result = await previewClientServiceDeadlineImpact(service.id, impactPayload, abortController.signal);
          if (attempt !== saveAttemptRef.current || abortController.signal.aborted) return;
          if (typeof result.previewFingerprint !== 'string' || !result.previewFingerprint) {
            throw new Error('Unable to verify the deadline impact preview. Please try again.');
          }
          impactFingerprint = result.previewFingerprint;
        }
      }
      if (attempt !== saveAttemptRef.current || abortController.signal.aborted) return;
      await update.mutateAsync({
        id: service.id,
        companyId: service.companyId,
        data: {
          expectedUpdatedAt: updatedAt,
          serviceName: submitServiceName,
          familyName: submitFamilyName,
          status: submitValues.status,
          serviceCadence: submitValues.serviceCadence,
          customCadenceLabel: submitValues.serviceCadence === 'CUSTOM' ? submitValues.customCadenceLabel : null,
          startDate: submitValues.startDate,
          endDate: submitValues.endDate || null,
          fieldValues: operationalFieldValues(submitValues),
          billingDisposition: submitValues.billingDisposition === '' ? undefined : submitValues.billingDisposition,
          billingNotRequiredReason: submitValues.billingDisposition === 'NOT_REQUIRED' ? submitValues.billingNotRequiredReason : null,
          feeLines: updateFeeLines(submitValues),
          ...(deadlineRulesChanged ? { deadlineRules: nextDeadlineRules, impactFingerprint } : impactRequired ? { impactFingerprint } : {}),
        },
      });
      if (attempt !== saveAttemptRef.current || abortController.signal.aborted) return;
      closeEditor();
    } catch (error) {
      if (abortController.signal.aborted || attempt !== saveAttemptRef.current) return;
      if (isHttpRequestError(error, 409) || (typeof error === 'object' && error !== null && 'status' in error && (error as { status?: unknown }).status === 409)) {
        setHasConflict(true);
        setFormError('This service was updated by someone else. Reload the latest service before saving again.');
        return;
      }
      setFormError(error instanceof Error ? error.message : 'Unable to save service changes.');
    } finally {
      if (attempt === saveAttemptRef.current) {
        setPreviewPending(false);
        saveLockRef.current = false;
        previewAbortRef.current = null;
      }
    }
  };

  const reloadLatest = async () => {
    setFormError('');
    try {
      const result = await latestService.refetch();
      if (!result.data) throw new Error('Unable to reload the latest service.');
      replaceForm(result.data);
      setHasConflict(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to reload the latest service.');
    }
  };

  const archiveService = async (reason?: string) => {
    setArchiveError('');
    try {
      await archive.mutateAsync({ id: service.id, companyId: service.companyId, reason: reason ?? '' });
      setArchiveOpen(false);
      onClose();
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Unable to archive service.');
      throw error;
    }
  };

  const deleteService = async (reason?: string) => {
    setDeleteError('');
    try {
      await permanentDelete.mutateAsync({
        id: service.id,
        companyId: service.companyId,
        expectedUpdatedAt: updatedAt,
        reason: reason ?? '',
      });
      setDeleteOpen(false);
      onClose();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Unable to permanently delete service.');
      throw error;
    }
  };

  const serviceHeader = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-xl border border-border-primary bg-background-primary p-4 shadow-sm">
      <FormInput id="client-service-name" label="Service name" disabled={readOnly || busy} value={serviceName} error={fieldErrors.serviceName} onChange={(event) => setServiceName(event.target.value)} />
      <FormInput id="client-service-family" label="Service family" readOnly disabled={readOnly || busy} value={familyName} error={fieldErrors.familyName} onChange={(event) => setFamilyName(event.target.value)} />
    </div>
  );

  return <>
    <Modal isOpen={isOpen} onClose={() => { if (!busy) closeEditor(); }} closeOnOverlayClick={!busy} closeOnEscape={!busy} showCloseButton={!busy} title={readOnly ? 'View service' : 'Edit service'} description={readOnly ? 'Review service configuration and tracking details.' : editDescription} size="wide">
      <ModalBody className="h-[80vh] min-h-[640px] max-h-[85vh] space-y-4 overflow-y-auto" aria-describedby={formError ? errorId : undefined}>
        <ServiceCompanyContext companyName={service.company?.name} uen={service.company?.uen} />
        {formError ? (
          <div id={errorId}>
            <Alert variant="error">
              <div className="flex flex-col gap-2">
                <p>{formError}</p>
                {hasConflict ? <Button size="sm" variant="secondary" disabled={busy} isLoading={latestService.isFetching} onClick={reloadLatest}>Reload latest service</Button> : null}
              </div>
            </Alert>
          </div>
        ) : null}
        <OperationalServiceForm
          mode="edit"
          values={values}
          onChange={setValues}
          errors={fieldErrors}
          disabled={readOnly || busy}
          readOnly={readOnly}
          serviceHeader={serviceHeader}
          deadlinePreview={deadlinePreview}
          openDeadlineOccurrences={service.openDeadlineOccurrences ?? []}
          companyObligations={(companyObligations.data?.items.length ?? 0) > 0 || (companyObligations.data?.notices.length ?? 0) > 0
            ? { ...toCompanyObligationsState(companyObligations), error: obligationError || toCompanyObligationsState(companyObligations).error }
            : undefined}
          onCompanyObligationStatusChange={async (item, status) => {
            // Filing a YA asks for the quantity of any tiered postpaid fee it
            // bills. If the check fails, the entry is still raised and flagged.
            if (status === 'FILED' && item.yearOfAssessment != null) {
              const prompts = await fetchObligationQuantityPrompts(service.companyId, {
                obligationCode: item.obligationCode,
                yearOfAssessment: item.yearOfAssessment,
              }).catch(() => []);
              if (prompts.length > 0) {
                setQuantityPrompt({ item, status, prompts: prompts.map((prompt) => ({ ...prompt, key: prompt.feeLineId })) });
                return;
              }
            }
            return saveObligationStatus(item, status);
          }}
          onConfirmFirstPeriod={() => setFirstPeriodOpen(true)}
          engagementStartYearOfAssessment={companyObligations.data?.engagementStartYearOfAssessment ?? null}
          onEngagementStartChange={(yearOfAssessment) => {
            setObligationError('');
            return setEngagementStart.mutateAsync({ serviceId: service.id, yearOfAssessment })
              .then(() => undefined)
              .catch((error: unknown) => setObligationError(error instanceof Error ? error.message : 'Unable to save the engagement start.'));
          }}
          openBillingOccurrences={latestService.data?.openBillingOccurrences ?? service.openBillingOccurrences ?? []}
        />
        {!readOnly ? (
          <div className="rounded-lg border border-status-error/30 bg-status-error/5 p-3">
            <p className="text-sm text-text-secondary">Permanent deletion removes this service and all of its deadline and billing history. This cannot be undone.</p>
            <Button className="mt-2" variant="danger" size="sm" disabled={busy} onClick={() => { setDeleteError(''); setDeleteOpen(true); }}>Delete service permanently</Button>
            <div className="mt-4 border-t border-status-error/20 pt-3">
              <p className="text-sm text-text-secondary">{archiveDescription}</p>
              <Button className="mt-2" variant="danger" size="sm" disabled={busy} onClick={() => { setArchiveError(''); setArchiveOpen(true); }}>Archive service</Button>
            </div>
          </div>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={busy} onClick={closeEditor}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly ? <Button isLoading={busy} disabled={hasConflict || busy} onClick={save}>Save changes</Button> : null}
      </ModalFooter>
    </Modal>
    <BillingQuantityDialog
      isOpen={quantityPrompt !== null}
      title={quantityPrompt ? `Mark ${quantityPrompt.item.obligationName} YA ${quantityPrompt.item.yearOfAssessment ?? ''} Filed` : 'Mark Filed'}
      prompts={quantityPrompt?.prompts ?? []}
      isLoading={setObligationStatus.isPending}
      onClose={() => setQuantityPrompt(null)}
      onConfirm={async (billingQuantities) => {
        if (!quantityPrompt) return;
        const { item, status } = quantityPrompt;
        setQuantityPrompt(null);
        await saveObligationStatus(item, status, billingQuantities);
      }}
    />
    <FirstFinancialPeriodDialog
      companyId={service.companyId}
      isOpen={firstPeriodOpen}
      onClose={() => setFirstPeriodOpen(false)}
      suggestion={companyObligations.data?.firstPeriodSuggestion ?? null}
    />
    <ConfirmDialog isOpen={deleteOpen} onClose={() => { setDeleteError(''); setDeleteOpen(false); }} onConfirm={deleteService} title="Permanently delete service?" description="This permanently removes the service and all related deadlines, billing records, fee lines, and rule configuration. Company ECI and Form C deadlines go too, unless another service still covers them. This cannot be undone." confirmLabel="Delete permanently" requireReason reasonLabel="Deletion reason" reasonPlaceholder="Explain why this service and its history must be deleted" reasonMinLength={10} isLoading={permanentDelete.isPending}>
      {deleteError ? <div role="alert" className="rounded-lg border border-status-error/30 bg-status-error/5 p-2 text-sm text-status-error">{deleteError}</div> : null}
    </ConfirmDialog>
    <ConfirmDialog isOpen={archiveOpen} onClose={() => { setArchiveError(''); setArchiveOpen(false); }} onConfirm={archiveService} title="Archive service?" description="This service will no longer appear in the company Services list." confirmLabel="Archive service" requireReason reasonLabel="Archive reason" reasonPlaceholder="Explain why this service is being archived" reasonMinLength={10} isLoading={archive.isPending}>
      {archiveError ? <div role="alert" className="rounded-lg border border-status-error/30 bg-status-error/5 p-2 text-sm text-status-error">{archiveError}</div> : null}
    </ConfirmDialog>
  </>;
}
