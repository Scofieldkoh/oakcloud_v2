'use client';

import { Building2 } from 'lucide-react';
import type { Company } from '@/types/document-generation';
import type { ServiceVariantDto } from '@/services/service-catalog/types';
import type {
  ServiceAgreementItemDto,
  ServiceAgreementItemInput,
} from '@/services/service-agreement';
import { Button } from '@/components/ui/button';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { ServiceFeeEditor } from './service-fee-editor';
import { createServiceAgreementClientKey } from './client-key';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface ServiceItemEditorProps {
  item: ServiceAgreementItemInput;
  agreementDate: string;
  variant?: ServiceVariantDto;
  pinnedItem?: ServiceAgreementItemDto;
  entities: Company[];
  onChange: (item: ServiceAgreementItemInput) => void;
  onRemove: () => void;
  onCopy: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRefresh?: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function ServiceItemEditor({
  item,
  agreementDate,
  variant: currentVariant,
  pinnedItem,
  entities,
  onChange,
  onRemove,
  onCopy,
  onMoveUp,
  onMoveDown,
  onRefresh,
  canMoveUp,
  canMoveDown,
}: ServiceItemEditorProps) {
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const variant = currentVariant ?? {
    id: item.variantId,
    familyId: '',
    code: '',
    name: pinnedItem?.variantNameSnapshot ?? 'Pinned service',
    description: null,
    serviceCadence: pinnedItem?.serviceCadence ?? 'CUSTOM',
    customCadenceLabel: pinnedItem?.customCadenceLabel ?? null,
    displayOrder: item.displayOrder,
    version: pinnedItem?.variantVersion ?? 1,
    isActive: false,
    sowPartial: {
      id: pinnedItem?.sowPartialId ?? '',
      name: '',
      displayName: null,
      version: pinnedItem?.partialVersion ?? 1,
      placeholders: pinnedItem?.partialPlaceholdersSnapshot ?? [],
    },
    feeTemplates: [],
  } satisfies ServiceVariantDto;
  const names = new Map(entities.map((entity) => [entity.id, entity.name]));
  const placeholders = (
    pinnedItem?.partialPlaceholdersSnapshot
    ?? (Array.isArray(variant.sowPartial.placeholders)
      ? variant.sowPartial.placeholders
      : [])
  ).filter((entry): entry is { key: string; required?: boolean; label?: string } =>
    Boolean(entry)
      && typeof entry === 'object'
      && typeof (entry as { key?: unknown }).key === 'string'
      && (entry as { key: string }).key.startsWith('service.fields.'));
  const isStale = Boolean(
    pinnedItem
    && (
      pinnedItem.staleVariantVersion
      || pinnedItem.stalePartialVersion
      || (currentVariant && (
        currentVariant.version !== pinnedItem.variantVersion
        || currentVariant.sowPartial.version !== pinnedItem.partialVersion
      ))
    ),
  );
  return (
    <article className="rounded-xl border border-border-primary bg-background-primary p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {pinnedItem?.variantNameSnapshot ?? variant?.name}
          </h3>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <Button variant="ghost" size="xs" onClick={onMoveUp} disabled={!canMoveUp}>
            Move up
          </Button>
          <Button variant="ghost" size="xs" onClick={onMoveDown} disabled={!canMoveDown}>
            Move down
          </Button>
          <Button variant="ghost" size="xs" onClick={onCopy}>
            Copy
          </Button>
          <Button variant="ghost" size="xs" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
      {isStale ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-status-warning">
          <span>Newer catalog wording is available. Your saved wording remains pinned.</span>
          {onRefresh ? (
            <Button variant="secondary" size="xs" onClick={onRefresh}>
              Refresh wording
            </Button>
          ) : null}
        </div>
      ) : null}
      <fieldset className="mt-3">
        <legend className="text-xs font-medium text-text-secondary">Applies to</legend>
        <div className="mt-1 space-y-1.5">
          {entities.map((entity) => (
            <label
              key={entity.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm transition-colors hover:bg-background-secondary focus-within:ring-2 focus-within:ring-inset focus-within:ring-oak-primary/30"
            >
              <input
                aria-label={`Applies to ${entity.name}`}
                type="checkbox"
                checked={item.entityIds.includes(entity.id)}
                onChange={async (event) => {
                  const checked = event.target.checked;
                  if (
                    !checked
                    && item.feeLines.some((fee) => fee.companyId === entity.id)
                    && !(await confirm({
                      title: `Remove ${entity.name}?`,
                      description: `${entity.name} and all of its fee lines will be removed from this service.`,
                      confirmLabel: 'Remove',
                    }))
                  ) {
                    return;
                  }
                  const entityIds = checked
                    ? [...item.entityIds, entity.id]
                    : item.entityIds.filter((id) => id !== entity.id);
                  const feeLines = checked
                    ? [
                        ...item.feeLines,
                        ...(variant.feeTemplates.length > 0
                          ? variant.feeTemplates
                          : [{
                              id: 'manual',
                              description: variant.name,
                              defaultAmount: '0.00',
                              currency: 'SGD',
                              billingFrequency: 'ANNUALLY' as const,
                              customFrequencyLabel: null,
                              displayOrder: 0,
                            }]
                        ).map((template, index) => ({
                          clientKey: createServiceAgreementClientKey(),
                          companyId: entity.id,
                          description: template.description,
                          amount: template.defaultAmount ?? '0.00',
                          currency: template.currency,
                          billingFrequency: template.billingFrequency,
                          customFrequencyLabel: template.customFrequencyLabel,
                          billingStartDate: null,
                          billingStartDateOverridden: false,
                          displayOrder: index,
                        })),
                      ]
                    : item.feeLines.filter((fee) => fee.companyId !== entity.id);
                  onChange({ ...item, entityIds, feeLines });
                }}
                className="h-4 w-4 shrink-0 accent-oak-primary"
              />
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
                <Building2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-text-primary">{entity.name}</span>
                {entity.uen ? <span className="block truncate text-xs text-text-muted">{entity.uen}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {placeholders.length > 0 ? (
        <fieldset className="mt-3">
          <legend className="text-xs font-medium text-text-secondary">Service details</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {placeholders.map((placeholder) => {
              const key = placeholder.key.replace(/^service\.fields\./, '');
              const label = placeholder.label
                ?? key.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase());
              return (
                <label key={placeholder.key} className="text-xs text-text-secondary">
                  {label}{placeholder.required ? ' *' : ''}
                  <input
                    required={placeholder.required}
                    value={item.fieldValues[key] ?? ''}
                    onChange={(event) => onChange({
                      ...item,
                      fieldValues: {
                        ...item.fieldValues,
                        [key]: event.target.value,
                      },
                    })}
                    className="mt-1 h-11 w-full rounded border border-border-primary bg-background-primary px-2 text-sm sm:h-8"
                  />
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="max-w-[17rem] text-xs text-text-secondary">
          <span>Service start date</span>
          <SingleDateInput
            value={item.startDate}
            onChange={(next) => onChange({
              ...item,
              startDate: next || agreementDate,
              startDateOverridden: Boolean(next),
            })}
            ariaLabel="Service start date"
            showTodayButton
            className="mt-1 w-[17rem] max-w-full"
            controlClassName={(item.startDateOverridden ?? item.startDate !== agreementDate)
              ? 'bg-oak-row-selected dark:bg-oak-row-selected'
              : 'bg-background-tertiary dark:bg-background-tertiary'}
          />
        </div>
        <div className="max-w-[17rem] text-xs text-text-secondary">
          <span>End date</span>
          <SingleDateInput
            value={item.endDate ?? ''}
            onChange={(next) => onChange({ ...item, endDate: next || null })}
            ariaLabel="End date"
            showTodayButton
            className="mt-1 w-[17rem] max-w-full"
          />
        </div>
      </div>
      <details open className="mt-4 rounded-lg border border-border-primary bg-background-secondary/30">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oak-primary/30">
          Fees
        </summary>
        <div className="border-t border-border-secondary p-3">
        <ServiceFeeEditor
          fees={item.feeLines}
          entityIds={item.entityIds}
          companyNames={names}
          startDate={item.startDate}
          onChange={(feeLines) => onChange({ ...item, feeLines })}
        />
        </div>
      </details>
      {confirmDialog}
    </article>
  );
}
