'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  EMPTY_RESOLUTION_WORKSPACE,
  ResolutionSectionsConfig,
} from '@/components/documents/generation-batch/resolution-sections-config';
import { saveResolutionPreset } from '@/components/documents/generation-batch/resolution-preset-actions';
import { readResolutionPreset, resolutionCompositionIssues } from '@/lib/resolution-composition';
import type { ResolutionWorkspaceState } from '@/types/document-generation-batch';

export interface ResolutionPresetPanelProps {
  /** Null until the template is saved; presets are stored on the saved template. */
  templateId: string | null;
  /** True once the saved template is a resolution template. */
  savedAsResolution: boolean;
  initialPreset: unknown;
  disabled?: boolean;
  /** Called after the preset is saved or cleared. */
  onSaved?: (preset: ResolutionWorkspaceState | null) => void;
}

/** The resolutions new documents from this template start with, edited in a dialog. */
export function ResolutionPresetPanel({
  templateId,
  savedAsResolution,
  initialPreset,
  disabled = false,
  onSaved,
}: ResolutionPresetPanelProps) {
  const { success, error: showError } = useToast();
  const loaded = useMemo(() => readResolutionPreset(initialPreset), [initialPreset]);
  const [preset, setPreset] = useState<ResolutionWorkspaceState | null>(loaded);
  const [draft, setDraft] = useState<ResolutionWorkspaceState>(EMPTY_RESOLUTION_WORKSPACE);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPreset(loaded), [loaded]);

  const save = async (next: ResolutionWorkspaceState | null) => {
    if (!templateId) return;
    setBusy(true);
    try {
      await saveResolutionPreset(templateId, next);
      setPreset(next);
      onSaved?.(next);
      success(next ? 'Preset resolutions saved' : 'Preset resolutions cleared');
      setOpen(false);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : 'Could not save the preset resolutions');
    } finally {
      setBusy(false);
    }
  };

  const draftIssues = draft.sections.length === 0 ? [] : resolutionCompositionIssues(draft);
  const ready = Boolean(templateId) && savedAsResolution;

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-secondary">
        {!ready
          ? 'Save the template as a resolution first, then preset the resolutions new documents start with.'
          : preset && preset.sections.length > 0
            ? `New documents start with ${preset.sections.length} resolution${preset.sections.length === 1 ? '' : 's'}: ${preset.sections.map((section) => section.heading).join(', ')}. They can still be changed when generating.`
            : 'No preset. New documents start with an empty list.'}
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || busy || !ready}
        onClick={() => {
          setDraft(preset ?? EMPTY_RESOLUTION_WORKSPACE);
          setOpen(true);
        }}
      >
        {preset ? 'Edit preset resolutions' : 'Preset resolutions'}
      </Button>

      <Modal
        isOpen={open}
        onClose={() => !busy && setOpen(false)}
        size="4xl"
        title="Preset resolutions"
        description="New documents from this template start with these resolutions, in this order."
      >
        <ModalBody>
          <ResolutionSectionsConfig value={draft} onChange={setDraft} disabled={busy} />
        </ModalBody>
        <ModalFooter>
          {preset ? (
            <Button variant="ghost" onClick={() => void save(null)} disabled={busy} className="mr-auto">
              Clear preset
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => void save(draft.sections.length > 0 ? draft : null)}
            isLoading={busy}
            disabled={draftIssues.length > 0}
          >
            Save preset
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
