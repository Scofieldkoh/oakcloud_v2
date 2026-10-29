import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualCycleDialog } from '@/components/services/deadlines/manual-cycle-dialog';

const preview = {
  ruleVersionId: '44444444-4444-4444-8444-444444444444',
  ruleName: 'Annual return',
  periodKey: '2024',
  milestones: [
    { milestoneKey: 'client-records', scheduleEntryKey: '', name: 'Client records', deadlineType: 'CLIENT', calculatedDueDate: '2024-01-15', operativeDueDate: '2024-01-15', explanation: ['Cycle start plus 14 days'] },
    { milestoneKey: 'statutory-filing', scheduleEntryKey: '', name: 'Statutory filing', deadlineType: 'STATUTORY', calculatedDueDate: '2024-02-01', operativeDueDate: '2024-02-01', explanation: ['Historical filing anchor'] },
  ],
  previewFingerprint: 'a'.repeat(64),
};
const configuredOptions = {
  clientServiceId: '22222222-2222-4222-8222-222222222222',
  companyId: '33333333-3333-4333-8333-333333333333',
  rules: [{
    id: 'rule-row-1',
    ruleId: 'rule-1',
    enabled: true,
    parameterValues: {
      monthsAfterFye: 2,
      stringNumber: '2',
      stringBoolean: 'true',
      stringNull: 'null',
      stringJson: '{"nested":true}',
      typedBoolean: true,
    },
    scheduleEntries: [
      { key: 'first-entry', label: 'First entry', expression: { kind: 'DAY_OF_MONTH', day: 1 }, businessDayAdjustment: 'NONE' },
      { key: 'second-entry', label: 'Second entry', expression: { kind: 'DAY_OF_MONTH', day: 2 }, businessDayAdjustment: 'NONE' },
      { key: 'third-entry', label: 'Third entry', expression: { kind: 'DAY_OF_MONTH', day: 3 }, businessDayAdjustment: 'NONE' },
      { key: 'fourth-entry', label: 'Fourth entry', expression: { kind: 'DAY_OF_MONTH', day: 4 }, businessDayAdjustment: 'NONE' },
    ],
    rule: {
      id: 'rule-1', code: 'ANNUAL_RETURN', name: 'Annual return', isActive: true, archivedAt: null, currentVersionId: preview.ruleVersionId,
      currentVersion: {
        id: preview.ruleVersionId,
        version: 3,
        state: 'PUBLISHED',
        configHash: 'b'.repeat(64),
        recurrence: {},
        applicability: {},
        parameters: [
          { key: 'monthsAfterFye', label: 'Months after FYE', type: 'INTEGER', required: true, defaultValue: 2, validation: null, helpText: null, displayOrder: 1 },
          { key: 'stringNumber', label: 'String number', type: 'STRING', required: false, defaultValue: null, validation: null, helpText: null, displayOrder: 2 },
          { key: 'stringBoolean', label: 'String boolean', type: 'STRING', required: false, defaultValue: null, validation: null, helpText: null, displayOrder: 3 },
          { key: 'stringNull', label: 'String null', type: 'STRING', required: false, defaultValue: null, validation: null, helpText: null, displayOrder: 4 },
          { key: 'stringJson', label: 'String JSON', type: 'STRING', required: false, defaultValue: null, validation: null, helpText: null, displayOrder: 5 },
          { key: 'typedBoolean', label: 'Typed boolean', type: 'BOOLEAN', required: false, defaultValue: true, validation: null, helpText: null, displayOrder: 6 },
        ],
      },
    },
  }],
} as never;

