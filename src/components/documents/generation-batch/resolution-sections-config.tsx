'use client';

import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  PenLine,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { useSession } from '@/hooks/use-auth';
import { useAllTemplatePartials, usePartialText } from '@/hooks/use-template-partials';
import {
  customResolutionParagraphs,
  isEditedPartial,
  resolutionCompositionIssues,
  resolutionSectionText,
  type ResolutionSection,
} from '@/lib/resolution-composition';
import { TEMPLATE_PARTIAL_CATEGORY_OPTIONS } from '@/lib/validations/template-partial';
import { RESOLUTION_TEXT_FIELDS } from '@/lib/document-editor/oakdoc-resolutions';
import type { ResolutionWorkspaceState } from '@/types/document-generation-batch';
import { createServiceAgreementClientKey as createClientKey } from '@/components/documents/service-agreement/client-key';
import { BatchSection } from './batch-section';
import { ResolutionPresetActions } from './resolution-preset-actions';

export const EMPTY_RESOLUTION_WORKSPACE: ResolutionWorkspaceState = { subject: '', sections: [] };

/** A resolution partial's header, else its display name or name, in capitals. */
export function defaultResolutionHeading(partial: { name: string; displayName?: string | null; header?: string | null }): string {
  return (partial.header?.trim() || partial.displayName || partial.name).trim().toUpperCase();
}

/** Resolution partials are listed first, then agreement wording, then the rest. */
const PARTIAL_GROUP_ORDER = ['RESOLUTION', 'AGREEMENT', 'OTHER'] as const;

function partialGroupLabel(category: string): string {
  return TEMPLATE_PARTIAL_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? 'Others';
}

const FIELD_OPTIONS = RESOLUTION_TEXT_FIELDS.map((field) => ({
  value: field.tag,
  label: field.label,
  description: `{${field.tag}}`,
  group: field.category,
}));

function ResolutionTextInput({
  number,
  value,
  invalid,
  disabled,
  onChange,
  footer,
}: {
  number: number;
  value: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  footer?: ReactNode;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const insertField = (tag: string) => {
    if (!tag) return;
    const token = `{${tag}}`;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label htmlFor={`resolution-text-${number}`} className="text-sm font-medium text-text-primary">
          Resolution text
          <span className="ml-1 text-status-error" aria-hidden="true">*</span>
        </label>
        <div className="w-56">
          <SearchableSelect
            ariaLabel={`Insert a field into resolution ${number}`}
            options={FIELD_OPTIONS}
            value=""
            onChange={insertField}
            placeholder="Insert field..."
            disabled={disabled}
            clearable={false}
            size="sm"
            groupBy="group"
          />
        </div>
      </div>
      <textarea
        ref={textareaRef}
        id={`resolution-text-${number}`}
        value={value}
        rows={Math.min(14, Math.max(4, value.split('\n').length + 1))}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        maxLength={20000}
        placeholder="RESOLVED that ..."
        aria-label={`Resolution ${number} text`}
        aria-invalid={invalid || undefined}
        className={cn(
          'mt-1 w-full rounded-lg border bg-background-primary px-3 py-2 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30',
          invalid ? 'border-status-error/50' : 'border-border-primary',
        )}
      />
      <span className="mt-1 block text-xs text-text-muted">
        A blank line starts a new paragraph. Fields such as {'{company.name}'} are filled in when the document is generated.
      </span>
      {footer ? <span className="mt-1 block text-xs text-text-muted">{footer}</span> : null}
    </div>
  );
}

/** The saved partial's wording, read-only, with a way to edit a copy for this document. */
function PartialResolutionText({
  partialId,
  number,
  disabled,
  onEdit,
}: {
  partialId: string;
  number: number;
  disabled: boolean;
  onEdit: (text: string) => void;
}) {
  const query = usePartialText(partialId);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-primary">Resolution text</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          leftIcon={<Pencil className="h-3.5 w-3.5" />}
          disabled={disabled || !query.data}
          aria-label={`Edit resolution ${number} text`}
          onClick={() => query.data && onEdit(query.data.text)}
        >
          Edit text
        </Button>
      </div>
      <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-secondary">
        {query.isLoading ? (
          <span className="inline-flex items-center gap-2 text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading partial text...
          </span>
        ) : query.error ? (
          <span className="text-status-error">
            {query.error instanceof Error ? query.error.message : 'Could not load the partial text.'}
          </span>
        ) : query.data?.text ? query.data.text : (
          <span className="italic text-text-muted">This partial has no text.</span>
        )}
      </div>
      <span className="mt-1 block text-xs text-text-muted">
        Printed from the saved partial with its Word formatting and fields.
      </span>
    </div>
  );
}

