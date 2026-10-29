'use client';

import { forwardRef } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Whether the checkbox is in an indeterminate state (some but not all selected) */
  indeterminate?: boolean;
  /** Label text for the checkbox */
  label?: string;
  /** Description text below the label */
  description?: string;
  /** Size of the checkbox */
  size?: 'sm' | 'md';
}

/**
 * Checkbox component with support for indeterminate state.
 * Used for selection in tables and forms.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      indeterminate = false,
      label,
      description,
      size = 'md',
      checked,
      disabled,
      ...props
    },
    ref
  ) => {
    const sizeClasses = {
      sm: 'w-4 h-4',
      md: 'w-5 h-5',
    };

    const iconSizeClasses = {
      sm: 'w-3 h-3',
      md: 'w-3.5 h-3.5',
    };

    const isChecked = checked || indeterminate;

    return (
      <label
        className={cn(
          'inline-flex items-start gap-2 min-h-[44px] sm:min-h-0 py-2 sm:py-0',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          className
        )}
      >
        <div className="relative flex items-center min-w-[44px] sm:min-w-0 min-h-[44px] sm:min-h-0 -m-2 sm:m-0 p-2 sm:p-0">
          <input
            type="checkbox"
            ref={ref}
            checked={checked}
            disabled={disabled}
            className="sr-only peer"
            {...props}
          />
          <div
            className={cn(
              sizeClasses[size],
              'flex items-center justify-center rounded border transition-all',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-oak-primary/30 peer-focus-visible:ring-offset-2',
              isChecked
                ? 'bg-oak-primary border-oak-primary text-white'
                : 'bg-background-primary border-border-primary hover:border-oak-primary/50',
              disabled && 'opacity-50'
            )}
          >
            {indeterminate ? (
              <Minus className={iconSizeClasses[size]} />
            ) : checked ? (
              <Check className={iconSizeClasses[size]} />
            ) : null}
          </div>
        </div>
        {(label || description) && (
          <div className="flex flex-col">
            {label && (
              <span
                className={cn(
                  'text-text-primary',
                  size === 'sm' ? 'text-sm' : 'text-base'
                )}
              >
                {label}
              </span>
            )}
            {description && (
              <span className="text-sm text-text-secondary">{description}</span>
            )}
          </div>
        )}
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
