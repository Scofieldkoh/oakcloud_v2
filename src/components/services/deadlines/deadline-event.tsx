'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Check, CircleAlert, FileText, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCompanyDisplayLabel } from '@/lib/company-display-label';
import type { DeadlineOccurrenceDto, DeadlineTimingBucket } from '@/services/deadline';
import type { UpdateDeadlineOccurrenceInput } from '@/lib/validations/deadline';
import { COMPANY_OBLIGATION_STATUS_LABELS, companyObligationStatusOf } from '@/services/compliance-monitoring/obligation-status-labels';
import { isAcraObligation } from '@/services/compliance-monitoring/catalog';

export interface DeadlineEventProps {
  occurrence: DeadlineOccurrenceDto;
  compact?: boolean;
  canEdit?: boolean;
  isPending?: boolean;
  mutationError?: unknown;
  onUpdate?: (occurrence: DeadlineOccurrenceDto, data: UpdateDeadlineOccurrenceInput) => void;
  onResetOverride?: (occurrence: DeadlineOccurrenceDto, reason: string) => void;
}

const typeLabels: Record<DeadlineOccurrenceDto['deadlineType'], string> = {
  STATUTORY: 'Statutory',
  CLIENT: 'Client',
  INTERNAL: 'Internal',
};

export const DEADLINE_TIMING_BUCKET_LABELS: Record<DeadlineTimingBucket, string> = {
  OVERDUE: 'Overdue',
  DUE_TODAY: 'Due today',
  WITHIN_1_MONTH: 'Within 1 month',
  WITHIN_3_MONTHS: 'Within 3 months',
  WITHIN_6_MONTHS: 'Within 6 months',
  WITHIN_12_MONTHS: 'Within 12 months',
  OVER_12_MONTHS: 'Over 12 months',
  TAKEOVER_REVIEW: 'Takeover review',
};

/** Timing shown for a deadline: how far away an open one is, else its status. */
export function deadlineTimingLabel(occurrence: Pick<DeadlineOccurrenceDto, 'status' | 'timingBucket'>): string {
  if (occurrence.status !== 'OPEN') return occurrence.status.charAt(0) + occurrence.status.slice(1).toLowerCase();
  return occurrence.timingBucket ? DEADLINE_TIMING_BUCKET_LABELS[occurrence.timingBucket] : 'Open';
}

export function deadlineTimingClass(occurrence: Pick<DeadlineOccurrenceDto, 'status' | 'timingBucket'>): string {
  if (occurrence.status !== 'OPEN') return 'badge-neutral';
  switch (occurrence.timingBucket) {
    case 'OVERDUE': return 'badge-error';
    case 'DUE_TODAY':
    case 'WITHIN_1_MONTH':
    case 'TAKEOVER_REVIEW': return 'badge-warning';
    case 'OVER_12_MONTHS': return 'badge-neutral';
    default: return 'badge-info';
  }
}

function dateLabel(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  const monthName = month
    ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]
    : undefined;
  return year && day && monthName ? `${day} ${monthName} ${year}` : value;
}

/**
 * Status shown for a deadline. Company obligations use the filing status set
 * in the service's Deadline tab (Filed, Pending filing, To be confirmed,
 * Managed externally, Not required); both read the same stored row.
 */
export function deadlineStatusLabel(occurrence: Pick<DeadlineOccurrenceDto, 'status' | 'obligation'>): string {
  if (occurrence.obligation && occurrence.status !== 'CANCELLED') {
    return COMPANY_OBLIGATION_STATUS_LABELS[companyObligationStatusOf({
      status: occurrence.status,
      filingResponsibility: occurrence.obligation.filingResponsibility,
    })];
  }
  return occurrence.status.charAt(0) + occurrence.status.slice(1).toLowerCase();
}

/**
 * Service shown for a deadline. Company obligations show the service that
 * files or monitors them; none when no service covers them.
 */
export function serviceLabel(occurrence: DeadlineOccurrenceDto): string {
  if (!occurrence.service) return '—';
  return occurrence.service.name || occurrence.service.variantName || '—';
}

