'use client';

import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { EsigningSigningOrder } from '@/generated/prisma';
import type { EsigningEnvelopeRecipientDto } from '@/types/esigning';
import { ESIGNING_ACCESS_MODE_LABELS, ESIGNING_RECIPIENT_TYPE_LABELS } from '@/components/esigning/esigning-shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  RECIPIENT_ACCENT_COLORS,
  mergeGroup,
  moveGroup,
  moveSignerToAdjacentGroup,
  splitSignerIntoOwnGroup,
} from './step-upload-helpers';

export interface MixedSignerGroup {
  groupIndex: number;
  recipientIds: string[];
  recipients: EsigningEnvelopeRecipientDto[];
}

interface StepUploadSignerListProps {
  canEdit: boolean;
  /** The routing saved on the envelope, before any unsaved change on this step. */
  savedSigningOrder: EsigningSigningOrder;
  signingOrder: EsigningSigningOrder;
  isReorderingRecipients: boolean;
  mixedSignerGroups: MixedSignerGroup[];
  orderedSignerRecipients: EsigningEnvelopeRecipientDto[];
  onMixedGroupChange: (updater: (groups: string[][]) => string[][], fallbackMessage: string) => Promise<void>;
  onMoveSequentialSigner: (recipientId: string, direction: -1 | 1) => Promise<void>;
  onEditRecipient: (recipientId: string) => void;
  onRemoveRecipient: (recipientId: string) => void;
}

