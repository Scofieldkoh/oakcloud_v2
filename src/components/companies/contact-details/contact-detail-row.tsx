'use client';

import { Pencil, Trash2, X, Check, Loader2, Star } from 'lucide-react';
import { AUTOMATION_PURPOSES } from '@/lib/constants/automation-purposes';
import { detailTypeConfig, type ContactDetail, type EditFormState } from './types';
import { CopyButton } from './copy-button';

interface ContactDetailRowProps {
  detail: ContactDetail;
  canEdit: boolean;
  isEditing: boolean;
  editForm: EditFormState;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onUpdateForm: (field: string, value: string | string[] | boolean) => void;
  isSaving: boolean;
  isDeleting: boolean;
}

const POC_BADGE =
  'inline-flex min-h-5 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium leading-none text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';

export function ContactDetailRow({
  detail,
  canEdit,
  isEditing,
  editForm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onUpdateForm,
  isSaving,
  isDeleting,
}: ContactDetailRowProps) {
  const config = detailTypeConfig[detail.detailType];
  const Icon = config.icon;

  if (isEditing && canEdit) {
    return (
      <div className="-mx-3 space-y-2 bg-surface-secondary px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={editForm.detailType}
            onChange={(e) => {
              const newType = e.target.value;
              onUpdateForm('detailType', newType);
              if (newType !== 'EMAIL') {
                onUpdateForm('purposes', []);
              }
            }}
            className="input input-xs w-28"
            aria-label="Detail type"
          >
            {Object.entries(detailTypeConfig).map(([type, cfg]) => (
              <option key={type} value={type}>{cfg.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={editForm.value}
            onChange={(e) => onUpdateForm('value', e.target.value)}
            className="input input-xs min-w-[160px] flex-1"
            placeholder="Value"
            aria-label="Value"
          />
          <input
            type="text"
            value={editForm.label}
            onChange={(e) => onUpdateForm('label', e.target.value)}
            className="input input-xs w-36"
            placeholder="Label (optional)"
            aria-label="Label"
          />
          <button
            type="button"
            onClick={() => onUpdateForm('isPoc', !editForm.isPoc)}
            className={`rounded p-1 transition-colors ${
              editForm.isPoc
                ? 'text-amber-500 hover:text-amber-600'
                : 'text-text-muted hover:text-amber-500'
            }`}
            title={editForm.isPoc ? 'Remove POC' : 'Set as POC'}
          >
            <Star className={`h-4 w-4 ${editForm.isPoc ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* Purposes row - only for EMAIL type */}
        {editForm.detailType === 'EMAIL' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-text-muted flex-shrink-0">Automation:</span>
            <div className="flex flex-wrap gap-1.5">
              {AUTOMATION_PURPOSES.map((purpose) => (
                <button
                  key={purpose.value}
                  type="button"
                  onClick={() => {
                    const newPurposes = editForm.purposes.includes(purpose.value)
                      ? editForm.purposes.filter(p => p !== purpose.value)
                      : [...editForm.purposes, purpose.value];
                    onUpdateForm('purposes', newPurposes);
                  }}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    editForm.purposes.includes(purpose.value)
                      ? 'bg-oak-light text-white'
                      : 'bg-surface-tertiary text-text-secondary hover:bg-border-secondary'
                  }`}
                >
                  {purpose.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancelEdit}
            disabled={isSaving}
            className="btn-ghost btn-xs text-text-muted hover:text-text-primary"
            title="Cancel"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
          <button
            onClick={onSaveEdit}
            disabled={isSaving || !editForm.value.trim()}
            className="btn-ghost btn-xs text-oak-light hover:text-oak-dark disabled:opacity-50"
            title="Save"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
          <Icon className="h-4 w-4 flex-shrink-0 text-text-tertiary" aria-hidden="true" />
          <span className="truncate">{detail.label || config.label}</span>
          {detail.isPoc && (
            <span className={POC_BADGE} title="Point of Contact">
              <Star className="h-3 w-3 fill-current" aria-hidden="true" />
              POC
            </span>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
          <span className="truncate">{detail.value}</span>
          <CopyButton value={detail.value} />
          {/* Only show purposes for EMAIL type - pill badge design */}
          {detail.detailType === 'EMAIL' && detail.purposes && detail.purposes.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {detail.purposes.map((purpose) => (
                <span key={purpose} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {purpose}
                </span>
              ))}
            </span>
          )}
        </p>
      </div>

      {canEdit && (
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            onClick={onStartEdit}
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-tertiary hover:text-oak-light"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-tertiary hover:text-status-error"
            title="Delete"
            disabled={isDeleting}
          >
            {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}