/** Words in milestone keys that are acronyms and print in capitals. */
const MILESTONE_ACRONYMS = new Set(['acra', 'agm', 'cit', 'cpf', 'eci', 'fye', 'gst', 'iras', 'sow', 'uen', 'xbrl', 'ya']);

export function milestoneLabel(occurrence: Pick<DeadlineOccurrenceDto, 'milestoneKey'>): string {
  return occurrence.milestoneKey
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => (MILESTONE_ACRONYMS.has(word.toLowerCase())
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

function sourceLabel(occurrence: DeadlineOccurrenceDto): string {
  return occurrence.origin === 'MANUAL_TRIGGER' ? 'Manual trigger' : `Rule version ${occurrence.ruleVersionId}`;
}

function dialogPosition(trigger: HTMLButtonElement): { left: number; top: number } {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(352, Math.max(280, window.innerWidth - 32));
  const left = Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - width - 16));
  const estimatedHeight = 480;
  const top = rect.bottom + estimatedHeight <= window.innerHeight - 16
    ? rect.bottom + 8
    : Math.max(16, rect.top - estimatedHeight - 8);
  return { left, top };
}

type ActionMode = 'waive' | 'reopen' | 'override' | 'reset' | 'notes' | null;

export interface DeadlineEventPanelProps {
  occurrence: DeadlineOccurrenceDto;
  canEdit?: boolean;
  isPending?: boolean;
  mutationError?: unknown;
  onUpdate?: (occurrence: DeadlineOccurrenceDto, data: UpdateDeadlineOccurrenceInput) => void;
  onResetOverride?: (occurrence: DeadlineOccurrenceDto, reason: string) => void;
  onClose?: () => void;
}

