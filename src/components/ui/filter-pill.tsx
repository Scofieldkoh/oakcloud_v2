'use client';

import { cn } from '@/lib/utils';

export interface FilterPillOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

export interface FilterPillGroupProps {
  /** Available options */
  options: FilterPillOption[];
  /** Currently selected values */
  value: string[];
  /** Callback when selection changes */
  onChange: (value: string[]) => void;
  /** Label for the group */
  label?: string;
  /** Allow selecting all (default: true) */
  allowSelectAll?: boolean;
  /** Allow deselecting all (default: false - at least one must be selected) */
  allowEmpty?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * FilterPillGroup - A group of toggleable filter pills for multi-select filtering.
 * Compact, visually clear, and follows oak design system.
 */
export function FilterPillGroup({
  options,
  value,
  onChange,
  label,
  allowSelectAll = true,
  allowEmpty = false,
  className,
}: FilterPillGroupProps) {
  const allSelected = options.every((opt) => value.includes(opt.value));
  // With every option selected the only action left is "Deselect all", which
  // is offered only when an empty selection is allowed.
  const showSelectAll = allowSelectAll && options.length > 2 && (!allSelected || allowEmpty);

  const handleToggle = (optionValue: string) => {
    const isSelected = value.includes(optionValue);

    if (isSelected) {
      // Deselecting
      const newValue = value.filter((v) => v !== optionValue);
      // Don't allow empty unless explicitly allowed
      if (newValue.length === 0 && !allowEmpty) {
        return;
      }
      onChange(newValue);
    } else {
      // Selecting
      onChange([...value, optionValue]);
    }
  };

  const handleSelectAll = () => {
    onChange(allSelected ? [] : options.map((opt) => opt.value));
  };

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-text-primary">{label}</label>
          {showSelectAll && (
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs text-text-secondary hover:text-oak-primary transition-colors"
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = value.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleToggle(option.value)}
              aria-pressed={isSelected}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                'border focus:outline-none focus:ring-2 focus:ring-oak-primary/30',
                isSelected
                  ? 'bg-oak-primary text-white border-oak-primary hover:bg-oak-hover'
                  : 'bg-background-secondary text-text-secondary border-border-primary hover:border-border-secondary hover:text-text-primary'
              )}
            >
              {option.icon && <span className="w-3.5 h-3.5">{option.icon}</span>}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface FilterPillToggleProps {
  /** Label text */
  label: string;
  /** Whether the pill is active */
  active: boolean;
  /** Callback when toggled */
  onChange: (active: boolean) => void;
  /** Icon to display */
  icon?: React.ReactNode;
  /** Additional class name */
  className?: string;
}

/**
 * FilterPillToggle - A single toggleable filter pill.
 */
export function FilterPillToggle({
  label,
  active,
  onChange,
  icon,
  className,
}: FilterPillToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
        'border focus:outline-none focus:ring-2 focus:ring-oak-primary/30',
        active
          ? 'bg-oak-primary text-white border-oak-primary hover:bg-oak-hover'
          : 'bg-background-secondary text-text-secondary border-border-primary hover:border-border-secondary hover:text-text-primary',
        className
      )}
    >
      {icon && <span className="w-3.5 h-3.5">{icon}</span>}
      {label}
    </button>
  );
}

export default FilterPillGroup;
