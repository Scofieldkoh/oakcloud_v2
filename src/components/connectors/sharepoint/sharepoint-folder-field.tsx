'use client';

import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SharePointFolderPickerValue } from './sharepoint-folder-picker';

/** `sm` matches the height of small inputs and selects, for use in a row of form fields. */
export function SharePointFolderField({ label, value, onSelect, onClear, disabled = false, size = 'md' }: { label: string; value?: SharePointFolderPickerValue | null; onSelect: () => void; onClear?: () => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  const compact = size === 'sm';
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-text-secondary">{label}</div>
      {value ? (
        <div className={cn(
          'flex items-center rounded-lg border border-border-primary bg-background-primary',
          compact ? 'min-h-10 sm:h-8 sm:min-h-8 gap-1 pl-3 pr-1' : 'gap-3 p-3',
        )}>
          <div className="min-w-0 flex-1">
            <a
              href={value.webUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in SharePoint"
              aria-label={`Open ${value.name} in SharePoint`}
              className={cn(
                'inline-flex max-w-full items-center gap-1 truncate text-sm font-medium text-oak-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30',
                !compact && 'min-h-10',
              )}
            >
              <span className="truncate">{value.name}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          </div>
          {onClear && <Button variant="ghost" size={compact ? 'xs' : 'sm'} iconOnly className={cn(compact && 'h-7 w-7')} aria-label={`Clear ${label}`} onClick={onClear} disabled={disabled} leftIcon={<X className="h-4 w-4" />} />}
          <Button variant={compact ? 'ghost' : 'secondary'} size={compact ? 'xs' : 'sm'} onClick={onSelect} disabled={disabled}>Change</Button>
        </div>
      ) : (
        <Button variant="secondary" size={compact ? 'sm' : 'md'} className={cn(compact && 'w-full')} onClick={onSelect} disabled={disabled}>Select folder</Button>
      )}
    </div>
  );
}
