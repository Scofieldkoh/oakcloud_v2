'use client';

import { useState } from 'react';
import { CopyPlus, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import type { ResolutionWorkspaceState } from '@/types/document-generation-batch';

async function requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error || 'The request failed'));
  return payload;
}

/** Edited partial text is kept so a preset can carry reworded partials too. */
export function saveResolutionPreset(templateId: string, preset: ResolutionWorkspaceState | null) {
  return requestJson(`/api/document-templates/${encodeURIComponent(templateId)}/resolution-preset`, {
    method: 'PUT',
    body: JSON.stringify({ resolutionPreset: preset }),
  });
}

export function saveResolutionTemplateCopy(templateId: string, name: string, preset: ResolutionWorkspaceState) {
  return requestJson(`/api/document-templates/${encodeURIComponent(templateId)}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ name, resolutionPreset: preset }),
  });
}

export interface ResolutionPresetActionsProps {
  templateId: string;
  templateName: string;
  value: ResolutionWorkspaceState;
  disabled?: boolean;
}

/** White outline buttons for the section's green header, like Apply to others. */
const HEADER_BUTTON_CLASS = 'min-h-9 border border-white/50 text-white hover:bg-white/10 hover:text-white';

/**
 * Save the resolutions on Configure as the template's preset, or as a new
 * template that uses the same Word layout with these resolutions preset.
 * Shown in the Resolutions section header.
 */
export function ResolutionPresetActions({
  templateId,
  templateName,
  value,
  disabled = false,
}: ResolutionPresetActionsProps) {
  const { success, error: showError } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyName, setCopyName] = useState('');
  const [busy, setBusy] = useState(false);
  const empty = value.sections.length === 0;

  const savePreset = async () => {
    setBusy(true);
    try {
      await saveResolutionPreset(templateId, value);
      success(`Saved these resolutions as the preset for "${templateName}"`);
      setConfirmOpen(false);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : 'Could not save the preset');
    } finally {
      setBusy(false);
    }
  };

  const saveCopy = async () => {
    setBusy(true);
    try {
      const created = await saveResolutionTemplateCopy(templateId, copyName.trim(), value);
      success(`Saved as template "${String(created.name ?? copyName.trim())}". It is listed when you next start a document.`);
      setCopyOpen(false);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : 'Could not save the template');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={HEADER_BUTTON_CLASS}
        leftIcon={<Save className="h-3.5 w-3.5" />}
        disabled={disabled || busy || empty}
        onClick={() => setConfirmOpen(true)}
      >
        Save as preset for this template
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={HEADER_BUTTON_CLASS}
        leftIcon={<CopyPlus className="h-3.5 w-3.5" />}
        disabled={disabled || busy || empty}
        onClick={() => {
          setCopyName(value.subject.trim() ? `${templateName} - ${value.subject.trim()}`.slice(0, 200) : '');
          setCopyOpen(true);
        }}
      >
        Save as new template
      </Button>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={savePreset}
        title="Save preset resolutions"
        description={`New "${templateName}" documents will start with these ${value.sections.length} resolutions${value.subject.trim() ? ' and subject' : ''}. Any preset it already has is replaced. Documents already started are not changed.`}
        confirmLabel="Save preset"
        isLoading={busy}
      />

      <Modal
        isOpen={copyOpen}
        onClose={() => setCopyOpen(false)}
        title="Save as new template"
        description={`A copy of "${templateName}" with the same Word layout, starting with these ${value.sections.length} resolutions. They can still be added to, removed or reordered when generating.`}
      >
        <ModalBody>
          <FormInput
            label="Template name"
            value={copyName}
            onChange={(event) => setCopyName(event.target.value)}
            placeholder="e.g. Appointment of corporate secretary"
            maxLength={200}
            required
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setCopyOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void saveCopy()} isLoading={busy} disabled={!copyName.trim()}>
            Save template
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