/** The Signers list: signing waves for mixed routing, otherwise one ordered list. */
export function StepUploadSignerList({
  canEdit,
  savedSigningOrder,
  signingOrder,
  isReorderingRecipients,
  mixedSignerGroups,
  orderedSignerRecipients,
  onMixedGroupChange,
  onMoveSequentialSigner,
  onEditRecipient,
  onRemoveRecipient,
}: StepUploadSignerListProps) {
  const usesOrderedSigning = signingOrder !== 'PARALLEL';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Signers</h3>
          {usesOrderedSigning ? (
            <p className="text-xs text-text-muted">
              {signingOrder === 'MIXED'
                ? 'Mixed routing sends each group in sequence. Signers inside the same group sign in parallel, and you can move people between waves below.'
                : 'Use Earlier / Later to set the signing sequence.'}
              {signingOrder === 'MIXED'
                ? ' Group mode is fixed to parallel inside each wave.'
                : savedSigningOrder === 'PARALLEL'
                  ? ' Your order will be saved when you continue.'
                  : ''}
            </p>
          ) : (
            <p className="text-xs text-text-muted">Switch routing to Sequential or Mixed to control signer order.</p>
          )}
        </div>
        {isReorderingRecipients && (
          <span className="text-xs text-text-muted">Saving order…</span>
        )}
      </div>

      {signingOrder === 'MIXED' ? (
        <div className="space-y-3">
          {mixedSignerGroups.map((group) => (
            <div
              key={`mixed-group-${group.groupIndex}`}
              className="rounded-2xl border border-border-primary bg-background-primary p-3 space-y-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-text-primary">Group {group.groupIndex + 1}</h4>
                    <span className="rounded-full border border-oak-primary/20 bg-oak-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-oak-primary">
                      Parallel within group
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    This wave is sent together. Use the actions below to merge, split, or move the wave.
                  </p>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Move earlier / later — grouped icon pair with shared affordance */}
                    <div className="inline-flex overflow-hidden rounded-lg border border-border-primary">
                      <button
                        type="button"
                        aria-label="Move group earlier"
                        onClick={() => {
                          void onMixedGroupChange(
                            (groups) => moveGroup(groups, group.groupIndex, -1),
                            'Failed to move group earlier'
                          );
                        }}
                        disabled={isReorderingRecipients || group.groupIndex === 0}
                        className="inline-flex h-8 min-w-[36px] items-center justify-center border-r border-border-primary bg-background-elevated px-3 text-sm text-text-primary transition-colors hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronUp className="h-4 w-4" />
                        <span className="ml-1 hidden sm:inline">Earlier</span>
                      </button>
                      <button
                        type="button"
                        aria-label="Move group later"
                        onClick={() => {
                          void onMixedGroupChange(
                            (groups) => moveGroup(groups, group.groupIndex, 1),
                            'Failed to move group later'
                          );
                        }}
                        disabled={isReorderingRecipients || group.groupIndex === mixedSignerGroups.length - 1}
                        className="inline-flex h-8 min-w-[36px] items-center justify-center bg-background-elevated px-3 text-sm text-text-primary transition-colors hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronDown className="h-4 w-4" />
                        <span className="ml-1 hidden sm:inline">Later</span>
                      </button>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      leftIcon={<Trash2 className="h-4 w-4" />}
                      onClick={() => {
                        void onMixedGroupChange(
                          (groups) => mergeGroup(groups, group.groupIndex),
                          'Failed to remove group'
                        );
                      }}
                      disabled={isReorderingRecipients || mixedSignerGroups.length <= 1}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {group.recipients.map((recipient, recipientIndex) => {
                  const accentColor = RECIPIENT_ACCENT_COLORS[(group.groupIndex + recipientIndex) % RECIPIENT_ACCENT_COLORS.length];

                  return (
                    <div
                      key={recipient.id}
                      className="rounded-xl border border-border-primary bg-background-secondary px-3 py-3"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ backgroundColor: accentColor }}
                        >
                          {group.groupIndex + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-text-primary">{recipient.name}</div>
                          <div className="truncate text-xs text-text-muted">{recipient.email || 'No email — manual link only'}</div>
                        </div>
                        <span className="flex-shrink-0 rounded-full border border-oak-primary/20 bg-oak-primary/10 px-2 py-0.5 text-[10px] text-oak-primary">
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
                          <div className="flex flex-shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onEditRecipient(recipient.id)}
                              aria-label={`Edit ${recipient.name}`}
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-background-tertiary hover:text-text-primary sm:h-8 sm:w-8"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveRecipient(recipient.id)}
                              aria-label={`Remove ${recipient.name}`}
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-background-tertiary hover:text-rose-500 sm:h-8 sm:w-8"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>

                      {canEdit && (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {/* Join previous / next — grouped icon pair */}
                          <div className="inline-flex overflow-hidden rounded-lg border border-border-primary">
                            <button
                              type="button"
                              aria-label="Join previous group"
                              onClick={() => {
                                void onMixedGroupChange(
                                  (groups) => moveSignerToAdjacentGroup(groups, group.groupIndex, recipient.id, -1),
                                  'Failed to move signer to the earlier group'
                                );
                              }}
                              disabled={isReorderingRecipients || group.groupIndex === 0}
                              className="inline-flex h-8 items-center justify-center gap-1 border-r border-border-primary bg-background-elevated px-3 text-sm text-text-primary transition-colors hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronUp className="h-4 w-4" />
                              <span>Previous group</span>
                            </button>
                            <button
                              type="button"
                              aria-label="Join next group"
                              onClick={() => {
                                void onMixedGroupChange(
                                  (groups) => moveSignerToAdjacentGroup(groups, group.groupIndex, recipient.id, 1),
                                  'Failed to move signer to the next group'
                                );
                              }}
                              disabled={isReorderingRecipients || group.groupIndex === mixedSignerGroups.length - 1}
                              className="inline-flex h-8 items-center justify-center gap-1 bg-background-elevated px-3 text-sm text-text-primary transition-colors hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronDown className="h-4 w-4" />
                              <span>Next group</span>
                            </button>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            leftIcon={<Plus className="h-4 w-4" />}
                            onClick={() => {
                              void onMixedGroupChange(
                                (groups) => splitSignerIntoOwnGroup(groups, group.groupIndex, recipient.id),
                                'Failed to create a new group'
                              );
                            }}
                            disabled={isReorderingRecipients || group.recipientIds.length <= 1}
                          >
                            New group
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {orderedSignerRecipients.map((recipient, idx) => {
            const accentColor = RECIPIENT_ACCENT_COLORS[idx % RECIPIENT_ACCENT_COLORS.length];
            return (
              <div
                key={recipient.id}
                className="flex items-center gap-3 rounded-xl border border-border-primary bg-background-primary px-3 py-2.5 overflow-hidden"
              >
                <span
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: accentColor }}
                >
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{recipient.name}</div>
                  <div className="text-xs text-text-muted truncate">{recipient.email || 'No email — manual link only'}</div>
                </div>
                <span className="flex-shrink-0 rounded-full border border-oak-primary/20 bg-oak-primary/10 px-2 py-0.5 text-[10px] text-oak-primary">
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
                {canEdit && signingOrder === 'SEQUENTIAL' && orderedSignerRecipients.length > 1 && (
                  <div className="inline-flex overflow-hidden rounded-lg border border-border-primary flex-shrink-0">
                    <button
                      type="button"
                      aria-label="Move signer up"
                      onClick={() => void onMoveSequentialSigner(recipient.id, -1)}
                      disabled={isReorderingRecipients || idx === 0}
                      className="inline-flex h-7 items-center gap-0.5 border-r border-border-primary bg-background-elevated px-2 text-xs text-text-primary transition-colors hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Up</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Move signer down"
                      onClick={() => void onMoveSequentialSigner(recipient.id, 1)}
                      disabled={isReorderingRecipients || idx === orderedSignerRecipients.length - 1}
                      className="inline-flex h-7 items-center gap-0.5 bg-background-elevated px-2 text-xs text-text-primary transition-colors hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Down</span>
                    </button>
                  </div>
                )}
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => onEditRecipient(recipient.id)}
                      aria-label={`Edit ${recipient.name}`}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-background-tertiary hover:text-text-primary"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveRecipient(recipient.id)}
                      aria-label={`Remove ${recipient.name}`}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-background-tertiary hover:text-rose-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
