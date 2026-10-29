'use client';

import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FormInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  hint?: string;
  inputSize?: 'xs' | 'sm' | 'md' | 'lg';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerClassName?: string;
}

const sizeConfig = {
  xs: { input: 'h-7 px-3 text-xs', iconSize: 14, iconClass: 'w-3.5 h-3.5', leftPadding: 'pl-8', rightPadding: 'pr-8' },
  sm: { input: 'h-8 px-3 text-sm', iconSize: 16, iconClass: 'w-4 h-4', leftPadding: 'pl-9', rightPadding: 'pr-9' },
  md: { input: 'h-9 px-3.5 text-sm', iconSize: 16, iconClass: 'w-4 h-4', leftPadding: 'pl-10', rightPadding: 'pr-10' },
  lg: { input: 'h-10 px-4 text-base', iconSize: 20, iconClass: 'w-5 h-5', leftPadding: 'pl-11', rightPadding: 'pr-11' },
};

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, error, hint, inputSize = 'sm', leftIcon, rightIcon, containerClassName, id, type, className, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === 'password';
    const inputType = isPassword && showPassword ? 'text' : type;
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const config = sizeConfig[inputSize];

    return (
      <div className={cn('flex flex-col gap-2', containerClassName)}>
        {label && (
          <label htmlFor={inputId} className="block text-xs font-medium text-text-secondary">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span
              className={cn(
                'pointer-events-none absolute left-3 top-1/2 z-[1] flex -translate-y-1/2 items-center justify-center text-text-muted',
                config.iconClass
              )}
            >
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            type={inputType}
            className={cn(
              'w-full rounded-lg border border-border-primary bg-background-primary text-text-primary',
              'placeholder:text-text-muted hover:border-border-secondary',
              'focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 focus:ring-offset-2',
              'dark:bg-background-secondary',
              config.input,
              leftIcon && config.leftPadding,
              (rightIcon || isPassword) && config.rightPadding,
              error && 'border-status-error hover:border-status-error focus:border-status-error focus:ring-status-error/30',
              className
            )}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className={cn(
                'absolute right-3 top-1/2 flex -translate-y-1/2 items-center justify-center text-text-muted transition-colors hover:text-text-secondary',
                config.iconClass
              )}
            >
              {showPassword ? <EyeOff size={config.iconSize} /> : <Eye size={config.iconSize} />}
            </button>
          )}
          {rightIcon && !isPassword && (
            <span
              className={cn(
                'pointer-events-none absolute right-3 top-1/2 z-[1] flex -translate-y-1/2 items-center justify-center text-text-muted',
                config.iconClass
              )}
            >
              {rightIcon}
            </span>
          )}
        </div>
        {error && (
          <div id={`${inputId}-error`} className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle size={14} className="flex-shrink-0" />
            {error}
          </div>
        )}
        {hint && !error && (
          <div id={`${inputId}-hint`} className="text-xs text-text-muted">
            {hint}
          </div>
        )}
      </div>
    );
  }
);

FormInput.displayName = 'FormInput';