describe('ManualCycleDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cycleId: 'cycle-1', occurrenceIds: ['occurrence-1'] }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  it('keeps Apply disabled until a current preview exists and invalidates it on edits', async () => {
    render(<ManualCycleDialog isOpen clientServiceId="22222222-2222-4222-8222-222222222222" options={configuredOptions} onClose={vi.fn()} />);

    const apply = screen.getByRole('button', { name: 'Apply cycle' });
    expect(apply).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText('Rule')).toHaveValue(preview.ruleVersionId));
    expect(screen.getByDisplayValue('monthsAfterFye')).toBeVisible();
    expect(screen.getByText('4 of 31 schedule entries configured')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Period key'), { target: { value: '2024' } });
    fireEvent.change(screen.getByLabelText('Period start'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('Period end'), { target: { value: '2024-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview cycle' }));

    await waitFor(() => expect(screen.getByText('Client records')).toBeVisible());
    expect(apply).toBeEnabled();
    expect(screen.getByText(/Only rule, period, parameter, schedule, and source changes require a new preview\./)).toBeVisible();

    fireEvent.change(screen.getByLabelText('Period key'), { target: { value: '2023' } });
    expect(apply).toBeDisabled();
  });

  it('keeps the current preview while editing selections, completion, dates, and notes', async () => {
    render(<ManualCycleDialog isOpen clientServiceId="22222222-2222-4222-8222-222222222222" options={configuredOptions} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Rule')).toHaveValue(preview.ruleVersionId));
    fireEvent.change(screen.getByLabelText('Period key'), { target: { value: '2024' } });
    fireEvent.change(screen.getByLabelText('Period start'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('Period end'), { target: { value: '2024-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview cycle' }));
    await waitFor(() => expect(screen.getByText('Client records')).toBeVisible());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Statutory filing' }));
    fireEvent.change(screen.getAllByLabelText('Operative date')[0], { target: { value: '2024-01-20' } });
    fireEvent.change(screen.getAllByLabelText('Status')[0], { target: { value: 'COMPLETED' } });
    fireEvent.change(screen.getAllByLabelText('Completion date')[0], { target: { value: '2024-01-21' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Completed from inherited records.' } });

    expect(screen.getByRole('button', { name: 'Apply cycle' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply cycle' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const applyRequest = vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit;
    const applyBody = JSON.parse(String(applyRequest.body)) as { notes: string; selections: Array<Record<string, unknown>> };
    expect(applyBody.notes).toBe('Completed from inherited records.');
    expect(applyBody.selections).toEqual(expect.arrayContaining([
      expect.objectContaining({ milestoneKey: 'client-records', include: true, operativeDueDate: '2024-01-20', status: 'COMPLETED', completionDate: '2024-01-21' }),
      expect.objectContaining({ milestoneKey: 'statutory-filing', include: false }),
    ]));
  });

  it('surfaces the safe message from a structured API error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'The published rule changed. Preview again before applying.',
      code: 'IMPACT_CHANGED',
      details: { preview: { ruleVersionId: preview.ruleVersionId } },
    }), { status: 409, headers: { 'content-type': 'application/json' } })));
    render(<ManualCycleDialog isOpen clientServiceId="22222222-2222-4222-8222-222222222222" options={configuredOptions} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Rule')).toHaveValue(preview.ruleVersionId));
    fireEvent.change(screen.getByLabelText('Period key'), { target: { value: '2024' } });
    fireEvent.change(screen.getByLabelText('Period start'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('Period end'), { target: { value: '2024-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview cycle' }));
    expect(await screen.findByText('The published rule changed. Preview again before applying.')).toBeVisible();
  });

  it('preserves configured string values while parsing typed parameter definitions', async () => {
    render(<ManualCycleDialog isOpen clientServiceId="22222222-2222-4222-8222-222222222222" options={configuredOptions} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Rule')).toHaveValue(preview.ruleVersionId));
    fireEvent.change(screen.getByLabelText('Period key'), { target: { value: '2024' } });
    fireEvent.change(screen.getByLabelText('Period start'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('Period end'), { target: { value: '2024-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview cycle' }));

    await waitFor(() => expect(screen.getByText('Client records')).toBeVisible());
    const previewRequest = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    const previewBody = JSON.parse(String(previewRequest.body)) as { parameterOverrides: Record<string, unknown> };
    expect(previewBody.parameterOverrides).toEqual(expect.objectContaining({
      monthsAfterFye: 2,
      stringNumber: '2',
      stringBoolean: 'true',
      stringNull: 'null',
      stringJson: '{"nested":true}',
      typedBoolean: true,
    }));
  });
});
