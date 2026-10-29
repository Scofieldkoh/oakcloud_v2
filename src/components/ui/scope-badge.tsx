'use client';

import { Shield, Settings, Building2, Globe, User, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Scope configuration for different access levels
 */
export const SCOPE_CONFIG: Record<string, {
  icon: LucideIcon;
  color: string;
  bgColor: string;
  label: string;
}> = {
  system: {
    icon: Shield,
    color: 'text-purple-800 dark:text-purple-300',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    label: 'System',
  },
  tenant: {
    icon: Building2,
    color: 'text-blue-800 dark:text-blue-300',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    label: 'Workspace',
  },
  company: {
    icon: Settings,
    color: 'text-teal-800 dark:text-teal-300',
    bgColor: 'bg-teal-100 dark:bg-teal-900/30',
    label: 'Company',
  },
  user: {
    icon: User,
    color: 'text-gray-800 dark:text-gray-300',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    label: 'User',
  },
  global: {
    icon: Globe,
    color: 'text-indigo-800 dark:text-indigo-300',
    bgColor: 'bg-indigo-100 dark:bg-indigo-900/30',
    label: 'Global',
  },
};

export type ScopeType = keyof typeof SCOPE_CONFIG;

export interface ScopeBadgeProps {
  /** Scope type or boolean for simple system/workspace */
  scope: ScopeType | boolean;
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
 * ScopeBadge - Display access scope indicators with consistent styling
 *
 * Features:
 * - Predefined scope types (system, tenant, company, user, global)
 * - Boolean shorthand for simple system/workspace distinction
 * - Multiple size variants
 * - Optional icon display
 * - Dark mode support
 *
 * @example
 * ```tsx
 * // Boolean shorthand (system vs workspace)
 * <ScopeBadge scope={true} />   // Shows "System"
 * <ScopeBadge scope={false} />  // Shows "Workspace"
 *
 * // Named scope
 * <ScopeBadge scope="company" />
 * <ScopeBadge scope="global" />
 *
 * // Custom label
 * <ScopeBadge scope="system" label="Admin" />
 *
 * // Without icon
 * <ScopeBadge scope="tenant" showIcon={false} />
 * ```
 */
export function ScopeBadge({
  scope,
  label,
  size = 'sm',
  showIcon = true,
  className,
}: ScopeBadgeProps) {
  // Convert boolean to scope type (true = system, false = workspace)
  const scopeType: ScopeType = typeof scope === 'boolean'
    ? (scope ? 'system' : 'tenant')
    : scope;

  const config = SCOPE_CONFIG[scopeType] || SCOPE_CONFIG.tenant;
  const Icon = config.icon;
  const sizeConfig = SIZE_CONFIG[size];
  const displayLabel = label || config.label;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded font-medium',
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

export default ScopeBadge;
