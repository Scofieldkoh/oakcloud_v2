'use client';

import { ReactNode, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { isTableInteractiveTarget, TABLE_INTERACTIVE_TARGET_SELECTOR } from '@/components/ui/data-table';
import { Square, CheckSquare, MinusSquare } from 'lucide-react';

/**
 * A wrapper component that renders a table on desktop and cards on mobile.
 * Provides a consistent responsive pattern across the app.
 */

interface SelectableProps {
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleOne?: (id: string) => void;
  onToggleAll?: () => void;
  isAllSelected?: boolean;
  isIndeterminate?: boolean;
}

interface ResponsiveTableProps<T> extends SelectableProps {
  data: T[];
  /** Unique key for each item */
  getKey: (item: T) => string;
  /** Desktop table headers */
  headers: string[];
  /** Render a table row for desktop */
  renderRow: (item: T, isSelected: boolean) => ReactNode;
  /** Render a card for mobile */
  renderCard: (item: T, isSelected: boolean) => ReactNode;
  /** Optional class for the container */
  className?: string;
}

export function ResponsiveTable<T>({
  data,
  getKey,
  headers,
  renderRow,
  renderCard,
  selectable = false,
  selectedIds = new Set(),
  onToggleOne,
  onToggleAll,
  isAllSelected = false,
  isIndeterminate = false,
  className,
}: ResponsiveTableProps<T>) {
  return (
    <>
      {/* Mobile Card View */}
      <div className={cn('md:hidden space-y-3', className)}>
        {selectable && (
          <div className="flex items-center gap-2 px-1">
            <button
              onClick={onToggleAll}
              className="p-2 hover:bg-background-secondary rounded transition-colors flex items-center gap-2"
              aria-label={isAllSelected ? 'Deselect all items' : 'Select all items'}
              aria-pressed={isAllSelected}
            >
              {isAllSelected ? (
                <CheckSquare className="w-5 h-5 text-oak-primary" aria-hidden="true" />
              ) : isIndeterminate ? (
                <MinusSquare className="w-5 h-5 text-oak-light" aria-hidden="true" />
              ) : (
                <Square className="w-5 h-5 text-text-muted" aria-hidden="true" />
              )}
              <span className="text-sm text-text-secondary">
                {isAllSelected ? 'Deselect all' : 'Select all'}
              </span>
            </button>
          </div>
        )}
        {data.map((item) => {
          const key = getKey(item);
          const isSelected = selectedIds.has(key);
          return (
            <div key={key}>
              {renderCard(item, isSelected)}
            </div>
          );
        })}
      </div>

      {/* Desktop Table View */}
      <div className={cn('hidden md:block table-container', className)}>
        <table className="table">
          <thead>
            <tr>
              {selectable && (
                <th className="w-10">
                  <button
                    onClick={onToggleAll}
                    className="p-0.5 hover:bg-background-secondary rounded transition-colors"
                    aria-label={isAllSelected ? 'Deselect all items' : 'Select all items'}
                    aria-pressed={isAllSelected}
                  >
                    {isAllSelected ? (
                      <CheckSquare className="w-4 h-4 text-oak-primary" aria-hidden="true" />
                    ) : isIndeterminate ? (
                      <MinusSquare className="w-4 h-4 text-oak-light" aria-hidden="true" />
                    ) : (
                      <Square className="w-4 h-4 text-text-muted" aria-hidden="true" />
                    )}
                  </button>
                </th>
              )}
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => {
              const key = getKey(item);
              const isSelected = selectedIds.has(key);
              return (
                <tr
                  key={key}
                  className={cn(
                    'transition-colors',
                    isSelected
                      ? 'bg-oak-row-selected hover:bg-oak-row-selected-hover'
                      : 'hover:bg-background-tertiary/50'
                  )}
                >
                  {selectable && (
                    <td>
                      <button
                        onClick={() => onToggleOne?.(key)}
                        className="p-0.5 hover:bg-background-secondary rounded transition-colors"
                        aria-label={isSelected ? 'Deselect item' : 'Select item'}
                        aria-pressed={isSelected}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-oak-primary" aria-hidden="true" />
                        ) : (
                          <Square className="w-4 h-4 text-text-muted" aria-hidden="true" />
                        )}
                      </button>
                    </td>
                  )}
                  {renderRow(item, isSelected)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * A reusable mobile card component for list items
 */
interface MobileCardProps {
  /** Whether the card is selected */
  isSelected?: boolean;
  /** Whether selection mode is enabled */
  selectable?: boolean;
  /** Handler for toggling selection */
  onToggle?: () => void;
  /** Primary content (title) */
  title: ReactNode;
  /** Secondary content (subtitle) */
  subtitle?: ReactNode;
  /** Badge to show (e.g., status) */
  badge?: ReactNode;
  /** Action menu dropdown */
  actions?: ReactNode;
  /** Additional details to show below the header */
  details?: ReactNode;
  /** Optional click handler for non-interactive card areas */
  onCardClick?: () => void;
  /** Optional className */
  className?: string;
  /** Accessible label for selection button */
  selectionLabel?: string;
}

const CARD_INTERACTIVE_TARGET_SELECTOR = `${TABLE_INTERACTIVE_TARGET_SELECTOR},[data-prevent-card-click="true"]`;

export function MobileCard({
  isSelected = false,
  selectable = false,
  onToggle,
  title,
  subtitle,
  badge,
  actions,
  details,
  onCardClick,
  className,
  selectionLabel,
}: MobileCardProps) {
  const hasSubtitle = !!subtitle;

  const handleCardClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onCardClick) return;
    if (isTableInteractiveTarget(e.target, e.currentTarget, CARD_INTERACTIVE_TARGET_SELECTOR)) {
      return;
    }
    onCardClick();
  };

  return (
    <div
      onClick={onCardClick ? handleCardClick : undefined}
      className={cn(
        'card transition-colors',
        onCardClick && 'cursor-pointer',
        isSelected && 'ring-2 ring-oak-primary/50 bg-oak-row-selected',
        className
      )}
    >
      <div className={cn('flex justify-between gap-3', hasSubtitle ? 'items-start' : 'items-center')}>
        <div className={cn('flex gap-3 flex-1 min-w-0', hasSubtitle ? 'items-start' : 'items-center')}>
          {selectable && (
            <button
              onClick={onToggle}
              className={cn(
                'p-1 hover:bg-background-secondary rounded transition-colors flex-shrink-0',
                hasSubtitle && 'mt-0.5'
              )}
              aria-label={selectionLabel || (isSelected ? 'Deselect item' : 'Select item')}
              aria-pressed={isSelected}
            >
              {isSelected ? (
                <CheckSquare className="w-5 h-5 text-oak-primary" aria-hidden="true" />
              ) : (
                <Square className="w-5 h-5 text-text-muted" aria-hidden="true" />
              )}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-text-primary truncate">{title}</div>
            {subtitle && <div className="text-xs text-text-secondary mt-0.5">{subtitle}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {badge}
          {actions}
        </div>
      </div>
      {details && (
        <div className="mt-3 pt-3 border-t border-border-primary">
          {details}
        </div>
      )}
    </div>
  );
}

/**
 * Grid for card details
 */
interface CardDetailsGridProps {
  children: ReactNode;
  className?: string;
}

export function CardDetailsGrid({ children, className }: CardDetailsGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-2 text-sm', className)}>
      {children}
    </div>
  );
}

/**
 * A single detail item for card details
 */
interface CardDetailItemProps {
  label: string;
  value: ReactNode;
  /** Optional icon to display before the value */
  icon?: ReactNode;
  /** Span full width (2 columns) */
  fullWidth?: boolean;
}

export function CardDetailItem({ label, value, icon, fullWidth = false }: CardDetailItemProps) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <span className="text-text-muted text-xs">{label}</span>
      <div className="text-text-secondary truncate flex items-center gap-1">
        {icon}
        {value}
      </div>
    </div>
  );
}
