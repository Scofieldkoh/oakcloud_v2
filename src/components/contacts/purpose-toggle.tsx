'use client';

import { cn } from '@/lib/utils';
import { AUTOMATION_PURPOSES } from '@/lib/constants/automation-purposes';

interface PurposeToggleProps {
  /** Currently selected purposes */
  selectedPurposes: string[];
  /** Callback when purposes change */
  onChange: (purposes: string[]) => void;
  /** Whether the toggle is disabled */
  disabled?: boolean;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional class names for the container */
  className?: string;
  /** Show label above the toggle */
  showLabel?: boolean;
  /** Custom label text */
  label?: string;
  /** Show description below the toggle */
  showDescription?: boolean;
}

const sizeConfig = {
  sm: {
    button: 'text-xs px-2 py-1',
    gap: 'gap-1.5',
  },
  md: {
    button: 'text-xs px-2.5 py-1.5',
    gap: 'gap-2',
  },
};

/**
 * Reusable purpose toggle component for email automation purposes.
 * Used across contact detail forms to select which automations should use an email.
 */
export function PurposeToggle({
  selectedPurposes,
  onChange,
  disabled = false,
  size = 'md',
  className,
  showLabel = false,
  label = 'Purposes (for automation)',
  showDescription = false,
}: PurposeToggleProps) {
  const config = sizeConfig[size];

  const handleToggle = (purposeValue: string) => {
    if (disabled) return;

    const newPurposes = selectedPurposes.includes(purposeValue)
      ? selectedPurposes.filter((p) => p !== purposeValue)
      : [...selectedPurposes, purposeValue];

    onChange(newPurposes);
  };

  return (
    <div className={className}>
      {showLabel && <label className="label">{label}</label>}
      <div className={cn('flex flex-wrap', config.gap)}>
        {AUTOMATION_PURPOSES.map((purpose) => {
          const isSelected = selectedPurposes.includes(purpose.value);
          return (
            <button
              key={purpose.value}
              type="button"
              onClick={() => handleToggle(purpose.value)}
              title={purpose.description}
              disabled={disabled}
              className={cn(
                config.button,
                'rounded-md transition-colors',
                isSelected
                  ? 'bg-oak-light text-white'
                  : 'bg-surface-tertiary text-text-secondary hover:bg-surface-secondary border border-border-primary',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              {purpose.label}
            </button>
          );
        })}
      </div>
      {showDescription && (
        <p className="text-xs text-text-muted mt-2">
          Select which automations should use this contact detail
        </p>
      )}
    </div>
  );
}

/**
 * Display-only purpose badges (for read-only views)
 */
export function PurposeBadges({
  purposes,
  maxVisible = 2,
  size = 'sm',
  className,
}: {
  purposes: string[];
  maxVisible?: number;
  size?: 'sm' | 'md';
  className?: string;
}) {
  if (!purposes || purposes.length === 0) return null;

  const visiblePurposes = purposes.slice(0, maxVisible);
  const hiddenCount = purposes.length - maxVisible;

  const badgeSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {visiblePurposes.map((purpose) => (
        <span
          key={purpose}
          className={cn(
            badgeSize,
            'font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full'
          )}
        >
          {purpose}
        </span>
      ))}
      {hiddenCount > 0 && (
        <span className={cn(badgeSize, 'text-text-muted')}>+{hiddenCount}</span>
      )}
    </div>
  );
}
