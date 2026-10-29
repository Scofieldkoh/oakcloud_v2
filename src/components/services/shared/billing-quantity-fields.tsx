'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { formatCurrency } from '@/lib/utils';
import type { PostpaidQuantityInput, PostpaidQuantityPrompt } from '@/services/billing/postpaid';
import { describeTieredPricing, isValidQuantity, priceTieredQuantity } from '@/services/billing/tiered-pricing';

/** A fee to ask a quantity for; `key` is unique within one form. */
export type BillingQuantityPromptItem = PostpaidQuantityPrompt & { key: string; heading?: string };

export type BillingQuantityValues = Record<string, string>;

/** Entered quantities that are valid, by prompt key; blanks are left out. */
export function enteredQuantities(
  prompts: readonly BillingQuantityPromptItem[],
  values: BillingQuantityValues,
): Map<string, PostpaidQuantityInput> {
  const result = new Map<string, PostpaidQuantityInput>();
  for (const prompt of prompts) {
    const quantity = values[prompt.key]?.trim() ?? '';
    if (quantity && isValidQuantity(quantity)) result.set(prompt.key, { feeLineId: prompt.feeLineId, quantity });
  }
  return result;
}

export function hasInvalidQuantity(prompts: readonly BillingQuantityPromptItem[], values: BillingQuantityValues): boolean {
  return prompts.some((prompt) => {
    const quantity = values[prompt.key]?.trim() ?? '';
    return quantity !== '' && !isValidQuantity(quantity);
  });
}

/**
 * Quantity inputs for tiered postpaid fees a filing bills, each with its
 * tiers and the fee the quantity comes to. A blank quantity bills 0.00 and
 * flags the entry until a quantity is entered on it.
 */
export function BillingQuantityFields({
  prompts,
  values,
  onChange,
  disabled = false,
}: {
  prompts: readonly BillingQuantityPromptItem[];
  values: BillingQuantityValues;
  onChange: (key: string, quantity: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {prompts.map((prompt) => {
        const quantity = values[prompt.key]?.trim() ?? '';
        const valid = quantity !== '' && isValidQuantity(quantity);
        const unit = prompt.tieredPricing.unitLabel.trim();
        return (
          <div key={prompt.key} className="space-y-2 rounded-lg border border-border-primary p-3">
            {prompt.heading ? <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{prompt.heading}</p> : null}
            <div>
              <p className="text-sm font-medium text-text-primary">{prompt.description}</p>
              <p className="text-xs text-text-secondary">{prompt.serviceName}</p>
            </div>
            <ul className="list-disc pl-5 text-xs text-text-secondary">
              {describeTieredPricing(prompt.tieredPricing, prompt.currency).map((line) => <li key={line}>{line}</li>)}
            </ul>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <FormInput
                label={`Number of ${unit}s`}
                aria-label={`${prompt.description} quantity`}
                inputMode="decimal"
                inputSize="sm"
                placeholder="Leave blank to enter later"
                disabled={disabled}
                value={values[prompt.key] ?? ''}
                error={quantity !== '' && !valid ? 'Enter a number with at most two decimals' : undefined}
                onChange={(event) => onChange(prompt.key, event.target.value)}
              />
              <div className="text-sm sm:pt-6">
                <span className="text-text-secondary">Fee: </span>
                <span className="font-semibold text-text-primary">
                  {valid ? formatCurrency(priceTieredQuantity(prompt.tieredPricing, quantity), prompt.currency) : '—'}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Asks for the quantities of the tiered postpaid fees one filing bills before
 * it is marked Filed. Confirming passes only the quantities entered.
 */
export function BillingQuantityDialog({
  isOpen,
  title,
  prompts,
  confirmLabel = 'Mark Filed',
  isLoading = false,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  prompts: readonly BillingQuantityPromptItem[];
  confirmLabel?: string;
  isLoading?: boolean;
  onClose: () => void;
  onConfirm: (quantities: PostpaidQuantityInput[]) => void | Promise<void>;
}) {
  const [values, setValues] = useState<BillingQuantityValues>({});
  useEffect(() => {
    if (isOpen) setValues({});
  }, [isOpen]);
  const invalid = hasInvalidQuantity(prompts, values);
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description="These fees are priced by quantity. Enter the quantity to bill now, or leave it blank and enter it on the billing entry later."
      size="md"
    >
      <ModalBody>
        <BillingQuantityFields
          prompts={prompts}
          values={values}
          disabled={isLoading}
          onChange={(key, quantity) => setValues((current) => ({ ...current, [key]: quantity }))}
        />
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>Cancel</Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          isLoading={isLoading}
          disabled={invalid}
          onClick={() => void onConfirm([...enteredQuantities(prompts, values).values()])}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
