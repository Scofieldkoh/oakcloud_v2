'use client';

import { cn } from '@/lib/utils';

interface ConfidenceDotProps {
  confidence: number; // 0-1 or 0-100
  showTooltip?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * ConfidenceDot - Visual indicator for extraction confidence levels
 *
 * Colors:
 * - Green (>90%): High confidence
 * - Yellow (70-90%): Medium confidence
 * - Red (<70%): Low confidence
 */
export function ConfidenceDot({
  confidence,
  showTooltip = true,
  size = 'sm',
  className
}: ConfidenceDotProps) {
  // Normalize to 0-1 if value is 0-100
  const normalizedConfidence = confidence > 1 ? confidence / 100 : confidence;
  const percentage = Math.round(normalizedConfidence * 100);

  // Determine color based on confidence level
  const getColorClass = () => {
    if (normalizedConfidence >= 0.9) {
      return 'bg-green-500';
    } else if (normalizedConfidence >= 0.7) {
      return 'bg-yellow-500';
    } else {
      return 'bg-red-500';
    }
  };

  const getSizeClass = () => {
    switch (size) {
      case 'sm':
        return 'w-2 h-2';
      case 'md':
        return 'w-2.5 h-2.5';
      case 'lg':
        return 'w-3 h-3';
      default:
        return 'w-2 h-2';
    }
  };

  return (
    <span
      className={cn(
        'inline-block rounded-full flex-shrink-0',
        getColorClass(),
        getSizeClass(),
        showTooltip && 'cursor-help',
        className
      )}
      title={showTooltip ? `${percentage}% confidence` : undefined}
    />
  );
}

/**
 * ConfidenceBadge - A more prominent confidence indicator with text
 */
export function ConfidenceBadge({
  confidence,
  className
}: {
  confidence: number;
  className?: string;
}) {
  const normalizedConfidence = confidence > 1 ? confidence / 100 : confidence;
  const percentage = Math.round(normalizedConfidence * 100);

  const getColorClasses = () => {
    if (normalizedConfidence >= 0.9) {
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    } else if (normalizedConfidence >= 0.7) {
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
    } else {
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    }
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        getColorClasses(),
        className
      )}
    >
      {percentage}%
    </span>
  );
}
