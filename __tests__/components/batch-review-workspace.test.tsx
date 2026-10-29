import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BatchReviewWorkspace,
  type BatchReviewWorkspaceProps,
} from '@/components/documents/generation-batch/batch-review-workspace';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';

function item(overrides: Partial<EditableBatchItem> = {}): EditableBatchItem {
  return {
    key: 'item-1',
    id: 'item-1',
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
    previewContent: '<p>Preview content</p>',
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: 'preview-hash',
    reviewedFingerprint: 'reviewed-hash',
    validationDiagnostics: null,
    lastError: null,
    ...overrides,
  };
}

function props(overrides: Partial<BatchReviewWorkspaceProps> = {}): BatchReviewWorkspaceProps {
  return {
    items: [item(), item({ key: 'item-2', id: 'item-2', templateName: 'KYC Checklist', reviewedFingerprint: null, status: 'NEEDS_INPUT' })],
    activeItemId: 'item-1',
    onSelect: vi.fn(),
    onPreview: vi.fn(),
    onReview: vi.fn(),
    onSaveOakDoc: vi.fn(),
    ...overrides,
  };
}

describe('BatchReviewWorkspace', () => {
  it('names the documents blocking generation and jumps to them', async () => {
    const user = userEvent.setup();
    const p = props({
      blockers: [{
        itemKey: 'item-2',
        title: 'KYC Checklist',
        reason: 'Not approved yet',
      }],
    });
    const { unmount } = render(<BatchReviewWorkspace {...p} />);
    expect(screen.getByText(/1 document not ready/i)).toBeInTheDocument();
    const reason = screen.getByText(/not approved yet/i);
    await user.click(reason.closest('button') as HTMLButtonElement);
    expect(p.onSelect).toHaveBeenCalledWith('item-2');
    unmount();
  });

  it('reports how many documents still await approval', () => {
    const { unmount } = render(<BatchReviewWorkspace {...props()} />);
    expect(screen.getByText(/1 awaiting approval/i)).toBeInTheDocument();
    unmount();
  });

  it('does not overwrite edited content when a preview becomes stale', async () => {
    const user = userEvent.setup();
    const p = props({
      items: [item({
        editedContent: '<p>manual</p>',
        previewContent: '<p>auto</p>',
        previewFingerprint: 'stale-hash',
        reviewedFingerprint: null,
      })],
    });
    const { unmount } = render(<BatchReviewWorkspace {...p} />);

    await user.click(screen.getByRole('button', { name: /refresh preview/i }));
    expect(screen.getByRole('dialog', { name: /replace manual edits/i })).toBeInTheDocument();
    expect(p.onPreview).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /replace edits/i }));
    expect(p.onPreview).toHaveBeenCalledWith('item-1', true);
    unmount();
  });

  it('shows a note instead of a preview for items on a retired A4 template', () => {
    const { container, unmount } = render(<BatchReviewWorkspace {...props()} />);
    expect(screen.getByText(/retired A4 editor/i)).toBeInTheDocument();
    expect(screen.queryByText('Preview content')).not.toBeInTheDocument();
    expect(container.querySelector('[contenteditable]')).toBeNull();
    unmount();
  });

  it('replaces approval with a locked notice once approved', () => {
    const p = props();
    const { unmount } = render(<BatchReviewWorkspace {...p} />);
    expect(screen.queryByRole('button', { name: /approve for generation/i })).not.toBeInTheDocument();
    expect(screen.getByText(/approved for generation/i)).toBeInTheDocument();
    unmount();
  });

  it('enables approving a freshly previewed document', async () => {
    const user = userEvent.setup();
    const p = props({
      items: [item({ reviewedFingerprint: null, status: 'PREVIEWED' })],
    });
    const { unmount } = render(<BatchReviewWorkspace {...p} />);
    const approve = screen.getByRole('button', { name: /approve for generation/i });
    expect(approve).toBeEnabled();
    await user.click(approve);
    expect(p.onReview).toHaveBeenCalledWith('item-1');
    unmount();
  });

  it('requires a refresh when the preview is stale', () => {
    const p = props({
      items: [item({ previewFingerprint: null, reviewedFingerprint: null, status: 'NEEDS_INPUT' })],
    });
    const { unmount } = render(<BatchReviewWorkspace {...p} />);
    expect(screen.getByRole('button', { name: /approve for generation/i })).toBeDisabled();
    unmount();
  });
});
