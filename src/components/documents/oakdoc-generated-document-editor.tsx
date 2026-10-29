'use client';

import { useCallback } from 'react';
import { OakDocDocumentHost } from '@/components/documents/oakdoc/oakdoc-document-host';
import { getOakDocGeneratedDraft } from '@/lib/document-generation-batch-api';
import type { OakDocSnapshotIdentity } from '@/types/oakdoc';

interface SaveResult {
  revision: number;
  updatedAt: string;
}

export interface OakDocGeneratedDocumentEditorProps {
  documentId: string;
  title: string;
  revision: number;
  readOnly: boolean;
  disabled?: boolean;
  onSaved?: (result: SaveResult) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function apiError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error((body as { error?: string } | null)?.error ?? 'Request failed');
}

/** Standalone generated-document adapter over the shared OakDoc host. */
export function OakDocGeneratedDocumentEditor({
  documentId,
  title,
  revision,
  readOnly,
  disabled = false,
  onSaved,
  onDirtyChange,
}: OakDocGeneratedDocumentEditorProps) {
  const load = useCallback(
    (signal: AbortSignal) => getOakDocGeneratedDraft(documentId, signal),
    [documentId],
  );

  const persist = useCallback(async (
    bytes: Uint8Array,
    snapshot: OakDocSnapshotIdentity,
    operationId: string,
  ): Promise<SaveResult> => {
    const query = new URLSearchParams({
      format: 'docx',
      expectedRevision: String(snapshot.baseRevision),
      sessionKey: snapshot.sessionKey,
      writerInstanceId: snapshot.writerInstanceId,
      localRevision: String(snapshot.localRevision),
      baseRevision: String(snapshot.baseRevision),
    });
    const response = await fetch(
      `/api/generated-documents/${encodeURIComponent(documentId)}?${query.toString()}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Idempotency-Key': operationId,
        },
        body: exactArrayBuffer(bytes),
      },
    );
    if (!response.ok) throw await apiError(response);
    const receipt = await response.json() as SaveResult;
    return { revision: receipt.revision, updatedAt: receipt.updatedAt };
  }, [documentId]);

  return (
    <OakDocDocumentHost
      entityKey={`generated:${documentId}`}
      baseRevision={revision}
      title={title}
      readOnly={readOnly}
      disabled={disabled}
      description={readOnly ? 'final document' : 'editable generated document'}
      loadingLabel="Loading generated DOCX…"
      load={load}
      persist={persist}
      onDirtyChange={onDirtyChange}
      onSaved={(result) => onSaved?.(result as SaveResult)}
    />
  );
}
