'use client';

import { Check, X, Clock, AlertCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Status configuration for different states
 */
export const STATUS_CONFIG: Record<string, {
  icon: LucideIcon;
  color: string;
  bgColor: string;
  label: string;
}> = {
  enabled: {
    icon: Check,
    color: 'text-green-800 dark:text-green-300',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    label: 'Enabled',
  },
  disabled: {
    icon: X,
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    label: 'Disabled',
  },
  active: {
    icon: Check,
    color: 'text-green-800 dark:text-green-300',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    label: 'Active',
  },
  inactive: {
    icon: X,
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    label: 'Inactive',
  },
  pending: {
    icon: Clock,
    color: 'text-amber-800 dark:text-amber-300',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    label: 'Pending',
  },
  success: {
    icon: Check,
    color: 'text-green-800 dark:text-green-300',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    label: 'Success',
  },
  failed: {
    icon: X,
    color: 'text-red-800 dark:text-red-300',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    label: 'Failed',
  },
  error: {
    icon: AlertCircle,
    color: 'text-red-800 dark:text-red-300',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    label: 'Error',
  },
};

export type StatusType = keyof typeof STATUS_CONFIG;

export interface StatusBadgeProps {
  /** Status type or boolean for simple enabled/disabled */
  status: StatusType | boolean;
  /** Custom label (overrides default) */
  label?: string;
  /** Size variant */
  size?: 'xs' | 'sm' | 'md';
  /** Whether to show the icon */
  showIcon?: boolean;
  /** Additional class name */
  className?: string;
}

const SIZE_CONFIG = {
  xs: { badge: 'px-1.5 py-0.5 text-xs gap-0.5', icon: 'w-2.5 h-2.5' },
  sm: { badge: 'px-2 py-0.5 text-xs gap-1', icon: 'w-3 h-3' },
  md: { badge: 'px-2.5 py-1 text-sm gap-1.5', icon: 'w-3.5 h-3.5' },
};

/**
 * StatusBadge - Display status indicators with consistent styling
 *
 * Features:
 * - Predefined status types (enabled, disabled, active, pending, etc.)
 * - Boolean shorthand for simple enabled/disabled states
 * - Multiple size variants
 * - Optional icon display
 * - Dark mode support
 *
 * @example
 * ```tsx
 * // Boolean shorthand
 * <StatusBadge status={true} />  // Shows "Enabled"
 * <StatusBadge status={false} /> // Shows "Disabled"
 *
 * // Named status
 * <StatusBadge status="pending" />
 * <StatusBadge status="success" />
 *
 * // Custom label
 * <StatusBadge status="active" label="Online" />
 *
 * // Without icon
 * <StatusBadge status="enabled" showIcon={false} />
 * ```
 */
export function StatusBadge({
  status,
  label,
  size = 'sm',
  showIcon = true,
  className,
}: StatusBadgeProps) {
  // Convert boolean to status type
  const statusType: StatusType = typeof status === 'boolean'
    ? (status ? 'enabled' : 'disabled')
    : status;

  const config = STATUS_CONFIG[statusType] || STATUS_CONFIG.disabled;
  const Icon = config.icon;
  const sizeConfig = SIZE_CONFIG[size];
  const displayLabel = label || config.label;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        sizeConfig.badge,
        config.bgColor,
        config.color,
        className
      )}
    >
      {showIcon && <Icon className={sizeConfig.icon} />}
      {displayLabel}
    </span>
  );
}

export default StatusBadge;
