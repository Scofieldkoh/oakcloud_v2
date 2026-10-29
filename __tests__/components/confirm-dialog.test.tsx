import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Modal, ModalBody } from '@/components/ui/modal';

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    isLoading,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    isLoading?: boolean;
    disabled?: boolean;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
  }) => (
    <button disabled={disabled || isLoading} onClick={onClick} type="button">
      {children}
    </button>
  ),
}));

describe('ConfirmDialog', () => {
  it('prevents duplicate async confirmations while a submission is in flight', async () => {
    let resolveConfirm: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        })
    );

    render(
      <ConfirmDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={onConfirm}
        title="Send Password Reset"
        confirmLabel="Send Reset Email"
      />
    );

    const confirmButton = screen.getByRole('button', { name: /send reset email/i });
    const cancelButton = screen.getByRole('button', { name: /cancel/i });

    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();

    resolveConfirm?.();

    await waitFor(() => {
      expect(confirmButton).not.toBeDisabled();
    });
  });

  it('uniquely names nested dialogs, traps tab focus, and restores focus after Escape', async () => {
    function Harness() {
      const [confirmOpen, setConfirmOpen] = useState(false);
      return (
        <Modal isOpen onClose={vi.fn()} title="Review duplicate contacts">
          <ModalBody>
            <button type="button" onClick={() => setConfirmOpen(true)}>Open merge confirmation</button>
            <ConfirmDialog
              isOpen={confirmOpen}
              onClose={() => setConfirmOpen(false)}
              onConfirm={vi.fn()}
              title="Permanently merge contacts"
              description="Only the master remains."
              confirmLabel="Permanently merge"
            />
          </ModalBody>
        </Modal>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /open merge confirmation/i });
    trigger.focus();
    fireEvent.click(trigger);

    const outer = screen.getByRole('dialog', { name: /review duplicate contacts/i });
    const inner = await screen.findByRole('dialog', { name: /permanently merge contacts/i });
    expect(outer).toBeVisible();
    expect(inner).toHaveAccessibleDescription('Only the master remains.');

    const cancel = screen.getByRole('button', { name: /cancel/i });
    const confirm = screen.getByRole('button', { name: /permanently merge/i });
    expect(inner.firstElementChild).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();

    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /permanently merge contacts/i })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: /review duplicate contacts/i })).toBeVisible();
    expect(trigger).toHaveFocus();
  });
});
