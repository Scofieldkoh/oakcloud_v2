'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  GripVertical,
  Inbox,
  Minus,
  MoreVertical,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@/components/ui/dropdown';
import type {
  DocumentTemplateSummary,
} from '@/types/document-generation';
import type {
  EditableBatchItem,
} from './batch-workspace-state';

export interface BatchTemplatePickerProps {
  templates: DocumentTemplateSummary[];
  selected: EditableBatchItem[];
  onAdd: (template: DocumentTemplateSummary) => void;
  onRemove: (itemId: string) => void;
  onReorder: (itemId: string, direction: -1 | 1) => void;
  /** Moves an item to an absolute position (drag and drop). */
  onMove?: (itemId: string, toIndex: number) => void;
  disabled?: boolean;
  maxDocuments?: number;
}

function hasDraftData(item: EditableBatchItem): boolean {
  return Boolean(
    item.previewContent
    || item.editedContent
    || item.configuration.serviceAgreement
    || item.configuration.resolution?.sections.length
    || Object.keys(item.configuration.itemValues).length > 0,
  );
}

export function BatchTemplatePicker({
  templates,
  selected,
  onAdd,
  onRemove,
  onReorder,
  onMove,
  disabled = false,
  maxDocuments = 20,
}: BatchTemplatePickerProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<EditableBatchItem | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragKeyRef = useRef<string | null>(null);

  const selectedCountByTemplateId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of selected) counts.set(item.templateId, (counts.get(item.templateId) ?? 0) + 1);
    return counts;
  }, [selected]);
  const atLimit = selected.length >= maxDocuments;

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const template of templates) {
      if (template.engine !== 'OAKDOC') continue;
      counts.set(template.category, (counts.get(template.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [templates]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return templates.filter((template) => {
      // A4 templates are retired and can't be generated.
      if (template.engine !== 'OAKDOC') return false;
      if (category && template.category !== category) return false;
      if (!normalized) return true;
      return [template.name, template.category, template.description ?? '']
        .some((value) => value.toLocaleLowerCase().includes(normalized));
    });
  }, [templates, category, query]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, DocumentTemplateSummary[]>();
    for (const template of visible) {
      byCategory.set(template.category, [...(byCategory.get(template.category) ?? []), template]);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  // A template can be added more than once (for example several resolutions);
  // copies are removed from the selected list.
  const add = (template: DocumentTemplateSummary) => {
    if (disabled || atLimit) return;
    onAdd(template);
  };

  const requestRemoval = (item: EditableBatchItem) => {
    if (disabled) return;
    if (hasDraftData(item)) {
      setPendingRemoval(item);
      return;
    }
    onRemove(item.key);
  };

  // Minus or right-click takes off the most recently added copy.
  const removeOne = (template: DocumentTemplateSummary) => {
    const last = [...selected].reverse().find((item) => item.templateId === template.id);
    if (last) requestRemoval(last);
  };

  const handleDrop = (toIndex: number) => {
    const key = dragKeyRef.current;
    setDragKey(null);
    setDropIndex(null);
    dragKeyRef.current = null;
    if (!key || !onMove) return;
    const fromIndex = selected.findIndex((item) => item.key === key);
    if (fromIndex < 0) return;
    // Dropping below the origin collapses the vacated slot first.
    const target = toIndex > fromIndex ? toIndex - 1 : toIndex;
    if (target === fromIndex) return;
    onMove(key, target);
  };

  const openTemplate = (templateId: string) => {
    window.open(
      `/template-partials/editor?id=${encodeURIComponent(templateId)}&tab=templates`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {/* Catalogue */}
      <section aria-label="Template catalogue" className="min-w-0 space-y-3">
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Search templates</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search templates by name or description..."
              className="min-h-11 w-full rounded-lg border border-border-primary bg-background-primary pl-9 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 lg:min-h-10"
            />
          </label>
          {categoryCounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
              <button
                type="button"
                onClick={() => setCategory(null)}
                aria-pressed={category === null}
                className={cn(
                  'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors',
                  category === null
                    ? 'bg-oak-primary text-white'
                    : 'border border-border-primary bg-background-elevated text-text-secondary hover:text-text-primary',
                )}
              >
                All
                <span className="text-xs opacity-70">{templates.length}</span>
              </button>
              {categoryCounts.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setCategory(category === name ? null : name)}
                  aria-pressed={category === name}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors',
                    category === name
                      ? 'bg-oak-primary text-white'
                      : 'border border-border-primary bg-background-elevated text-text-secondary hover:text-text-primary',
                  )}
                >
                  {name}
                  <span className="text-xs opacity-70">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {visible.length > 0 && (
          <p className="text-xs text-text-muted">
            Left-click a template to add it, right-click to remove one.
          </p>
        )}

        {visible.length === 0 && (
          <p className="rounded-lg border border-dashed border-border-primary p-6 text-center text-sm text-text-muted">
            No templates match your search.
          </p>
        )}

        {groups.map(([groupName, groupTemplates]) => (
          <CollapsibleSection
            key={groupName}
            title={groupName}
            count={groupTemplates.length}
            defaultCollapsedMobile={false}
            defaultCollapsedDesktop={false}
            className="mb-0"
          >
            <ul className="grid gap-1.5">
              {groupTemplates.map((template) => {
                const selectedCount = selectedCountByTemplateId.get(template.id) ?? 0;
                const isSelected = selectedCount > 0;
                const blocked = atLimit;
                return (
                  <li key={template.id}>
                    <div
                      onContextMenu={(event) => {
                        event.preventDefault();
                        if (!disabled) removeOne(template);
                      }}
                      title="Left-click to add, right-click to remove"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors',
                        isSelected
                          ? 'border-oak-primary bg-oak-primary/5'
                          : 'border-border-primary bg-background-primary hover:border-oak-primary/40 hover:bg-background-tertiary',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => add(template)}
                        disabled={disabled || blocked}
                        aria-pressed={isSelected}
                        title={blocked ? `Maximum of ${maxDocuments} documents reached` : undefined}
                        className={cn(
                          'flex min-h-9 min-w-0 flex-1 items-center gap-3 text-left',
                          (disabled || blocked) && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                            isSelected
                              ? 'bg-oak-primary text-white'
                              : 'bg-oak-primary/10 text-oak-primary',
                          )}
                        >
                          {isSelected
                            ? <Check className="h-4 w-4" />
                            : <FileText className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                          {template.name}
                        </span>
                        {!isSelected && (
                          <span className="shrink-0 text-xs font-medium text-text-muted">Add</span>
                        )}
                      </button>

                      {isSelected && (
                        <span
                          className="flex shrink-0 items-center rounded-lg border border-oak-primary/30 bg-background-primary"
                          role="group"
                          aria-label={`${template.name} quantity`}
                        >
                          <button
                            type="button"
                            onClick={() => removeOne(template)}
                            disabled={disabled}
                            aria-label={`Remove one ${template.name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-l-lg text-text-secondary transition-colors hover:bg-background-tertiary hover:text-text-primary disabled:opacity-30"
                          >
                            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <span
                            className="min-w-6 px-1 text-center text-sm font-medium tabular-nums text-text-primary"
                            aria-live="polite"
                          >
                            {selectedCount}
                          </span>
                          <button
                            type="button"
                            onClick={() => add(template)}
                            disabled={disabled || blocked}
                            aria-label={`Add another ${template.name}`}
                            title={blocked ? `Maximum of ${maxDocuments} documents reached` : undefined}
                            className="flex h-8 w-8 items-center justify-center rounded-r-lg text-text-secondary transition-colors hover:bg-background-tertiary hover:text-text-primary disabled:opacity-30"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      )}

                      <Dropdown className="shrink-0">
                        <DropdownTrigger asChild aria-label={`Actions for ${template.name}`}>
                          <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
                          >
                            <MoreVertical className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </DropdownTrigger>
                        <DropdownMenu>
                          <DropdownItem
                            icon={<ExternalLink className="h-4 w-4" />}
                            onClick={() => openTemplate(template.id)}
                          >
                            Open template
                          </DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CollapsibleSection>
        ))}
      </section>

      {/* Batch */}
      <section
        aria-label="Documents in this batch"
        className="lg:sticky lg:top-4 lg:self-start"
      >
        <div className="rounded-lg border border-border-primary bg-background-secondary">
          <header className="flex items-baseline justify-between gap-2 border-b border-border-secondary px-3 py-2">
            <h2 className="text-sm font-medium text-text-primary">This batch</h2>
            <p className="text-xs text-text-muted" aria-live="polite">
              {selected.length} of {maxDocuments}
            </p>
          </header>

          {atLimit && (
            <p className="border-b border-border-secondary bg-status-warning/5 px-3 py-2 text-xs font-medium text-status-warning">
              Maximum of {maxDocuments} documents reached. Remove one to add another.
            </p>
          )}

          {selected.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <Inbox className="h-6 w-6 text-text-muted" aria-hidden="true" />
              <p className="text-sm font-medium text-text-primary">No documents yet</p>
              <p className="text-xs text-text-muted">
                Pick templates from the catalogue. They generate in the order listed here.
              </p>
            </div>
          ) : (
            <ol className="p-2">
              {selected.map((item, index) => (
                <li
                  key={item.key}
                  draggable={!disabled && Boolean(onMove)}
                  onDragStart={() => {
                    dragKeyRef.current = item.key;
                    setDragKey(item.key);
                  }}
                  onDragEnd={() => {
                    dragKeyRef.current = null;
                    setDragKey(null);
                    setDropIndex(null);
                  }}
                  onDragOver={(event) => {
                    if (!dragKeyRef.current) return;
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const after = event.clientY > bounds.top + bounds.height / 2;
                    setDropIndex(after ? index + 1 : index);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleDrop(dropIndex ?? index);
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-2 py-2 transition-colors',
                    dragKey === item.key
                      ? 'border-oak-primary/60 bg-oak-primary/5 opacity-60'
                      : 'border-transparent hover:bg-background-tertiary',
                    dropIndex === index && dragKey !== item.key && 'border-t-oak-primary',
                    dropIndex === index + 1 && dragKey !== item.key && 'border-b-oak-primary',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'shrink-0 text-text-muted',
                      onMove && !disabled ? 'cursor-grab active:cursor-grabbing' : 'opacity-40',
                    )}
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background-tertiary text-xs font-medium text-text-secondary"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-primary">
                      {item.templateName}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => onReorder(item.key, -1)}
                      disabled={disabled || index === 0}
                      aria-label={`Move ${item.templateName} up`}
                      className="flex min-h-11 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-background-elevated hover:text-text-primary disabled:opacity-30 lg:min-h-9"
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onReorder(item.key, 1)}
                      disabled={disabled || index === selected.length - 1}
                      aria-label={`Move ${item.templateName} down`}
                      className="flex min-h-11 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-background-elevated hover:text-text-primary disabled:opacity-30 lg:min-h-9"
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => requestRemoval(item)}
                      disabled={disabled}
                      aria-label={`Remove ${item.templateName}`}
                      className="flex min-h-11 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-status-error/10 hover:text-status-error disabled:opacity-30 lg:min-h-9"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div aria-live="polite" className="sr-only">
          {selected.length} document{selected.length === 1 ? '' : 's'} selected
        </div>
      </section>

      <ConfirmDialog
        isOpen={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) onRemove(pendingRemoval.key);
          setPendingRemoval(null);
        }}
        title="Remove this document?"
        description={
          pendingRemoval
            ? `“${pendingRemoval.templateName}” has unfinished configuration or a draft preview. Removing it discards that work.`
            : undefined
        }
        confirmLabel="Remove document"
        variant="warning"
      />
    </div>
  );
}
