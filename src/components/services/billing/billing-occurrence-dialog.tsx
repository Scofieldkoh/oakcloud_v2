'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import type { BillingOccurrenceDto } from '@/services/billing';
import type { ResetBillingOverrideInput, UpdateBillingOccurrenceInput } from '@/lib/validations/billing';
import { formatCurrency } from '@/lib/utils';
import { describeTieredPricing, isValidQuantity, priceTieredQuantity } from '@/services/billing/tiered-pricing';

interface BillingOccurrenceDialogProps {
  occurrence: BillingOccurrenceDto | null;
  isOpen?: boolean;
  onClose?: () => void;
  onSave?: (input: UpdateBillingOccurrenceInput) => void;
  onReset?: (input: ResetBillingOverrideInput) => void;
  isSaving?: boolean;
  isResetting?: boolean;
  errorMessage?: string | null;
}

function dateValue(value: string | null): string {
  return value?.slice(0, 10) ?? '';
}

export function BillingOccurrenceDialog({ occurrence, isOpen = Boolean(occurrence), onClose = () => undefined, onSave, onReset, isSaving = false, isResetting = false, errorMessage = null }: BillingOccurrenceDialogProps) {
  const [status, setStatus] = useState<UpdateBillingOccurrenceInput['status']>('OPEN');
  const [billedDate, setBilledDate] = useState('');
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState('');
  const [currency, setCurrency] = useState('SGD');
  const [externalReference, setExternalReference] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [scopePromptOpen, setScopePromptOpen] = useState(false);
  const [resetPromptOpen, setResetPromptOpen] = useState(false);
  const [resetReason, setResetReason] = useState('');

  useEffect(() => {
    if (!occurrence) return;
    setStatus(occurrence.status === 'CANCELLED' ? 'OPEN' : occurrence.status);
    setBilledDate(dateValue(occurrence.billedDate));
    setAmount(occurrence.operativeAmount);
    setQuantity(occurrence.quantity?.replace(/\.00$/, '') ?? '');
    setCurrency(occurrence.operativeCurrency);
    setExternalReference(occurrence.externalReference ?? '');
    setNotes(occurrence.notes ?? '');
    setReason('');
    setScopePromptOpen(false);
    setResetPromptOpen(false);
    setResetReason('');
  }, [occurrence]);

  if (!occurrence) return null;

  const pricing = occurrence.feeLine.tieredPricing ?? null;
  const quantityEditable = Boolean(pricing) && occurrence.status === 'OPEN';
  const trimmedQuantity = quantity.trim();
  const quantityValid = trimmedQuantity !== '' && isValidQuantity(trimmedQuantity);
  const quantityChanged = quantityEditable && quantityValid
    && Number(trimmedQuantity) !== Number(occurrence.quantity ?? Number.NaN);
  const amountChanged = amount !== occurrence.operativeAmount || currency.toUpperCase() !== occurrence.operativeCurrency.toUpperCase();
  const currentStatus = occurrence.status === 'CANCELLED' ? 'OPEN' : occurrence.status;
  const originalBilledDate = dateValue(occurrence.billedDate);
  const statusChanged = status !== currentStatus;
  const billedDateChanged = billedDate !== originalBilledDate;
  const statusOptions = currentStatus === 'OPEN'
    ? (['OPEN', 'BILLED', 'WAIVED'] as const)
    : currentStatus === 'BILLED'
      ? (['BILLED', 'OPEN'] as const)
      : (['WAIVED', 'OPEN'] as const);

  const payloadFor = (updateScope: UpdateBillingOccurrenceInput['updateScope']): UpdateBillingOccurrenceInput => {
    const payload: UpdateBillingOccurrenceInput = {
      expectedUpdatedAt: occurrence.updatedAt,
      externalReference: externalReference.trim() || null,
      notes: notes.trim() || null,
      updateScope,
      reason: reason.trim() || null,
    };
    if (statusChanged) payload.status = status;
    if (billedDateChanged) payload.billedDate = billedDate || null;
    if (quantityChanged) payload.quantity = trimmedQuantity;
    if (amountChanged) {
      payload.amount = amount;
      payload.currency = currency.trim().toUpperCase();
    }
    return payload;
  };

  const submit = (updateScope: UpdateBillingOccurrenceInput['updateScope']) => {
    onSave?.(payloadFor(updateScope));
    setScopePromptOpen(false);
  };

  const save = () => {
    if (amountChanged) {
      setScopePromptOpen(true);
      return;
    }
    submit('THIS_OCCURRENCE');
  };

  const canResetOverrides = occurrence.dateOverridden || occurrence.valueOverridden;
  const reset = (target: ResetBillingOverrideInput['target']) => {
    const cleanedReason = resetReason.trim();
    if (cleanedReason.length < 3) return;
    onReset?.({ expectedUpdatedAt: occurrence.updatedAt, target, reason: cleanedReason });
    setResetPromptOpen(false);
  };

  return (
    <>
      <Modal
        isOpen={isOpen && !scopePromptOpen && !resetPromptOpen}
        onClose={onClose}
        title="Edit billing tracking"
        description={`${occurrence.company.name} · ${occurrence.service.name}`}
        size="lg"
      >
        <ModalBody>
          {errorMessage ? <div role="alert" className="mb-4 rounded-lg border border-status-error/30 bg-status-error/5 p-3 text-sm text-status-error">{errorMessage}</div> : null}
          {canResetOverrides ? (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-status-warning/30 bg-status-warning/5 p-3">
              <p className="text-xs text-text-secondary">This row has a manually overridden tracked value.</p>
              <Button type="button" size="xs" variant="ghost" onClick={() => setResetPromptOpen(true)}>Reset tracked overrides</Button>
            </div>
          ) : null}
          {pricing ? (
            <div className="mb-4 space-y-2 rounded-lg border border-border-primary p-3">
              <p className="text-sm font-medium text-text-primary">Priced by quantity</p>
              <ul className="list-disc pl-5 text-xs text-text-secondary">
                {describeTieredPricing(pricing, occurrence.operativeCurrency).map((line) => <li key={line}>{line}</li>)}
              </ul>
              <div className="grid items-end gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-text-primary">
                  {`Number of ${pricing.unitLabel}s`}
                  <input aria-label="Quantity" inputMode="decimal" value={quantity} disabled={!quantityEditable} onChange={(event) => setQuantity(event.target.value)} placeholder={occurrence.quantity == null ? 'Quantity needed' : undefined} className="min-h-11 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm font-normal text-text-primary outline-none placeholder:text-text-muted focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/20 disabled:opacity-60 sm:min-h-9" />
                </label>
                <p className="text-sm text-text-secondary">
                  Fee: <span className="font-semibold text-text-primary">{quantityValid ? formatCurrency(priceTieredQuantity(pricing, trimmedQuantity), occurrence.operativeCurrency) : '—'}</span>
                </p>
              </div>
              {trimmedQuantity !== '' && !quantityValid ? <p role="alert" className="text-xs text-status-error">Enter a number with at most two decimals.</p> : null}
              {!quantityEditable ? <p className="text-xs text-text-muted">Reopen this entry to change its quantity.</p> : null}
              {quantityEditable && occurrence.valueOverridden ? <p className="text-xs text-text-muted">The amount was overridden, so a new quantity changes the configured fee only. Reset the amount override to bill the tier price.</p> : null}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium text-text-primary">
              Status
              <select aria-label="Status" value={status} onChange={(event) => {
                const nextStatus = event.target.value as UpdateBillingOccurrenceInput['status'];
                setStatus(nextStatus);
                if (nextStatus !== 'BILLED') setBilledDate('');
              }} className="min-h-11 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm font-normal text-text-primary outline-none focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/20 sm:min-h-9">
                {statusOptions.map((option) => <option key={option} value={option}>{option.charAt(0) + option.slice(1).toLowerCase()}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-text-primary">
              Billed date
              <input aria-label="Billed date" type="date" value={billedDate} onChange={(event) => setBilledDate(event.target.value)} className="min-h-11 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm font-normal text-text-primary outline-none focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/20 sm:min-h-9" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-text-primary">
              Amount
              <input aria-label="Amount" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="min-h-11 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm font-normal text-text-primary outline-none focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/20 sm:min-h-9" />
              <span className="text-xs font-normal text-text-secondary">Current: {formatCurrency(occurrence.operativeAmount, occurrence.operativeCurrency)}</span>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-text-primary">
              Currency
              <input aria-label="Currency" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} className="min-h-11 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm font-normal uppercase text-text-primary outline-none focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/20 sm:min-h-9" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-text-primary sm:col-span-2">
              External reference
              <input aria-label="External reference" value={externalReference} onChange={(event) => setExternalReference(event.target.value)} placeholder="Optional" className="min-h-11 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm font-normal text-text-primary outline-none placeholder:text-text-muted focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/20 sm:min-h-9" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-text-primary sm:col-span-2">
              Notes
              <textarea aria-label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Optional tracking notes" className="rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-sm font-normal text-text-primary outline-none placeholder:text-text-muted focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/20" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-text-primary sm:col-span-2">
              Reason
              <textarea aria-label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={2} placeholder="Required when waiving or changing tracked values" className="rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-sm font-normal text-text-primary outline-none placeholder:text-text-muted focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/20" />
            </label>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" isLoading={isSaving} onClick={save}>Save tracking update</Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={resetPromptOpen}
        onClose={() => setResetPromptOpen(false)}
        title="Reset tracking override"
        description="Restore the configured value or expected date for this occurrence."
        size="md"
      >
        <ModalBody>
          <label className="flex flex-col gap-2 text-sm font-medium text-text-primary">
            Reset reason
            <textarea aria-label="Reset reason" value={resetReason} onChange={(event) => setResetReason(event.target.value)} rows={3} placeholder="Explain why the override is being reset" className="rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-sm font-normal text-text-primary outline-none placeholder:text-text-muted focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/20" />
          </label>
        </ModalBody>
        <ModalFooter className="justify-stretch sm:justify-end">
          {occurrence.dateOverridden ? <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={isResetting} onClick={() => reset('DATE')}>Reset expected date</Button> : null}
          {occurrence.valueOverridden ? <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={isResetting} onClick={() => reset('VALUE')}>Reset amount</Button> : null}
          <Button type="button" variant="primary" className="w-full sm:w-auto" isLoading={isResetting} disabled={resetReason.trim().length < 3} onClick={() => reset('ALL')}>Reset all overrides</Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={scopePromptOpen}
        onClose={() => setScopePromptOpen(false)}
        title="Apply amount change"
        description="Choose which open tracking rows should use this amount and currency."
        size="md"
      >
        <ModalBody>
          <p className="text-sm text-text-secondary">This change affects the tracked amount or currency. Apply it only here, or to this and future matching open occurrences.</p>
        </ModalBody>
        <ModalFooter className="justify-stretch sm:justify-end">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => submit('THIS_OCCURRENCE')}>This occurrence</Button>
          <Button type="button" variant="primary" className="w-full sm:w-auto" onClick={() => submit('THIS_AND_FUTURE')}>This and future</Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
