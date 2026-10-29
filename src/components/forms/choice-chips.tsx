'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChoiceChipOption {
  value: string;
  label: string;
  /** A selected required option cannot be cleared. */
  locked?: boolean;
}

interface ChoiceChipsProps {
  id: string;
  options: ChoiceChipOption[];
  selected: string[];
  multiple: boolean;
  onChange: (next: string[]) => void;
  labelledBy?: string;
  hasError?: boolean;
}

/**
 * Pill toggles for short choice lists (validation `choiceLayout: 'chips'`).
 * Single choice behaves as a radio group; multiple choice as a set of toggles.
 */
export function ChoiceChips({ id, options, selected, multiple, onChange, labelledBy, hasError }: ChoiceChipsProps) {
  const toggle = (option: ChoiceChipOption) => {
    const isSelected = selected.includes(option.value);
    if (!multiple) {
      if (!isSelected) onChange([option.value]);
      return;
    }
    if (isSelected) {
      if (option.locked) return;
      onChange(selected.filter((value) => value !== option.value));
    } else {
      // Keep the option order stable so stored answers do not depend on click order.
      const next = new Set([...selected, option.value]);
      onChange(options.map((candidate) => candidate.value).filter((value) => next.has(value)));
    }
  };

  return (
    <div
      id={id}
      role={multiple ? 'group' : 'radiogroup'}
      aria-labelledby={labelledBy}
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={isSelected}
            onClick={() => toggle(option)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#294D44]/30',
              isSelected
                ? 'border-[#294D44] bg-[#294D44] text-white'
                : 'border-[#D8E3DF] bg-[#F4F7F6] text-text-primary hover:border-[#294D44]/50',
              hasError && !isSelected && 'border-status-error/70'
            )}
          >
            {isSelected && multiple && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
