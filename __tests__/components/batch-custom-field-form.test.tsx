import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  BatchCustomFieldForm,
  type BatchCustomFieldFormProps,
} from '@/components/documents/generation-batch/batch-custom-field-form';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';

// The real select positions its popover from layout, which jsdom lacks.
vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: ({ ariaLabel, options, value, onChange }: {
    ariaLabel?: string;
    options: Array<{ value: string; label: string }>;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose...</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

function item(): EditableBatchItem {
  return {
    key: 'item-1',
    id: 'item-1',
    templateId: 'template-a',
    templateName: 'Engagement Letter',
    templateKind: 'STANDARD',
    templateVersion: 1,
    templateEngine: 'A4',
    status: 'NEEDS_INPUT',
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
    validationDiagnostics: null,
    lastError: null,
  };
}

const fields: CustomPlaceholderDefinition[] = [
  {
    id: 'signature_date',
    key: 'signature_date',
    label: 'Signature date',
    type: 'date',
    required: true,
  },
  {
    id: 'reference',
    key: 'reference',
    label: 'Reference',
    type: 'text',
    required: false,
  },
];

function props(overrides: Partial<BatchCustomFieldFormProps> = {}): BatchCustomFieldFormProps {
  return {
    item: item(),
    fields,
    onPatch: vi.fn(),
    ...overrides,
  };
}

describe('BatchCustomFieldForm', () => {
  it('renders date fields with the reusable single date selector', () => {
    const p = props();
    const { unmount } = render(<BatchCustomFieldForm {...p} />);

    const dateInput = screen.getByLabelText('Signature date');
    expect(dateInput).toBeInTheDocument();
    expect(dateInput).toHaveAttribute('placeholder', 'dd mmm yyyy');
    expect(screen.getByRole('button', { name: 'Open calendar' })).toBeInTheDocument();

    fireEvent.change(dateInput, { target: { value: '2026-12-01' } });
    expect(p.onPatch).toHaveBeenCalledWith({
      itemValues: { signature_date: '2026-12-01' },
    });
    unmount();
  });

  it('keeps non-date fields as plain text inputs', () => {
    const p = props();
    const { unmount } = render(<BatchCustomFieldForm {...p} />);

    const textInput = screen.getByLabelText('Reference');
    expect(textInput.tagName).toBe('INPUT');
    expect(textInput).toHaveAttribute('type', 'text');

    fireEvent.change(textInput, { target: { value: 'REF-1' } });
    expect(p.onPatch).toHaveBeenCalledWith({
      itemValues: { reference: 'REF-1' },
    });
    unmount();
  });

  it('offers a Contact field\'s shortlist by name and stores the chosen contact', () => {
    const p = props({
      fields: [{
        id: 'secretary',
        key: 'secretary',
        label: 'Secretary',
        type: 'text',
        required: true,
        storageDefinition: {
          key: 'custom.secretary',
          fieldKind: 'contact',
          options: [{ value: 'c-1', label: 'Tan Wei Jie' }, { value: 'c-2', label: 'Lim Mei Ling' }],
        },
      }],
    });
    const { unmount } = render(<BatchCustomFieldForm {...p} />);

    expect(screen.getByRole('option', { name: 'Lim Mei Ling' })).toHaveValue('c-2');
    fireEvent.change(screen.getByRole('combobox', { name: 'Secretary' }), { target: { value: 'c-2' } });
    expect(p.onPatch).toHaveBeenCalledWith({ itemValues: { secretary: 'c-2' } });
    unmount();
  });
});
