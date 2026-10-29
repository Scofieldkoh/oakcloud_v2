import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchableSelect } from '../searchable-select';
import { AsyncSearchSelect } from '../async-search-select';

const days = ['1', '3', '31'].map((day) => ({ value: day, label: day }));

describe('Tab after filtering to one option', () => {
  it('picks the only option left in a searchable select', () => {
    const onChange = vi.fn();
    render(<SearchableSelect options={days} value="" onChange={onChange} ariaLabel="Day" />);
    const input = screen.getByRole('combobox', { name: 'Day' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '31' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onChange).toHaveBeenCalledWith('31');
  });

  it('leaves the value alone while several options match', () => {
    const onChange = vi.fn();
    render(<SearchableSelect options={days} value="" onChange={onChange} ariaLabel="Day" />);
    const input = screen.getByRole('combobox', { name: 'Day' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('picks the only result left in an async search select', () => {
    const onChange = vi.fn();
    render(
      <AsyncSearchSelect
        label="Company"
        value=""
        options={[{ id: 'company-1', label: 'Acme Holdings' }]}
        isLoading={false}
        searchQuery="acme"
        onSearchChange={vi.fn()}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Company' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onChange).toHaveBeenCalledWith('company-1', expect.objectContaining({ label: 'Acme Holdings' }));
  });
});
