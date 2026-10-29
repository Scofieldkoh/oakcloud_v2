'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DocxEditor, type DocxEditorRef, type EditorCaret } from '@docx-editor.dev/react';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OakDocSnapshotIdentity } from '@/types/oakdoc';
import { OAKDOC_FIELD_TAGS } from '@/lib/document-editor/oakdoc-field-registry';
import { inspectOakDocFields, type OakDocFieldDefinition } from '@/lib/document-editor/oakdoc-fields';
import {
  createOakDocRepeater,
  inspectOakDocRepeaters,
  removeOakDocRepeater,
  setOakDocRepeaterLettering,
  type OakDocRepeaterDefinition,
  type OakDocRepeaterSummary,
} from '@/lib/document-editor/oakdoc-repeaters';
import { OakDocEditorSession } from './oakdoc-editor-session';
import { insertOakDocField } from './insert-oakdoc-field';
import { keepIfSame, useOakDocSummaryRefresh } from './use-oakdoc-summary-refresh';
import { useOakDocSectionDeleteGuard } from './use-oakdoc-section-delete-guard';
import { useOakDocFieldBlocks } from './use-oakdoc-field-blocks';
import { useOakDocViewKeeper } from './use-oakdoc-view-keeper';
import { OakDocLetteredListButton } from './oakdoc-lettered-list';

export interface OakDocPersistResult {
  revision: number;
}

/** What a host sidebar can do with the open document. */
export interface OakDocHostSidebarApi {
  /** Wrap the selection in, or insert at the caret, an Oakcloud field. */
  insertField: (field: OakDocFieldDefinition) => Promise<void>;
  /** Mark the document unsaved for a change made outside the Word body. */
  markChanged: () => void;
  /** Field tags currently in the document. */
  fieldTags: readonly string[];
  /** Make the paragraphs or table row at the caret repeat for each chosen person. */
  addRepeater: (definition: OakDocRepeaterDefinition) => Promise<void>;
  /** Remove the repeating section around the caret, keeping its content once. */
  removeRepeaterAtCaret: () => Promise<void>;
  /** Letter each copy of the sections with this tag (a), (b) when more than one is listed. */
  setRepeaterLettering: (tag: string, lettered: boolean) => Promise<void>;
  /** Repeating sections currently in the document. */
  repeaters: OakDocRepeaterSummary;
  disabled: boolean;
}

export interface OakDocDocumentHostProps {
  /** Identity of the loaded entity; changing it loads a new session. */
  entityKey: string;
  /** Persisted revision the loaded bytes belong to. */
  baseRevision: number;
  title: string;
  readOnly: boolean;
  disabled?: boolean;
  /** Short description shown in the header, e.g. "editable generated document". */
  description: string;
  loadingLabel: string;
  load: (signal: AbortSignal) => Promise<Uint8Array>;
  /**
   * Route-specific persistence adapter. `operationId` is reused when an
   * ambiguous failure is retried for the same local revision.
   */
  persist: (
    bytes: Uint8Array,
    snapshot: OakDocSnapshotIdentity,
    operationId: string,
  ) => Promise<OakDocPersistResult>;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (result: OakDocPersistResult) => void;
  /** Optional panel beside an editable document, e.g. a field picker. */
  renderSidebar?: (api: OakDocHostSidebarApi) => ReactNode;
  /**
   * Optional repair run on loaded bytes and before each save, e.g. removing
   * field controls a cut left empty. Cleaned bytes are remounted after save.
   */
  cleanup?: (bytes: Uint8Array) => { bytes: Uint8Array; removed: number; changed?: number };
  /** Authoring: fields act as blocks (no typing inside, whole-field delete). Needs `cleanup`. */
  fieldBlocks?: boolean;
}

function keepBytes(bytes: Uint8Array) {
  return { bytes, removed: 0 };
}

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The single native editor host for generated drafts and batch review.
 *
 * Save acknowledges only the submitted snapshot: edits made while a save is
 * in flight stay visible and dirty, the editor is never reloaded with the
 * submitted bytes, and responses from a previous entity/session are ignored.
 */
