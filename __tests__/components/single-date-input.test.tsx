import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { SingleDateInput } from '@/components/ui/single-date-input';

describe('SingleDateInput', () => {
  function TestHarness({
    initial = '',
    minDate,
    maxDate,
    disabled = false,
  }: {
    initial?: string;
    minDate?: string;
    maxDate?: string;
    disabled?: boolean;
  }) {
    const [value, setValue] = useState(initial);
    return (
      <div>
        <SingleDateInput
          id="test-date"
          label="Test date"
          value={value}
          onChange={setValue}
          minDate={minDate}
          maxDate={maxDate}
          disabled={disabled}
        />
        <button type="button">Next field</button>
      </div>
    );
  }

  it('renders with initial ISO value formatted to display date', () => {
    render(<TestHarness initial="2026-08-01" />);
    const input = screen.getByLabelText('Test date');
    expect(input).toHaveValue('1 Aug 2026');
    expect(input).toHaveAttribute('id', 'test-date');
  });

  it('commits a typed valid date and formats display on Enter', () => {
    render(<TestHarness />);
    const input = screen.getByLabelText('Test date');

    fireEvent.focus(input);
    expect(document.querySelector('[data-single-date-popover="true"]')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '2026-09-15' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('15 Sep 2026');
    expect(document.querySelector('[data-single-date-popover="true"]')).not.toBeInTheDocument();
  });

  it('commits typed DD/MM/YYYY date on Enter', () => {
    render(<TestHarness />);
    const input = screen.getByLabelText('Test date');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '25/12/2026' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('25 Dec 2026');
    expect(document.querySelector('[data-single-date-popover="true"]')).not.toBeInTheDocument();
  });

  it('closes calendar popover on Tab without blocking focus transition', () => {
    render(<TestHarness />);
    const input = screen.getByLabelText('Test date');

    fireEvent.focus(input);
    expect(document.querySelector('[data-single-date-popover="true"]')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Tab' });
    expect(document.querySelector('[data-single-date-popover="true"]')).not.toBeInTheDocument();
  });

  it('closes calendar popover on Escape keypress', () => {
    render(<TestHarness />);
    const input = screen.getByLabelText('Test date');

    fireEvent.focus(input);
    expect(document.querySelector('[data-single-date-popover="true"]')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.querySelector('[data-single-date-popover="true"]')).not.toBeInTheDocument();
  });

  it('clears value on Enter when input is empty', () => {
    render(<TestHarness initial="2026-08-01" />);
    const input = screen.getByLabelText('Test date');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('');
    expect(document.querySelector('[data-single-date-popover="true"]')).not.toBeInTheDocument();
  });

  it('displays error on invalid date entry upon Enter', () => {
    render(<TestHarness />);
    const input = screen.getByLabelText('Test date');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'invalid-date' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Enter a valid date.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('enforces minDate and maxDate on Enter', () => {
    render(<TestHarness minDate="2026-08-01" maxDate="2026-08-31" />);
    const input = screen.getByLabelText('Test date');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2026-09-01' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText(/Enter a date on or before/)).toBeInTheDocument();
  });
});
