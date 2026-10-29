'use client';

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BuilderField } from './builder-utils';
import { FIELD_TYPE_LABEL } from './builder-utils';
import { FieldGeneralTab } from './field-general-tab';
import { FieldValidationTab } from './field-validation-tab';
import { FieldConditionTab } from './field-condition-tab';
import type { FormUrlHealthDetail } from '@/hooks/use-form-url-health';

const FIELD_DRAWER_MIN_WIDTH = 360;
const FIELD_DRAWER_MAX_WIDTH = 860;
const FIELD_DRAWER_DEFAULT_WIDTH = 460;
const FIELD_DRAWER_WIDTH_STORAGE_KEY = 'form_builder_field_drawer_width';

export function FieldEditorDrawer({
  field,
  allFields,
  onClose,
  onChange,
  isDirty,
  onSave,
  urlHealth,
}: {
  field: BuilderField;
  allFields: BuilderField[];
  onClose: () => void;
  onChange: (next: BuilderField) => void;
  isDirty?: boolean;
  onSave?: () => void;
  urlHealth?: FormUrlHealthDetail | null;
}) {
  const [activeTab, setActiveTab] = useState<'general' | 'validation' | 'condition'>('general');
  const [panelWidth, setPanelWidth] = useState(FIELD_DRAWER_DEFAULT_WIDTH);
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(FIELD_DRAWER_DEFAULT_WIDTH);

  const conditionalCandidates = allFields.filter(
    (f) => f.clientId !== field.clientId && !['PAGE_BREAK', 'PARAGRAPH', 'HTML'].includes(f.type)
  );

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(FIELD_DRAWER_WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved)) {
      setPanelWidth(Math.min(FIELD_DRAWER_MAX_WIDTH, Math.max(FIELD_DRAWER_MIN_WIDTH, saved)));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FIELD_DRAWER_WIDTH_STORAGE_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (!isResizingRef.current) return;
      const delta = startXRef.current - event.clientX;
      const nextWidth = startWidthRef.current + delta;
      setPanelWidth(Math.min(FIELD_DRAWER_MAX_WIDTH, Math.max(FIELD_DRAWER_MIN_WIDTH, nextWidth)));
    }

    function stopResize() {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResize);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResize);
    };
  }, []);

  function startResize(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    isResizingRef.current = true;
    startXRef.current = event.clientX;
    startWidthRef.current = panelWidth;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  return (
    <div
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[calc(100vw-0.5rem)] border-l border-border-primary bg-background-secondary shadow-elevation-3"
      style={{ width: `min(calc(100vw - 0.5rem), ${panelWidth}px)` }}
    >
      <button
        type="button"
        onMouseDown={startResize}
        className="absolute inset-y-0 left-0 hidden w-2 -translate-x-1 cursor-col-resize sm:block"
        aria-label="Resize field editor"
      />
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between border-b border-border-primary px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Edit field</h2>
            <p className="mt-0.5 text-xs text-text-muted">{FIELD_TYPE_LABEL[field.type] ?? field.type}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-2 text-text-secondary hover:bg-background-tertiary hover:text-text-primary"
            aria-label="Close field editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border-primary px-5 pt-2">
          <div className="flex items-center gap-5 text-sm">
            {[
              { id: 'general', label: 'Setup' },
              { id: 'validation', label: 'Rules' },
              { id: 'condition', label: 'Conditions' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as 'general' | 'validation' | 'condition')}
                className={cn(
                  'border-b-2 px-1 py-2 text-sm',
                  activeTab === tab.id
                    ? 'border-oak-primary text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {activeTab === 'general' && (
            <FieldGeneralTab field={field} allFields={allFields} onChange={onChange} urlHealth={urlHealth} />
          )}

          {activeTab === 'validation' && (
            <FieldValidationTab field={field} allFields={allFields} onChange={onChange} />
          )}

          {activeTab === 'condition' && (
            <FieldConditionTab
              field={field}
              allFields={allFields}
              conditionalCandidates={conditionalCandidates}
              onChange={onChange}
            />
          )}
        </div>

        {onSave && (
          <div className="flex items-center justify-between gap-3 border-t border-border-primary px-5 py-3">
            <span className={cn('text-xs', isDirty ? 'text-status-warning' : 'text-text-muted')}>
              {isDirty ? 'Unsaved changes' : 'All saved'}
            </span>
            <button
              type="button"
              onClick={onSave}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                isDirty
                  ? 'bg-oak-primary text-white hover:opacity-90'
                  : 'border border-border-primary bg-background-primary text-text-secondary hover:text-text-primary'
              )}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
