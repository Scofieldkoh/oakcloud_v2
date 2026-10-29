'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Loader2, PencilLine, Plus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import {
  useCreateServiceCalendar,
  usePreviewServiceCalendarImpact,
  useServiceCalendar,
  useServiceCalendars,
  useUpdateServiceCalendar,
} from '@/hooks/use-service-calendars';
import type { BusinessCalendarInput, BusinessCalendarUpdateInput } from '@/lib/validations/business-calendar';
import type { BusinessCalendarDto, BusinessCalendarImpact } from '@/services/business-calendar';
import { PublicHolidaySourceCard } from './public-holiday-source-card';

interface BusinessCalendarPanelProps {
  workspaceId?: string;
  canAdminister?: boolean;
  featureEnabled?: boolean;
  active?: boolean;
}

type HolidayForm = {
  id?: string;
  date: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sourceType: 'MANUAL' | 'EXTERNAL';
  /** Set when an administrator takes over an official (MOM) holiday. */
  convertToManual?: boolean;
};
type CalendarForm = {
  name: string;
  jurisdictionCode: string;
  timeZone: string;
  weekendDays: number[];
  holidays: HolidayForm[];
  isActive: boolean;
};

const WEEKDAYS = [
  [0, 'Sunday'],
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
  [6, 'Saturday'],
] as const;

function formFromCalendar(calendar?: BusinessCalendarDto): CalendarForm {
  return {
    name: calendar?.name ?? '',
    jurisdictionCode: calendar?.jurisdictionCode ?? 'SG',
    timeZone: calendar?.timeZone ?? 'Asia/Singapore',
    weekendDays: calendar?.weekendDays ?? [0, 6],
    holidays: calendar?.holidays.map((holiday) => ({ id: holiday.id, date: holiday.date, name: holiday.name, description: holiday.description, isActive: holiday.isActive, sourceType: holiday.sourceType ?? 'MANUAL' })) ?? [],
    isActive: calendar?.isActive ?? true,
  };
}

function toInput(form: CalendarForm): BusinessCalendarInput {
  return {
    name: form.name.trim(),
    jurisdictionCode: form.jurisdictionCode,
    timeZone: form.timeZone,
    weekendDays: form.weekendDays,
    // Inactive rows are historical records. The API archives active rows that
    // are explicitly removed, so omitting inactive rows preserves their
    // identity and state instead of reactivating them during replacement.
    // Official holidays are sent back unchanged; the API keeps their owner
    // unless the administrator converted them to manual.
    holidays: form.holidays.filter((holiday) => holiday.isActive).map((holiday) => ({
      date: holiday.date,
      name: isLockedOfficial(holiday) ? holiday.name : holiday.name.trim(),
      description: isLockedOfficial(holiday) ? holiday.description : holiday.description?.trim() || null,
      ...(holiday.convertToManual ? { sourceType: 'MANUAL' as const } : {}),
    })),
    isActive: form.isActive,
  };
}

function isLockedOfficial(holiday: HolidayForm): boolean {
  return holiday.isActive && holiday.sourceType === 'EXTERNAL' && !holiday.convertToManual;
}

