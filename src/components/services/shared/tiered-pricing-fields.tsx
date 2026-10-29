'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import {
  MAX_PRICING_TIERS,
  TIERED_PRICING_MODES,
  TIERED_PRICING_MODE_HINTS,
  TIERED_PRICING_MODE_LABELS,
  type TieredPricing,
  type TieredPricingMode,
  type TieredPricingTier,
} from '@/services/billing/tiered-pricing';

/** Next "up to" for a new tier: the previous limit plus 100. */
function nextLimit(previous: string | null | undefined): string {
  const value = Number(previous ?? 0);
  return String(Number.isFinite(value) ? Math.floor(value) + 100 : 100);
}

/**
 * Tier table of a postpaid fee priced by quantity: what is counted, how the
 * tiers price it, and each tier's limit, flat fee and per-unit price. The
 * last tier has no limit.
 */
export function TieredPricingFields({
  idPrefix,
  label,
  currency,
  value,
  onChange,
  disabled = false,
  error,
}: {
  idPrefix: string;
  /** Accessible name prefix, e.g. "Fee 1". */
  label: string;
  currency: string;
  value: TieredPricing;
  onChange: (value: TieredPricing) => void;
  disabled?: boolean;
  error?: string;
}) {
  const modeId = `${idPrefix}-tier-mode`;
  const unit = value.unitLabel.trim() || 'unit';
  const updateTier = (index: number, changes: Partial<TieredPricingTier>) => onChange({
    ...value,
    tiers: value.tiers.map((tier, tierIndex) => (tierIndex === index ? { ...tier, ...changes } : tier)),
  });
  const addTier = () => {
    const bounded = value.tiers.slice(0, -1);
    const last = value.tiers[value.tiers.length - 1] ?? { upTo: null, flatAmount: '0', unitAmount: '0' };
    const added = { upTo: nextLimit(bounded[bounded.length - 1]?.upTo), flatAmount: last.flatAmount, unitAmount: last.unitAmount };
    onChange({ ...value, tiers: [...bounded, added, { ...last, upTo: null }] });
  };
  const removeTier = (index: number) => {
    const tiers = value.tiers.filter((_, tierIndex) => tierIndex !== index);
    // The last tier never has a limit.
    if (tiers.length > 0) tiers[tiers.length - 1] = { ...tiers[tiers.length - 1]!, upTo: null };
    onChange({ ...value, tiers });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border-primary bg-background-secondary/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormInput
          id={`${idPrefix}-unit-label`}
          label="Counted unit"
          aria-label={`${label} counted unit`}
          placeholder="transaction"
          hint="Singular, e.g. transaction or employee"
          inputSize="sm"
          maxLength={60}
          disabled={disabled}
          value={value.unitLabel}
          onChange={(event) => onChange({ ...value, unitLabel: event.target.value })}
        />
        <div>
          <label htmlFor={modeId} className="label">Tier pricing</label>
          <select
            id={modeId}
            aria-label={`${label} tier pricing`}
            className="input input-sm w-full"
            disabled={disabled}
            value={value.mode}
            onChange={(event) => onChange({ ...value, mode: event.target.value as TieredPricingMode })}
          >
            {TIERED_PRICING_MODES.map((mode) => (
              <option key={mode} value={mode}>{TIERED_PRICING_MODE_LABELS[mode]}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-muted">{TIERED_PRICING_MODE_HINTS[value.mode]}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="hidden grid-cols-12 gap-2 text-xs font-medium text-text-secondary sm:grid">
          <span className="col-span-4">Up to ({unit}s)</span>
          <span className="col-span-3">Flat fee ({currency})</span>
          <span className="col-span-4">Per {unit} ({currency})</span>
        </div>
        {value.tiers.map((tier, index) => {
          const last = index === value.tiers.length - 1;
          const tierLabel = `${label} tier ${index + 1}`;
          return (
            <div key={index} className="grid grid-cols-2 items-start gap-2 sm:grid-cols-12">
              <div className="col-span-2 sm:col-span-4">
                {last ? (
                  <p className="flex h-9 items-center text-sm text-text-secondary">
                    {value.tiers.length > 1 ? `Above ${value.tiers[index - 1]?.upTo || '…'}` : 'Any quantity'}
                  </p>
                ) : (
                  <FormInput
                    aria-label={`${tierLabel} up to`}
                    inputMode="decimal"
                    inputSize="sm"
                    disabled={disabled}
                    value={tier.upTo ?? ''}
                    onChange={(event) => updateTier(index, { upTo: event.target.value })}
                  />
                )}
              </div>
              <div className="sm:col-span-3">
                <FormInput
                  aria-label={`${tierLabel} flat fee`}
                  inputMode="decimal"
                  inputSize="sm"
                  disabled={disabled}
                  value={tier.flatAmount}
                  onChange={(event) => updateTier(index, { flatAmount: event.target.value })}
                />
              </div>
              <div className="sm:col-span-4">
                <FormInput
                  aria-label={`${tierLabel} price per unit`}
                  inputMode="decimal"
                  inputSize="sm"
                  disabled={disabled}
                  value={tier.unitAmount}
                  onChange={(event) => updateTier(index, { unitAmount: event.target.value })}
                />
              </div>
              <div className="col-span-2 flex justify-end sm:col-span-1">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  iconOnly
                  aria-label={`Remove ${tierLabel}`}
                  disabled={disabled || value.tiers.length <= 1}
                  onClick={() => removeTier(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          size="xs"
          variant="secondary"
          disabled={disabled || value.tiers.length >= MAX_PRICING_TIERS}
          onClick={addTier}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add tier
        </Button>
        <p className="text-xs text-text-muted">Use 0 for a fee or price a tier doesn&apos;t have.</p>
      </div>
      {error ? <p role="alert" className="text-xs text-status-error">{error}</p> : null}
    </div>
  );
}
