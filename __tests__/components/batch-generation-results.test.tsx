import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BatchGenerationResults,
  type BatchGenerationResultsProps,
} from '@/components/documents/generation-batch/batch-generation-results';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

function item(overrides: Partial<EditableBatchItem> = {}): EditableBatchItem {
  return {
    key: 'item-1',
    id: 'item-1',
    templateId: 'template-a',
    templateName: 'Engagement Letter',
    templateKind: 'STANDARD',
    templateVersion: 1,
    templateEngine: 'A4',
    status: 'GENERATED',
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
    generatedDocumentId: 'doc-1',
    generatedDocumentTitle: 'Engagement Letter',
    ...overrides,
  };
}

function props(overrides: Partial<BatchGenerationResultsProps> = {}): BatchGenerationResultsProps {
  return {
    items: [
      item(),
      item({
        key: 'item-2',
        id: 'item-2',
        templateName: 'Service Agreement',
        configuration: {
          ...item().configuration,
          title: 'Service Agreement',
        },
        status: 'FAILED',
        lastError: {
          itemId: 'item-2',
          code: 'GENERATION_FAILED',
          message: 'conversion failed',
          occurredAt: '2026-08-12T00:00:00.000Z',
        },
      }),
    ],
    onRetry: vi.fn(),
    ...overrides,
  };
}

describe('BatchGenerationResults', () => {
  it('preserves successful links and retries only a failed item', async () => {
    const user = userEvent.setup();
    const p = props();
    const { unmount } = render(<BatchGenerationResults {...p} />);

    expect(screen.getByRole('link', { name: /open engagement letter/i }))
      .toHaveAttribute('href', expect.stringContaining('/generated-documents/doc-1'));
    await user.click(screen.getByRole('button', { name: /retry service agreement/i }));
    expect(p.onRetry).toHaveBeenCalledWith('item-2');
    unmount();
  });

  it('shows a completed summary when every item is generated', () => {
    const { unmount } = render(<BatchGenerationResults {...props({
      items: [item(), item({ key: 'item-2', id: 'item-2', templateName: 'KYC Checklist' })],
    })} />);
    expect(screen.getByText(/batch complete/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^generated documents$/i }))
      .toHaveAttribute('href', '/generated-documents');
    unmount();
  });

  it('offers a bulk retry and a way back into the batch', async () => {
    const user = userEvent.setup();
    const onRetryAll = vi.fn();
    const onBackToBatch = vi.fn();
    const { unmount } = render(
      <BatchGenerationResults {...props({ onRetryAll, onBackToBatch })} />,
    );
    await user.click(screen.getByRole('button', { name: /retry all failed/i }));
    expect(onRetryAll).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /back to batch/i }));
    expect(onBackToBatch).toHaveBeenCalled();
    unmount();
  });

  it('offers one download for all generated documents', async () => {
    const user = userEvent.setup();
    const onDownloadAll = vi.fn();
    const { unmount } = render(
      <BatchGenerationResults {...props({ onDownloadAll })} />,
    );

    await user.click(screen.getByRole('button', { name: /download all 1 generated document/i }));

    expect(onDownloadAll).toHaveBeenCalledOnce();
    unmount();
  });

  it('explains why untouched items did not run', () => {
    const { unmount } = render(<BatchGenerationResults {...props({
      items: [item({ status: 'BLOCKED' })],
    })} />);
    expect(screen.getByText(/did not run because it was not ready/i)).toBeInTheDocument();
    unmount();
  });

  it('sends every generated document for e-signing in one envelope after confirming', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'envelope-1', signersAdded: 2, signersWithoutEmail: 0 }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<BatchGenerationResults
      items={[
        item({ generatedDocumentId: 'doc-1' }),
        item({ key: 'item-2', id: 'item-2', generatedDocumentId: 'doc-2' }),
        item({ key: 'item-3', id: 'item-3', status: 'FAILED', generatedDocumentId: 'doc-3' }),
      ]}
      onRetry={vi.fn()}
    />);
    await user.click(screen.getByRole('button', { name: 'Send all for e-signing (2)' }));
    await user.click(screen.getByRole('button', { name: 'Finalize and continue' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/esigning/envelopes/from-documents', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ generatedDocumentIds: ['doc-1', 'doc-2'], finalizeDrafts: true });
    expect(push).toHaveBeenCalledWith('/esigning/envelope-1');
    vi.unstubAllGlobals();
  });
});
