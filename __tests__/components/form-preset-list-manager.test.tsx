import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/hooks/use-form-option-presets', () => ({
  useFormOptionPresets: () => ({
    data: [
      {
        id: 'countries-id', name: 'Countries', builtInKey: 'countries', isProtected: true,
        allowCsvReplace: false, optionCount: 244, updatedAt: '2026-08-01T00:00:00.000Z',
        _count: { fields: 3 }, options: [],
      },
      {
        id: 'ssic-id', name: 'SSIC 2025', builtInKey: 'ssic', isProtected: true,
        allowCsvReplace: true, optionCount: 988, updatedAt: '2026-08-01T00:00:00.000Z',
        _count: { fields: 1 }, options: [],
      },
      {
        id: 'clients-id', name: 'Clients', builtInKey: null, isProtected: false,
        allowCsvReplace: true, optionCount: 2, updatedAt: '2026-08-01T00:00:00.000Z',
        _count: { fields: 2 }, options: [],
      },
    ],
    isLoading: false,
    error: null,
  }),
  usePreviewFormOptionPresetCsv: () => ({ mutateAsync: mocks.preview, isPending: false }),
  useCreateFormOptionPreset: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateFormOptionPreset: () => ({ mutateAsync: mocks.update, isPending: false }),
  useDeleteFormOptionPreset: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error }),
}));

import { PresetListManager } from '@/components/forms/preset-list-manager';

describe('PresetListManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preview.mockResolvedValue({
      detectedColumns: ['value', 'label'], totalRows: 2, validRows: 2, rejectedRows: 0,
      errors: [], sample: [{ value: 'A', label: 'Agriculture' }, { value: 'B', label: 'Banking' }],
    });
    mocks.update.mockResolvedValue({ id: 'ssic-id' });
    mocks.remove.mockResolvedValue({ id: 'clients-id' });
  });

  it('shows protected, replaceable, and in-use states compactly', () => {
    render(<PresetListManager isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Preset lists' })).toBeVisible();
    expect(screen.getByText('SSIC 2025')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete Countries' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update SSIC 2025 CSV' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete Clients' })).toBeDisabled();
    expect(screen.getByText('Used by 2 fields')).toBeVisible();
  });

  it('downloads an upload-ready CSV template and explains optional values', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:preset-list-template');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<PresetListManager isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create preset list' }));

    expect(screen.getByText(/label is required and is the text shown in the dropdown/i)).toBeVisible();
    expect(screen.getByText(/value is optional and is the unique stored or submitted value/i)).toBeVisible();
    expect(screen.getByText(/if omitted, the label is used as the value/i)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV template' }));

    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('preset-list-template.csv');
    expect(anchor.href).toBe('blob:preset-list-template');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preset-list-template');

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result)));
      reader.addEventListener('error', () => reject(reader.error));
      reader.readAsText(blob);
    });
    expect(csv).toBe('value,label\r\nSG,Singapore\r\nMY,Malaysia\r\n');
  });

  it('previews counts and sample rows before confirming an atomic replacement', async () => {
    render(<PresetListManager isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Update SSIC 2025 CSV' }));
    const file = new File(['value,label\nA,Agriculture\nB,Banking'], 'ssic.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('value,label\nA,Agriculture\nB,Banking') });
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });

    expect(await screen.findByText('2 valid rows')).toBeVisible();
    expect(screen.getByText('A')).toBeVisible();
    expect(screen.getByText('Agriculture')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Save replacement' }));
    expect(screen.getByRole('dialog', { name: 'Replace preset list?' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Replace list' }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({
        id: 'ssic-id', csv: 'value,label\nA,Agriculture\nB,Banking',
      }));
  });

  it('shows row-numbered validation errors and keeps save disabled', async () => {
    mocks.preview.mockResolvedValueOnce({
      detectedColumns: ['value', 'label'], totalRows: 2, validRows: 1, rejectedRows: 1,
      errors: [{ row: 3, column: 'value', code: 'duplicate_value', message: 'Duplicate value: A' }],
      sample: [{ value: 'A', label: 'Agriculture' }],
    });
    render(<PresetListManager isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create preset list' }));
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Industries' } });
    const file = new File(['duplicate'], 'invalid.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('duplicate') });
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });

    expect(await screen.findByText('Row 3 · value: Duplicate value: A')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create list' })).toBeDisabled();
  });
});