export function DeadlineEventPanel({
  occurrence,
  canEdit = false,
  isPending = false,
  mutationError,
  onUpdate,
  onResetOverride,
  onClose,
}: DeadlineEventPanelProps) {
  const [action, setAction] = useState<ActionMode>(null);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(occurrence.operativeDueDate);
  const [notes, setNotes] = useState(occurrence.notes ?? '');
  const companyLabel = occurrence.company.displayLabel || getCompanyDisplayLabel(occurrence.company);
  const milestone = milestoneLabel(occurrence);
  const familyName = occurrence.family.name || occurrence.service?.familyName || 'Unassigned family';
  const familyColor = occurrence.family.displayColor ?? '#58736a';
  const state = deadlineTimingLabel(occurrence);

  const closeAction = () => {
    setAction(null);
    setReason('');
    setDate(occurrence.operativeDueDate);
    setNotes(occurrence.notes ?? '');
  };

  const submitAction = () => {
    if (!onUpdate || !canEdit || isPending) return;
    if ((action === 'waive' || action === 'reopen' || action === 'override') && !reason.trim()) return;
    if (action === 'waive') onUpdate(occurrence, { expectedUpdatedAt: occurrence.updatedAt, status: 'WAIVED', reason: reason.trim() });
    if (action === 'reopen') onUpdate(occurrence, { expectedUpdatedAt: occurrence.updatedAt, status: 'OPEN', reason: reason.trim() });
    if (action === 'override') onUpdate(occurrence, { expectedUpdatedAt: occurrence.updatedAt, operativeDueDate: date, reason: reason.trim() });
    if (action === 'notes') onUpdate(occurrence, { expectedUpdatedAt: occurrence.updatedAt, notes: notes.trim() || null });
    closeAction();
  };

  const submitReset = () => {
    if (!onResetOverride || !canEdit || isPending || !reason.trim()) return;
    onResetOverride(occurrence, reason.trim());
    closeAction();
  };

  const openAction = (next: ActionMode) => {
    setAction(next);
    setReason('');
    if (next === 'override') setDate(occurrence.operativeDueDate);
    if (next === 'notes') setNotes(occurrence.notes ?? '');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-text-primary">{occurrence.company.name}</p>
          <p className="text-xs text-text-secondary">{companyLabel} · {serviceLabel(occurrence)} · {milestone}</p>
        </div>
        {onClose ? <button type="button" aria-label="Close deadline details" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-text-muted hover:bg-background-tertiary"><X className="h-4 w-4" aria-hidden="true" /></button> : null}
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border-primary px-2"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />{dateLabel(occurrence.operativeDueDate)}</span>
        <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border-primary px-2"><CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />{state}</span>
        <span className="inline-flex min-h-8 items-center rounded-full border px-2" style={{ borderColor: familyColor }}>{familyName}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div><dt className="text-text-muted">Service</dt><dd className="text-text-primary">{serviceLabel(occurrence)}</dd></div>
        <div><dt className="text-text-muted">Milestone</dt><dd className="text-text-primary">{milestone}</dd></div>
        <div><dt className="text-text-muted">Type</dt><dd className="text-text-primary">{typeLabels[occurrence.deadlineType]}</dd></div>
        <div><dt className="text-text-muted">Lifecycle</dt><dd className="text-text-primary">{occurrence.status}</dd></div>
        {occurrence.obligation ? <div><dt className="text-text-muted">Filing status</dt><dd className="text-text-primary">{deadlineStatusLabel(occurrence)}</dd></div> : null}
        {occurrence.obligation && isAcraObligation(occurrence.obligation.code) && occurrence.obligation.financialPeriodEnd
          ? <div><dt className="text-text-muted">Financial year end</dt><dd className="text-text-primary">{dateLabel(occurrence.obligation.financialPeriodEnd)}</dd></div>
          : occurrence.obligation?.yearOfAssessment ? <div><dt className="text-text-muted">Year of Assessment</dt><dd className="text-text-primary">YA {occurrence.obligation.yearOfAssessment}</dd></div> : null}
        <div><dt className="text-text-muted">Calculated date</dt><dd className="text-text-primary">{dateLabel(occurrence.calculatedDueDate)}</dd></div>
        <div><dt className="text-text-muted">Operative date</dt><dd className="text-text-primary">{dateLabel(occurrence.operativeDueDate)}</dd></div>
        <div className="col-span-2"><dt className="text-text-muted">Source</dt><dd className="break-all text-text-primary">{sourceLabel(occurrence)}</dd></div>
        <div><dt className="text-text-muted">Cycle</dt><dd className="text-text-primary">{occurrence.cycle?.periodKey || '—'}</dd></div>
      </dl>
      {occurrence.notes ? <p className="border-t border-border-primary pt-3 text-xs text-text-secondary"><span className="font-medium text-text-primary">Notes:</span> {occurrence.notes}</p> : null}
      {mutationError ? <p role="alert" className="text-xs text-status-error">Unable to save this deadline. Please retry.</p> : null}
      {canEdit && onUpdate && occurrence.status !== 'CANCELLED' ? (
        <div className="flex flex-wrap gap-2 border-t border-border-primary pt-3">
          {occurrence.status === 'OPEN' ? <button type="button" disabled={isPending} onClick={() => onUpdate(occurrence, { expectedUpdatedAt: occurrence.updatedAt, status: 'COMPLETED' })} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border-primary px-3 text-xs font-medium text-text-primary hover:bg-background-tertiary disabled:opacity-50"><Check className="h-3.5 w-3.5" aria-hidden="true" />Mark complete</button> : null}
          {occurrence.status === 'OPEN' ? <button type="button" disabled={isPending} onClick={() => openAction('waive')} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border-primary px-3 text-xs font-medium text-text-primary hover:bg-background-tertiary disabled:opacity-50">Waive</button> : null}
          {occurrence.status === 'COMPLETED' || occurrence.status === 'WAIVED' ? <button type="button" disabled={isPending} onClick={() => openAction('reopen')} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border-primary px-3 text-xs font-medium text-text-primary hover:bg-background-tertiary disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Reopen</button> : null}
          <button type="button" disabled={isPending} onClick={() => openAction('override')} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border-primary px-3 text-xs font-medium text-text-primary hover:bg-background-tertiary disabled:opacity-50">Override date</button>
          {occurrence.dateOverridden && onResetOverride ? <button type="button" disabled={isPending} onClick={() => openAction('reset')} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border-primary px-3 text-xs font-medium text-text-primary hover:bg-background-tertiary disabled:opacity-50">Reset date</button> : null}
          <button type="button" disabled={isPending} onClick={() => openAction('notes')} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border-primary px-3 text-xs font-medium text-text-primary hover:bg-background-tertiary disabled:opacity-50"><FileText className="h-3.5 w-3.5" aria-hidden="true" />Edit notes</button>
        </div>
      ) : null}
      {action ? (
        <form className="space-y-2 border-t border-border-primary pt-3" onSubmit={(event) => { event.preventDefault(); if (action === 'reset') submitReset(); else submitAction(); }}>
          {action === 'override' ? <label className="block text-xs text-text-secondary">New operative date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary" /></label> : null}
          {action === 'notes' ? <label className="block text-xs text-text-secondary">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary" /></label> : null}
          {action !== 'notes' ? <label className="block text-xs text-text-secondary">Reason<input required value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary" /></label> : null}
          <div className="flex justify-end gap-2"><button type="button" onClick={closeAction} className="min-h-11 rounded-lg border border-border-primary px-3 text-xs text-text-secondary">Cancel</button><button type="submit" disabled={isPending || ((action !== 'notes') && !reason.trim())} className="min-h-11 rounded-lg bg-oak-primary px-3 text-xs font-medium text-white disabled:opacity-50">{isPending ? 'Saving…' : 'Save'}</button></div>
        </form>
      ) : null}
    </div>
  );
}

export function DeadlineEvent({
  occurrence,
  compact = false,
  canEdit = false,
  isPending = false,
  mutationError,
  onUpdate,
  onResetOverride,
}: DeadlineEventProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const companyLabel = occurrence.company.displayLabel || getCompanyDisplayLabel(occurrence.company);
  const milestone = milestoneLabel(occurrence);
  const familyName = occurrence.family.name || occurrence.service?.familyName || 'Unassigned family';
  const familyColor = occurrence.family.displayColor ?? '#58736a';
  const state = deadlineTimingLabel(occurrence);
  const label = `${companyLabel} ${milestone}`;

  useEffect(() => {
    if (!open) return;
    if (!triggerRef.current) return;
    setPosition(dialogPosition(triggerRef.current));
    const focusTarget = dialogRef.current?.querySelector<HTMLElement>('button, input, textarea');
    focusTarget?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleOutside = (event: MouseEvent) => {
      if (!dialogRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [open]);

  return (
    <div className={cn('relative min-w-0', compact && 'w-full')}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        tabIndex={open ? -1 : 0}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          if (!open) setPosition(dialogPosition(event.currentTarget));
          setOpen((current) => !current);
        }}
        className={cn(
          'flex min-h-11 w-full min-w-0 items-start gap-1.5 rounded-md border-l-4 px-2 py-1.5 text-left text-xs transition-colors',
          'border-border-primary bg-background-tertiary/70 text-text-primary hover:bg-background-tertiary',
        )}
        style={{ borderLeftColor: familyColor }}
        title={`${occurrence.company.name} — ${milestone}`}
      >
        <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: familyColor }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{companyLabel} · {milestone}</span>
          <span className="block truncate text-text-secondary">{familyName} · {typeLabels[occurrence.deadlineType]} · {state}</span>
        </span>
      </button>
      {open ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label={`${companyLabel} deadline details`}
          className="fixed z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border-primary bg-background-elevated p-4 text-sm shadow-elevation-2"
          style={{ left: position.left, top: position.top }}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); } }}
        >
          <DeadlineEventPanel
            occurrence={occurrence}
            canEdit={canEdit}
            isPending={isPending}
            mutationError={mutationError}
            onUpdate={onUpdate}
            onResetOverride={onResetOverride}
            onClose={() => { setOpen(false); triggerRef.current?.focus(); }}
          />
        </div>
      ) : null}
    </div>
  );
}
