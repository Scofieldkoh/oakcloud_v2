import { describe, expect, it } from 'vitest';
import {
  acknowledgeBatchWithNewerLocalState,
  batchWorkspaceWriteFingerprint,
} from '@/components/documents/generation-batch/batch-workflow-ack';
import {
  createInitialBatchWorkspaceState,
  defaultItemConfiguration,
  type EditableDocumentGenerationBatch,
} from '@/components/documents/generation-batch/batch-workspace-state';
import type {
  DocumentGenerationBatchDto,
  DocumentGenerationBatchItemDto,
} from '@/types/document-generation-batch';

const masterFields = { fields: [], conflicts: [] };

function dtoItem(
  id: string,
  templateId: string,
  editedContent: string | null,
  editedContentJson: unknown | null,
): DocumentGenerationBatchItemDto {
  return {
    id,
    templateId,
    templateName: `Template ${templateId}`,
    templateKind: 'STANDARD',
    templateVersion: 3,
    templateEngine: 'A4',
    displayOrder: 0,
    status: 'PREVIEWED',
    configuration: defaultItemConfiguration(`Template ${templateId}`),
    previewContent: `<p>preview ${templateId}</p>`,
    editedContent,
    editedContentJson,
    previewFingerprint: `preview-${templateId}`,
    reviewedFingerprint: null,
    validationDiagnostics: null,
    lastError: null,
    generatedDocumentId: `document-${templateId}`,
    generatedDocumentTitle: `Document ${templateId}`,
    serviceAgreement: null,
  };
}

function dto(
  revision: number,
  items: DocumentGenerationBatchItemDto[],
  activeItemId: string | null = items[0]?.id ?? null,
): DocumentGenerationBatchDto {
  return {
    id: 'batch-1',
    primaryCompanyId: null,
    company: null,
    activeItemId,
    currentStage: 3,
    revision,
    status: 'DRAFT',
    masterFieldValues: {},
    masterFields,
    taskContext: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
    items,
  };
}

function editable(): EditableDocumentGenerationBatch {
  return {
    id: 'batch-1',
    primaryCompanyId: null,
    activeItemId: 'local-a',
    currentStage: 3,
    revision: 4,
    status: 'DRAFT',
    masterFieldValues: {},
    masterFields,
    taskContext: null,
    items: [
      {
        key: 'local-a',
        templateId: 'template-a',
        templateName: 'Template A',
        templateKind: 'STANDARD',
        templateVersion: 2,
        templateEngine: 'A4',
        status: 'PREVIEWED',
        configuration: defaultItemConfiguration('Template A'),
        previewContent: '<p>A preview</p>',
        editedContent: '<p>A local newer edit</p>',
        editedContentJson: {
          version: 1,
          marker: 'a-local',
          layout: { version: 1, fontFamily: 'Arial', fontSize: '12pt', lineHeight: 1.5, paragraphSpacing: '0.5em', marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
        },
        previewFingerprint: 'preview-a',
        reviewedFingerprint: null,
        validationDiagnostics: null,
        lastError: null,
      },
      {
        key: 'local-b',
        templateId: 'template-b',
        templateName: 'Template B',
        templateKind: 'STANDARD',
        templateVersion: 2,
        templateEngine: 'A4',
        status: 'PREVIEWED',
        configuration: defaultItemConfiguration('Template B'),
        previewContent: '<p>B preview</p>',
        editedContent: '<p>B local edit</p>',
        editedContentJson: {
          version: 1,
          marker: 'b-local',
          layout: { version: 1, fontFamily: 'Calibri', fontSize: '11pt', lineHeight: 1.4, paragraphSpacing: '0.4em', marginsMm: { top: 20, right: 20, bottom: 20, left: 20 } },
        },
        previewFingerprint: 'preview-b',
        reviewedFingerprint: null,
        validationDiagnostics: null,
        lastError: null,
      },
    ],
  };
}

describe('WORKFLOW W2 batch acknowledgements', () => {
  it('fingerprints local write inputs but ignores server-only request state', () => {
    const state = createInitialBatchWorkspaceState(editable());
    const base = batchWorkspaceWriteFingerprint(state);
    expect(batchWorkspaceWriteFingerprint({
      ...state,
      pending: 'save',
      batch: { ...state.batch, revision: 99 },
    })).toBe(base);
    expect(batchWorkspaceWriteFingerprint({
      ...state,
      batch: {
        ...state.batch,
        items: state.batch.items.map((item, index) => index === 0
          ? { ...item, editedContent: '<p>newer</p>' }
          : item),
      },
    })).not.toBe(base);
  });

  it('advances server identity/revision without replacing newer local content or layout', () => {
    const state = {
      ...createInitialBatchWorkspaceState(editable()),
      dirty: true,
      pending: 'save' as const,
    };
    const server = dto(5, [
      dtoItem('server-a', 'template-a', '<p>A older saved edit</p>', { version: 1, marker: 'a-server' }),
      dtoItem('server-b', 'template-b', '<p>B older saved edit</p>', { version: 1, marker: 'b-server' }),
    ], 'server-a');

    const next = acknowledgeBatchWithNewerLocalState(state, server);
    expect(next.batch.revision).toBe(5);
    expect(next.batch.items[0].id).toBe('server-a');
    expect(next.batch.items[0].key).toBe('server-a');
    expect(next.batch.items[0].editedContent).toBe('<p>A local newer edit</p>');
    expect(next.batch.items[0].editedContentJson).toMatchObject({ marker: 'a-local' });
    expect(next.batch.items[1].editedContentJson).toMatchObject({ marker: 'b-local' });
    expect(next.activeItemId).toBe('server-a');
    expect(next.dirty).toBe(true);
    expect(next.pending).toBeNull();
  });

  it('keeps document A and B layout/history state isolated across server ID assignment', () => {
    const state = createInitialBatchWorkspaceState(editable());
    const server = dto(5, [
      dtoItem('server-a', 'template-a', null, null),
      dtoItem('server-b', 'template-b', null, null),
    ]);
    const next = acknowledgeBatchWithNewerLocalState(state, server);

    expect(next.batch.items[0].editedContentJson).not.toEqual(next.batch.items[1].editedContentJson);
    expect(next.batch.items[0].editedContentJson).toMatchObject({ marker: 'a-local' });
    expect(next.batch.items[1].editedContentJson).toMatchObject({ marker: 'b-local' });
    expect(next.batch.items.map((item) => item.key)).toEqual(['server-a', 'server-b']);
  });
});
