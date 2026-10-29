import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDeleteDialog } from '@/components/documents/document-delete-dialog';

describe('DocumentDeleteDialog', () => {
  it('moves documents to the Recycle Bin with no permanent-delete option', async () => {
    const onConfirm = vi.fn();
    render(<DocumentDeleteDialog isOpen onClose={vi.fn()} onConfirm={onConfirm} count={3} />);

    expect(screen.queryByText(/Delete permanently/i)).not.toBeInTheDocument();
    expect(screen.getByText(/moved to the Recycle Bin/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/reason for deleting these documents/i), {
      target: { value: 'Generated in error' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete 3 Documents' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Generated in error'));
  });
});
