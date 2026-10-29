'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle, CircleOff } from 'lucide-react';
import { BulkActionsToolbar, type BulkAction } from '@/components/ui/bulk-actions-toolbar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import type { UpdateDeadlineOccurrenceInput } from '@/lib/validations/deadline';
import type { DeadlineOccurrenceDto } from '@/services/deadline';
import { fetchFilingBillingChecks, type FilingBillingChecks } from '@/hooks/use-deadlines';
import {
  BillingQuantityFields,
  enteredQuantities,
  hasInvalidQuantity,
  type BillingQuantityPromptItem,
  type BillingQuantityValues,
} from '@/components/services/shared/billing-quantity-fields';

type DeadlineBulkActionId = 'complete' | 'waive' | 'override';

interface DeadlineBulkActionsProps {
  selected: DeadlineOccurrenceDto[];
  onClearSelection: () => void;
  onUpdate: (occurrence: DeadlineOccurrenceDto, data: UpdateDeadlineOccurrenceInput) => Promise<unknown>;
}

const FILING_LABELS: Record<string, string> = { SG_ECI: 'ECI', SG_FORM_C: 'Form C', SG_AGM_DUE: 'AGM', SG_ANNUAL_RETURN: 'Annual return' };

type UnbilledFilingResponse = Pick<FilingBillingChecks, 'items'>;

/** A selected filing that would bill nothing when marked Filed. */
export type UnbilledFiling = { id: string; company: string; filing: string; services: string };

export function describeUnbilledFilings(
  selected: readonly DeadlineOccurrenceDto[],
  response: UnbilledFilingResponse,
): UnbilledFiling[] {
  const byId = new Map(selected.map((occurrence) => [occurrence.id, occurrence]));
  return response.items.flatMap(({ occurrenceId, services }) => {
    const occurrence = byId.get(occurrenceId);
    if (!occurrence || services.length === 0) return [];
    const code = occurrence.obligation?.code ?? '';
    const ya = occurrence.obligation?.yearOfAssessment;
    return [{
      id: occurrenceId,
      company: occurrence.company.displayLabel || occurrence.company.name,
      filing: `${FILING_LABELS[code] ?? code}${ya != null ? ` YA ${ya}` : ''}`,
      services: services.map((service) => `${service.serviceName} starts from YA ${service.engagementStartYearOfAssessment}`).join('; '),
    }];
  });
}

function filingLabel(occurrence: DeadlineOccurrenceDto): string {
  const code = occurrence.obligation?.code ?? '';
  const ya = occurrence.obligation?.yearOfAssessment;
  return `${occurrence.company.displayLabel || occurrence.company.name} · ${FILING_LABELS[code] ?? code}${ya != null ? ` YA ${ya}` : ''}`;
}

/** Quantity prompts of the selected filings, each headed by its filing. */
export function describeQuantityPrompts(
  selected: readonly DeadlineOccurrenceDto[],
  response: Pick<FilingBillingChecks, 'quantityPrompts'>,
): BillingQuantityPromptItem[] {
  const byId = new Map(selected.map((occurrence) => [occurrence.id, occurrence]));
  return response.quantityPrompts.flatMap(({ occurrenceId, prompts }) => {
    const occurrence = byId.get(occurrenceId);
    if (!occurrence) return [];
    return prompts.map((prompt) => ({ ...prompt, key: `${occurrenceId}:${prompt.feeLineId}`, heading: filingLabel(occurrence) }));
  });
}

function itemLabel(count: number): string {
  return `${count} deadline${count === 1 ? '' : 's'}`;
}

