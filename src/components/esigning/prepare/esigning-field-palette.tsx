'use client';

import { PenLine, Type, Calendar, User, Building2, Briefcase, AlignLeft, CheckSquare } from 'lucide-react';
import type { EsigningFieldType } from '@/generated/prisma';
import type { EsigningEnvelopeRecipientDto } from '@/types/esigning';
import { ESIGNING_FIELD_TYPE_LABELS } from '@/components/esigning/esigning-shared';
import { cn } from '@/lib/utils';

interface EsigningFieldPaletteProps {
  recipients: EsigningEnvelopeRecipientDto[];
  selectedRecipientId: string;
  onRecipientChange: (recipientId: string) => void;
  activePlacementType: EsigningFieldType | null;
  onPlacementTypeSelect: (type: EsigningFieldType | null) => void;
  recipientFieldSummary: Map<string, { required: number; optional: number; hasSignature: boolean }>;
}

interface FieldTypeButtonProps {
  type: EsigningFieldType;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}

function FieldTypeButton({ type, icon, isActive, onClick }: FieldTypeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
        isActive
          ? 'bg-oak-primary text-white'
          : 'bg-background-primary text-text-primary hover:bg-background-tertiary border border-border-primary'
      )}
    >
      <span className="h-4 w-4 flex-shrink-0">{icon}</span>
      <span>{ESIGNING_FIELD_TYPE_LABELS[type]}</span>
    </button>
  );
}

const SIGNATURE_FIELDS: Array<{ type: EsigningFieldType; icon: React.ReactNode }> = [
  { type: 'SIGNATURE', icon: <PenLine className="h-4 w-4" /> },
  { type: 'INITIALS', icon: <Type className="h-4 w-4" /> },
];

const AUTOFILL_FIELDS: Array<{ type: EsigningFieldType; icon: React.ReactNode }> = [
  { type: 'DATE_SIGNED', icon: <Calendar className="h-4 w-4" /> },
  { type: 'NAME', icon: <User className="h-4 w-4" /> },
  { type: 'COMPANY', icon: <Building2 className="h-4 w-4" /> },
  { type: 'TITLE', icon: <Briefcase className="h-4 w-4" /> },
];

const STANDARD_FIELDS: Array<{ type: EsigningFieldType; icon: React.ReactNode }> = [
  { type: 'TEXT', icon: <AlignLeft className="h-4 w-4" /> },
  { type: 'CHECKBOX', icon: <CheckSquare className="h-4 w-4" /> },
];

export function EsigningFieldPalette({
  recipients,
  selectedRecipientId,
  onRecipientChange,
  activePlacementType,
  onPlacementTypeSelect,
  recipientFieldSummary,
}: EsigningFieldPaletteProps) {
  const signerRecipients = recipients.filter((r) => r.type === 'SIGNER');
  const summary = selectedRecipientId ? recipientFieldSummary.get(selectedRecipientId) : null;

  function handleTypeClick(type: EsigningFieldType) {
    onPlacementTypeSelect(activePlacementType === type ? null : type);
  }

  function renderGroup(
    title: string,
    fields: Array<{ type: EsigningFieldType; icon: React.ReactNode }>
  ) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</p>
        {fields.map(({ type, icon }) => (
          <FieldTypeButton
            key={type}
            type={type}
            icon={icon}
            isActive={activePlacementType === type}
            onClick={() => handleTypeClick(type)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex w-full h-full flex-col bg-background-secondary border-r border-border-primary overflow-hidden">
      {/* Active placement banner — pinned at top so it's always visible */}
      {activePlacementType && (
        <div className="flex-shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-amber-800">
            Placing:{' '}
            <span className="font-bold">{ESIGNING_FIELD_TYPE_LABELS[activePlacementType]}</span>
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            Click on the document to drop the field. Press <kbd className="rounded border border-amber-300 bg-amber-100 px-1 text-[10px]">Esc</kbd> to cancel.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Recipient pills */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Placing fields for</p>
          {signerRecipients.length === 0 ? (
            <p className="text-xs text-text-muted italic">No signers added yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {signerRecipients.map((r) => {
                const isSelected = r.id === selectedRecipientId;
                const rSummary = recipientFieldSummary.get(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onRecipientChange(r.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                      isSelected
                        ? 'border-oak-primary bg-oak-primary/10'
                        : 'border-border-primary bg-background-primary hover:bg-background-tertiary'
                    )}
                  >
                    <span
                      className="h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: r.colorTag ?? '#ccc' }}
                    />
                    <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', isSelected ? 'text-oak-primary' : 'text-text-primary')}>
                      {r.name}
                    </span>
                    {rSummary && !rSummary.hasSignature && (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-amber-600">⚠</span>
                    )}
                    {rSummary && rSummary.hasSignature && (
                      <span className="flex-shrink-0 text-[10px] text-text-muted">{rSummary.required}r</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Summary for selected recipient */}
          {summary && (
            <div className={cn('rounded-lg px-2 py-1.5 text-xs', !summary.hasSignature ? 'bg-amber-50 text-amber-700' : 'bg-background-primary text-text-secondary')}>
              {summary.required} required · {summary.optional} optional
              {!summary.hasSignature && <span className="ml-1 font-semibold">— no signature field yet</span>}
            </div>
          )}
        </div>

        {renderGroup('Signature Fields', SIGNATURE_FIELDS)}
        {renderGroup('Auto-fill Fields', AUTOFILL_FIELDS)}
        {renderGroup('Standard Fields', STANDARD_FIELDS)}
      </div>
    </div>
  );
}
