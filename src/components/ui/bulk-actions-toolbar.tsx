'use client';

import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BulkActionVariant = 'default' | 'warning' | 'danger';

export interface BulkAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  variant?: BulkActionVariant;
  isLoading?: boolean;
  disabled?: boolean;
}

interface BulkActionsToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
  actions: BulkAction[];
  onAction: (actionId: string) => void;
  className?: string;
  /** Singular noun for the item type (e.g., "company", "contact") */
  itemLabel?: string;
}

export function BulkActionsToolbar({
  selectedCount,
  onClearSelection,
  actions,
  onAction,
  className,
}: BulkActionsToolbarProps) {
  if (selectedCount === 0) {
    return null;
  }

  const isAnyLoading = actions.some((a) => a.isLoading);

  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-40',
        'bg-background-primary border border-border-primary rounded-lg shadow-xl',
        'flex items-center gap-2 px-4 py-3',
        'animate-in slide-in-from-bottom-4',
        className
      )}
    >
      {/* Selection count */}
      <div className="flex items-center gap-2 pr-3 border-r border-border-primary">
        <span className="text-sm text-text-secondary">
          <span className="font-medium text-text-primary">{selectedCount}</span> selected
        </span>
        <button
          onClick={onClearSelection}
          className="btn-ghost btn-xs p-1"
          title="Clear selection"
          disabled={isAnyLoading}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        {actions.map((action) => {
          const Icon = action.icon;
          const isDisabled = action.disabled || isAnyLoading;

          return (
            <button
              key={action.id}
              onClick={() => onAction(action.id)}
              disabled={isDisabled}
              className={cn(
                'btn-sm flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors',
                action.variant === 'danger'
                  ? 'hover:bg-status-error/10 hover:text-status-error text-text-secondary'
                  : action.variant === 'warning'
                  ? 'hover:bg-status-warning/10 hover:text-status-warning text-text-secondary'
                  : 'hover:bg-oak-light/10 hover:text-oak-primary text-text-secondary',
                isDisabled && 'opacity-50 cursor-not-allowed'
              )}
              title={action.description || action.label}
            >
              {action.isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icon className="w-4 h-4" />
              )}
              <span className="text-sm">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
