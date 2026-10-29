'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { SingleDateInput } from '@/components/ui/single-date-input';
import type { OakDocRepeaterSectionSummary } from '@/lib/document-editor/oakdoc-custom-fields';
import { parseOakDocAmount } from '@/lib/document-editor/oakdoc-repeater-definitions';
import {
  checkOakDocPersonFields,
  type OakDocPersonFieldIssue,
} from '@/lib/document-editor/oakdoc-person-values';
import {
  documentPersonFields,
  personFieldPeople,
  personFieldSectionName,
  type PersonFieldParty,
} from '@/lib/document-generation-person-fields';
import type { BatchItemConfiguration } from '@/types/document-generation-batch';
import { BatchSection } from './batch-section';

export interface PersonFieldsSectionProps {
  configuration: BatchItemConfiguration;
  repeaterSections: OakDocRepeaterSectionSummary | null;
  fieldTags: readonly string[] | undefined;
  directors: readonly PersonFieldParty[];
  shareholders: readonly PersonFieldParty[];
  officers: readonly PersonFieldParty[];
  contactName: (id: string) => string;
  /** A custom field's value for this document, for the totals. */
  customValue: (key: string) => string;
  customLabel: (key: string) => string;
  onPatch: (patch: Partial<BatchItemConfiguration>) => void;
  disabled?: boolean;
}

const INPUT_CLASS = 'min-h-11 w-full rounded-lg border bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 lg:min-h-10';

function formatSum(amount: number, currency: boolean): string {
  return amount.toLocaleString('en-SG', currency
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 6 });
}

/**
 * One card per section with per-person fields: a row for each person the
 * section lists, with the values asked for each, and the running total of
 * any value that must add up to a document field.
 */
export function PersonFieldsSection({
  configuration,
  repeaterSections,
  fieldTags,
  directors,
  shareholders,
  officers,
  contactName,
  customValue,
  customLabel,
  onPatch,
  disabled = false,
}: PersonFieldsSectionProps) {
  const personFields = useMemo(
    () => documentPersonFields(repeaterSections, fieldTags),
    [fieldTags, repeaterSections],
  );
  const sections = Object.entries(personFields).map(([tag, fields]) => ({
    tag,
    fields,
    name: personFieldSectionName(tag, repeaterSections),
    people: personFieldPeople({ tag, configuration, directors, shareholders, officers, contactName }),
  }));
  if (sections.length === 0) return null;

  const totals = new Set(sections.flatMap((section) => section.fields.flatMap((field) => field.totalOf ?? [])));
  const { values, issues } = checkOakDocPersonFields({
    personFields,
    people: Object.fromEntries(sections.map((section) => [section.tag, section.people])),
    values: configuration.personValues,
    customData: Object.fromEntries([...totals].map((key) => [key, customValue(key)])),
    sectionName: (tag) => personFieldSectionName(tag, repeaterSections),
    customLabel,
  });

  const setValue = (tag: string, personId: string, key: string, value: string) => {
    const current = configuration.personValues ?? {};
    onPatch({
      personValues: {
        ...current,
        [tag]: {
          ...(current[tag] ?? {}),
          [personId]: { ...(current[tag]?.[personId] ?? {}), [key]: value },
        },
      },
    });
  };

  return (
    <>
      {sections.map((section) => {
        const sectionIssues = issues.filter((issue: OakDocPersonFieldIssue) => issue.tag === section.tag);
        return (
          <BatchSection
            key={section.tag}
            title={`${section.name}: details for each person`}
            status={{
              complete: sectionIssues.length === 0,
              label: sectionIssues.length === 0 ? 'Complete' : `${sectionIssues.length} to fix`,
            }}
          >
            {section.people.length === 0 ? (
              <p className="text-sm text-text-muted">Tick people under {section.name} first.</p>
            ) : (
              <div className="space-y-3">
                {section.people.map((person) => (
                  <div key={person.id} className="rounded-lg border border-border-primary p-3">
                    <p className="text-sm font-medium text-text-primary">{person.name}</p>
                    {sectionIssues.filter((issue) => issue.personId === person.id).map((issue) => (
                      <p key={issue.key} className="mt-1 text-xs text-status-error">{issue.message}</p>
                    ))}
                    <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {section.fields.map((field) => {
                        const typed = configuration.personValues?.[section.tag]?.[person.id]?.[field.key] ?? '';
                        // A single person's empty value takes the total; show it.
                        const shown = typed || values[section.tag]?.[person.id]?.[field.key] || '';
                        const missing = sectionIssues.some((issue) => issue.personId === person.id && issue.key === field.key);
                        const id = `person-${section.tag}-${person.id}-${field.key}`;
                        return (
                          <label key={field.key} htmlFor={id} className="block">
                            <span className="text-xs font-medium text-text-secondary">
                              {field.label}
                              {field.required || field.totalOf ? <span className="ml-1 text-status-error" aria-hidden="true">*</span> : null}
                            </span>
                            {field.type === 'date' ? (
                              <SingleDateInput
                                value={shown}
                                onChange={(next) => setValue(section.tag, person.id, field.key, next)}
                                disabled={disabled}
                                ariaLabel={`${field.label} for ${person.name}`}
                                showTodayButton
                                error={missing ? 'Required' : undefined}
                                className="mt-1 w-full"
                              />
                            ) : (
                              <input
                                id={id}
                                type="text"
                                inputMode={field.type === 'text' ? undefined : 'decimal'}
                                value={shown}
                                onChange={(event) => setValue(section.tag, person.id, field.key, event.target.value)}
                                disabled={disabled}
                                aria-label={`${field.label} for ${person.name}`}
                                aria-invalid={missing || undefined}
                                className={cn('mt-1', INPUT_CLASS, missing ? 'border-status-error/60' : 'border-border-primary')}
                              />
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {section.fields.filter((field) => field.totalOf).map((field) => {
                  const sum = section.people.reduce((total, person) => (
                    total + (parseOakDocAmount(values[section.tag]?.[person.id]?.[field.key]) ?? 0)
                  ), 0);
                  const target = parseOakDocAmount(customValue(field.totalOf!));
                  const currency = field.type === 'currency';
                  return (
                    <p key={field.key} className="text-xs text-text-secondary">
                      {field.label}: {formatSum(sum, currency)}
                      {target === null
                        ? ` (enter ${customLabel(field.totalOf!)} to check the total)`
                        : ` of ${formatSum(target, currency)} (${customLabel(field.totalOf!)})`}
                    </p>
                  );
                })}
                {sectionIssues.filter((issue) => !issue.personId).map((issue) => (
                  <p key={`${issue.key}-total`} className="text-xs text-status-error">{issue.message}</p>
                ))}
              </div>
            )}
          </BatchSection>
        );
      })}
    </>
  );
}
