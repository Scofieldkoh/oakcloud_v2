'use client';

import { cn } from '@/lib/utils';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { customFieldOptionLabels, customFieldOptions } from '@/lib/document-generation-master-fields';
import {
  createWorkflowFieldInputDescriptors,
  fieldInputDescriptorDefaultValue,
  isWorkflowFieldValuePresent,
} from '@/lib/document-editor/template-field-workflow';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';
import type { EditableBatchItem } from './batch-workspace-state';

export interface BatchCustomFieldFormProps {
  item: EditableBatchItem;
  fields: CustomPlaceholderDefinition[];
  onPatch: (patch: Partial<EditableBatchItem['configuration']>) => void;
  disabled?: boolean;
}

export function BatchCustomFieldForm({
  item,
  fields,
  onPatch,
  disabled = false,
}: BatchCustomFieldFormProps) {
  const itemValues = item.configuration.itemValues;
  const fieldKeys = new Set(fields.map((field) => field.key));
  const extraKeys = Object.keys(itemValues).filter((key) => !fieldKeys.has(key));
  const visibleFields: CustomPlaceholderDefinition[] = [
    ...fields,
    ...extraKeys.map((key) => ({
      id: key,
      key,
      label: key,
      type: 'text' as const,
      required: false,
    })),
  ];
  const descriptors = createWorkflowFieldInputDescriptors(visibleFields, {
    kind: 'template',
    id: item.templateId,
  });

  if (visibleFields.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-primary p-3 text-sm text-text-muted">
        This document has no item-specific custom fields.
      </p>
    );
  }

  const entries = visibleFields.map((field, index) => ({
    field,
    descriptor: descriptors[index],
  }));
  const requiredFields = entries.filter(({ descriptor, field }) => descriptor?.required ?? field.required);
  const missingRequired = requiredFields.filter(({ descriptor, field }) => {
    const current = itemValues[field.key];
    const fallback = descriptor ? fieldInputDescriptorDefaultValue(descriptor) : field.defaultValue;
    return !isWorkflowFieldValuePresent(
      Object.prototype.hasOwnProperty.call(itemValues, field.key) ? current : fallback,
    );
  });

  const patchValue = (key: string, value: string | boolean) => onPatch({
    itemValues: { ...itemValues, [key]: value },
  });

  return (
    <div className="space-y-3">
      {requiredFields.length > 0 ? (
        <p
          className={cn(
            'text-xs font-medium',
            missingRequired.length > 0 ? 'text-status-warning' : 'text-status-success',
          )}
          aria-live="polite"
        >
          {missingRequired.length === 0
            ? 'All required fields are filled.'
            : `${missingRequired.length} of ${requiredFields.length} required field${requiredFields.length === 1 ? '' : 's'} still need${missingRequired.length === 1 ? 's' : ''} a value.`}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {entries.map(({ field, descriptor }) => {
          const hasExplicitValue = Object.prototype.hasOwnProperty.call(itemValues, field.key);
          const fallback = descriptor ? fieldInputDescriptorDefaultValue(descriptor) : field.defaultValue;
          const rawValue = hasExplicitValue ? itemValues[field.key] : fallback;
          const missing = (descriptor?.required ?? field.required)
            && !isWorkflowFieldValuePresent(rawValue);
          const textValue = typeof rawValue === 'string'
            ? rawValue
            : rawValue === undefined || rawValue === null ? '' : String(rawValue);
          const control = descriptor?.control
            ?? (field.type === 'date' ? 'date' : field.type === 'textarea' ? 'textarea' : field.type === 'boolean' ? 'boolean' : 'text');
          const required = descriptor?.required ?? field.required;
          const inputDisabled = disabled || control === 'read-only';
          const key = descriptor?.identity ?? field.fieldIdentity ?? field.id ?? field.key;

          if (control === 'date') {
            return (
              <div key={key} className="block">
                <span className="text-sm font-medium text-text-primary">{field.label}</span>
                {required && <span className="ml-1 text-status-error" aria-hidden="true">*</span>}
                <SingleDateInput
                  value={textValue}
                  onChange={(next) => patchValue(field.key, next)}
                  disabled={inputDisabled}
                  ariaLabel={field.label}
                  showTodayButton
                  error={missing ? 'Required' : undefined}
                  className="mt-1 w-full"
                />
              </div>
            );
          }

          if (control === 'boolean') {
            const checked = rawValue === true || rawValue === 'true' || rawValue === '1';
            return (
              <label
                key={key}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg border bg-background-primary px-3 py-2',
                  missing ? 'border-status-error/50' : 'border-border-primary',
                  inputDisabled && 'opacity-70',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => patchValue(field.key, event.target.checked)}
                  disabled={inputDisabled}
                  aria-label={field.label}
                  aria-required={required || undefined}
                  className="h-4 w-4 rounded border-border-primary text-oak-primary focus:ring-oak-primary"
                />
                <span className="min-w-0 text-sm font-medium text-text-primary">
                  {field.label}
                  {required && <span className="ml-1 text-status-error" aria-hidden="true">*</span>}
                </span>
              </label>
            );
          }

          const options = customFieldOptions(field);
          if (options.length > 0) {
            const labels = customFieldOptionLabels(field);
            return (
              <div key={key} className="block">
                <span className="text-sm font-medium text-text-primary">{field.label}</span>
                {required && <span className="ml-1 text-status-error" aria-hidden="true">*</span>}
                <SearchableSelect
                  ariaLabel={field.label}
                  options={options.map((option) => ({ value: option, label: labels[option] ?? option }))}
                  value={textValue}
                  onChange={(next) => patchValue(field.key, next)}
                  disabled={inputDisabled}
                  placeholder="Choose..."
                  clearable={!required}
                  error={missing ? 'Required' : undefined}
                  size="md"
                  className="mt-1"
                />
              </div>
            );
          }

          if (control === 'textarea') {
            return (
              <label key={key} className="block lg:col-span-2">
                <span className="text-sm font-medium text-text-primary">{field.label}</span>
                {required && <span className="ml-1 text-status-error" aria-hidden="true">*</span>}
                <textarea
                  value={textValue}
                  rows={4}
                  onChange={(event) => patchValue(field.key, event.target.value)}
                  disabled={inputDisabled}
                  aria-label={field.label}
                  aria-required={required || undefined}
                  aria-invalid={missing || undefined}
                  className={cn(
                    'mt-1 w-full rounded-lg border bg-background-primary px-3 py-2 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30',
                    missing ? 'border-status-error/50' : 'border-border-primary',
                  )}
                />
                {missing ? <span className="mt-1 block text-xs text-status-error">Required</span> : null}
              </label>
            );
          }

          return (
            <label key={key} className="block">
              <span className="text-sm font-medium text-text-primary">{field.label}</span>
              {required && <span className="ml-1 text-status-error" aria-hidden="true">*</span>}
              <input
                type="text"
                inputMode={control === 'decimal' || control === 'currency' ? 'decimal' : undefined}
                value={textValue}
                onChange={(event) => patchValue(field.key, event.target.value)}
                disabled={inputDisabled}
                aria-label={field.label}
                aria-required={required || undefined}
                aria-invalid={missing || undefined}
                className={cn(
                  'mt-1 min-h-11 w-full rounded-lg border bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 lg:min-h-9',
                  missing ? 'border-status-error/50' : 'border-border-primary',
                )}
              />
              {descriptor?.disabledReason ? (
                <span className="mt-1 block text-xs text-status-warning">{descriptor.disabledReason}</span>
              ) : missing ? (
                <span className="mt-1 block text-xs text-status-error">Required</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
