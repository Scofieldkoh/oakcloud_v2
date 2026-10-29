'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, GripVertical, MoreHorizontal, MoveHorizontal, Plus, SquarePen, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { FIELD_TYPE_LABEL, WIDTH_CLASS, WIDTH_OPTIONS, isBlockDividerInputType } from './builder-utils';
import type { BuilderField } from './builder-utils';

const ADD_FIELD_GROUPS: Array<{ label: string; types: Array<BuilderField['type']> }> = [
  { label: 'Text', types: ['SHORT_TEXT', 'LONG_TEXT'] },
  { label: 'Choice', types: ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'DROPDOWN'] },
  { label: 'Content', types: ['PARAGRAPH', 'HTML'] },
  { label: 'Upload', types: ['FILE_UPLOAD', 'SIGNATURE'] },
  { label: 'Custom', types: ['COMPANY_NAME_CHECK'] },
  { label: 'Structure', types: ['PAGE_BREAK', 'HIDDEN'] },
];

function getFieldTypeLabel(field: BuilderField): string {
  if (field.type === 'PAGE_BREAK') {
    if (field.inputType === 'repeat_start') return 'Dynamic section start';
    if (field.inputType === 'repeat_end') return 'Dynamic section end';
    if (isBlockDividerInputType(field.inputType)) return 'Block divider';
    return FIELD_TYPE_LABEL[field.type];
  }

  if (field.type !== 'PARAGRAPH') {
    return FIELD_TYPE_LABEL[field.type];
  }

  if (field.inputType === 'info_image') return 'Information / Image';
  if (field.inputType === 'info_url') return 'Information / URL';
  return 'Information / Text block';
}

function getFieldToneClasses(field: BuilderField): string {
  if (field.type === 'PAGE_BREAK' && (field.inputType === 'repeat_start' || field.inputType === 'repeat_end')) {
    return 'border-blue-300 dark:border-blue-700 bg-blue-50/40 dark:bg-blue-900/10';
  }

  if (field.type === 'PAGE_BREAK' && isBlockDividerInputType(field.inputType)) {
    return 'border-sky-300 dark:border-sky-700 bg-sky-50/40 dark:bg-sky-900/10';
  }

  if (field.type === 'PAGE_BREAK') {
    return 'border-orange-300 dark:border-orange-700 bg-orange-50/40 dark:bg-orange-900/10';
  }

  if (field.type === 'PARAGRAPH' && field.validation?.infoStopsProgress === true) {
    return 'border-status-warning/70 bg-status-warning/10';
  }

  if (field.type === 'PARAGRAPH') {
    return 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/35 dark:bg-emerald-900/10';
  }

  return 'border-border-primary hover:border-border-secondary';
}

function getEnabledFieldFlags(field: BuilderField): string[] {
  const flags: string[] = [];

  if (field.isRequired) flags.push('Required');
  if (field.isReadOnly) flags.push('Read only');
  if (field.hideLabel) flags.push('Hide label');
  if (field.validation?.tooltipEnabled === true) flags.push('Tooltip');
  if (field.type === 'PARAGRAPH' && field.validation?.infoStopsProgress === true) flags.push('Stops progress');
  if (field.type === 'PARAGRAPH' && field.validation?.infoShowInPdf === true) flags.push('Print PDF');
  if (field.showOnSummary) flags.push('Summary');

  return flags;
}