export function OakDocDocumentHost({
  entityKey,
  baseRevision,
  title,
  readOnly,
  disabled = false,
  description,
  loadingLabel,
  load,
  persist,
  onDirtyChange,
  onSaved,
  renderSidebar,
  cleanup,
  fieldBlocks = false,
}: OakDocDocumentHostProps) {
  const editorRef = useRef<DocxEditorRef>(null);
  const readyRef = useRef(false);
  const sessionRef = useRef<OakDocEditorSession>(new OakDocEditorSession(baseRevision));
  const pendingOperationRef = useRef<{ operationId: string; localRevision: number; sessionKey: string } | null>(null);
  const baseRevisionRef = useRef(baseRevision);
  const loadRef = useRef(load);
  const cleanupRef = useRef(cleanup);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const [documentBytes, setDocumentBytes] = useState<Uint8Array | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(loadingLabel);
  const [error, setError] = useState<string | null>(null);
  const [fieldTags, setFieldTags] = useState<string[]>([]);
  const [repeaters, setRepeaters] = useState<OakDocRepeaterSummary>({ count: 0, tags: [], letteredTags: [] });

  loadRef.current = load;
  cleanupRef.current = cleanup;
  onDirtyChangeRef.current = onDirtyChange;
  baseRevisionRef.current = baseRevision;

  const publishDirty = useCallback(() => {
    const next = sessionRef.current.dirty;
    setDirty(next);
    onDirtyChangeRef.current?.(next);
  }, []);

  // Load only when the entity (or view mode) changes. A refetch of the same
  // entity at a newer revision never replaces local content.
  useEffect(() => {
    const controller = new AbortController();
    readyRef.current = false;
    sessionRef.current.reset(baseRevisionRef.current);
    pendingOperationRef.current = null;
    publishDirty();
    setLoading(true);
    setError(null);
    setStatus(loadingLabel);

    void loadRef.current(controller.signal)
      .then((bytes) => {
        if (controller.signal.aborted) return;
        setDocumentBytes(cleanupRef.current?.(bytes).bytes ?? bytes);
        setVersion((current) => current + 1);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        const message = caught instanceof Error ? caught.message : 'Could not load the Word document.';
        setError(message);
        setStatus(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [entityKey, loadingLabel, publishDirty, readOnly]);

  useEffect(() => {
    if (!dirty || readOnly) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty, readOnly]);

  const markChanged = useCallback(() => {
    sessionRef.current.markChanged();
    publishDirty();
    setStatus('Document changed.');
  }, [publishDirty]);

  // The field-block hook owns the caret probe; it is created further down.
  const caretRef = useRef<() => EditorCaret | null>(() => null);
  const getCaret = useCallback(() => caretRef.current(), []);
  const { containerRef: viewRef, keep: keepView, restore: restoreView } = useOakDocViewKeeper(editorRef, getCaret);

  const replaceMountedDocument = useCallback((bytes: Uint8Array, message: string) => {
    keepView();
    readyRef.current = false;
    setDocumentBytes(bytes);
    setVersion((current) => current + 1);
    setStatus(message);
  }, [keepView]);

  const hasSidebar = Boolean(renderSidebar);
  const updateSummaries = useCallback((bytes: Uint8Array) => {
    try {
      setFieldTags(keepIfSame(inspectOakDocFields(bytes, OAKDOC_FIELD_TAGS).tags));
      setRepeaters(keepIfSame(inspectOakDocRepeaters(bytes)));
    } catch {
      setFieldTags([]);
      setRepeaters({ count: 0, tags: [], letteredTags: [] });
    }
  }, []);
  useEffect(() => {
    if (hasSidebar && documentBytes) updateSummaries(documentBytes);
  }, [documentBytes, hasSidebar, updateSummaries]);
  // Deleting a field or section by typing changes no bytes the host holds.
  const refreshSummaries = useOakDocSummaryRefresh(editorRef, updateSummaries);

  const insertField = useCallback(async (field: OakDocFieldDefinition) => {
    if (readOnly || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const inserted = await insertOakDocField(editorRef.current, field);
      markChanged();
      if (inserted.bytes) {
        replaceMountedDocument(inserted.bytes, inserted.message);
      } else {
        updateSummaries(inserted.afterBytes);
        setStatus(inserted.message);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not create the Word field.';
      setError(message);
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }, [disabled, markChanged, readOnly, replaceMountedDocument, updateSummaries]);

  /** Rewrite the saved bytes around the caret's paragraphs and remount them. */
  const editAtCaret = useCallback(async (
    action: string,
    edit: (bytes: Uint8Array, fromParaId: string, toParaId: string) => { bytes: Uint8Array; message: string },
  ) => {
    if (readOnly || disabled) return;
    const handle = editorRef.current;
    const selection = handle?.getEditor()?.snapshot().selection;
    if (!handle || !selection || !('paraId' in selection.from) || !('paraId' in selection.to)) {
      setError(`Place the caret inside a paragraph or table row to ${action}.`);
      setStatus(`Place the caret inside a paragraph or table row to ${action}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const buffer = await handle.save();
      if (!buffer) throw new Error('OakDoc did not return a DOCX file.');
      const edited = edit(new Uint8Array(buffer), selection.from.paraId, selection.to.paraId);
      markChanged();
      replaceMountedDocument(edited.bytes, edited.message);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : `Could not ${action}.`;
      setError(message);
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }, [disabled, markChanged, readOnly, replaceMountedDocument]);

  const addRepeater = useCallback((definition: OakDocRepeaterDefinition) => editAtCaret(
    'add a repeating section',
    (bytes, fromParaId, toParaId) => {
      const created = createOakDocRepeater({ docxBytes: bytes, fromParaId, toParaId, definition });
      return {
        bytes: created.bytes,
        message: `Created ${definition.label} repeating section around the current ${created.targetKind}. `
          + `Add ${definition.itemLabel.toLowerCase()} fields inside it.`,
      };
    },
  ), [editAtCaret]);

  const removeRepeaterAtCaret = useCallback(() => editAtCaret(
    'remove a repeating section',
    (bytes, fromParaId) => {
      const removed = removeOakDocRepeater({ docxBytes: bytes, paraId: fromParaId });
      return { bytes: removed.bytes, message: 'Removed the repeating section and kept its content once.' };
    },
  ), [editAtCaret]);

  const setRepeaterLettering = useCallback(async (tag: string, lettered: boolean) => {
    if (readOnly || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const buffer = await editorRef.current?.save();
      if (!buffer) throw new Error('OakDoc did not return a DOCX file.');
      const bytes = setOakDocRepeaterLettering({ docxBytes: new Uint8Array(buffer), tag, lettered });
      markChanged();
      replaceMountedDocument(bytes, lettered
        ? 'Each person in this section is lettered (a), (b) when more than one is listed.'
        : 'This section is no longer lettered.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not change the lettering.';
      setError(message);
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }, [disabled, markChanged, readOnly, replaceMountedDocument]);

  const handleKeyDownCapture = useOakDocSectionDeleteGuard({
    editorRef,
    documentBytes,
    disabled: readOnly || disabled || busy,
    onRepaired: replaceMountedDocument,
    onChanged: markChanged,
    onBusyChange: setBusy,
    cleanup,
    onError: (message) => {
      setError(message);
      setStatus(message);
    },
  });

  const showHint = useCallback((message: string) => setStatus(message), []);
  const blocks = useOakDocFieldBlocks({
    editorRef,
    disabled: !fieldBlocks || !cleanup || readOnly || disabled || busy,
    cleanup: cleanup ?? keepBytes,
    onRepaired: replaceMountedDocument,
    onChanged: markChanged,
    onHint: showHint,
    onDropField: insertField,
  });
  caretRef.current = blocks.getCaret;
  const handleEditorKeyDownCapture = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    blocks.onKeyDownCapture(event);
    if (!event.defaultPrevented) handleKeyDownCapture(event);
  }, [blocks, handleKeyDownCapture]);

  const save = useCallback(async () => {
    if (readOnly || disabled || saving) return;
    const editor = editorRef.current;
    if (!editor) {
      setError('OakDoc editor is not ready.');
      return;
    }

    const session = sessionRef.current;
    // Capture identity before serialization; any change during save()
    // increments localRevision beyond this snapshot and stays dirty.
    const snapshot = session.snapshot();
    const pending = pendingOperationRef.current;
    const operationId = pending
      && pending.sessionKey === snapshot.sessionKey
      && pending.localRevision === snapshot.localRevision
      ? pending.operationId
      : newOperationId();
    pendingOperationRef.current = {
      operationId,
      localRevision: snapshot.localRevision,
      sessionKey: snapshot.sessionKey,
    };

    setSaving(true);
    setError(null);
    setStatus('Saving Word document…');
    try {
      const buffer = await editor.save();
      if (!buffer) throw new Error('OakDoc did not return a DOCX file.');
      const saved = new Uint8Array(buffer.slice(0));
      const cleaned = cleanup?.(saved);
      const result = await persist(cleaned?.bytes ?? saved, snapshot, operationId);
      const outcome = session.acknowledge(snapshot, result.revision);
      if (outcome === 'stale') return;
      pendingOperationRef.current = null;
      publishDirty();
      if (outcome === 'clean' && cleaned && (cleaned.changed ?? cleaned.removed) > 0) {
        replaceMountedDocument(cleaned.bytes, 'Word document saved.');
      } else {
        setStatus(outcome === 'clean' ? 'Word document saved.' : 'Saved. Newer edits are not saved yet.');
      }
      onSaved?.(result);
    } catch (caught) {
      if (!session.isCurrent(snapshot)) return;
      const message = caught instanceof Error ? caught.message : 'Could not save the Word document.';
      setError(message);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }, [cleanup, disabled, onSaved, persist, publishDirty, readOnly, replaceMountedDocument, saving]);

  if (loading && !documentBytes) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-background-secondary text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {loadingLabel}
      </div>
    );
  }

  if (error && !documentBytes) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p role="alert" className="max-w-lg text-sm text-status-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-secondary">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border-primary bg-background-primary px-3 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-text-primary">
            Word · OakDoc {description}
          </p>
          <p
            role="status"
            aria-live="polite"
            className={cn(
              'truncate text-[11px]',
              error ? 'text-status-error' : dirty ? 'text-status-warning' : 'text-text-muted',
            )}
          >
            {error ?? (dirty && !saving ? 'Unsaved Word edits' : status)}
          </p>
        </div>
        {!readOnly && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void save()}
            disabled={disabled || saving || busy || !dirty}
            leftIcon={
              saving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : dirty
                  ? <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            }
          >
            {saving ? 'Saving…' : dirty ? 'Save DOCX' : 'Saved'}
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={(element) => { viewRef.current = element; }}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#eef0f2]"
          onKeyDownCapture={handleEditorKeyDownCapture}
          onPointerUpCapture={blocks.onPointerUpCapture}
          onDragOver={blocks.onDragOver}
          onDrop={blocks.onDrop}
        >
          {documentBytes && (
            <DocxEditor
              key={version}
              ref={editorRef}
              document={documentBytes}
              title={title}
              mode={readOnly ? 'view' : 'edit'}
              zoomMode="auto"
              locale="en-SG"
              colorMode="light"
              menu={{ reportIssue: false }}
              onSave={() => void save()}
              onReady={() => {
                readyRef.current = true;
                restoreView();
                if (!sessionRef.current.dirty) {
                  setStatus(readOnly ? 'Final Word document loaded.' : 'Word document ready to edit.');
                }
              }}
              onChange={() => {
                if (!readOnly && readyRef.current) {
                  markChanged();
                  if (hasSidebar) refreshSummaries();
                }
              }}
              className="h-full min-h-0"
            >
              {blocks.probe}
              <OakDocLetteredListButton />
            </DocxEditor>
          )}
        </div>
        {renderSidebar && !readOnly ? (
          <aside
            aria-label="Fields"
            className="w-72 flex-shrink-0 space-y-4 overflow-y-auto border-l border-border-primary bg-background-secondary p-3"
          >
            {renderSidebar({
              insertField,
              markChanged,
              fieldTags,
              addRepeater,
              removeRepeaterAtCaret,
              setRepeaterLettering,
              repeaters,
              disabled: disabled || busy || saving || !documentBytes,
            })}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
