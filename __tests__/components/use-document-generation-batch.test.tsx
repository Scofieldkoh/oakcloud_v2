import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useDocumentGenerationBatch,
} from '@/components/documents/generation-batch/use-document-generation-batch';

const apiMock = vi.hoisted(() => ({
  createDocumentGenerationBatch: vi.fn(),
  saveDocumentGenerationBatch: vi.fn(),
  getDocumentGenerationBatch: vi.fn(),
  previewDocumentGenerationBatchItem: vi.fn(),
  reviewDocumentGenerationBatchItem: vi.fn(),
  preflightDocumentGenerationBatch: vi.fn(),
  generateDocumentGenerationBatch: vi.fn(),
  retryDocumentGenerationBatchItem: vi.fn(),
}));

vi.mock('@/lib/document-generation-batch-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/document-generation-batch-api')>()),
  ...apiMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

import type {
  EditableDocumentGenerationBatch,
} from '@/components/documents/generation-batch/batch-workspace-state';
import { DocumentGenerationBatchApiError } from '@/lib/document-generation-batch-api';

const serverBatch: EditableDocumentGenerationBatch = {
  id: 'batch-1',
  primaryCompanyId: 'company-1',
  activeItemId: 'item-a',
  currentStage: 3,
  revision: 2,
  status: 'DRAFT',
  masterFieldValues: {},
  masterFields: { fields: [], conflicts: [] },
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
  items: [{
    key: 'item-a',
    id: 'item-a',
    templateId: 'template-a',
    templateName: 'Engagement Letter',
    templateKind: 'STANDARD',
    templateVersion: 1,
    templateEngine: 'A4',
    status: 'READY',
    configuration: {
      version: 1,
      title: 'Engagement Letter',
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {},
      masterOverrides: {},
      useLetterhead: true,
      serviceAgreement: null,
    },
    previewContent: '<p>x</p>',
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: 'p',
    reviewedFingerprint: 'r',
    validationDiagnostics: null,
    lastError: null,
    generatedDocumentId: 'child-1',
  }],
};

const localDraft: EditableDocumentGenerationBatch = {
  ...serverBatch,
  id: undefined,
  revision: undefined,
  items: serverBatch.items.map(({ id: _id, ...item }) => ({ ...item, id: undefined })),
};

