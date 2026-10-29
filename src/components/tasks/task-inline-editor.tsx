'use client';

import { useEffect, useRef, useState } from 'react';
import { DatePicker } from '@/components/ui/date-picker';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { TaskStatusAction, TaskUpdatePayload } from '@/hooks/use-tasks';
import type { TaskListItem } from '@/services/tasks/types';

export type TaskEditableField = 'company' | 'title' | 'status' | 'owner' | 'due';

interface CompanyOption {
  id: string;
  name: string;
}

interface OwnerOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface TaskInlineEditorProps {
  field: TaskEditableField;
  task: TaskListItem;
  companies: CompanyOption[];
  owners: OwnerOption[];
  onSaveMetadata: (payload: TaskUpdatePayload) => Promise<void>;
  onStatusAction: (action: TaskStatusAction) => void;
  onSaved: () => void;
  onCancel: () => void;
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function TaskInlineEditor({
  field,
  task,
  companies,
  owners,
  onSaveMetadata,
  onStatusAction,
  onSaved,
  onCancel,
}: TaskInlineEditorProps) {
  const [title, setTitle] = useState(task.title);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const isWithinEditor = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return true;
      if (editorRef.current?.contains(target)) return true;
      return target instanceof Element
        && Boolean(target.closest('[data-searchable-select-popover], [data-datepicker-popover]'));
    };
    const dismissIfOutside = (event: MouseEvent | FocusEvent) => {
      if (field !== 'title' && !isWithinEditor(event.target)) {
        onCancel();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (field !== 'title' && event.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('mousedown', dismissIfOutside);
    document.addEventListener('focusin', dismissIfOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', dismissIfOutside);
      document.removeEventListener('focusin', dismissIfOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [field, onCancel]);

  const save = async (payload: TaskUpdatePayload) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setError(null);
    try {
      await onSaveMetadata(payload);
      onSaved();
    } catch {
      setError('Could not save task');
    } finally {
      savingRef.current = false;
    }
  };

  const editor = (() => {
    if (field === 'company') {
      return (
        <SearchableSelect
          variant="table-filter"
          options={[
            { value: '', label: 'Not linked' },
            ...companies.map((company) => ({ value: company.id, label: company.name })),
          ]}
          value={task.company?.id ?? ''}
          onChange={(value) => { void save({ companyId: value || null }); }}
          placeholder="Edit company"
          className="text-xs"
          showChevron={false}
          showKeyboardHints={false}
        />
      );
    }

    if (field === 'owner') {
      return (
        <SearchableSelect
          variant="table-filter"
          options={[
            { value: '', label: 'Unassigned' },
            ...owners.map((owner) => ({
              value: owner.id,
              label: `${owner.firstName} ${owner.lastName}`.trim() || owner.email,
            })),
          ]}
          value={task.owner?.id ?? ''}
          onChange={(value) => { void save({ ownerId: value || null }); }}
          placeholder="Edit owner"
          className="text-xs"
          showChevron={false}
          showKeyboardHints={false}
        />
      );
    }

    if (field === 'due') {
      return (
        <div data-testid="task-due-inline-editor">
          <DatePicker
            value={task.dueDate
              ? { mode: 'single', date: new Date(task.dueDate) }
              : undefined}
            onChange={(value) => {
              const date = value?.mode === 'single' ? value.date : undefined;
              void save({ dueDate: date ? toLocalDateString(date) : null });
            }}
            placeholder="Set due date"
            size="sm"
            defaultTab="single"
            className="text-xs"
          />
        </div>
      );
    }

    if (field === 'status') {
      if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
        return <span className="text-xs text-text-muted">No status actions available</span>;
      }
      const action: TaskStatusAction = task.status === 'PAUSED' ? 'resume' : 'pause';
      const label = action === 'resume' ? 'Resume task' : 'Pause task';
      return (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => {
              onSaved();
              onStatusAction(action);
            }}
            className="rounded-md border border-border-primary px-2 py-1 text-xs font-medium text-text-primary hover:bg-background-tertiary"
          >
            {label}
          </button>
          <button
            type="button"
            onClick={() => {
              onSaved();
              onStatusAction('cancel');
            }}
            className="rounded-md border border-border-primary px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            Cancel task
          </button>
        </div>
      );
    }

    return (
      <input
        autoFocus
        type="text"
        aria-label="Edit task title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          if (cancelledRef.current) return;
          const nextTitle = title.trim();
          if (!nextTitle) {
            setError('Task title is required');
            return;
          }
          if (nextTitle === task.title) {
            onSaved();
            return;
          }
          void save({ title: nextTitle });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelledRef.current = true;
            onCancel();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="h-9 w-full rounded-lg border border-oak-primary bg-background-primary px-2 text-sm text-text-primary outline-none ring-2 ring-oak-primary/20"
      />
    );
  })();

  return (
    <div
      ref={editorRef}
      data-task-inline-editor
      className="min-w-0 space-y-1"
      onClick={(event) => event.stopPropagation()}
    >
      {editor}
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
