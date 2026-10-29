import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FieldGeneralTab } from '@/components/forms/field-general-tab';
import { defaultField, toPayloadFields, type BuilderField } from '@/components/forms/builder-utils';

const SSIC_ID = '11111111-1111-4111-8111-111111111111';
const SSIC_OPTIONS = [
  { value: '01111', label: '01111 - Growing vegetables' },
  { value: '62011', label: '62011 - Software development' },
  { value: 'internal-code', label: 'Visible label only' },
];

vi.mock('@/hooks/use-form-option-presets', () => ({
  useFormOptionPresets: () => ({
    data: [{
      id: SSIC_ID,
      name: 'SSIC 2025',
      builtInKey: 'ssic',
      isProtected: true,
      allowCsvReplace: true,
      optionCount: 3,
      updatedAt: '2026-08-01T00:00:00.000Z',
      _count: { fields: 0 },
      options: SSIC_OPTIONS,
    }],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <div />,
}));

function Harness() {
  const [field, setField] = useState<BuilderField>(() => defaultField('DROPDOWN', 0));
  return (
    <>
      <FieldGeneralTab field={field} onChange={setField} />
      <output data-testid="field-state">{JSON.stringify(field)}</output>
    </>
  );
}

describe('dropdown preset editor', () => {
  it('serializes linked dropdowns with the preset reference and no embedded options', () => {
    const field = {
      ...defaultField('DROPDOWN', 0),
      optionPresetId: SSIC_ID,
      options: SSIC_OPTIONS,
    };

    expect(toPayloadFields([field])[0]).toMatchObject({
      optionPresetId: SSIC_ID,
      options: null,
    });
  });

  it('links a selected preset and copies resolved options when switching back to Custom options', () => {
    render(<Harness />);
    const select = screen.getByLabelText('Preset list');

    fireEvent.change(select, { target: { value: SSIC_ID } });
    expect(JSON.parse(screen.getByTestId('field-state').textContent || '{}')).toMatchObject({
      optionPresetId: SSIC_ID,
      options: SSIC_OPTIONS,
    });

    fireEvent.change(select, { target: { value: 'custom' } });
    expect(JSON.parse(screen.getByTestId('field-state').textContent || '{}')).toMatchObject({
      optionPresetId: null,
      options: SSIC_OPTIONS,
    });
  });

  it('shows linked preset labels in a read-only list that becomes editable for Custom options', () => {
    render(<Harness />);
    const select = screen.getByLabelText('Preset list');

    fireEvent.change(select, { target: { value: SSIC_ID } });

    const linkedOptions = screen.getByRole('textbox', { name: 'Options' });
    expect(linkedOptions).toHaveValue(
      '01111 - Growing vegetables\n62011 - Software development\nVisible label only',
    );
    expect(linkedOptions).toHaveAttribute('readonly');
    expect(linkedOptions).not.toHaveValue(expect.stringContaining('internal-code'));

    fireEvent.change(select, { target: { value: 'custom' } });

    const customOptions = screen.getByRole('textbox', { name: 'Options' });
    expect(customOptions).not.toHaveAttribute('readonly');
    expect(customOptions).toHaveValue(
      '01111 - Growing vegetables\n62011 - Software development\nVisible label only',
    );
  });
});
