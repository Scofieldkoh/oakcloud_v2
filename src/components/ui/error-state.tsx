'use client';

import { AlertCircle, X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface ErrorStateProps {
  /** Error message to display */
  message?: string;
  /** The error object (will extract message if string not provided) */
  error?: Error | unknown;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
  /** Whether to display inline or as a block */
  inline?: boolean;
  /** Optional retry handler */
  onRetry?: () => void;
  /** Retry button label */
  retryLabel?: string;
}

const sizeConfig = {
  sm: {
    icon: 'w-4 h-4',
    text: 'text-xs',
    padding: 'p-3',
    gap: 'gap-2',
  },
  md: {
    icon: 'w-4 h-4',
    text: 'text-sm',
    padding: 'p-4',
    gap: 'gap-2',
  },
  lg: {
    icon: 'w-5 h-5',
    text: 'text-sm',
    padding: 'py-8',
    gap: 'gap-3',
  },
};

/**
 * Get error message from various error types
 */
function getErrorMessage(error: Error | unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return fallback;
}

/**
 * Reusable error state component with consistent styling.
 * Use this for displaying errors from async operations.
 */
export function ErrorState({
  message,
  error,
  size = 'md',
  className,
  inline = false,
  onRetry,
  retryLabel = 'Try again',
}: ErrorStateProps) {
  const config = sizeConfig[size];
  // Prioritize actual error message over generic fallback message
  const displayMessage = getErrorMessage(error, message || 'An error occurred');

  if (inline) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn('flex items-center', config.gap, 'text-status-error', className)}
      >
        <AlertCircle className={cn(config.icon, 'flex-shrink-0')} aria-hidden="true" />
        <span className={config.text}>{displayMessage}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-status-error hover:text-status-error/80 p-1 rounded hover:bg-status-error/10"
            aria-label={`${retryLabel}: ${displayMessage}`}
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn('text-center', config.padding, className)}
    >
      <div
        className={cn(
          'inline-flex items-center',
          config.gap,
          'px-4 py-2 bg-status-error/10 text-status-error rounded-lg'
        )}
      >
        <X className={cn(config.icon, 'flex-shrink-0')} aria-hidden="true" />
        <span className={config.text}>{displayMessage}</span>
      </div>
      {onRetry && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onRetry} aria-label={retryLabel}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline error for form fields
 */
export function InlineError({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn('flex items-start gap-2 mt-1.5 text-status-error', className)}
    >
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <span className="text-xs">{message}</span>
    </div>
  );
}
