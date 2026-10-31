import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EsigningFieldInputModal } from '@/components/esigning/signing/esigning-field-input-modal';
import type { EsigningFieldDefinitionDto } from '@/types/esigning';

function field(type: EsigningFieldDefinitionDto['type']): EsigningFieldDefinitionDto {
  return {
    id: 'field-1',
    documentId: 'document-1',
    recipientId: 'recipient-1',
    type,
    pageNumber: 1,
    xPercent: 10,
    yPercent: 10,
    widthPercent: 30,
    heightPercent: 5,
    required: true,
    label: null,
    placeholder: null,
    sortOrder: 1,
  };
}

function renderModal(type: EsigningFieldDefinitionDto['type'], onSave = vi.fn()) {
  render(
    <EsigningFieldInputModal
      field={field(type)}
      isOpen
      initialValue={null}
      onClose={vi.fn()}
      onSave={onSave}
    />
  );
  return onSave;
}

describe('EsigningFieldInputModal unsupported characters', () => {
  it.each(['NAME', 'TEXT'] as const)('accepts Chinese and Vietnamese in a %s field', async (type) => {
    const onSave = renderModal(type);
    await userEvent.type(screen.getByRole('textbox'), 'Nguyễn 陈伟明');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('Nguyễn 陈伟明');
  });

  it.each(['NAME', 'TEXT'] as const)('explains an unsupported character in a %s field and blocks Save', async (type) => {
    const onSave = renderModal(type);
    await userEvent.type(screen.getByRole('textbox'), 'Wei 😀');

    expect(screen.getByText(/cannot be printed on the signed document: "😀" \(U\+1F600\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('lets the signer clear an unsupported value', async () => {
    const onSave = renderModal('TEXT');
    await userEvent.type(screen.getByRole('textbox'), '😀');
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSave).toHaveBeenCalledWith(null);
  });
});
