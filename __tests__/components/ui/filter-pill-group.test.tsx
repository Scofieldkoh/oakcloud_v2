import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterPillGroup } from '@/components/ui/filter-pill';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('FilterPillGroup', () => {
  it('hides "Deselect all" when every option is selected and an empty selection is not allowed', () => {
    render(<FilterPillGroup label="Status" options={options} value={['a', 'b', 'c']} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Deselect all' })).not.toBeInTheDocument();
  });

  it('clears the selection with "Deselect all" when an empty selection is allowed', async () => {
    const onChange = vi.fn();
    render(<FilterPillGroup label="Status" options={options} value={['a', 'b', 'c']} onChange={onChange} allowEmpty />);
    await userEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('selects every option with "Select all" and keeps the last pill selected', async () => {
    const onChange = vi.fn();
    render(<FilterPillGroup label="Status" options={options} value={['a']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(onChange).toHaveBeenCalledWith(['a', 'b', 'c']);

    onChange.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Alpha', pressed: true }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