export function SortableFieldCard({
  field,
  selected,
  isDropTarget = false,
  dropPosition = null,
  onSelect,
  onAddBelow,
  onDuplicate,
  onDelete,
  onSetWidth,
}: {
  field: BuilderField;
  selected: boolean;
  isDropTarget?: boolean;
  dropPosition?: 'before' | 'after' | null;
  onSelect: (id: string) => void;
  onAddBelow: (id: string, type: BuilderField['type']) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onSetWidth: (id: string, width: BuilderField['layoutWidth']) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.clientId,
  });
  const cardRef = useRef<HTMLDivElement | null>(null);
  const setCardRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    cardRef.current = node;
  }, [setNodeRef]);

  const [showWidthOptions, setShowWidthOptions] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [useCompactActions, setUseCompactActions] = useState(false);
  const actionPopoverRef = useRef<HTMLDivElement>(null);
  const addPickerRef = useRef<HTMLDivElement>(null);
  const actionButtonClass = 'inline-flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-background-tertiary hover:text-text-primary';

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !cardRef.current) return;

    const node = cardRef.current;
    const updateCompactMode = () => {
      // Collapse actions into a 3-dot menu for narrow cards.
      setUseCompactActions(node.clientWidth < 390);
    };

    updateCompactMode();
    const observer = new ResizeObserver(updateCompactMode);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!showWidthOptions && !showActionMenu && !showAddPicker) return;

    function handleOutsideClick(event: MouseEvent) {
      if (!actionPopoverRef.current?.contains(event.target as Node)) {
        setShowWidthOptions(false);
        setShowActionMenu(false);
      }
      if (!addPickerRef.current?.contains(event.target as Node)) {
        setShowAddPicker(false);
      }
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [showWidthOptions, showActionMenu, showAddPicker]);

  useEffect(() => {
    if (!useCompactActions) {
      setShowActionMenu(false);
    }
  }, [useCompactActions]);

  const style = {
    transform: !isDragging && transform ? CSS.Translate.toString(transform) : undefined,
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0 : 1,
    pointerEvents: isDragging ? ('none' as const) : undefined,
    willChange: 'transform',
  };
  const enabledFlags = getEnabledFieldFlags(field);

  const widthOptionsPanel = (
    <div className="flex items-center gap-1">
      {WIDTH_OPTIONS.map((width) => (
        <button
          key={width}
          type="button"
          onClick={() => {
            onSetWidth(field.clientId, width);
            setShowWidthOptions(false);
            setShowActionMenu(false);
          }}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium text-text-primary transition-colors',
            field.layoutWidth === width
              ? 'bg-orange-300 text-black'
              : 'hover:bg-background-tertiary'
          )}
        >
          {width}%
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={setCardRef}
      style={style}
      className={cn(
        WIDTH_CLASS[field.layoutWidth],
        'group/field relative min-w-0',
        (showWidthOptions || showActionMenu) && 'z-[70]'
      )}
    >
      {isDropTarget && dropPosition && (
        <div
          className={cn(
            'pointer-events-none absolute left-2 right-2 z-20 border-t-2 border-oak-primary',
            dropPosition === 'before' ? '-top-1' : '-bottom-1'
          )}
        />
      )}
      <div
        className={cn(
          'overflow-visible rounded-lg border border-dashed bg-background-elevated px-3 py-3 transition-colors',
          getFieldToneClasses(field),
          selected && 'ring-1 ring-oak-primary border-oak-primary',
          isDropTarget && 'border-oak-primary/70 bg-oak-primary/5'
        )}
      >
        <div className="flex items-start gap-2">
          <Tooltip content="Drag">
            <button
              type="button"
              className="mt-0.5 rounded p-1 text-text-muted hover:text-text-primary cursor-grab active:cursor-grabbing"
              aria-label="Drag"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-4 h-4" />
            </button>
          </Tooltip>

          <button
            type="button"
            className="flex-1 min-w-0 text-left"
            onClick={() => onSelect(field.clientId)}
          >
            <div className="truncate font-semibold text-sm text-text-primary">
              {field.label || 'Untitled field'}
            </div>
            <div className="truncate text-xs text-text-secondary">
              {getFieldTypeLabel(field)}
              {field.key ? ` | ${field.key}` : ''}
            </div>
            {enabledFlags.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {enabledFlags.map((flag) => (
                  <span
                    key={`${field.clientId}-${flag}`}
                    className="rounded-full border border-border-primary bg-background-secondary px-1.5 py-0.5 text-2xs font-medium text-text-secondary"
                  >
                    {flag}
                  </span>
                ))}
              </div>
            )}
          </button>

          <div ref={actionPopoverRef} className="relative flex items-center gap-1">
            {useCompactActions ? (
              <>
                <Tooltip content="Actions">
                  <button
                    type="button"
                    className={actionButtonClass}
                    onClick={() => {
                      setShowActionMenu((prev) => !prev);
                      setShowWidthOptions(false);
                    }}
                    aria-label="Field actions"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </Tooltip>

                {showActionMenu && (
                  <div className="absolute right-0 top-full z-[80] mt-2 rounded-lg border border-border-primary bg-background-primary p-1.5 shadow-elevation-2">
                    <div className="flex items-center gap-1">
                      {field.type !== 'PAGE_BREAK' && (
                        <button
                          type="button"
                          className={actionButtonClass}
                          onClick={() => setShowWidthOptions((prev) => !prev)}
                          aria-label="Field width"
                        >
                          <MoveHorizontal className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        className={actionButtonClass}
                        onClick={() => {
                          onDuplicate(field.clientId);
                          setShowActionMenu(false);
                        }}
                        aria-label="Duplicate"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className={actionButtonClass}
                        onClick={() => {
                          onSelect(field.clientId);
                          setShowActionMenu(false);
                        }}
                        aria-label="Edit"
                      >
                        <SquarePen className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className={cn(actionButtonClass, 'hover:text-status-error')}
                        onClick={() => {
                          onDelete(field.clientId);
                          setShowActionMenu(false);
                        }}
                        aria-label="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {field.type !== 'PAGE_BREAK' && showWidthOptions && (
                      <div className="mt-1.5 border-t border-border-primary pt-1.5">
                        {widthOptionsPanel}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {field.type !== 'PAGE_BREAK' && (
                  <div className="relative inline-flex">
                    <Tooltip content="Width">
                      <button
                        type="button"
                        className={actionButtonClass}
                        onClick={() => setShowWidthOptions((prev) => !prev)}
                        aria-label="Field width"
                      >
                        <MoveHorizontal className="w-4 h-4" />
                      </button>
                    </Tooltip>

                    {showWidthOptions && (
                      <div className="absolute right-0 top-full z-[80] mt-2 rounded-lg border border-border-primary bg-background-primary p-1.5 shadow-elevation-2">
                        {widthOptionsPanel}
                      </div>
                    )}
                  </div>
                )}
                <Tooltip content="Duplicate">
                  <button
                    type="button"
                    className={actionButtonClass}
                    onClick={() => onDuplicate(field.clientId)}
                    aria-label="Duplicate"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </Tooltip>
                <Tooltip content="Edit">
                  <button
                    type="button"
                    className={actionButtonClass}
                    onClick={() => onSelect(field.clientId)}
                    aria-label="Edit"
                  >
                    <SquarePen className="w-4 h-4" />
                  </button>
                </Tooltip>
                <Tooltip content="Delete">
                  <button
                    type="button"
                    className={cn(actionButtonClass, 'hover:text-status-error')}
                    onClick={() => onDelete(field.clientId)}
                    aria-label="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </div>

      {!isDragging && (
        <div ref={addPickerRef} className="pointer-events-none absolute inset-x-0 -bottom-[14px] z-20 flex justify-center">
          <button
            type="button"
            className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full border border-border-primary bg-background-primary text-text-secondary opacity-0 shadow-elevation-1 transition-opacity hover:text-text-primary group-hover/field:opacity-100 group-focus-within/field:opacity-100"
            aria-label="Add element below"
            onClick={() => setShowAddPicker((prev) => !prev)}
          >
            <Plus className="h-4 w-4" />
          </button>

          {showAddPicker && (
            <div className="pointer-events-auto absolute bottom-full mb-2 w-64 rounded-xl border border-border-primary bg-background-primary p-2 shadow-elevation-3">
              <p className="mb-1.5 px-1 text-2xs font-semibold uppercase tracking-widest text-text-muted">Add below</p>
              <div className="space-y-1">
                {ADD_FIELD_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="px-1 py-0.5 text-2xs text-text-muted">{group.label}</p>
                    <div className="flex flex-wrap gap-1">
                      {group.types.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            onAddBelow(field.clientId, type);
                            setShowAddPicker(false);
                          }}
                          className="rounded-md border border-border-primary bg-background-elevated px-2 py-1 text-xs text-text-secondary hover:border-oak-primary/50 hover:bg-oak-primary/5 hover:text-text-primary transition-colors"
                        >
                          {FIELD_TYPE_LABEL[type]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
