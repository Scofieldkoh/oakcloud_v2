'use client';

import { useCallback } from 'react';
import { OakDocDocumentHost } from '@/components/documents/oakdoc/oakdoc-document-host';
import { getOakDocGeneratedDraft } from '@/lib/document-generation-batch-api';
import type { OakDocSnapshotIdentity } from '@/types/oakdoc';

export interface OakDocReviewEditorProps {
  generatedDocumentId: string;
  previewFingerprint: string;
  title: string;
  readOnly?: boolean;
  disabled?: boolean;
  onSave: (bytes: Uint8Array) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Batch review adapter over the shared OakDoc host. Batch revision and
 * preview freshness are enforced by the batch save route; each preview
 * (fingerprint) is its own editor session so item switches never leak state.
 */
export function OakDocReviewEditor({
  generatedDocumentId,
  previewFingerprint,
  title,
  readOnly = false,
  disabled = false,
  onSave,
  onDirtyChange,
}: OakDocReviewEditorProps) {
  const load = useCallback(
    (signal: AbortSignal) => getOakDocGeneratedDraft(generatedDocumentId, signal),
    [generatedDocumentId],
  );

  const persist = useCallback(async (bytes: Uint8Array, snapshot: OakDocSnapshotIdentity) => {
    await onSave(bytes);
    return { revision: snapshot.baseRevision };
  }, [onSave]);

  return (
    <OakDocDocumentHost
      entityKey={`batch-review:${generatedDocumentId}:${previewFingerprint}`}
      baseRevision={0}
      title={title}
      readOnly={readOnly}
      disabled={disabled}
      description={readOnly ? 'final document' : 'editable generated draft'}
      loadingLabel="Loading generated Word draft…"
      load={load}
      persist={persist}
      onDirtyChange={onDirtyChange}
    />
  );
}
