import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from '@/components/ui/date-picker';

describe('DatePicker', () => {
  it('keeps range inputs text-only without opening field calendars', () => {
    render(<DatePicker onChange={vi.fn()} defaultTab="range" />);

    fireEvent.click(screen.getByText('Select date'));

    expect(screen.queryByRole('button', { name: 'Open calendar for From' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open calendar for To' })).not.toBeInTheDocument();

    fireEvent.focus(screen.getByLabelText('From'));
    expect(document.querySelector('[data-single-date-popover]')).not.toBeInTheDocument();
  });

  it('allows valid From and To dates to be typed and applied from the range footer', () => {
    const onChange = vi.fn();
    render(<DatePicker onChange={onChange} defaultTab="range" />);

    fireEvent.click(screen.getByText('Select date'));

    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    fireEvent.focus(from);
    fireEvent.change(from, { target: { value: '2026-08-10' } });
    fireEvent.keyDown(from, { key: 'Enter' });
    fireEvent.focus(to);
    fireEvent.change(to, { target: { value: '20/08/2026' } });
    fireEvent.keyDown(to, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'range',
      range: {
        from: expect.any(Date),
        to: expect.any(Date),
      },
    });
    const applied = onChange.mock.lastCall?.[0];
    expect(applied.range.from).toEqual(new Date(2026, 7, 10));
    expect(applied.range.to).toEqual(new Date(2026, 7, 20));
  });

  it('shows the same invalid-date validation when a typed range date is committed', () => {
    const onChange = vi.fn();
    render(<DatePicker onChange={onChange} defaultTab="range" />);

    fireEvent.click(screen.getByText('Select date'));
    const from = screen.getByLabelText('From');
    fireEvent.focus(from);
    fireEvent.change(from, { target: { value: 'not-a-date' } });
    fireEvent.keyDown(from, { key: 'Enter' });

    expect(screen.getByText('Enter a valid date.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
