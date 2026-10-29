'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useUnsavedNavigationGuard } from '@/hooks/use-unsaved-navigation-guard';
import {
  DocumentGenerationBatchApiError,
  createDocumentGenerationBatch,
  generateDocumentGenerationBatch,
  getDocumentGenerationBatch,
  preflightDocumentGenerationBatch,
  previewDocumentGenerationBatchItem,
  retryDocumentGenerationBatchItem,
  reviewDocumentGenerationBatchItem,
  saveDocumentGenerationBatch,
  saveOakDocGeneratedDraft,
} from '@/lib/document-generation-batch-api';
import type {
  BatchExecutionInput,
  BatchGenerationResult,
  DocumentGenerationBatchDto,
  UpdateDocumentGenerationBatchInput,
} from '@/types/document-generation-batch';
import {
  BATCH_STAGES,
  createInitialBatchWorkspaceState,
  deriveCapabilitiesForCommit,
  documentGenerationBatchReducer,
  editableBatchFromDto,
  type BatchStage,
  type BatchWorkspaceState,
  type EditableDocumentGenerationBatch,
} from './batch-workspace-state';
import {
  acknowledgeBatchWithNewerLocalState,
  batchWorkspaceWriteFingerprint,
  type WorkflowBatchAction,
} from './batch-workflow-ack';

export interface UseDocumentGenerationBatchOptions {
  initialBatch?: EditableDocumentGenerationBatch | null;
}

export interface DocumentGenerationBatchCommands {
  state: BatchWorkspaceState;
  dispatch: React.Dispatch<WorkflowBatchAction>;
  saveDraft: () => Promise<EditableDocumentGenerationBatch>;
  continueTo: (stage: BatchStage) => Promise<void>;
  previewItem: (
    itemId: string,
    replaceEditedContent?: boolean,
  ) => Promise<EditableDocumentGenerationBatch>;
  reviewItem: (itemId: string) => Promise<EditableDocumentGenerationBatch>;
  saveOakDocDraft: (
    itemId: string,
    bytes: Uint8Array,
  ) => Promise<EditableDocumentGenerationBatch>;
  preflight: () => Promise<EditableDocumentGenerationBatch>;
  generate: () => Promise<BatchGenerationResult>;
  retry: (itemId: string) => Promise<EditableDocumentGenerationBatch>;
  reload: () => Promise<EditableDocumentGenerationBatch>;
  /** Re-saves local edits on top of the newer server revision. */
  overwriteConflict: () => Promise<EditableDocumentGenerationBatch>;
  /** Navigates after a successful workflow action without reopening the guard. */
  navigateAway: (destination: string) => void;
  requestNavigation: (destination: string) => void;
  dialog: React.ReactNode;
}

function buildUpdateInput(state: BatchWorkspaceState): UpdateDocumentGenerationBatchInput {
  // The server knows saved items by id and new ones by template id.
  const activeItem = state.batch.items.find((item) => item.key === state.activeItemId
    || item.id === state.activeItemId);
  return {
    expectedRevision: state.batch.revision ?? 0,
    currentStage: BATCH_STAGES.indexOf(state.stage),
    primaryCompanyId: state.batch.primaryCompanyId,
    activeItemId: activeItem ? (activeItem.id ?? activeItem.templateId) : state.activeItemId,
    masterFieldValues: state.batch.masterFieldValues,
    items: state.batch.items.map((item, index) => ({
      id: item.id,
      templateId: item.templateId,
      displayOrder: index,
      configuration: item.configuration,
      editedContent: item.editedContent,
      editedContentJson: item.editedContentJson,
    })),
    ...(state.batch.taskContext !== undefined
      ? { taskContext: state.batch.taskContext }
      : {}),
  };
}

function workflowBatchReducer(
  state: BatchWorkspaceState,
  action: WorkflowBatchAction,
): BatchWorkspaceState {
  if (action.type === 'server/acknowledge-newer-local') {
    return acknowledgeBatchWithNewerLocalState(state, action.batch);
  }
  return documentGenerationBatchReducer(state, action);
}

function conflictRevision(error: unknown): number | null {
  if (
    !(error instanceof DocumentGenerationBatchApiError)
    || error.status !== 409
    || !error.details
    || typeof error.details !== 'object'
    || !('currentRevision' in error.details)
  ) {
    return null;
  }
  const revision = Number(
    (error.details as { currentRevision: unknown }).currentRevision,
  );
  return Number.isInteger(revision) && revision >= 0 ? revision : null;
}