describe('useDocumentGenerationBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.createDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 0 });
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 1 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates then saves on the first explicit save and replaces state', async () => {
    apiMock.createDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 0 });
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 1 });
    const { result } = renderHook(() => useDocumentGenerationBatch({ initialBatch: localDraft }));

    await act(async () => {
      await result.current.saveDraft();
    });

    expect(apiMock.createDocumentGenerationBatch).toHaveBeenCalledWith({
      items: expect.any(Array),
    });
    expect(apiMock.saveDocumentGenerationBatch).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ expectedRevision: 0 }),
    );
    expect(result.current.state.batch.id).toBe('batch-1');
    expect(result.current.state.dirty).toBe(false);
  });

  it('adopts server-assigned item ids and active item on the first save', async () => {
    apiMock.createDocumentGenerationBatch.mockResolvedValue({
      ...serverBatch,
      revision: 0,
      activeItemId: 'item-server',
      items: [{ ...serverBatch.items[0], id: 'item-server', key: 'item-server' }],
    });
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({
      ...serverBatch,
      revision: 1,
      activeItemId: 'item-server',
      items: [{ ...serverBatch.items[0], id: 'item-server', key: 'item-server' }],
    });
    const { result } = renderHook(() => useDocumentGenerationBatch({ initialBatch: localDraft }));

    await act(async () => {
      await result.current.saveDraft();
    });

    const [, updateInput] = apiMock.saveDocumentGenerationBatch.mock.calls[0];
    expect(updateInput.activeItemId).toBe('item-server');
    expect(updateInput.items[0]).toMatchObject({ id: 'item-server', templateId: 'template-a' });
  });

  it('sends task context on create so generation can link outcomes', async () => {
    const withTaskContext: EditableDocumentGenerationBatch = {
      ...localDraft,
      taskContext: { taskId: 'task-1', taskStageId: 'stage-1' },
    };
    apiMock.createDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 0 });
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 1 });
    const { result } = renderHook(() => useDocumentGenerationBatch({ initialBatch: withTaskContext }));

    await act(async () => {
      await result.current.saveDraft();
    });

    expect(apiMock.createDocumentGenerationBatch).toHaveBeenCalledWith(
      expect.objectContaining({ taskContext: { taskId: 'task-1', taskStageId: 'stage-1' } }),
    );
  });

  it('keeps local edits and exposes the current revision on 409', async () => {
    apiMock.createDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 0 });
    apiMock.saveDocumentGenerationBatch.mockRejectedValue(
      new Error('409') as never,
    );
    const conflict = new DocumentGenerationBatchApiError(
      'Batch changed',
      409,
      { currentRevision: 9 },
    );
    apiMock.saveDocumentGenerationBatch.mockRejectedValueOnce(conflict);

    const { result } = renderHook(() => useDocumentGenerationBatch({ initialBatch: localDraft }));
    await act(async () => {
      await result.current.saveDraft().catch(() => undefined);
    });

    expect(result.current.state.conflict).toEqual({ currentRevision: 9 });
    expect(result.current.state.dirty).toBe(true);
  });

  it('previews an item only after persisting', async () => {
    apiMock.createDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 0 });
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 1 });
    apiMock.previewDocumentGenerationBatchItem.mockResolvedValue({
      ...serverBatch,
      revision: 2,
    });
    const { result } = renderHook(() => useDocumentGenerationBatch({ initialBatch: localDraft }));

    await act(async () => {
      await result.current.previewItem('item-a');
    });

    expect(apiMock.saveDocumentGenerationBatch).toHaveBeenCalled();
    expect(apiMock.previewDocumentGenerationBatchItem).toHaveBeenCalledWith(
      'batch-1',
      'item-a',
      { expectedRevision: 1, replaceEditedContent: false },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(result.current.state.pending).toBeNull());
  });

  it('keeps the selected item active when its preview response defaults to the first item', async () => {
    const secondItem = {
      ...serverBatch.items[0],
      key: 'item-b',
      id: 'item-b',
      templateId: 'template-b',
      templateName: 'Service Agreement',
      generatedDocumentId: 'child-2',
    };
    const twoItemBatch: EditableDocumentGenerationBatch = {
      ...serverBatch,
      items: [serverBatch.items[0], secondItem],
      activeItemId: 'item-a',
    };
    apiMock.previewDocumentGenerationBatchItem.mockResolvedValue({
      ...twoItemBatch,
      revision: 3,
      activeItemId: 'item-a',
    });
    const { result } = renderHook(() => useDocumentGenerationBatch({
      initialBatch: twoItemBatch,
    }));

    act(() => {
      result.current.dispatch({ type: 'item/activate', itemId: 'item-b' });
    });

    await act(async () => {
      await result.current.previewItem('item-b');
    });

    expect(result.current.state.activeItemId).toBe('item-b');
    expect(result.current.state.batch.activeItemId).toBe('item-b');
  });

  it('resolves the server item id when previewing right after the first save', async () => {
    apiMock.createDocumentGenerationBatch.mockResolvedValue({
      ...serverBatch,
      revision: 0,
      activeItemId: 'item-server',
      items: [{ ...serverBatch.items[0], id: 'item-server', key: 'item-server' }],
    });
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({
      ...serverBatch,
      revision: 1,
      activeItemId: 'item-server',
      items: [{ ...serverBatch.items[0], id: 'item-server', key: 'item-server' }],
    });
    apiMock.previewDocumentGenerationBatchItem.mockResolvedValue({
      ...serverBatch,
      revision: 2,
      activeItemId: 'item-server',
      items: [{ ...serverBatch.items[0], id: 'item-server', key: 'item-server' }],
    });
    const { result } = renderHook(() => useDocumentGenerationBatch({ initialBatch: localDraft }));

    await act(async () => {
      await result.current.previewItem('template-a');
    });

    expect(apiMock.previewDocumentGenerationBatchItem).toHaveBeenCalledWith(
      'batch-1',
      'item-server',
      { expectedRevision: 1, replaceEditedContent: false },
      expect.any(AbortSignal),
    );
  });

  it('keeps generation results visible after partial execution', async () => {
    apiMock.createDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 0 });
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 1 });
    apiMock.generateDocumentGenerationBatch.mockResolvedValue({
      batchId: 'batch-1',
      revision: 2,
      batchStatus: 'PARTIAL',
      successes: [{ itemId: 'item-a', documentId: 'child-1', title: 'Engagement Letter' }],
      failures: [],
    });
    apiMock.getDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 2 });
    const { result } = renderHook(() => useDocumentGenerationBatch({ initialBatch: localDraft }));

    let generationResult: Awaited<ReturnType<typeof result.current.generate>> | undefined;
    await act(async () => {
      generationResult = await result.current.generate();
    });

    expect(generationResult?.batchStatus).toBe('PARTIAL');
    expect(result.current.state.batch.revision).toBe(2);
  });

  it('persists a pending stage change before previewing so review is not reset', async () => {
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 1 });
    apiMock.previewDocumentGenerationBatchItem.mockResolvedValue({ ...serverBatch, revision: 2 });
    const configured: EditableDocumentGenerationBatch = {
      ...serverBatch,
      currentStage: 2,
    };
    const { result } = renderHook(() => useDocumentGenerationBatch({ initialBatch: configured }));

    act(() => {
      result.current.dispatch({ type: 'stage/navigate', stage: 'review-generate' });
    });

    await act(async () => {
      await result.current.previewItem('item-a');
    });

    expect(apiMock.saveDocumentGenerationBatch).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ currentStage: 3 }),
    );
    expect(result.current.state.stage).toBe('review-generate');
  });

  it('persists the target stage when continuing to the next stage', async () => {
    apiMock.saveDocumentGenerationBatch.mockResolvedValue({ ...serverBatch, revision: 3 });
    const configured: EditableDocumentGenerationBatch = {
      ...serverBatch,
      currentStage: 2,
    };
    const { result } = renderHook(() => useDocumentGenerationBatch({ initialBatch: configured }));

    await act(async () => {
      await result.current.continueTo('review-generate');
    });

    expect(apiMock.saveDocumentGenerationBatch).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ currentStage: 3 }),
    );
    expect(result.current.state.stage).toBe('review-generate');
  });
});
