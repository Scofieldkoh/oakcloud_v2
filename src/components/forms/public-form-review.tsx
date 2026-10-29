'use client';

import { AlertTriangle, CheckCircle2, Info, PenLine } from 'lucide-react';
import {
  evaluateCondition,
  formatTimeTimezoneAnswer,
  isEmptyValue,
  parseChoiceOptions,
  type PublicFormField,
} from '@/lib/form-utils';
import type { IncorporationIssue } from '@/lib/forms/company-incorporation-profile';
import { cn } from '@/lib/utils';

export interface ReviewUpload {
  id: string;
  fileName: string;
}

interface ReviewEntry {
  key: string;
  label: string;
  value: string;
}

interface ReviewRepeat {
  key: string;
  title: string;
  itemLabel: string;
  rows: ReviewEntry[][];
}

interface ReviewSection {
  pageIndex: number;
  title: string;
  entries: Array<ReviewEntry | ReviewRepeat>;
}

const NON_ANSWER_TYPES = new Set(['PAGE_BREAK', 'PARAGRAPH', 'HTML', 'HIDDEN']);

function isRepeatStart(field: PublicFormField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'repeat_start';
}

function isRepeatEnd(field: PublicFormField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'repeat_end';
}

function isHeading(field: PublicFormField): boolean {
  return field.type === 'PARAGRAPH' && typeof field.inputType === 'string' && field.inputType.startsWith('info_heading');
}

function choiceEntryValue(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof (entry as { value?: unknown }).value === 'string') {
    return (entry as { value: string }).value;
  }
  return '';
}

function choiceEntryDetail(entry: unknown): string {
  if (entry && typeof entry === 'object' && typeof (entry as { detailText?: unknown }).detailText === 'string') {
    return (entry as { detailText: string }).detailText.trim();
  }
  return '';
}

/** A single-option multiple choice with a hidden label reads as a tick box. */
function isTickBox(field: PublicFormField): boolean {
  return field.type === 'MULTIPLE_CHOICE' && field.hideLabel === true && parseChoiceOptions(field.options).length === 1;
}

/** Readable value for one answer, using option labels rather than stored values. */
export function formatReviewValue(
  field: PublicFormField,
  value: unknown,
  uploadsById: Map<string, ReviewUpload>
): string | null {
  if (isTickBox(field)) return isEmptyValue(value) || (Array.isArray(value) && value.length === 0) ? 'No' : 'Yes';
  if (isEmptyValue(value)) return null;

  if (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE' || field.type === 'DROPDOWN') {
    const labels = new Map(parseChoiceOptions(field.options).map((option) => [option.value, option.label]));
    const entries = Array.isArray(value) ? value : [value];
    const text = entries
      .map((entry) => {
        const selected = choiceEntryValue(entry);
        if (!selected) return '';
        const detail = choiceEntryDetail(entry);
        const label = labels.get(selected) ?? selected;
        return detail ? `${label}: ${detail}` : label;
      })
      .filter(Boolean)
      .join(', ');
    return text || null;
  }

  if (field.type === 'SHORT_TEXT' && field.inputType === 'time_timezone') {
    return formatTimeTimezoneAnswer(value);
  }

  if (field.type === 'SHORT_TEXT' && field.inputType === 'date' && typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
  }

  if (field.type === 'FILE_UPLOAD') {
    const ids = (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string');
    const names = ids.map((id) => uploadsById.get(id)?.fileName ?? 'Uploaded file');
    return names.length > 0 ? names.join(', ') : null;
  }

  if (field.type === 'SIGNATURE') return 'Signature added';

  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function rowContext(answers: Record<string, unknown>, rowIndex: number): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    context[key] = Array.isArray(value) ? value[rowIndex] : value;
  }
  return context;
}

export function buildReviewSections(input: {
  pages: PublicFormField[][];
  allFields: PublicFormField[];
  answers: Record<string, unknown>;
  repeatCounts: Record<string, number>;
  uploadsById: Map<string, ReviewUpload>;
  localize: (field: PublicFormField) => PublicFormField;
}): ReviewSection[] {
  const { pages, allFields, answers, uploadsById, localize } = input;

  return pages.map((pageFields, pageIndex) => {
    const entries: ReviewSection['entries'] = [];
    const headingField = pageFields.find(isHeading);
    const title = headingField ? (localize(headingField).label || `Page ${pageIndex + 1}`) : `Page ${pageIndex + 1}`;

    for (let index = 0; index < pageFields.length; index += 1) {
      const field = pageFields[index];

      if (isRepeatStart(field)) {
        const sectionFields: PublicFormField[] = [];
        let cursor = index + 1;
        while (cursor < pageFields.length && !isRepeatEnd(pageFields[cursor])) {
          if (!NON_ANSWER_TYPES.has(pageFields[cursor].type)) sectionFields.push(pageFields[cursor]);
          cursor += 1;
        }
        index = cursor;
        if (!evaluateCondition(field.condition, answers, { fields: allFields })) continue;

        const localized = localize(field);
        const validation = (field.validation && typeof field.validation === 'object') ? field.validation as Record<string, unknown> : {};
        const itemLabel = typeof validation.repeatItemLabel === 'string' ? validation.repeatItemLabel : 'Item';
        let rowCount = input.repeatCounts[field.id] ?? 1;
        for (const sectionField of sectionFields) {
          const value = answers[sectionField.key];
          if (Array.isArray(value)) rowCount = Math.max(rowCount, value.length);
        }

        const rows: ReviewEntry[][] = [];
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          const context = rowContext(answers, rowIndex);
          const row: ReviewEntry[] = [];
          for (const sectionField of sectionFields) {
            if (!evaluateCondition(sectionField.condition, context, { fields: sectionFields })) continue;
            const text = formatReviewValue(sectionField, context[sectionField.key], uploadsById);
            if (!text) continue;
            row.push({ key: sectionField.key, label: localize(sectionField).label || sectionField.key, value: text });
          }
          if (row.length > 0) rows.push(row);
        }

        entries.push({ key: field.key, title: localized.label || 'Items', itemLabel, rows });
        continue;
      }

      if (NON_ANSWER_TYPES.has(field.type)) continue;
      if (!evaluateCondition(field.condition, answers, { fields: allFields })) continue;
      const text = formatReviewValue(field, answers[field.key], uploadsById);
      const localized = localize(field);
      entries.push({
        key: field.key,
        label: localized.label || field.key,
        value: text ?? 'Not provided',
      });
    }

    return { pageIndex, title, entries };
  });
}