export function useDocumentGenerationBatch(
  options: UseDocumentGenerationBatchOptions = {},
): DocumentGenerationBatchCommands {
  const { initialBatch = null } = options;
  const [state, dispatch] = useReducer(
    workflowBatchReducer,
    undefined,
    () => createInitialBatchWorkspaceState(initialBatch ?? []),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const initialBatchRef = useRef(initialBatch);

  useEffect(() => {
    if (initialBatch === initialBatchRef.current) return;
    initialBatchRef.current = initialBatch;
    if (
      initialBatch
      && !stateRef.current.batch.id
      && stateRef.current.batch.items.length === 0
    ) {
      const next = createInitialBatchWorkspaceState(initialBatch);
      dispatch({ type: 'local/initialize', batch: initialBatch });
      stateRef.current = next;
    }
  }, [initialBatch]);

  const previewAbortRef = useRef<AbortController | null>(null);
  const { disarm, requestNavigation, dialog } = useUnsavedNavigationGuard(
    state.dirty,
  );
  const navigateAway = useCallback((destination: string) => {
    disarm();
    requestNavigation(destination);
  }, [disarm, requestNavigation]);

  const commit = useCallback((
    saved: DocumentGenerationBatchDto,
    requestFingerprint?: string,
  ) => {
    const current = stateRef.current;
    if (
      requestFingerprint !== undefined
      && batchWorkspaceWriteFingerprint(current) !== requestFingerprint
    ) {
      const acknowledged = acknowledgeBatchWithNewerLocalState(current, saved);
      dispatch({ type: 'server/acknowledge-newer-local', batch: saved });
      stateRef.current = acknowledged;
      return acknowledged.batch;
    }

    const normalized = editableBatchFromDto(saved);
    const currentActiveItem = current.activeItemId
      ? normalized.items.find((item) =>
        item.key === current.activeItemId
        || item.id === current.activeItemId
        || item.templateId === current.activeItemId,
      )
      : undefined;
    const activeItemId = currentActiveItem?.key
      ?? normalized.activeItemId
      ?? normalized.items[0]?.key
      ?? null;
    const committed = activeItemId === normalized.activeItemId
      ? normalized
      : { ...normalized, activeItemId };
    dispatch({ type: 'server/replace', batch: committed });
    stateRef.current = {
      ...current,
      batch: committed,
      stage: BATCH_STAGES[Math.min(committed.currentStage, BATCH_STAGES.length - 1)],
      activeItemId,
      savedSnapshot: JSON.stringify(committed),
      dirty: false,
      pending: null,
      conflict: null,
      capabilities: deriveCapabilitiesForCommit(committed),
    };
    return committed;
  }, []);

  const recordConflict = useCallback((error: unknown): boolean => {
    const currentRevision = conflictRevision(error);
    if (currentRevision === null) return false;
    dispatch({ type: 'save/conflict', currentRevision });
    stateRef.current = {
      ...stateRef.current,
      pending: null,
      conflict: { currentRevision },
    };
    return true;
  }, []);

  const resolveItemId = useCallback((itemId: string): string => {
    const item = stateRef.current.batch.items.find(
      (entry) =>
        entry.id === itemId
        || entry.key === itemId
        || entry.templateId === itemId,
    );
    return item?.id ?? item?.key ?? itemId;
  }, []);

  const persistInFlightRef = useRef<Promise<EditableDocumentGenerationBatch> | null>(null);

  const persist = useCallback(async (): Promise<EditableDocumentGenerationBatch> => {
    if (persistInFlightRef.current) return persistInFlightRef.current;

    const run = async (): Promise<EditableDocumentGenerationBatch> => {
      const current = stateRef.current;
      if (current.batch.items.length === 0) {
        throw new Error('Select at least one template before saving');
      }
      const requestFingerprint = batchWorkspaceWriteFingerprint(current);
      dispatch({ type: 'request/start', pending: 'save' });
      let batchId = current.batch.id;
      let revision = current.batch.revision;
      let activeItemId = current.activeItemId;
      let items = current.batch.items;

      try {
        if (!batchId) {
          const created = await createDocumentGenerationBatch({
            items: current.batch.items.map((item) => ({ templateId: item.templateId })),
            ...(current.batch.legacyDraftId
              ? { legacyDraftId: current.batch.legacyDraftId }
              : {}),
            ...(current.batch.taskContext !== undefined
              ? { taskContext: current.batch.taskContext }
              : {}),
          });
          batchId = created.id;
          revision = created.revision;
          activeItemId = created.activeItemId ?? null;
          // Created items come back in the order they were sent.
          const createdItems = [...created.items].sort((a, b) => a.displayOrder - b.displayOrder);
          items = current.batch.items.map((item, index) => {
            const server = createdItems[index];
            return server && server.templateId === item.templateId ? { ...item, id: server.id } : item;
          });
        }

        const updateInput = buildUpdateInput({
          ...current,
          activeItemId,
          batch: { ...current.batch, id: batchId, revision, items },
        });
        const saved = await saveDocumentGenerationBatch(batchId, updateInput);
        return commit(saved, requestFingerprint);
      } catch (error) {
        const currentRevision = conflictRevision(error);
        if (currentRevision !== null) {
          if (batchId && !stateRef.current.batch.id) {
            dispatch({
              type: 'server/track-id',
              id: batchId,
              revision: revision ?? 0,
              currentRevision,
            });
            stateRef.current = {
              ...stateRef.current,
              batch: {
                ...stateRef.current.batch,
                id: batchId,
                revision: revision ?? 0,
              },
              conflict: { currentRevision },
              dirty: true,
              pending: null,
            };
          } else {
            recordConflict(error);
          }
        } else {
          dispatch({ type: 'request/end' });
        }
        throw error;
      }
    };

    const promise = run();
    persistInFlightRef.current = promise;
    try {
      return await promise;
    } finally {
      persistInFlightRef.current = null;
    }
  }, [commit, recordConflict]);

  const ensurePersisted = useCallback(async (): Promise<EditableDocumentGenerationBatch> => {
    const stagesMatch = () => {
      const current = stateRef.current;
      const localStage = BATCH_STAGES.indexOf(current.stage);
      const persistedStage = Math.min(
        current.batch.currentStage,
        BATCH_STAGES.length - 1,
      );
      return persistedStage === localStage;
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = stateRef.current;
      if (current.batch.id && !current.dirty && stagesMatch()) {
        return current.batch;
      }
      await persist();
    }

    const current = stateRef.current;
    if (current.dirty || !stagesMatch()) {
      throw new Error(
        'The batch changed while it was being saved. Save the latest changes before continuing.',
      );
    }
    return current.batch;
  }, [persist]);

  const saveDraft = useCallback(() => persist(), [persist]);

  const continueTo = useCallback(async (stage: BatchStage) => {
    dispatch({ type: 'stage/navigate', stage });
    stateRef.current = { ...stateRef.current, stage };
    await ensurePersisted();
  }, [ensurePersisted]);

  const previewItem = useCallback(async (
    itemId: string,
    replaceEditedContent = false,
  ) => {
    await ensurePersisted();
    const current = stateRef.current;
    const requestFingerprint = batchWorkspaceWriteFingerprint(current);
    const resolvedItemId = resolveItemId(itemId);
    const batchId = current.batch.id!;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    dispatch({ type: 'request/start', pending: 'preview' });
    try {
      const saved = await previewDocumentGenerationBatchItem(
        batchId,
        resolvedItemId,
        {
          expectedRevision: current.batch.revision ?? 0,
          replaceEditedContent,
        },
        controller.signal,
      );
      return commit(saved, requestFingerprint);
    } catch (error) {
      recordConflict(error);
      throw error;
    } finally {
      dispatch({ type: 'request/end' });
    }
  }, [commit, ensurePersisted, recordConflict, resolveItemId]);

  const reviewItem = useCallback(async (itemId: string) => {
    await ensurePersisted();
    const current = stateRef.current;
    const requestFingerprint = batchWorkspaceWriteFingerprint(current);
    const resolvedItemId = resolveItemId(itemId);
    dispatch({ type: 'request/start', pending: 'review' });
    try {
      const saved = await reviewDocumentGenerationBatchItem(
        current.batch.id!,
        resolvedItemId,
        { expectedRevision: current.batch.revision ?? 0 },
      );
      return commit(saved, requestFingerprint);
    } catch (error) {
      recordConflict(error);
      throw error;
    } finally {
      dispatch({ type: 'request/end' });
    }
  }, [commit, ensurePersisted, recordConflict, resolveItemId]);

  const saveOakDocDraft = useCallback(async (
    itemId: string,
    bytes: Uint8Array,
  ) => {
    await ensurePersisted();
    const current = stateRef.current;
    const item = current.batch.items.find(
      (entry) => entry.id === itemId || entry.key === itemId || entry.templateId === itemId,
    );
    if (!item) throw new Error('OakDoc batch item not found');
    if (!item.generatedDocumentId) {
      throw new Error('Save the batch before editing the generated Word draft');
    }
    if (!item.generatedDocumentId) {
      throw new Error('Save the batch before editing the generated Word draft');
    }
    if (!item.previewFingerprint) {
      throw new Error('Render the OakDoc preview before saving edits');
    }
    const requestFingerprint = batchWorkspaceWriteFingerprint(current);
    dispatch({ type: 'request/start', pending: 'save' });
    try {
      const saved = await saveOakDocGeneratedDraft(
        item.generatedDocumentId,
        {
          expectedBatchRevision: current.batch.revision ?? 0,
          previewFingerprint: item.previewFingerprint,
          bytes,
        },
      );
      return commit(saved, requestFingerprint);
    } catch (error) {
      recordConflict(error);
      throw error;
    } finally {
      dispatch({ type: 'request/end' });
    }
  }, [commit, ensurePersisted, recordConflict]);

  const preflight = useCallback(async () => {
    await ensurePersisted();
    const current = stateRef.current;
    const requestFingerprint = batchWorkspaceWriteFingerprint(current);
    dispatch({ type: 'request/start', pending: 'preflight' });
    try {
      const saved = await preflightDocumentGenerationBatch(
        current.batch.id!,
        { expectedRevision: current.batch.revision ?? 0 },
      );
      return commit(saved, requestFingerprint);
    } catch (error) {
      recordConflict(error);
      throw error;
    } finally {
      dispatch({ type: 'request/end' });
    }
  }, [commit, ensurePersisted, recordConflict]);

  const generate = useCallback(async () => {
    await ensurePersisted();
    const current = stateRef.current;
    const requestFingerprint = batchWorkspaceWriteFingerprint(current);
    dispatch({ type: 'request/start', pending: 'generate' });
    try {
      const result = await generateDocumentGenerationBatch(
        current.batch.id!,
        { expectedRevision: current.batch.revision ?? 0 },
      );
      if (result.batchId) {
        const refreshed = await getDocumentGenerationBatch(result.batchId);
        commit(refreshed, requestFingerprint);
      }
      return result;
    } catch (error) {
      recordConflict(error);
      throw error;
    } finally {
      dispatch({ type: 'request/end' });
    }
  }, [commit, ensurePersisted, recordConflict]);

  const retry = useCallback(async (itemId: string) => {
    await ensurePersisted();
    const current = stateRef.current;
    const requestFingerprint = batchWorkspaceWriteFingerprint(current);
    const resolvedItemId = resolveItemId(itemId);
    dispatch({ type: 'request/start', pending: 'retry' });
    try {
      const saved = await retryDocumentGenerationBatchItem(
        current.batch.id!,
        resolvedItemId,
        { expectedRevision: current.batch.revision ?? 0 },
      );
      return commit(saved, requestFingerprint);
    } catch (error) {
      recordConflict(error);
      throw error;
    } finally {
      dispatch({ type: 'request/end' });
    }
  }, [commit, ensurePersisted, recordConflict, resolveItemId]);

  const overwriteConflict = useCallback(async () => {
    const conflict = stateRef.current.conflict;
    if (conflict) {
      dispatch({ type: 'conflict/accept-revision' });
      stateRef.current = {
        ...stateRef.current,
        batch: {
          ...stateRef.current.batch,
          revision: conflict.currentRevision,
        },
        conflict: null,
      };
    }
    return persist();
  }, [persist]);

  const reload = useCallback(async () => {
    const current = stateRef.current;
    if (!current.batch.id) return current.batch;
    const saved = await getDocumentGenerationBatch(current.batch.id);
    return commit(saved);
  }, [commit]);

  return {
    state,
    dispatch,
    saveDraft,
    continueTo,
    previewItem,
    reviewItem,
    saveOakDocDraft,
    preflight,
    generate,
    retry,
    reload,
    overwriteConflict,
    navigateAway,
    requestNavigation,
    dialog,
  };
}

export type { BatchExecutionInput };