export function DeadlineBulkActions({ selected, onClearSelection, onUpdate }: DeadlineBulkActionsProps) {
  const [activeAction, setActiveAction] = useState<DeadlineBulkActionId | null>(null);
  const [overrideDate, setOverrideDate] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState('');
  const [bulkPending, setBulkPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [unbilled, setUnbilled] = useState<UnbilledFiling[]>([]);
  const [quantityPrompts, setQuantityPrompts] = useState<BillingQuantityPromptItem[]>([]);
  const [quantities, setQuantities] = useState<BillingQuantityValues>({});

  // Before marking complete, find company filings that would raise no
  // postpaid bill because their YA is before a service's engagement start,
  // and tiered postpaid fees they bill that need a quantity.
  const checkIds = activeAction === 'complete'
    ? selected.filter((occurrence) => occurrence.ownershipScope === 'COMPANY' && occurrence.obligation?.yearOfAssessment != null).map((occurrence) => occurrence.id)
    : [];
  const checkKey = checkIds.join(',');
  useEffect(() => {
    setUnbilled([]);
    setQuantityPrompts([]);
    setQuantities({});
    if (!checkKey) return;
    let cancelled = false;
    fetchFilingBillingChecks(checkKey.split(','))
      .then((body) => {
        if (cancelled) return;
        setUnbilled(describeUnbilledFilings(selected, body));
        setQuantityPrompts(describeQuantityPrompts(selected, body));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // selected is read for labels only; the ids decide when to check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  const selectedOpenOnly = selected.length > 0 && selected.every((occurrence) => occurrence.status === 'OPEN');
  const selectedNonCancelled = selected.length > 0 && selected.every((occurrence) => occurrence.status !== 'CANCELLED');

  const runBulkUpdate = async (
    dataForOccurrence: (occurrence: DeadlineOccurrenceDto) => UpdateDeadlineOccurrenceInput,
  ): Promise<boolean> => {
    setBulkPending(true);
    setFeedback(null);
    const results = await Promise.allSettled(selected.map(async (occurrence) => onUpdate(occurrence, dataForOccurrence(occurrence))));
    const failed = results.filter((result) => result.status === 'rejected').length;
    const succeeded = results.length - failed;
    setFeedback(failed === 0
      ? `${succeeded} deadline${succeeded === 1 ? '' : 's'} updated successfully.`
      : `${succeeded} deadline${succeeded === 1 ? '' : 's'} updated; ${failed} failed. Review and retry the failed rows.`);
    setBulkPending(false);
    if (failed === 0) onClearSelection();
    return failed === 0;
  };

  const confirmComplete = async () => {
    if (hasInvalidQuantity(quantityPrompts, quantities)) return;
    const entered = enteredQuantities(quantityPrompts, quantities);
    await runBulkUpdate((occurrence) => {
      const billingQuantities = quantityPrompts
        .filter((prompt) => prompt.key.startsWith(`${occurrence.id}:`) && entered.has(prompt.key))
        .map((prompt) => entered.get(prompt.key)!);
      return {
        expectedUpdatedAt: occurrence.updatedAt,
        status: 'COMPLETED',
        ...(billingQuantities.length > 0 ? { billingQuantities } : {}),
      };
    });
    setActiveAction(null);
  };

  const confirmWaive = async (reason?: string) => {
    await runBulkUpdate((occurrence) => ({ expectedUpdatedAt: occurrence.updatedAt, status: 'WAIVED', reason: reason! }));
    setActiveAction(null);
  };

  const submitOverride = async () => {
    if (!overrideDate) {
      setOverrideError('A new operative date is required');
      return;
    }
    if (!overrideReason.trim()) {
      setOverrideError('A reason is required');
      return;
    }
    const succeeded = await runBulkUpdate((occurrence) => ({
      expectedUpdatedAt: occurrence.updatedAt,
      operativeDueDate: overrideDate,
      reason: overrideReason.trim(),
    }));
    if (succeeded) {
      setActiveAction(null);
      setOverrideDate('');
      setOverrideReason('');
      setOverrideError('');
    }
  };

  const openOverride = () => {
    setOverrideDate(selected[0]?.operativeDueDate ?? '');
    setOverrideReason('');
    setOverrideError('');
    setFeedback(null);
    setActiveAction('override');
  };

  const actions: BulkAction[] = [
    {
      id: 'complete',
      label: 'Mark complete',
      icon: CheckCircle,
      description: selectedOpenOnly ? 'Mark selected open deadlines complete' : 'Only open deadlines can be marked complete',
      disabled: !selectedOpenOnly,
    },
    {
      id: 'waive',
      label: 'Waive',
      icon: CircleOff,
      variant: 'warning',
      description: selectedOpenOnly ? 'Waive selected open deadlines' : 'Only open deadlines can be waived',
      disabled: !selectedOpenOnly,
    },
    {
      id: 'override',
      label: 'Override date',
      icon: CalendarClock,
      description: selectedNonCancelled ? 'Override the operative date for selected deadlines' : 'Cancelled deadlines cannot be overridden',
      disabled: !selectedNonCancelled,
    },
  ];

  const handleAction = (actionId: string) => {
    setFeedback(null);
    if (actionId === 'complete') setActiveAction('complete');
    if (actionId === 'waive') setActiveAction('waive');
    if (actionId === 'override') openOverride();
  };

  return (
    <>
      {selected.length > 0 ? (
        <div role="region" aria-label="Deadline bulk actions">
          <BulkActionsToolbar
            selectedCount={selected.length}
            onClearSelection={onClearSelection}
            actions={actions.map((action) => ({ ...action, isLoading: bulkPending }))}
            onAction={handleAction}
          />
        </div>
      ) : null}
      {feedback ? <div role="status" className="rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-secondary">{feedback}</div> : null}
      <ConfirmDialog
        isOpen={activeAction === 'complete'}
        onClose={() => setActiveAction(null)}
        onConfirm={confirmComplete}
        title={`Mark ${itemLabel(selected.length)} complete`}
        description={`This will mark ${itemLabel(selected.length)} as completed.`}
        confirmLabel="Mark complete"
        variant="info"
        isLoading={bulkPending}
      >
        {unbilled.length > 0 ? (
          <Alert variant="warning" title={`${unbilled.length} filing${unbilled.length === 1 ? '' : 's'} will not be billed`} compact>
            <p>These YAs are before the service&apos;s engagement start, so no postpaid bill is created. To bill one, mark it on its own and choose to move the engagement start.</p>
            <ul className="mt-1 list-disc pl-5">
              {unbilled.map((item) => (
                <li key={item.id}>{item.company}: {item.filing} ({item.services})</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {quantityPrompts.length > 0 ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-text-secondary">
              These fees are priced by quantity. Enter the quantity to bill now, or leave it blank and enter it on the billing entry later.
            </p>
            <BillingQuantityFields
              prompts={quantityPrompts}
              values={quantities}
              disabled={bulkPending}
              onChange={(key, quantity) => setQuantities((current) => ({ ...current, [key]: quantity }))}
            />
          </div>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={activeAction === 'waive'}
        onClose={() => setActiveAction(null)}
        onConfirm={confirmWaive}
        title={`Waive ${itemLabel(selected.length)}`}
        description={`Provide one reason for waiving ${itemLabel(selected.length)}.`}
        confirmLabel="Waive deadline"
        variant="warning"
        requireReason
        reasonMinLength={1}
        reasonPlaceholder="Why are these deadlines being waived?"
        isLoading={bulkPending}
      />
      <Modal
        isOpen={activeAction === 'override'}
        onClose={() => setActiveAction(null)}
        title={`Override ${itemLabel(selected.length)} date`}
        description={`Apply one operative date and reason to ${itemLabel(selected.length)}.`}
        size="sm"
      >
        <ModalBody className="space-y-3">
          <label className="block text-sm text-text-secondary">
            New operative date
            <input
              type="date"
              value={overrideDate}
              onChange={(event) => { setOverrideDate(event.target.value); setOverrideError(''); }}
              className="input input-sm mt-1 min-h-11 w-full"
            />
          </label>
          <label className="block text-sm text-text-secondary">
            Reason
            <textarea
              value={overrideReason}
              onChange={(event) => { setOverrideReason(event.target.value); setOverrideError(''); }}
              rows={3}
              className="input input-sm mt-1 w-full py-2"
              placeholder="Why is the operative date changing?"
            />
          </label>
          {overrideError ? <p role="alert" className="text-sm text-status-error">{overrideError}</p> : null}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" size="sm" onClick={() => setActiveAction(null)} disabled={bulkPending}>Cancel</Button>
          <Button type="button" variant="primary" size="sm" onClick={() => void submitOverride()} isLoading={bulkPending}>Override date</Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
