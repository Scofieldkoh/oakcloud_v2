import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SingleDateInput } from '../single-date-input';

describe('SingleDateInput Today button', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 29 Sep 2026, 1:30 AM in Singapore is still 28 Sep in UTC.
    vi.setSystemTime(new Date('2026-09-28T17:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is hidden unless turned on', () => {
    render(<SingleDateInput value="" onChange={() => {}} ariaLabel="Agreement date" />);
    expect(screen.queryByRole('button', { name: /to today/i })).toBeNull();
  });

  it('fills in the Singapore date', () => {
    const onChange = vi.fn();
    render(<SingleDateInput value="" onChange={onChange} ariaLabel="Agreement date" showTodayButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Set Agreement date to today' }));

    expect(onChange).toHaveBeenCalledWith('2026-09-29');
    expect(screen.getByRole('textbox')).toHaveValue('29 Sep 2026');
  });

  it('is disabled when today is outside the allowed dates', () => {
    render(
      <SingleDateInput value="" onChange={() => {}} ariaLabel="End date" maxDate="2026-01-31" showTodayButton />
    );
    expect(screen.getByRole('button', { name: 'Set End date to today' })).toBeDisabled();
  });
});
