'use client';

import { Pencil, X } from 'lucide-react';
import type { EsigningEnvelopeRecipientDto } from '@/types/esigning';
import { ESIGNING_ACCESS_MODE_LABELS, ESIGNING_RECIPIENT_TYPE_LABELS } from '@/components/esigning/esigning-shared';
import { cn } from '@/lib/utils';

export function RecipientRow({
  recipient,
  index,
  accentColor,
  canEdit,
  showIndex,
  onEdit,
  onRemove,
}: {
  recipient: EsigningEnvelopeRecipientDto;
  index: number;
  accentColor: string;
  canEdit: boolean;
  showIndex: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-border-primary bg-background-primary px-3 py-2.5 overflow-hidden"
      style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}
    >
      {showIndex && (
        <span
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: accentColor }}
        >
          {index + 1}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">{recipient.name}</div>
        <div className="text-xs text-text-muted truncate">{recipient.email || 'No email — manual link only'}</div>
      </div>
      <span className="flex-shrink-0 rounded-full border border-border-primary px-2 py-0.5 text-[10px] text-text-muted">
        {ESIGNING_RECIPIENT_TYPE_LABELS[recipient.type]}
      </span>
      <span
        data-testid={`recipient-access-method-badge-${recipient.id}`}
        className={cn(
          'flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
          recipient.accessMode === 'MANUAL_LINK'
            ? 'border-border-primary bg-background-secondary text-text-muted'
            : 'border-oak-primary/20 bg-oak-primary/10 text-oak-primary'
        )}
      >
        {ESIGNING_ACCESS_MODE_LABELS[recipient.accessMode]}
      </span>
      {canEdit && (
        <>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${recipient.name}`}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-background-tertiary hover:text-text-primary sm:h-8 sm:w-8"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${recipient.name}`}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-background-tertiary hover:text-rose-500 sm:h-8 sm:w-8"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
