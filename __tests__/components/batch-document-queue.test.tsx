import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BatchDocumentQueue,
  type BatchDocumentQueueProps,
} from '@/components/documents/generation-batch/batch-document-queue';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';
import type { BatchItemStatus } from '@/types/document-generation-batch';

function item(status: BatchItemStatus): EditableBatchItem {
  return {
    key: 'item-1',
    id: 'item-1',
    templateId: 'template-a',
    templateName: 'Engagement Letter',
    templateKind: 'STANDARD',
    templateVersion: 1,
    templateEngine: 'A4',
    status,
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
    previewContent: null,
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: null,
    reviewedFingerprint: null,
    validationDiagnostics: status === 'FAILED'
      ? {
          itemId: 'item-1',
          status,
          errors: ['conversion failed'],
          fieldErrors: [],
        }
      : null,
    lastError: null,
  };
}

function props(status: BatchItemStatus, overrides: Partial<BatchDocumentQueueProps> = {}): BatchDocumentQueueProps {
  return {
    items: [item(status)],
    activeItemId: null,
    onSelect: vi.fn(),
    ...overrides,
  };
}

describe('BatchDocumentQueue', () => {
  it.each([
    ['NEEDS_INPUT', 'Needs input'],
    ['PREVIEWED', 'Awaiting review'],
    ['READY', 'Ready'],
    ['GENERATING', 'Generating'],
    ['GENERATED', 'Generated'],
    ['FAILED', 'Failed'],
    ['BLOCKED', 'Blocked'],
  ] as const)('renders the %s queue status and activates the selected document', async (status, label) => {
    const user = userEvent.setup();
    const p = props(status);
    const { unmount } = render(<BatchDocumentQueue {...p} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /engagement letter/i }));
    expect(p.onSelect).toHaveBeenCalledWith('item-1');
    unmount();
  });

  it('shows persisted error counts for failed items', () => {
    render(<BatchDocumentQueue {...props('FAILED')} />);
    expect(screen.getByText('1 error')).toBeInTheDocument();
  });

  it('reports derived completeness instead of action-derived status', () => {
    render(<BatchDocumentQueue {...props('NOT_STARTED', {
      completeness: {
        'item-1': {
          requiredTotal: 3,
          requiredFilled: 1,
          missing: [
            { id: 'field:a', label: 'A' },
            { id: 'field:b', label: 'B' },
          ],
          isComplete: false,
        },
      },
    })} />);
    expect(screen.getByText('1/3 fields')).toBeInTheDocument();
    expect(screen.getByText('1 need input')).toBeInTheDocument();
  });

  it('highlights approved documents in review mode', () => {
    const reviewed = { ...item('READY'), reviewedFingerprint: 'reviewed-hash' };
    render(<BatchDocumentQueue {...props('READY', {
      items: [reviewed],
      mode: 'review',
    })} />);
    const button = screen.getByRole('button', { name: /engagement letter/i });
    expect(button.className).toContain('bg-status-success/5');
    expect(screen.getByText('All complete')).toBeInTheDocument();
  });

  it('offers a jump to the next incomplete document', async () => {
    const user = userEvent.setup();
    const onNextIncomplete = vi.fn();
    render(<BatchDocumentQueue {...props('NOT_STARTED', {
      completeness: {
        'item-1': {
          requiredTotal: 1,
          requiredFilled: 0,
          missing: [{ id: 'title', label: 'Document title' }],
          isComplete: false,
        },
      },
      onNextIncomplete,
    })} />);
    await user.click(screen.getByRole('button', { name: /next incomplete/i }));
    expect(onNextIncomplete).toHaveBeenCalled();
  });
});
