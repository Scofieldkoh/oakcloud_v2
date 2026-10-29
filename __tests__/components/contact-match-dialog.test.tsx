import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContactMatchDialog } from '@/components/contacts/contact-match-dialog';
import type { ContactMatchResult } from '@/types/contact-identity';

const match: ContactMatchResult = {
  contactId: '11111111-1111-4111-8111-111111111111',
  score: 100,
  automatic: true,
  blockedByIdentifierConflict: false,
  reasons: ['EXACT_CANONICAL_NAME'],
  conflicts: [],
};

describe('ContactMatchDialog', () => {
  it('offers use-existing and create-separate actions', () => {
    render(
      <ContactMatchDialog
        match={match}
        open
        onUseExisting={vi.fn()}
        onCreateSeparate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /use existing/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /create separate/i })).toBeVisible();
  });

  it('requires a ten-character reason before creating separately', () => {
    const createSeparate = vi.fn();
    render(
      <ContactMatchDialog
        match={match}
        open
        onUseExisting={vi.fn()}
        onCreateSeparate={createSeparate}
        onClose={vi.fn()}
      />
    );

    const separateButton = screen.getByRole('button', { name: /create separate/i });
    expect(separateButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Different person with the same name' } });
    expect(separateButton).toBeEnabled();
    fireEvent.click(separateButton);
    expect(createSeparate).toHaveBeenCalledWith('Different person with the same name');
  });

  it('blocks use-existing when strong identifiers conflict', () => {
    render(
      <ContactMatchDialog
        match={{ ...match, blockedByIdentifierConflict: true }}
        open
        onUseExisting={vi.fn()}
        onCreateSeparate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /use existing/i })).toBeDisabled();
    expect(screen.getByText(/identifier conflict/i)).toBeVisible();
  });

  it('delegates close through the accessible modal control', () => {
    const close = vi.fn();
    render(
      <ContactMatchDialog match={match} open onUseExisting={vi.fn()} onCreateSeparate={vi.fn()} onClose={close} />
    );
    fireEvent.click(screen.getByRole('button', { name: /close modal/i }));
    expect(close).toHaveBeenCalledOnce();
  });
});
