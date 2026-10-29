import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BillingOccurrenceDto } from '@/services/billing';

import { BillingOccurrenceDialog } from '@/components/services/billing/billing-occurrence-dialog';

const billedOccurrence: BillingOccurrenceDto = {
  id: 'occurrence-1',
  tenantId: 'tenant-1',
  companyId: 'company-1',
  clientServiceId: 'service-1',
  feeLineId: 'fee-1',
  billingPeriodKey: '2026-08',
  scheduleEntryKey: 'entry-1',
  generationKey: 'generation-1',
  calculatedExpectedDate: '2026-08-31',
  operativeExpectedDate: '2026-08-31',
  dateOverridden: false,
  dateOverrideReason: null,
  dateOverriddenAt: null,
  dateOverriddenById: null,
  baseAmount: '1200.00',
  baseCurrency: 'SGD',
  operativeAmount: '1200.00',
  operativeCurrency: 'SGD',
  valueOverridden: false,
  valueOverrideReason: null,
  valueOverriddenAt: null,
  valueOverriddenById: null,
  status: 'BILLED',
  timingState: null,
  billedDate: '2026-08-31',
  markedBilledAt: '2026-08-31T08:00:00.000Z',
  markedBilledById: 'user-1',
  externalReference: 'EXT-2048',
  notes: 'Recorded from external billing run',
  waivedAt: null,
  waivedById: null,
  waiverReason: null,
  cancelledAt: null,
  cancelledById: null,
  cancellationReason: null,
  cancellationReconciliationRequestId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-31T08:00:00.000Z',
  company: { id: 'company-1', name: 'Northstar Holdings Pte. Ltd.', displayAlias: 'Northstar', displayLabel: 'Northstar', uen: null },
  family: { id: 'family-1', name: 'Corp Sec', displayColor: '#3C7768' },
  service: { id: 'service-1', name: 'Corporate Secretary', familyName: 'Corp Sec', variantId: null, variantName: null },
  feeLine: { id: 'fee-1', description: 'Annual retainer', amount: '1200.00', currency: 'SGD' },
};

describe('BillingOccurrenceDialog', () => {
  it('asks update scope whenever amount or currency changes', () => {
    const onSave = vi.fn();
    render(<BillingOccurrenceDialog occurrence={billedOccurrence} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1500.00' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Updated engagement pricing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tracking update' }));

    expect(screen.getByRole('dialog', { name: 'Apply amount change' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'This occurrence' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'This and future' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'This and future' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      amount: '1500.00',
      currency: 'SGD',
      reason: 'Updated engagement pricing',
      updateScope: 'THIS_AND_FUTURE',
    }));
  });

  it('submits a non-value tracking update without opening a scope prompt', () => {
    const onSave = vi.fn();
    render(<BillingOccurrenceDialog occurrence={billedOccurrence} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Updated tracking note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tracking update' }));

    expect(screen.queryByRole('dialog', { name: 'Apply amount change' })).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Updated tracking note', updateScope: 'THIS_OCCURRENCE' }));
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('status');
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('billedDate');
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('amount');
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('currency');
  });

  it('omits unchanged lifecycle fields when editing a waived occurrence', () => {
    const onSave = vi.fn();
    const waivedOccurrence: BillingOccurrenceDto = {
      ...billedOccurrence,
      status: 'WAIVED',
      billedDate: null,
      markedBilledAt: null,
      markedBilledById: null,
      waivedAt: '2026-08-20T08:00:00.000Z',
      waivedById: 'user-1',
      waiverReason: 'Client confirmed no billing is required',
    };
    render(<BillingOccurrenceDialog occurrence={waivedOccurrence} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('External reference'), { target: { value: 'WAIVER-REF' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Waived after client confirmation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tracking update' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      externalReference: 'WAIVER-REF',
      notes: 'Waived after client confirmation',
      updateScope: 'THIS_OCCURRENCE',
      reason: null,
    }));
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('status');
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('billedDate');
  });

  it('sends only the lifecycle field for a real Open to Billed transition', () => {
    const onSave = vi.fn();
    const openOccurrence: BillingOccurrenceDto = {
      ...billedOccurrence,
      status: 'OPEN',
      billedDate: null,
      markedBilledAt: null,
      markedBilledById: null,
    };
    render(<BillingOccurrenceDialog occurrence={openOccurrence} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'BILLED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tracking update' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'BILLED', updateScope: 'THIS_OCCURRENCE' }));
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('billedDate');
  });

  it('sends the reopen transition and clears the billed date when moving Billed to Open', () => {
    const onSave = vi.fn();
    render(<BillingOccurrenceDialog occurrence={billedOccurrence} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'OPEN' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Reopen after client review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tracking update' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      status: 'OPEN',
      billedDate: null,
      reason: 'Reopen after client review',
      updateScope: 'THIS_OCCURRENCE',
    }));
  });

  it('sends a billed-date-only edit without resubmitting lifecycle state', () => {
    const onSave = vi.fn();
    render(<BillingOccurrenceDialog occurrence={billedOccurrence} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Billed date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tracking update' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ billedDate: '2026-09-01', updateScope: 'THIS_OCCURRENCE' }));
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('status');
  });

  it.each([
    ['BILLED', 'Waived'],
    ['WAIVED', 'Billed'],
  ] as const)('does not offer the invalid %s to %s lifecycle transition', (status, forbiddenLabel) => {
    render(<BillingOccurrenceDialog occurrence={{ ...billedOccurrence, status }} />);

    expect(screen.queryByRole('option', { name: forbiddenLabel })).not.toBeInTheDocument();
  });

  it('offers a reset lifecycle for overridden expected values', () => {
    const onReset = vi.fn();
    render(
      <BillingOccurrenceDialog
        occurrence={{ ...billedOccurrence, valueOverridden: true, valueOverrideReason: 'Legacy amount correction' }}
        onReset={onReset}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset tracked overrides' }));
    expect(screen.getByRole('dialog', { name: 'Reset tracking override' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Reset reason'), { target: { value: 'Use configured fee line amount' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset all overrides' }));

    expect(onReset).toHaveBeenCalledWith(expect.objectContaining({ target: 'ALL', reason: 'Use configured fee line amount' }));
  });

  it('surfaces a mutation error without losing the edited tracking note', () => {
    render(<BillingOccurrenceDialog occurrence={billedOccurrence} errorMessage="Unable to update billing tracking" />);

    const notes = screen.getByLabelText('Notes');
    fireEvent.change(notes, { target: { value: 'Keep this note after a failed save' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to update billing tracking');
    expect(notes).toHaveValue('Keep this note after a failed save');
  });
});
