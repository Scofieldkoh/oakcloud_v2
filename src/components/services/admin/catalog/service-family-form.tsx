'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import type {
  CreateServiceFamilyInput,
  UpdateServiceFamilyInput,
} from '@/lib/validations/service-catalog';
import type { ServiceFamilyDto } from '@/services/service-catalog/types';

const DEFAULT_FAMILY_COLOR = '#2F6F5E';

interface ServiceFamilyFormProps {
  initialValue?: ServiceFamilyDto;
  onCancel: () => void;
  onSubmit: (
    input: CreateServiceFamilyInput | UpdateServiceFamilyInput,
  ) => Promise<void>;
  isSubmitting?: boolean;
}

export function ServiceFamilyForm({
  initialValue,
  onCancel,
  onSubmit,
  isSubmitting = false,
}: ServiceFamilyFormProps) {
  const [code, setCode] = useState(initialValue?.code ?? '');
  const [name, setName] = useState(initialValue?.name ?? '');
  const [description, setDescription] = useState(initialValue?.description ?? '');
  const [displayColor, setDisplayColor] = useState(
    initialValue?.displayColor ?? DEFAULT_FAMILY_COLOR,
  );
  const [displayOrder, setDisplayOrder] = useState(
    String(initialValue?.displayOrder ?? 0),
  );
  const [isActive, setIsActive] = useState(initialValue?.isActive ?? true);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      code,
      name,
      description: description || null,
      displayColor: displayColor.trim().toUpperCase(),
      displayOrder: Number.parseInt(displayOrder, 10) || 0,
      isActive,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            label="Family code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ACCOUNTING"
            required
          />
          <FormInput
            label="Family name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Accounting"
            required
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            id="service-family-color"
            label="Display color"
            type="color"
            value={displayColor}
            onChange={(event) => setDisplayColor(event.target.value.toUpperCase())}
            hint="Used for family badges, filters, table accents, and calendar events."
          />
          <div className="flex min-h-9 items-center gap-2 self-end rounded-lg border border-border-primary bg-background-primary px-3 py-2">
            <span
              aria-hidden="true"
              className="h-5 w-5 shrink-0 rounded-full border border-border-secondary"
              style={{ backgroundColor: displayColor }}
            />
            <span className="text-sm text-text-primary">
              {name || 'Family color preview'}
            </span>
          </div>
        </div>
        <label className="block text-xs font-medium text-text-secondary">
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-lg border border-border-primary bg-background-primary px-3.5 py-2 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            label="Display order"
            type="number"
            min={0}
            value={displayOrder}
            onChange={(event) => setDisplayOrder(event.target.value)}
          />
          <label className="flex min-h-11 items-center gap-2 self-end text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Active
          </label>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-primary p-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {initialValue ? 'Save family' : 'Create family'}
        </Button>
      </div>
    </form>
  );
}
