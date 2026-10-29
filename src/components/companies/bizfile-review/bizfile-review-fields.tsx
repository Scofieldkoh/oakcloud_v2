'use client';

import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import type { BizFileReviewIssue } from '@/lib/validations/bizfile-review';

type ReviewError = BizFileReviewIssue | string;

interface ReviewControlProps {
  id: string;
  label: string;
  error?: ReviewError;
  hint?: string;
}

function errorMessage(error?: ReviewError): string | undefined {
  return typeof error === 'string' ? error : error?.message;
}

function fieldPath(error?: ReviewError): string | undefined {
  return typeof error === 'object' ? error.path : undefined;
}

function describedBy(id: string, hint?: string, error?: ReviewError): string | undefined {
  return [hint && `${id}-hint`, errorMessage(error) && `${id}-error`].filter(Boolean).join(' ') || undefined;
}

function HelpText({ id, hint, error }: Pick<ReviewControlProps, 'id' | 'hint' | 'error'>) {
  const message = errorMessage(error);
  return (
    <>
      {hint && <p id={`${id}-hint`} className="text-xs text-text-muted">{hint}</p>}
      {message && <p id={`${id}-error`} className="text-xs text-status-error">{message}</p>}
    </>
  );
}

const controlClassName = 'h-8 w-full rounded-md border border-border-primary bg-background-primary px-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-oak-primary/30';

export type ReviewFieldProps = ReviewControlProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

export function ReviewField({ id, label, error, hint, className = '', ...props }: ReviewFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-text-secondary">{label}</label>
      <input {...props} id={id} data-field-path={fieldPath(error)} aria-describedby={describedBy(id, hint, error)} aria-invalid={Boolean(errorMessage(error))} className={`${controlClassName} ${className}`} />
      <HelpText id={id} hint={hint} error={error} />
    </div>
  );
}

export type ReviewSelectProps = ReviewControlProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'>;

export function ReviewSelect({ id, label, error, hint, className = '', children, ...props }: ReviewSelectProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-text-secondary">{label}</label>
      <select {...props} id={id} data-field-path={fieldPath(error)} aria-describedby={describedBy(id, hint, error)} aria-invalid={Boolean(errorMessage(error))} className={`${controlClassName} ${className}`}>{children}</select>
      <HelpText id={id} hint={hint} error={error} />
    </div>
  );
}

export type ReviewTextareaProps = ReviewControlProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>;

export function ReviewTextarea({ id, label, error, hint, className = '', ...props }: ReviewTextareaProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-text-secondary">{label}</label>
      <textarea {...props} id={id} data-field-path={fieldPath(error)} aria-describedby={describedBy(id, hint, error)} aria-invalid={Boolean(errorMessage(error))} className={`min-h-16 w-full rounded-md border border-border-primary bg-background-primary px-2 py-1.5 text-xs text-text-primary outline-none focus:ring-2 focus:ring-oak-primary/30 ${className}`} />
      <HelpText id={id} hint={hint} error={error} />
    </div>
  );
}

export type ReviewCheckboxProps = ReviewControlProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'>;

export function ReviewCheckbox({ id, label, error, hint, className = '', ...props }: ReviewCheckboxProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        <input {...props} id={id} type="checkbox" data-field-path={fieldPath(error)} aria-describedby={describedBy(id, hint, error)} aria-invalid={Boolean(errorMessage(error))} className={`h-4 w-4 rounded border-border-primary text-oak-primary focus:ring-oak-primary/30 ${className}`} />
        {label}
      </label>
      <HelpText id={id} hint={hint} error={error} />
    </div>
  );
}
