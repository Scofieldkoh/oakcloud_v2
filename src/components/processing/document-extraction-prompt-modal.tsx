'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export interface DocumentExtractionPromptVariable {
  key: string;
  label: string;
}

export interface DocumentExtractionQuickContext {
  id: string;
  label: string;
  value: string;
}

export interface DocumentExtractionPromptSettings {
  promptTemplate: string;
  quickContexts: DocumentExtractionQuickContext[];
  variables: DocumentExtractionPromptVariable[];
}

interface DocumentExtractionPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: DocumentExtractionPromptSettings | null;
  onSettingsChange: (settings: DocumentExtractionPromptSettings) => void;
}

function createQuickContext(): DocumentExtractionQuickContext {
  return {
    id: `context-${Date.now()}`,
    label: 'New Context',
    value: '',
  };
}

export function DocumentExtractionPromptModal({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
}: DocumentExtractionPromptModalProps) {
  const { success, error: toastError } = useToast();
  const [promptTemplate, setPromptTemplate] = useState('');
  const [quickContexts, setQuickContexts] = useState<DocumentExtractionQuickContext[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const initializedForOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      initializedForOpenRef.current = false;
      return;
    }
    if (!settings || initializedForOpenRef.current) return;
    setPromptTemplate(settings.promptTemplate);
    setQuickContexts(settings.quickContexts);
    initializedForOpenRef.current = true;
  }, [settings, isOpen]);

  const updateQuickContext = (
    id: string,
    field: keyof DocumentExtractionQuickContext,
    value: string
  ) => {
    setQuickContexts((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const removeQuickContext = (id: string) => {
    setQuickContexts((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const response = await fetch('/api/workspace/document-extraction-prompt', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptTemplate,
          quickContexts: quickContexts
            .map((item) => ({
              id: item.id.trim(),
              label: item.label.trim(),
              value: item.value.trim(),
            }))
            .filter((item) => item.id && item.label && item.value),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save prompt settings');
      }

      const body = await response.json();
      onSettingsChange(body.data);
      success('Prompt settings saved');
      onClose();
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Failed to save prompt settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Prompt Management"
      description="Edit the extraction prompt template and the quick context buttons available during document upload and re-extraction."
      size="4xl"
    >
      <ModalBody>
        <div className="space-y-5">
          <div>
            <label className="label mb-2">Extraction Prompt Template</label>
            <textarea
              value={promptTemplate}
              onChange={(event) => setPromptTemplate(event.target.value)}
              rows={14}
              className="input w-full text-sm font-mono resize-y px-3 py-2.5"
              placeholder="Enter the extraction prompt template..."
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <label className="label">Variables</label>
            </div>
            <div className="flex flex-wrap gap-2">
              {(settings?.variables ?? []).map((variable) => (
                <button
                  key={variable.key}
                  type="button"
                  className="badge badge-neutral font-mono"
                  title={variable.label}
                  onClick={() => setPromptTemplate((prev) => `${prev}${prev ? '\n' : ''}${variable.key}`)}
                >
                  {variable.key}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <label className="label">Quick Context Buttons</label>
              <button
                type="button"
                className="btn-secondary btn-xs flex items-center gap-1.5"
                onClick={() => setQuickContexts((prev) => [...prev, createQuickContext()])}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
            <div className="space-y-2">
              {quickContexts.map((context) => (
                <div
                  key={context.id}
                  className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2 items-start"
                >
                  <input
                    value={context.label}
                    onChange={(event) => updateQuickContext(context.id, 'label', event.target.value)}
                    className="input input-sm"
                    placeholder="Button label"
                  />
                  <textarea
                    value={context.value}
                    onChange={(event) => updateQuickContext(context.id, 'value', event.target.value)}
                    rows={2}
                    className="input text-sm resize-none px-3 py-2"
                    placeholder="Context text or variables, e.g. Current date: [CurrentDate]"
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-status-error"
                    onClick={() => removeQuickContext(context.id)}
                    title="Remove quick context"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {quickContexts.length === 0 && (
                <p className="text-sm text-text-muted">No quick context buttons configured.</p>
              )}
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          <X className="w-3.5 h-3.5 mr-1.5" />
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave} isLoading={isSaving}>
          <Save className="w-3.5 h-3.5 mr-1.5" />
          Save
        </Button>
      </ModalFooter>
    </Modal>
  );
}
