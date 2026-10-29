'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ServiceVariantDto } from '@/services/service-catalog/types';
import type {
  ServiceAgreementItemDto,
  ServiceAgreementItemInput,
} from '@/services/service-agreement';
import type { Company } from '@/types/document-generation';
import { ServiceItemEditor } from './service-item-editor';
import { createServiceAgreementClientKey } from './client-key';
import { ServiceVariantPicker } from './service-variant-picker';

interface ServiceSelectionStepProps {
  entities: Company[];
  agreementDate: string;
  items: ServiceAgreementItemInput[];
  pinnedItems?: ServiceAgreementItemDto[];
  agreementId?: string | null;
  onPinnedItemChange?: (item: ServiceAgreementItemDto) => void;
  onValidationErrorsChange?: (errors: string[]) => void;
  onChange: (items: ServiceAgreementItemInput[]) => void;
}

export function ServiceSelectionStep({
  entities,
  agreementDate,
  items,
  pinnedItems = [],
  agreementId,
  onPinnedItemChange,
  onValidationErrorsChange,
  onChange,
}: ServiceSelectionStepProps) {
  const [variants, setVariants] = useState<ServiceVariantDto[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/service-catalog?selectable=true', { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => setVariants(body.variants ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!onValidationErrorsChange) return;
    const errors = items.flatMap((item) => {
      const variant = variants.find((candidate) => candidate.id === item.variantId);
      const pinned = pinnedItems.find((candidate) => candidate.id === item.id);
      const definitions = pinned?.partialPlaceholdersSnapshot
        ?? (Array.isArray(variant?.sowPartial.placeholders)
          ? variant.sowPartial.placeholders
          : []);
      const itemErrors: string[] = [];
      for (const definition of definitions) {
        if (
          definition
          && typeof definition === 'object'
          && 'key' in definition
          && typeof definition.key === 'string'
          && definition.key.startsWith('service.fields.')
          && 'required' in definition
          && definition.required
        ) {
          const key = definition.key.replace(/^service\.fields\./, '');
          if (!item.fieldValues[key]?.trim()) {
            itemErrors.push(
              `${pinned?.variantNameSnapshot ?? variant?.name ?? 'Service'}: ${key.replaceAll('_', ' ')} is required.`,
            );
          }
        }
      }
      if (item.entityIds.length === 0) itemErrors.push('Each service must target an entity.');
      if (item.feeLines.length === 0) itemErrors.push('Each service must have a fee line.');
      item.feeLines.forEach((fee) => {
        if (!fee.description.trim()) itemErrors.push('Fee descriptions are required.');
        if (!/^[A-Z]{3}$/.test(fee.currency)) itemErrors.push('Fee currency must use a three-letter code.');
        if (fee.billingFrequency === 'CUSTOM' && !fee.customFrequencyLabel?.trim()) {
          itemErrors.push('Custom fee frequency is required.');
        }
      });
      return itemErrors;
    });
    onValidationErrorsChange([...new Set(errors)]);
  }, [items, onValidationErrorsChange, pinnedItems, variants]);

  const addItem = () => {
    const variant = variants.find((candidate) => candidate.id === selectedVariantId);
    if (!variant || entities.length === 0) return;
    const key = createServiceAgreementClientKey();
    const startDate = agreementDate;
    const entityIds = entities.map((entity) => entity.id);
    const next: ServiceAgreementItemInput = {
      clientKey: key,
      variantId: variant.id,
      entityIds,
      startDate,
      startDateOverridden: false,
      endDate: null,
      fieldValues: {},
      displayOrder: items.length,
      feeLines: entityIds.flatMap((companyId) =>
        (variant.feeTemplates.length > 0
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
        ).map((fee, index) => ({
          clientKey: createServiceAgreementClientKey(),
          companyId,
          description: fee.description,
          amount: fee.defaultAmount ?? '0.00',
          currency: fee.currency,
          billingFrequency: fee.billingFrequency,
          customFrequencyLabel: fee.customFrequencyLabel,
          billingStartDate: null,
          billingStartDateOverridden: false,
          displayOrder: index,
        })),
      ),
    };
    onChange([...items, next]);
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <ServiceVariantPicker
          variants={variants}
          value={selectedVariantId}
          onChange={setSelectedVariantId}
        />
        <Button className="self-end" onClick={addItem} disabled={!selectedVariantId}>
          Add service
        </Button>
      </div>
      {items.map((item, index) => {
        const variant = variants.find((candidate) => candidate.id === item.variantId);
        const pinnedItem = pinnedItems.find((candidate) => candidate.id === item.id);
        return variant || pinnedItem ? (
          <ServiceItemEditor
            key={item.clientKey}
            item={item}
            agreementDate={agreementDate}
            variant={variant}
            pinnedItem={pinnedItem}
            entities={entities}
            onChange={(changed) =>
              onChange(items.map((candidate, candidateIndex) =>
                candidateIndex === index ? changed : candidate))
            }
            canMoveUp={index > 0}
            canMoveDown={index < items.length - 1}
            onMoveUp={() => {
              if (index === 0) return;
              const next = [...items];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              onChange(next.map((candidate, displayOrder) => ({
                ...candidate,
                displayOrder,
              })));
            }}
            onMoveDown={() => {
              if (index >= items.length - 1) return;
              const next = [...items];
              [next[index], next[index + 1]] = [next[index + 1], next[index]];
              onChange(next.map((candidate, displayOrder) => ({
                ...candidate,
                displayOrder,
              })));
            }}
            onCopy={() => {
              const copyKey = createServiceAgreementClientKey();
              const copy: ServiceAgreementItemInput = {
                ...item,
                id: undefined,
                clientKey: copyKey,
                displayOrder: items.length,
                feeLines: item.feeLines.map((fee) => ({
                  ...fee,
                  id: undefined,
                  clientKey: createServiceAgreementClientKey(),
                })),
              };
              onChange([...items, copy]);
            }}
            onRefresh={agreementId && item.id && onPinnedItemChange
              ? async () => {
                  const response = await fetch(
                    `/api/service-agreements/${agreementId}/items/${item.id}/refresh-wording`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        expectedVariantVersion: pinnedItem?.variantVersion,
                        expectedPartialVersion: pinnedItem?.partialVersion,
                      }),
                    },
                  );
                  if (!response.ok) return;
                  onPinnedItemChange(await response.json());
                }
              : undefined}
            onRemove={() =>
              onChange(
                items
                  .filter((_, candidateIndex) => candidateIndex !== index)
                  .map((candidate, displayOrder) => ({ ...candidate, displayOrder })),
              )
            }
          />
        ) : null;
      })}
    </section>
  );
}
