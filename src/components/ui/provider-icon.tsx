'use client';

import { Brain, Cloud, Zap, Database, Server, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Provider configuration for icons and colors
 */
export const PROVIDER_CONFIG: Record<string, {
  icon: LucideIcon;
  color: string;
  bgColor: string;
  label: string;
}> = {
  // AI Providers
  OPENAI: {
    icon: Brain,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    label: 'OpenAI',
  },
  ANTHROPIC: {
    icon: Brain,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    label: 'Anthropic',
  },
  GOOGLE: {
    icon: Brain,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    label: 'Google AI',
  },
  OPENROUTER: {
    icon: Zap,
    color: 'text-violet-600 dark:text-violet-400',
    bgColor: 'bg-violet-100 dark:bg-violet-900/30',
    label: 'OpenRouter',
  },
  MISTRAL: {
    icon: Brain,
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-100 dark:bg-rose-900/30',
    label: 'Mistral OCR',
  },
  // Storage Providers
  ONEDRIVE: {
    icon: Cloud,
    color: 'text-sky-600 dark:text-sky-400',
    bgColor: 'bg-sky-100 dark:bg-sky-900/30',
    label: 'OneDrive',
  },
  SHAREPOINT: {
    icon: Cloud,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    label: 'SharePoint',
  },
  S3: {
    icon: Database,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    label: 'Amazon S3',
  },
  MINIO: {
    icon: Server,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    label: 'MinIO',
  },
  // Default fallback
  DEFAULT: {
    icon: Zap,
    color: 'text-text-secondary',
    bgColor: 'bg-background-tertiary',
    label: 'Provider',
  },
};

export type ProviderType = keyof typeof PROVIDER_CONFIG | string;

export interface ProviderIconProps {
  /** Provider identifier (e.g., 'OPENAI', 'ANTHROPIC', 'ONEDRIVE') */
  provider: ProviderType;
  /** Size variant */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Whether to show background circle */
  showBackground?: boolean;
  /** Additional class name */
  className?: string;
}

const SIZE_CONFIG = {
  xs: { icon: 'w-3 h-3', container: 'p-1' },
  sm: { icon: 'w-4 h-4', container: 'p-1.5' },
  md: { icon: 'w-5 h-5', container: 'p-2' },
  lg: { icon: 'w-6 h-6', container: 'p-2.5' },
};

/**
 * ProviderIcon - Display brand-colored icons for service providers
 *
 * Features:
 * - Semantic colors for known providers (AI, Storage)
 * - Optional circular background
 * - Multiple size variants
 * - Dark mode support
 *
 * @example
 * ```tsx
 * // Simple icon
 * <ProviderIcon provider="OPENAI" />
 *
 * // With background
 * <ProviderIcon provider="ANTHROPIC" showBackground />
 *
 * // Large size
 * <ProviderIcon provider="ONEDRIVE" size="lg" showBackground />
 * ```
 */
export function ProviderIcon({
  provider,
  size = 'md',
  showBackground = false,
  className,
}: ProviderIconProps) {
  const config = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.DEFAULT;
  const Icon = config.icon;
  const sizeConfig = SIZE_CONFIG[size];

  if (showBackground) {
    return (
      <div
        className={cn(
          'rounded-lg flex items-center justify-center',
          sizeConfig.container,
          config.bgColor,
          className
        )}
      >
        <Icon className={cn(sizeConfig.icon, config.color)} />
      </div>
    );
  }

  return <Icon className={cn(sizeConfig.icon, config.color, className)} />;
}

/**
 * Get the display name for a provider
 */
export function getProviderLabel(provider: ProviderType): string {
  return PROVIDER_CONFIG[provider]?.label || provider;
}

export default ProviderIcon;
