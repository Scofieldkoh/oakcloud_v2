/**
 * Shared variant configurations for UI components
 * Used by Alert, Toast, ConfirmDialog, and similar components
 */

import { CheckCircle2, AlertCircle, AlertTriangle, Info, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ============================================================================
// Status Variants (Alert, Toast)
// ============================================================================

export type StatusVariant = 'success' | 'error' | 'warning' | 'info';

export interface StatusVariantConfig {
  icon: LucideIcon;
  /** Combined background, border, and text color classes */
  className: string;
  /** Background class only */
  bgClass: string;
  /** Border class only */
  borderClass: string;
  /** Text/icon color class */
  colorClass: string;
}

export const statusVariants: Record<StatusVariant, StatusVariantConfig> = {
  success: {
    icon: CheckCircle2,
    className: 'bg-status-success/10 border-status-success/20 text-status-success',
    bgClass: 'bg-status-success/10',
    borderClass: 'border-status-success/20',
    colorClass: 'text-status-success',
  },
  error: {
    icon: AlertCircle,
    className: 'bg-status-error/10 border-status-error/20 text-status-error',
    bgClass: 'bg-status-error/10',
    borderClass: 'border-status-error/20',
    colorClass: 'text-status-error',
  },
  warning: {
    icon: AlertTriangle,
    className: 'bg-status-warning/10 border-status-warning/20 text-status-warning',
    bgClass: 'bg-status-warning/10',
    borderClass: 'border-status-warning/20',
    colorClass: 'text-status-warning',
  },
  info: {
    icon: Info,
    className: 'bg-status-info/10 border-status-info/20 text-status-info',
    bgClass: 'bg-status-info/10',
    borderClass: 'border-status-info/20',
    colorClass: 'text-status-info',
  },
};

// ============================================================================
// Dialog Variants (ConfirmDialog)
// ============================================================================

export type DialogVariant = 'danger' | 'warning' | 'info';

export interface DialogVariantConfig {
  icon: LucideIcon;
  /** Background class for icon container */
  iconBgClass: string;
  /** Icon color class */
  iconColorClass: string;
  /** Button variant to use for confirm action */
  buttonVariant: 'primary' | 'danger';
}

export const dialogVariants: Record<DialogVariant, DialogVariantConfig> = {
  danger: {
    icon: Trash2,
    iconBgClass: 'bg-status-error/10',
    iconColorClass: 'text-status-error',
    buttonVariant: 'danger',
  },
  warning: {
    icon: AlertTriangle,
    iconBgClass: 'bg-status-warning/10',
    iconColorClass: 'text-status-warning',
    buttonVariant: 'primary',
  },
  info: {
    icon: Info,
    iconBgClass: 'bg-status-info/10',
    iconColorClass: 'text-status-info',
    buttonVariant: 'primary',
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get status variant configuration
 */
export function getStatusVariant(variant: StatusVariant): StatusVariantConfig {
  return statusVariants[variant];
}

/**
 * Get dialog variant configuration
 */
export function getDialogVariant(variant: DialogVariant): DialogVariantConfig {
  return dialogVariants[variant];
}
