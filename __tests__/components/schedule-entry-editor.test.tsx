import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScheduleEntryEditor } from '@/components/services/shared/schedule-entry-editor';

const entries = [
  {
    key: 'salary-payout',
    label: 'Salary payout',
    expression: { kind: 'DAY_OF_MONTH' as const, day: 15 },
    businessDayAdjustment: 'NONE' as const,
  },
  {
    key: 'client-funding',
    label: 'Client funding',
    expression: { kind: 'BUSINESS_DAY_FROM_END' as const, ordinal: 2 },
    businessDayAdjustment: 'NEXT' as const,
  },
];

describe('ScheduleEntryEditor', () => {
  it('reorders entries without changing stable keys', () => {
    const onChange = vi.fn();
    render(<ScheduleEntryEditor value={entries} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Salary payout down' }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'client-funding' }),
      expect.objectContaining({ key: 'salary-payout' }),
    ]);
  });

  it('prevents a 32nd row and announces the limit accessibly', () => {
    const onChange = vi.fn();
    const full = Array.from({ length: 31 }, (_, index) => ({
      key: `entry-${index + 1}`,
      label: `Entry ${index + 1}`,
      expression: { kind: 'DAY_OF_MONTH' as const, day: (index % 31) + 1 },
      businessDayAdjustment: 'NONE' as const,
    }));
    render(<ScheduleEntryEditor value={full} onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Add schedule entry' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('31');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('preserves parameterized relative offsets and exposes operand controls', () => {
    const onChange = vi.fn();
    render(<ScheduleEntryEditor value={[{
      key: 'parameterized',
      label: 'Parameterized offset',
      expression: {
        kind: 'RELATIVE_TO_SOURCE' as const,
        source: { kind: 'CYCLE_START' as const },
        offset: { kind: 'INTEGER_PARAMETER' as const, key: 'daysAfterStart' },
        unit: 'BUSINESS_DAY' as const,
      },
      businessDayAdjustment: 'NONE' as const,
    }]} onChange={onChange} />);

    expect(screen.getByLabelText('Offset operand')).toHaveValue('INTEGER_PARAMETER');
    expect(screen.getByLabelText('Offset parameter key')).toHaveValue('daysAfterStart');
    expect(screen.getByLabelText('Entry label')).toHaveClass('min-h-[44px]');
    expect(screen.getByLabelText('Offset unit')).toHaveClass('min-h-[44px]');
    fireEvent.change(screen.getByLabelText('Offset parameter key'), { target: { value: 'daysAfterDue' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({
      expression: expect.objectContaining({ offset: { kind: 'INTEGER_PARAMETER', key: 'daysAfterDue' } }),
    })]);
  });

  it('restricts billing schedules to evaluator-safe relative sources and literal offsets', () => {
    const onChange = vi.fn();
    render(<ScheduleEntryEditor
      value={[{
        key: 'billing-date',
        label: 'Billing date',
        expression: {
          kind: 'RELATIVE_TO_SOURCE' as const,
          source: { kind: 'CYCLE_START' as const },
          offset: 1,
          unit: 'CALENDAR_DAY' as const,
        },
        businessDayAdjustment: 'NONE' as const,
      }]}
      onChange={onChange}
      capabilities={{
        allowedRelativeSourceKinds: ['CYCLE_START', 'CYCLE_END', 'CURRENT_SCHEDULE_ENTRY'],
        allowParameterizedOffsets: false,
      }}
    />);

    const source = screen.getByLabelText('Relative source');
    expect(screen.getByRole('option', { name: /Cycle start/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Cycle end/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Current schedule entry/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Company field/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Parameter/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Milestone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Schedule entry$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Offset operand')).toHaveValue('LITERAL');
    expect(screen.queryByRole('option', { name: /Integer parameter/i })).not.toBeInTheDocument();

    fireEvent.change(source, { target: { value: 'CYCLE_END' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({
      expression: expect.objectContaining({ source: { kind: 'CYCLE_END' } }),
    })]);
  });
});
