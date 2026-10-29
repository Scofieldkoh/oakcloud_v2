import type { DocumentGenerationBatchDto } from '@/types/document-generation-batch';
import {
  BATCH_STAGES,
  editableBatchFromDto,
  type BatchWorkspaceState,
  type DocumentGenerationBatchAction,
  type EditableDocumentGenerationBatch,
} from './batch-workspace-state';

export type WorkflowBatchAction =
  | DocumentGenerationBatchAction
  | { type: 'server/acknowledge-newer-local'; batch: DocumentGenerationBatchDto };

function canonicalEditableState(batch: EditableDocumentGenerationBatch): string {
  return JSON.stringify({
    primaryCompanyId: batch.primaryCompanyId,
    currentStage: batch.currentStage,
    masterFieldValues: batch.masterFieldValues,
    items: batch.items.map((item) => ({
      templateId: item.templateId,
      configuration: item.configuration,
      editedContent: item.editedContent,
      editedContentJson: item.editedContentJson,
      status: item.status,
      previewFingerprint: item.previewFingerprint,
      reviewedFingerprint: item.reviewedFingerprint,
    })),
  });
}

/**
 * Fingerprint only local request inputs. Server revisions, request pending
 * state and server diagnostics are intentionally excluded so an in-flight
 * response can tell whether user-owned state changed after dispatch.
 */
export function batchWorkspaceWriteFingerprint(state: BatchWorkspaceState): string {
  return JSON.stringify({
    stage: state.stage,
    activeItemId: state.activeItemId,
    primaryCompanyId: state.batch.primaryCompanyId,
    masterFieldValues: state.batch.masterFieldValues,
    taskContext: state.batch.taskContext,
    items: state.batch.items.map((item, index) => ({
      index,
      id: item.id,
      key: item.key,
      templateId: item.templateId,
      configuration: item.configuration,
      editedContent: item.editedContent,
      editedContentJson: item.editedContentJson,
    })),
  });
}

/**
 * Applies only server identity/revision acknowledgement when newer local edits
 * exist. Local item configuration/content/layout/review invalidation remains
 * authoritative in the browser; the echoed older payload becomes the saved
 * baseline so the reducer continues to report the newer state as dirty.
 */
export function acknowledgeBatchWithNewerLocalState(
  state: BatchWorkspaceState,
  saved: DocumentGenerationBatchDto,
): BatchWorkspaceState {
  const normalized = editableBatchFromDto(saved);
  const serverById = new Map(
    normalized.items
      .filter((item) => item.id)
      .map((item) => [item.id!, item]),
  );
  // Pair by id first; unsaved locals take the next unclaimed server item of
  // the same template, since a template can appear more than once.
  const claimed = new Set<string>();
  const pairs = state.batch.items.map((local) => {
    const byId = local.id ? serverById.get(local.id) : undefined;
    if (byId) claimed.add(byId.key);
    return byId;
  });
  state.batch.items.forEach((local, index) => {
    if (pairs[index]) return;
    const sameTemplate = normalized.items.find(
      (item) => item.templateId === local.templateId && !claimed.has(item.key),
    );
    if (!sameTemplate) return;
    claimed.add(sameTemplate.key);
    pairs[index] = sameTemplate;
  });

  const items = state.batch.items.map((local, index) => {
    const server = pairs[index];
    if (!server) return local;
    return {
      ...local,
      id: server.id ?? local.id,
      key: server.id ?? local.key,
      generatedDocumentId: server.generatedDocumentId ?? local.generatedDocumentId,
      templateVersion: server.templateVersion ?? local.templateVersion,
    };
  });

  const activeIndex = state.batch.items.findIndex((item) =>
    item.key === state.activeItemId
    || item.id === state.activeItemId
    || item.templateId === state.activeItemId,
  );
  const activeMerged = activeIndex >= 0 ? items[activeIndex] : undefined;
  const activeItemId = activeMerged?.key ?? state.activeItemId;
  const batch: EditableDocumentGenerationBatch = {
    ...state.batch,
    id: normalized.id,
    revision: normalized.revision,
    items,
    activeItemId,
  };

  return {
    ...state,
    batch,
    activeItemId,
    stage: BATCH_STAGES[Math.min(
      BATCH_STAGES.indexOf(state.stage),
      BATCH_STAGES.length - 1,
    )],
    savedSnapshot: canonicalEditableState(normalized),
    dirty: true,
    pending: null,
    conflict: null,
  };
}
