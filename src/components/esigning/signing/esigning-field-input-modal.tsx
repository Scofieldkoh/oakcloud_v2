'use client';

import { useEffect, useMemo, useState } from 'react';
import type { EsigningFieldDefinitionDto } from '@/types/esigning';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';

interface EsigningFieldInputModalProps {
  field: EsigningFieldDefinitionDto | null;
  isOpen: boolean;
  initialValue: string | null;
  placeholder?: string;
  suggestedValue?: string | null;
  onClose: () => void;
  onSave: (value: string | null) => void;
}

function getFieldTitle(field: EsigningFieldDefinitionDto | null): string {
  if (!field) return 'Fill field';
  if (field.label?.trim()) return field.label.trim();
  switch (field.type) {
    case 'NAME':
      return 'Name';
    case 'COMPANY':
      return 'Company';
    case 'TITLE':
      return 'Title';
    case 'DATE_SIGNED':
      return 'Date Signed';
    case 'TEXT':
      return 'Text Field';
    default:
      return 'Fill field';
  }
}

function getFieldPlaceholder(field: EsigningFieldDefinitionDto | null): string {
  if (!field) return '';
  if (field.placeholder?.trim()) return field.placeholder.trim();
  switch (field.type) {
    case 'NAME':
      return 'Enter your full name';
    case 'COMPANY':
      return 'Enter your company name';
    case 'TITLE':
      return 'Enter your title';
    case 'DATE_SIGNED':
      return '';
    case 'TEXT':
      return 'Enter the requested text';
    default:
      return '';
  }
}

export function EsigningFieldInputModal({
  field,
  isOpen,
  initialValue,
  placeholder: placeholderOverride,
  suggestedValue,
  onClose,
  onSave,
}: EsigningFieldInputModalProps) {
  const [value, setValue] = useState('');
  const isDateField = field?.type === 'DATE_SIGNED';
  const title = getFieldTitle(field);
  const placeholder = placeholderOverride ?? getFieldPlaceholder(field);

  useEffect(() => {
    if (!isOpen) return;
    setValue(initialValue ?? suggestedValue ?? '');
  }, [initialValue, isOpen, suggestedValue]);

  const trimmedValue = useMemo(() => value.trim(), [value]);
  const normalizedValue = isDateField ? (value || null) : (trimmedValue || null);
  const canSave = field ? (!field.required || Boolean(normalizedValue)) : false;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={field?.required ? 'This field is required before you can finish signing.' : undefined}
      size="lg"
    >
      <ModalBody className="space-y-4">
        {isDateField ? (
          <label className="flex flex-col gap-2 text-xs font-medium text-text-secondary">
            <span>{title}</span>
            <input
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="DD-MM-YYYY"
              className="h-9 rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary"
            />
          </label>
        ) : field?.type === 'TEXT' ? (
          <label className="flex flex-col gap-2 text-xs font-medium text-text-secondary">
            <span>{title}</span>
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              rows={4}
              className="min-h-[100px] rounded-xl border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary outline-none resize-none focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/30 sm:min-h-[140px]"
            />
          </label>
        ) : (
          <FormInput
            label={title}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
          />
        )}
      </ModalBody>
      <ModalFooter className="justify-between">
        <Button
          variant="secondary"
          onClick={() => {
            setValue('');
            onSave(null);
          }}
        >
          Clear
        </Button>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(normalizedValue)} disabled={!canSave}>
            Save
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
