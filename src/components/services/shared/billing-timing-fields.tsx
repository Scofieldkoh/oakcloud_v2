'use client';

import {
  BILLING_TIMINGS,
  BILLING_TIMING_LABELS,
  POSTPAID_TRIGGERS,
  POSTPAID_TRIGGER_LABELS,
  type BillingTiming,
  type PostpaidTrigger,
} from '@/services/billing/postpaid-triggers';
import { defaultTieredPricing, type TieredPricing } from '@/services/billing/tiered-pricing';

export type BillingTimingValue = {
  billingTiming: BillingTiming;
  postpaidTrigger: PostpaidTrigger | null;
  /** Postpaid only: quantity tiers; null for a fixed amount. */
  tieredPricing?: TieredPricing | null;
};

/**
 * Prepaid or postpaid choice for a fee line. A postpaid line bills once per
 * YA when its trigger filing is set to Filed, so it asks for the trigger and
 * whether it bills a fixed amount or by quantity tiers (edited with
 * TieredPricingFields).
 */
export function BillingTimingFields({
  idPrefix,
  label,
  value,
  onChange,
  disabled = false,
  error,
}: {
  idPrefix: string;
  /** Accessible name prefix, e.g. "Fee 1". */
  label: string;
  value: BillingTimingValue;
  onChange: (value: BillingTimingValue) => void;
  disabled?: boolean;
  error?: string;
}) {
  const timingId = `${idPrefix}-billing-timing`;
  const triggerId = `${idPrefix}-trigger`;
  const pricingId = `${idPrefix}-pricing`;
  const postpaid = value.billingTiming === 'POSTPAID';
  return (
    <div className={`grid grid-cols-1 gap-3 ${postpaid ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      <div>
        <label htmlFor={timingId} className="label">Billing basis</label>
        <select
          id={timingId}
          aria-label={`${label} billing basis`}
          className="input input-sm w-full"
          disabled={disabled}
          value={value.billingTiming}
          onChange={(event) => {
            const billingTiming = event.target.value as BillingTiming;
            onChange({
              billingTiming,
              postpaidTrigger: billingTiming === 'POSTPAID' ? value.postpaidTrigger ?? 'SG_ECI_OR_FORM_C_FILED' : null,
              tieredPricing: billingTiming === 'POSTPAID' ? value.tieredPricing ?? null : null,
            });
          }}
        >
          {BILLING_TIMINGS.map((timing) => (
            <option key={timing} value={timing}>{BILLING_TIMING_LABELS[timing]}</option>
          ))}
        </select>
      </div>
      {postpaid ? (
        <div>
          <label htmlFor={triggerId} className="label">Bill when</label>
          <select
            id={triggerId}
            aria-label={`${label} bill when`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${triggerId}-error` : `${triggerId}-hint`}
            className="input input-sm w-full"
            disabled={disabled}
            value={value.postpaidTrigger ?? ''}
            onChange={(event) => onChange({
              billingTiming: 'POSTPAID',
              postpaidTrigger: (event.target.value || null) as PostpaidTrigger | null,
              tieredPricing: value.tieredPricing ?? null,
            })}
          >
            <option value="">Select filing</option>
            {POSTPAID_TRIGGERS.map((trigger) => (
              <option key={trigger} value={trigger}>{POSTPAID_TRIGGER_LABELS[trigger]}</option>
            ))}
          </select>
          {error ? (
            <p id={`${triggerId}-error`} role="alert" className="mt-1 text-xs text-status-error">{error}</p>
          ) : (
            <p id={`${triggerId}-hint`} className="mt-1 text-xs text-text-muted">
              Bills once per YA, dated the day the status is set to Filed.
            </p>
          )}
        </div>
      ) : null}
      {postpaid ? (
        <div>
          <label htmlFor={pricingId} className="label">Pricing</label>
          <select
            id={pricingId}
            aria-label={`${label} pricing`}
            className="input input-sm w-full"
            disabled={disabled}
            value={value.tieredPricing ? 'TIERED' : 'FIXED'}
            onChange={(event) => onChange({
              billingTiming: 'POSTPAID',
              postpaidTrigger: value.postpaidTrigger,
              tieredPricing: event.target.value === 'TIERED' ? value.tieredPricing ?? defaultTieredPricing() : null,
            })}
          >
            <option value="FIXED">Fixed amount</option>
            <option value="TIERED">Tiered by quantity</option>
          </select>
          <p className="mt-1 text-xs text-text-muted">
            {value.tieredPricing ? 'Asks for the quantity when the filing is marked Filed.' : 'Bills the same amount each YA.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