function HolidaySourceBadge({ official }: { official: boolean }) {
  return official
    ? <span className="badge badge-info" title="Official public holiday from the Ministry of Manpower">MOM</span>
    : <span className="badge badge-neutral">Manual</span>;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00+08:00`));
}

export function BusinessCalendarPanel({
  workspaceId,
  canAdminister = true,
  featureEnabled = true,
  active = true,
}: BusinessCalendarPanelProps) {
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CalendarForm>(() => formFromCalendar());
  const [preview, setPreview] = useState<BusinessCalendarImpact | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const panelEnabled = Boolean(active && featureEnabled && canAdminister && workspaceId);
  const calendars = useServiceCalendars(workspaceId, panelEnabled);
  const firstId = calendars.data?.calendars[0]?.id;
  const activeId = selectedId ?? firstId;
  const detail = useServiceCalendar(workspaceId, activeId, panelEnabled);
  const calendar = detail.data ?? calendars.data?.calendars.find((item) => item.id === activeId) ?? null;
  const create = useCreateServiceCalendar(workspaceId);
  const update = useUpdateServiceCalendar(workspaceId);
  const previewMutation = usePreviewServiceCalendarImpact(workspaceId);

  useEffect(() => {
    const calendarIds = calendars.data?.calendars.map((item) => item.id) ?? [];
    if (selectedId && calendarIds.includes(selectedId)) return;
    setSelectedId(calendarIds[0]);
  }, [calendars.data, selectedId]);

  useEffect(() => {
    if (calendar && !editing && !creating) setForm(formFromCalendar(calendar));
  }, [calendar, creating, editing]);

  const selectedWeekendDays = useMemo(() => new Set(form.weekendDays), [form.weekendDays]);

  const updateForm = (next: CalendarForm) => {
    setForm(next);
    setPreview(null);
    setPreviewDialogOpen(false);
  };

  const handleEdit = () => {
    setCreating(false);
    setForm(formFromCalendar(calendar ?? undefined));
    setPreview(null);
    setPreviewDialogOpen(false);
    setError(null);
    setEditing(true);
  };

  const handlePreview = async () => {
    if (!activeId && !creating) return;
    setError(null);
    try {
      const input = toInput(form);
      if (creating) {
        setPreview({ calendarId: '', expectedRevision: 0, proposedHash: '', previewFingerprint: '', counts: { recalculated: 0, preserved: 0, warnings: 0 }, samples: [] });
        return;
      }
      const impact = await previewMutation.mutateAsync({ id: activeId!, input });
      setPreview(impact);
      setPreviewDialogOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to preview date changes.');
    }
  };

  const handleSave = async () => {
    setError(null);
    if (creating) {
      try {
        const created = await create.mutateAsync(toInput(form));
        setCreating(false);
        setEditing(false);
        setSelectedId(created.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to create the business calendar.');
      }
      return;
    }
    if (!calendar || !preview) return;
    const input: BusinessCalendarUpdateInput = {
      ...toInput(form),
      expectedRevision: calendar.revision,
      proposedHash: preview.proposedHash,
      previewFingerprint: preview.previewFingerprint,
    };
    try {
      await update.mutateAsync({ id: calendar.id, input });
      setEditing(false);
      setPreview(null);
      setPreviewDialogOpen(false);
    } catch (reason) {
      setPreview(null);
      setPreviewDialogOpen(false);
      setError(reason instanceof Error ? reason.message : 'Unable to save the calendar. The preview may be stale.');
    }
  };

  if (!featureEnabled) return <section aria-labelledby="business-calendar-heading" className="card p-4"><h2 id="business-calendar-heading" className="text-lg font-semibold text-text-primary">Business calendar</h2><p className="mt-1 text-sm text-text-secondary">Business calendar administration is not enabled for this workspace.</p></section>;
  if (!canAdminister) return <section aria-labelledby="business-calendar-heading" className="card p-4"><h2 id="business-calendar-heading" className="text-lg font-semibold text-text-primary">Business calendar</h2><p className="mt-1 text-sm text-text-secondary">Tenant Admin access is required to manage business calendars.</p></section>;
  if (!workspaceId) return <section aria-labelledby="business-calendar-heading" className="card p-4"><h2 id="business-calendar-heading" className="text-lg font-semibold text-text-primary">Business calendar</h2><p className="mt-1 text-sm text-text-secondary">Select a workspace to administer the business calendar.</p></section>;

  if (creating || editing) {
    return (
      <section aria-labelledby="business-calendar-heading">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 id="business-calendar-heading" className="text-lg font-semibold text-text-primary">Business calendar</h2><p className="mt-1 text-sm text-text-secondary">Weekend days and named holidays drive business-day adjustments.</p></div></div>
        {error ? <Alert variant="error" title="Calendar action failed">{error}</Alert> : null}
        <div className="rounded-lg border border-border-primary bg-background-secondary p-4">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><FormInput label="Calendar name" value={form.name} onChange={(event) => updateForm({ ...form, name: event.target.value })} required className="input input-sm min-h-11 sm:min-h-8" /><FormInput label="Jurisdiction" value={form.jurisdictionCode} disabled hint="Singapore jurisdiction is SG in the first release." className="input input-sm min-h-11 sm:min-h-8" /><FormInput label="Time zone" value={form.timeZone} disabled className="input input-sm min-h-11 sm:min-h-8" /></div>
            <fieldset><legend className="text-sm font-semibold text-text-primary">Weekend days</legend><p className="mt-1 text-xs text-text-muted">Select one or more non-working weekdays.</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{WEEKDAYS.map(([day, label]) => <label key={day} className="flex min-h-11 items-center gap-2 rounded-lg border border-border-secondary px-3 text-sm text-text-primary sm:min-h-8"><input type="checkbox" aria-label={label} checked={selectedWeekendDays.has(day)} onChange={(event) => updateForm({ ...form, weekendDays: event.target.checked ? [...form.weekendDays, day].sort((left, right) => left - right) : form.weekendDays.filter((value) => value !== day) })} />{label}</label>)}</div></fieldset>
            <section aria-labelledby="holiday-editor-heading"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="holiday-editor-heading" className="text-sm font-semibold text-text-primary">Named holidays</h3><p className="mt-1 text-xs text-text-muted">Dates are stored as Singapore civil dates. Archived holidays remain visible for audit history. MOM holidays follow the official list; convert one to manual to change or remove it.</p></div><Button type="button" size="xs" variant="secondary" className="min-h-11 sm:min-h-8" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => updateForm({ ...form, holidays: [...form.holidays, { date: '', name: '', description: null, isActive: true, sourceType: 'MANUAL' }] })}>Add holiday</Button></div><div className="mt-3 space-y-3">{form.holidays.length === 0 ? <p className="rounded-lg border border-dashed border-border-primary p-3 text-xs text-text-muted">No named holidays configured.</p> : form.holidays.map((holiday, index) => <div key={holiday.id ?? `${holiday.date}-${index}`} className="grid grid-cols-1 gap-3 rounded-lg border border-border-primary bg-background-primary p-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]"><FormInput label="Holiday date" type="date" value={holiday.date} disabled={!holiday.isActive || isLockedOfficial(holiday)} onChange={(event) => updateForm({ ...form, holidays: form.holidays.map((item, itemIndex) => itemIndex === index ? { ...item, date: event.target.value } : item) })} className="input input-sm min-h-11 sm:min-h-8" required={holiday.isActive} /><div><FormInput label="Holiday name" value={holiday.name} disabled={!holiday.isActive || isLockedOfficial(holiday)} onChange={(event) => updateForm({ ...form, holidays: form.holidays.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} className="input input-sm min-h-11 sm:min-h-8" required={holiday.isActive} /><div className="mt-1 flex flex-wrap gap-1"><HolidaySourceBadge official={isLockedOfficial(holiday)} />{!holiday.isActive ? <span className="inline-flex badge badge-neutral">Archived</span> : null}</div></div><div className="flex items-end">{isLockedOfficial(holiday) ? <Button type="button" size="xs" variant="ghost" className="min-h-11 sm:min-h-8" leftIcon={<PencilLine className="h-3.5 w-3.5" />} aria-label={`Convert ${holiday.name} to manual`} onClick={() => updateForm({ ...form, holidays: form.holidays.map((item, itemIndex) => itemIndex === index ? { ...item, convertToManual: true } : item) })}>Convert to manual</Button> : holiday.isActive ? <Button type="button" size="xs" variant="ghost" iconOnly className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8" aria-label={`Remove holiday ${holiday.name || index + 1}`} onClick={() => updateForm({ ...form, holidays: form.holidays.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4 text-status-error" /></Button> : <span className="text-xs text-text-muted">Historical</span>}</div></div>)}</div></section>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-primary pt-4"><div>{preview ? <p className="text-sm font-medium text-status-success">Date-change preview ready</p> : <p className="text-xs text-text-muted">Preview is required before a date-affecting update.</p>}</div><div className="flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" className="min-h-11 sm:min-h-8" onClick={() => { setEditing(false); setCreating(false); setPreview(null); }}>Cancel</Button><Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => void handlePreview()} disabled={previewMutation.isPending || !form.name.trim()}>Preview date changes</Button><Button type="button" className="min-h-11 sm:min-h-8" onClick={() => void handleSave()} disabled={(!creating && !preview) || update.isPending || create.isPending} isLoading={update.isPending || create.isPending}>{creating ? 'Create calendar' : 'Save calendar'}</Button></div></div>
          </div>
        </div>
        {preview && !creating && previewDialogOpen ? <Modal isOpen onClose={() => { setPreview(null); setPreviewDialogOpen(false); }} title="Date-change impact preview" description="The server checks the current revision and fingerprint again before saving."><ModalBody><div className="grid grid-cols-3 gap-3"><div className="rounded-lg border border-border-primary p-3"><p className="text-xs text-text-muted">Recalculated</p><p className="text-xl font-semibold text-text-primary">{preview.counts.recalculated}</p></div><div className="rounded-lg border border-border-primary p-3"><p className="text-xs text-text-muted">Preserved</p><p className="text-xl font-semibold text-text-primary">{preview.counts.preserved}</p></div><div className="rounded-lg border border-border-primary p-3"><p className="text-xs text-text-muted">Warnings</p><p className="text-xl font-semibold text-text-primary">{preview.counts.warnings}</p></div></div><p className="mt-4 text-xs text-text-muted">{preview.samples.length} samples shown · revision {calendar?.revision}</p></ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11 sm:min-h-8" onClick={() => { setPreview(null); setPreviewDialogOpen(false); }}>Continue editing</Button><Button type="button" className="min-h-11 sm:min-h-8" onClick={() => void handleSave()} disabled={update.isPending} isLoading={update.isPending}>Save calendar</Button></ModalFooter></Modal> : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="business-calendar-heading">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 id="business-calendar-heading" className="text-lg font-semibold text-text-primary">Business calendar</h2><p className="mt-1 text-sm text-text-secondary">Singapore-first holiday data for business-day adjustments.</p></div><div className="flex flex-wrap items-center gap-3"><Button type="button" size="sm" className="min-h-11 sm:min-h-8" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setCreating(true); setEditing(false); setForm(formFromCalendar()); }}>Add business calendar</Button>{calendar ? <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-8" onClick={handleEdit}>Edit calendar</Button> : null}</div></div>
      {error ? <Alert variant="error" title="Calendar action failed">{error}</Alert> : null}
      <PublicHolidaySourceCard workspaceId={workspaceId} enabled={panelEnabled} />
      {calendars.data?.calendars.length ? <nav className="mb-4 rounded-lg border border-border-primary bg-background-secondary p-2" aria-label="Business calendar list"><div className="flex flex-wrap gap-2">{calendars.data.calendars.map((candidate) => <button key={candidate.id} type="button" className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 sm:min-h-8 ${candidate.id === activeId ? 'border-oak-primary bg-background-tertiary text-text-primary' : 'border-border-secondary text-text-secondary hover:bg-background-tertiary'}`} aria-label={`Select calendar ${candidate.name}`} aria-pressed={candidate.id === activeId} onClick={() => { setSelectedId(candidate.id); setCreating(false); setEditing(false); setPreview(null); setPreviewDialogOpen(false); setError(null); }}>Select {candidate.name}<span className="ml-2 text-xs text-text-muted">v{candidate.revision}</span></button>)}</div></nav> : null}
      {calendars.isLoading ? <div role="status" className="card flex items-center gap-2 p-4 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading business calendars…</div> : calendars.error ? <div className="card space-y-2 p-4"><p className="font-medium text-status-error">Unable to load business calendars.</p><Button type="button" variant="secondary" className="min-h-11 sm:min-h-8" onClick={() => void calendars.refetch()}>Retry</Button></div> : !calendar ? <div className="card p-4 text-center"><CalendarDays className="mx-auto h-12 w-12 text-text-muted" /><p className="mt-3 text-sm font-medium text-text-primary">No business calendar configured</p><p className="mt-1 text-xs text-text-muted">Create a calendar before publishing business-day rules.</p></div> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.35fr)]"><div className="rounded-lg border border-border-primary bg-background-secondary p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-text-primary">{calendar.name}</h3><p className="mt-1 text-xs text-text-muted">{calendar.jurisdictionCode} · {calendar.timeZone}</p></div><span className={calendar.isActive ? 'badge badge-success' : 'badge badge-neutral'}>{calendar.isActive ? `${calendar.holidays.filter((holiday) => holiday.isActive).length} configured` : 'Inactive'}</span></div><div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"><fieldset className="rounded-lg border border-border-primary bg-background-primary p-3"><legend className="px-1 text-xs font-medium text-text-muted">Weekend days</legend><div className="mt-2 grid grid-cols-2 gap-2">{WEEKDAYS.map(([day, label]) => <label key={day} className="flex min-h-11 items-center gap-2 rounded-lg border border-border-secondary px-3 text-sm text-text-primary sm:min-h-8"><input type="checkbox" aria-label={label} checked={calendar.weekendDays.includes(day)} disabled readOnly />{label}</label>)}</div></fieldset><div className="rounded-lg border border-border-primary bg-background-primary p-3"><p className="text-xs font-medium text-text-muted">Revision</p><p className="mt-2 text-sm font-semibold text-text-primary">Revision {calendar.revision}</p><p className="mt-1 text-xs text-text-muted">Updates require a current impact fingerprint.</p></div></div><div className="mt-4"><h4 className="text-sm font-semibold text-text-primary">Named holidays</h4>{calendar.holidays.filter((holiday) => holiday.isActive).length === 0 ? <p className="mt-2 text-sm text-text-muted">No holidays configured.</p> : <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{calendar.holidays.filter((holiday) => holiday.isActive).map((holiday) => <li key={holiday.id ?? holiday.date} className="rounded-lg border border-border-secondary p-3"><div className="flex items-start justify-between gap-2"><strong className="text-sm text-text-primary">{formatDate(holiday.date)}</strong><HolidaySourceBadge official={holiday.sourceType === 'EXTERNAL'} /></div><span className="mt-1 block text-sm text-text-secondary">{holiday.name}</span></li>)}</ul>}</div></div><aside className="rounded-lg border border-border-primary bg-background-secondary p-4"><h3 className="text-sm font-semibold text-text-primary">Calendar settings</h3><dl className="mt-3 space-y-3 text-sm"><div><dt className="text-xs text-text-muted">Jurisdiction</dt><dd className="mt-1 text-text-primary">{calendar.jurisdictionCode}</dd></div><div><dt className="text-xs text-text-muted">Time zone</dt><dd className="mt-1 text-text-primary">{calendar.timeZone}</dd></div><div><dt className="text-xs text-text-muted">Working days</dt><dd className="mt-1 text-text-primary">{calendar.weekendDays.length === 2 ? 'Monday–Friday' : 'Configured weekend days'}</dd></div><div><dt className="text-xs text-text-muted">Default adjustment</dt><dd className="mt-1 text-text-primary">Configured per milestone</dd></div></dl></aside></div>}
    </section>
  );
}
