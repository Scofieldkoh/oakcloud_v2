'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingStateProps {
  /** Loading message to display */
  message?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
  /** Whether to display inline or as a block */
  inline?: boolean;
}

const sizeConfig = {
  sm: {
    spinner: 'w-4 h-4',
    text: 'text-xs',
    padding: 'p-4',
  },
  md: {
    spinner: 'w-5 h-5',
    text: 'text-sm',
    padding: 'p-8',
  },
  lg: {
    spinner: 'w-6 h-6',
    text: 'text-sm',
    padding: 'py-12',
  },
};

/**
 * Reusable loading state component with consistent styling.
 * Use this for async data loading states across the application.
 */
export function LoadingState({
  message = 'Loading...',
  size = 'md',
  className,
  inline = false,
}: LoadingStateProps) {
  const config = sizeConfig[size];

  if (inline) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn('flex items-center gap-2', className)}
      >
        <Loader2 className={cn(config.spinner, 'animate-spin text-oak-light')} aria-hidden="true" />
        {message && <span className={cn(config.text, 'text-text-muted')}>{message}</span>}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn('text-center', config.padding, className)}
    >
      <Loader2 className={cn(config.spinner, 'animate-spin mx-auto text-oak-light')} aria-hidden="true" />
      {message && <p className={cn(config.text, 'text-text-muted mt-2')}>{message}</p>}
    </div>
  );
}

/**
 * Simple spinner without message for compact spaces
 */
export function LoadingSpinner({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const spinnerSize = sizeConfig[size].spinner;
  return (
    <Loader2
      className={cn(spinnerSize, 'animate-spin text-oak-light', className)}
      aria-hidden="true"
    />
  );
}