const SEVERITY_STYLE: Record<IncorporationIssue['severity'], { label: string; className: string }> = {
  error: { label: 'Must be corrected', className: 'border-status-error/40 bg-status-error/5 text-status-error' },
  staff_review: { label: 'For our review', className: 'border-border-primary bg-background-primary text-text-primary' },
};

export interface PublicFormReviewProps {
  title: string;
  intro: string | null;
  sections: ReviewSection[];
  issues: Array<IncorporationIssue & { pageIndex: number | null }>;
  onEdit: (pageIndex: number) => void;
}

export function PublicFormReview({ title, intro, sections, issues, onEdit }: PublicFormReviewProps) {
  const blocking = issues.filter((issue) => issue.severity === 'error');
  const outstanding = issues.filter((issue) => issue.severity !== 'error');

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border-primary/50 bg-[var(--form-panel-bg,#fff)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {intro && <p className="mt-1 text-sm text-text-secondary">{intro}</p>}
      </div>

      {issues.length > 0 && (
        <section
          aria-labelledby="review-clarification-heading"
          className={cn(
            'rounded-xl border bg-[var(--form-panel-bg,#fff)] p-5 shadow-sm',
            blocking.length > 0 ? 'border-status-error/40' : 'border-status-warning/50'
          )}
        >
          <h3 id="review-clarification-heading" className="flex items-center gap-2 text-base font-semibold text-text-primary">
            <AlertTriangle className="h-4 w-4 text-status-warning" aria-hidden="true" />
            Items requiring clarification
          </h3>
          {blocking.length > 0 && (
            <p className="mt-1 text-sm text-status-error">Correct the items marked “Must be corrected” before submitting.</p>
          )}
          {blocking.length === 0 && outstanding.length > 0 && (
            <p className="mt-1 text-sm text-text-secondary">You can submit now. We will follow up on these items with you.</p>
          )}
          <ul className="mt-3 space-y-2">
            {[...blocking, ...outstanding].map((issue, index) => {
              const style = SEVERITY_STYLE[issue.severity];
              return (
                <li key={`${issue.code}-${issue.rowIndex ?? 'x'}-${index}`} className={cn('flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm', style.className)}>
                  <span>
                    <span className="block text-xs font-medium uppercase tracking-wide opacity-80">{style.label}</span>
                    {issue.message}
                  </span>
                  {issue.pageIndex !== null && (
                    <button
                      type="button"
                      onClick={() => onEdit(issue.pageIndex!)}
                      className="shrink-0 text-xs font-medium text-oak-primary underline-offset-2 hover:underline"
                    >
                      Edit
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {issues.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-status-success/40 bg-status-success/10 px-4 py-3 text-sm text-text-primary">
          <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden="true" />
          No items need clarification.
        </div>
      )}

      {sections.map((section) => (
        <section key={section.pageIndex} className="rounded-xl border border-border-primary/50 bg-[var(--form-panel-bg,#fff)] p-5 shadow-sm" aria-label={section.title}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-text-primary">{section.title}</h3>
            <button
              type="button"
              onClick={() => onEdit(section.pageIndex)}
              className="inline-flex items-center gap-1 text-sm font-medium text-oak-primary underline-offset-2 hover:underline"
              aria-label={`Edit ${section.title}`}
            >
              <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </button>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {section.entries.map((entry) => {
              if ('rows' in entry) {
                return (
                  <div key={entry.key} className="sm:col-span-2">
                    <dt className="text-xs font-medium text-text-secondary">{entry.title}</dt>
                    <dd className="mt-1 space-y-2">
                      {entry.rows.length === 0 && <span className="text-sm text-text-muted">None added</span>}
                      {entry.rows.map((row, rowIndex) => (
                        <div key={rowIndex} className="rounded-lg border border-border-primary/60 bg-background-primary px-3 py-2">
                          <p className="text-xs font-medium text-text-muted">{entry.itemLabel} {rowIndex + 1}</p>
                          <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                            {row.map((cell) => (
                              <div key={cell.key}>
                                <dt className="text-xs text-text-secondary">{cell.label}</dt>
                                <dd className="break-words text-sm text-text-primary">{cell.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                    </dd>
                  </div>
                );
              }

              return (
                <div key={entry.key} className="min-w-0">
                  <dt className="text-xs font-medium text-text-secondary">{entry.label}</dt>
                  <dd className={cn('whitespace-pre-wrap break-words text-sm', entry.value === 'Not provided' ? 'text-text-muted' : 'text-text-primary')}>
                    {entry.value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}

      <p className="flex items-start gap-2 text-xs text-text-secondary">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Check the details above. Use Edit to change a section before submitting.
      </p>
    </div>
  );
}