export interface ResolutionSectionsConfigProps {
  /** The resolution template, for saving this list as its preset or a new template. */
  templateId?: string;
  templateName?: string;
  value: ResolutionWorkspaceState | null | undefined;
  onChange: (next: ResolutionWorkspaceState) => void;
  disabled?: boolean;
}

/**
 * Configure step for RESOLUTION templates: the resolutions to print, each a
 * Word partial or custom text written for this document, numbered in the
 * order listed.
 */
export function ResolutionSectionsConfig({
  templateId,
  templateName,
  value,
  onChange,
  disabled = false,
}: ResolutionSectionsConfigProps) {
  const workspace = value ?? EMPTY_RESOLUTION_WORKSPACE;
  const { data: session } = useSession();
  const tenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId) ?? undefined;
  const partialsQuery = useAllTemplatePartials(tenantId, Boolean(tenantId));
  const wordPartials = useMemo(
    () => (partialsQuery.data?.partials ?? []).filter((partial) => partial.documentEngine === 'OAKDOC'),
    [partialsQuery.data],
  );
  const partialById = useMemo(
    () => new Map(wordPartials.map((partial) => [partial.id, partial])),
    [wordPartials],
  );
  const partialOptions = useMemo(
    () => PARTIAL_GROUP_ORDER.flatMap((category) => wordPartials
      .filter((partial) => (partial.category ?? 'OTHER') === category)
      .map((partial) => ({
        value: partial.id,
        label: partial.displayName || partial.name,
        description: partial.description ?? undefined,
        group: partialGroupLabel(category),
      }))),
    [wordPartials],
  );
  // Partials start collapsed and custom text open; toggles override that.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pickedPartialId, setPickedPartialId] = useState('');
  const subjectId = useId();
  const issues = resolutionCompositionIssues(workspace);

  const update = (patch: Partial<ResolutionWorkspaceState>) => onChange({ ...workspace, ...patch });
  const setSections = (sections: ResolutionSection[]) => update({ sections });
  const patchSection = (id: string, patch: Partial<ResolutionSection>) => setSections(
    workspace.sections.map((section) => (
      section.id === id ? { ...section, ...patch } as ResolutionSection : section
    )),
  );
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= workspace.sections.length) return;
    const sections = [...workspace.sections];
    [sections[index], sections[target]] = [sections[target], sections[index]];
    setSections(sections);
  };
  const addPartialSection = (partial: { id: string; name: string; displayName?: string | null; header?: string | null }) => {
    setSections([...workspace.sections, {
      id: createClientKey(),
      kind: 'PARTIAL',
      partialId: partial.id,
      heading: defaultResolutionHeading(partial),
    }]);
    setPickedPartialId('');
  };
  const addPartial = (partialId: string) => {
    const partial = partialById.get(partialId);
    if (partial) addPartialSection(partial);
  };
  const addCustom = () => setSections([...workspace.sections, {
    id: createClientKey(),
    kind: 'CUSTOM',
    heading: '',
    body: '',
  }]);

  return (
    <BatchSection
      title="Resolutions"
      status={{
        complete: issues.length === 0,
        label: issues.length === 0
          ? `${workspace.sections.length} resolution${workspace.sections.length === 1 ? '' : 's'}`
          : workspace.sections.length === 0 ? 'At least one resolution required' : `${issues.length} to fix`,
      }}
      action={templateId && templateName ? (
        <ResolutionPresetActions
          templateId={templateId}
          templateName={templateName}
          value={workspace}
          disabled={disabled || issues.length > 0}
        />
      ) : undefined}
    >
      <div className="space-y-4">
        <FormInput
          id={`resolution-subject-${subjectId}`}
          label="Subject heading"
          value={workspace.subject}
          onChange={(event) => update({ subject: event.target.value })}
          placeholder="e.g. CHANGE IN COMPANY SECRETARY"
          hint="Printed in bold above the numbered resolutions. Leave empty to omit it."
          disabled={disabled}
          maxLength={300}
          containerClassName="max-w-xl"
        />

        {workspace.sections.length > 0 ? (
          <ol className="space-y-3">
            {workspace.sections.map((section, index) => {
              const partial = section.kind === 'PARTIAL' ? partialById.get(section.partialId) : undefined;
              const headingMissing = !section.heading.trim();
              const text = resolutionSectionText(section);
              const bodyMissing = text !== null && customResolutionParagraphs(text).length === 0;
              const isExpanded = expanded[section.id] ?? section.kind === 'CUSTOM';
              const number = index + 1;
              return (
                <li
                  key={section.id}
                  className={cn(
                    'rounded-lg border bg-background-secondary p-3',
                    !isExpanded && (headingMissing || bodyMissing) ? 'border-status-error/50' : 'border-border-primary',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} resolution ${number}`}
                      onClick={() => setExpanded((current) => ({ ...current, [section.id]: !isExpanded }))}
                    >
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                        : <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />}
                      <span className="text-sm font-semibold text-text-primary">{number}.</span>
                      <span className={cn('truncate text-sm', headingMissing ? 'italic text-status-error' : 'font-medium text-text-primary')}>
                        {headingMissing ? 'Heading required' : section.heading}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-background-tertiary px-2 py-0.5 text-xs text-text-secondary">
                        {section.kind === 'PARTIAL'
                          ? <><FileText className="h-3 w-3" aria-hidden="true" /> {partial ? (partial.displayName || partial.name) : 'Unavailable partial'}{isEditedPartial(section) ? ' (edited)' : ''}</>
                          : <><PenLine className="h-3 w-3" aria-hidden="true" /> Custom text</>}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        iconOnly
                        leftIcon={<ArrowUp className="h-4 w-4" />}
                        aria-label={`Move resolution ${number} up`}
                        title="Move up"
                        disabled={disabled || index === 0}
                        onClick={() => move(index, -1)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        iconOnly
                        leftIcon={<ArrowDown className="h-4 w-4" />}
                        aria-label={`Move resolution ${number} down`}
                        title="Move down"
                        disabled={disabled || index === workspace.sections.length - 1}
                        onClick={() => move(index, 1)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        iconOnly
                        leftIcon={<Trash2 className="h-4 w-4" />}
                        aria-label={`Remove resolution ${number}`}
                        title="Remove"
                        disabled={disabled}
                        onClick={() => setSections(workspace.sections.filter((item) => item.id !== section.id))}
                      />
                    </div>
                  </div>
                  {isExpanded ? (
                    <div className="mt-2 space-y-3 pl-6">
                      <FormInput
                        id={`resolution-heading-${section.id}`}
                        label="Heading"
                        value={section.heading}
                        onChange={(event) => patchSection(section.id, { heading: event.target.value })}
                        placeholder="e.g. APPOINTMENT OF SECRETARY"
                        error={headingMissing ? 'Required' : undefined}
                        disabled={disabled}
                        maxLength={300}
                        containerClassName="max-w-xl"
                      />
                      {section.kind === 'PARTIAL' && !partial && !partialsQuery.isLoading ? (
                        <p className="text-xs text-status-error">
                          This partial is no longer available. Remove it or pick another.
                        </p>
                      ) : null}
                      {section.kind === 'PARTIAL' && partial ? (
                        <a
                          href={`/template-partials/editor?type=partial&tab=partials&id=${encodeURIComponent(section.partialId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-oak-primary hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          Edit the saved partial in a new tab
                        </a>
                      ) : null}
                      {section.kind === 'PARTIAL' && text === null ? (
                        <PartialResolutionText
                          partialId={section.partialId}
                          number={number}
                          disabled={disabled}
                          onEdit={(body) => patchSection(section.id, { body })}
                        />
                      ) : null}
                      {text !== null ? (
                        <ResolutionTextInput
                          number={number}
                          value={text}
                          invalid={bodyMissing}
                          disabled={disabled}
                          onChange={(body) => patchSection(section.id, { body })}
                          footer={section.kind === 'PARTIAL' ? (
                            <span className="flex flex-wrap items-center gap-2">
                              <span>Edited text prints as plain paragraphs instead of the partial&apos;s Word formatting and fields.</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                                disabled={disabled}
                                onClick={() => patchSection(section.id, { body: null })}
                              >
                                Use saved partial
                              </Button>
                            </span>
                          ) : undefined}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-text-secondary">
            No resolutions yet. Add a saved partial or write a custom resolution.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-3xl">
            <SearchableSelect
              label="Add a partial"
              options={partialOptions}
              value={pickedPartialId}
              onChange={(partialId) => {
                setPickedPartialId(partialId);
                if (partialId) addPartial(partialId);
              }}
              placeholder={partialsQuery.isLoading
                ? 'Loading partials...'
                : wordPartials.length === 0 ? 'No Word partials yet' : 'Search partials...'}
              loading={partialsQuery.isLoading}
              disabled={disabled || wordPartials.length === 0}
              clearable={false}
              size="md"
              groupBy="group"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="md"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={addCustom}
            disabled={disabled || workspace.sections.length >= 50}
          >
            Add custom resolution
          </Button>
        </div>

      </div>
    </BatchSection>
  );
}
