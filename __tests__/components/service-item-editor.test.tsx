import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ServiceItemEditor } from '@/components/documents/service-agreement/service-item-editor';
import type { ServiceVariantDto } from '@/services/service-catalog/types';
import type { ServiceAgreementItemInput } from '@/services/service-agreement';

const company = {
  id: 'company-1',
  name: 'Acme Pte. Ltd.',
  uen: '202600001A',
  status: 'LIVE' as const,
};

const variant: ServiceVariantDto = {
  id: 'variant-1',
  familyId: 'family-1',
  code: 'CORP_SECRETARIAL',
  name: 'Corporate Secretarial Services',
  description: null,
  serviceCadence: 'ANNUALLY',
  customCadenceLabel: null,
  displayOrder: 0,
  version: 1,
  isActive: true,
  sowPartial: {
    id: 'partial-1',
    name: 'sow',
    displayName: null,
    version: 1,
    placeholders: [],
  },
  feeTemplates: [],
};

const item: ServiceAgreementItemInput = {
  clientKey: 'item-1',
  variantId: variant.id,
  entityIds: [company.id],
  startDate: '2026-08-29',
  endDate: null,
  fieldValues: {},
  displayOrder: 0,
  feeLines: [{
    clientKey: 'fee-1',
    companyId: company.id,
    description: 'Annual secretarial service',
    amount: '500',
    currency: 'SGD',
    billingFrequency: 'ANNUALLY',
    customFrequencyLabel: null,
    billingStartDate: '2026-08-29',
    displayOrder: 0,
  }],
};

describe('ServiceItemEditor', () => {
  it('renders applies-to tiles and an expanded fee table without version metadata', () => {
    render(
      <ServiceItemEditor
        item={item}
        agreementDate="2026-08-29"
        variant={variant}
        entities={[company]}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onCopy={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        canMoveUp={false}
        canMoveDown={false}
      />,
    );

    expect(screen.queryByText(/Pinned from version/i)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Applies to Acme Pte. Ltd.' })).toBeChecked();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Company applied' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Currency' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Frequency' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Billing start date' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByRole('button', { name: 'Remove' }))
      .toHaveClass('bg-red-600');
    expect(screen.queryByRole('button', { name: 'Remove fee' })).not.toBeInTheDocument();
    expect(screen.getByText('Fees').closest('details')).toHaveAttribute('open');
  });

  it('asks in the app dialog before removing a company that has fee lines', async () => {
    const onChange = vi.fn();
    render(
      <ServiceItemEditor
        item={item}
        agreementDate="2026-08-29"
        variant={variant}
        entities={[company]}
        onChange={onChange}
        onRemove={vi.fn()}
        onCopy={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        canMoveUp={false}
        canMoveDown={false}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Applies to Acme Pte. Ltd.' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Remove Acme Pte. Ltd.?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Applies to Acme Pte. Ltd.' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ entityIds: [], feeLines: [] })));
  });

  it('pegs service and billing dates until each field is explicitly overridden', () => {
    const onChange = vi.fn();
    const peggedItem = {
      ...item,
      startDateOverridden: false,
      feeLines: item.feeLines.map((fee) => ({
        ...fee,
        billingStartDate: null,
        billingStartDateOverridden: false,
      })),
    };
    const sharedProps = {
      variant,
      entities: [company],
      onChange,
      onRemove: vi.fn(),
      onCopy: vi.fn(),
      onMoveUp: vi.fn(),
      onMoveDown: vi.fn(),
      canMoveUp: false,
      canMoveDown: false,
    };
    const { rerender } = render(
      <ServiceItemEditor
        {...sharedProps}
        item={peggedItem}
        agreementDate="2026-08-29"
      />,
    );

    const serviceDate = screen.getByLabelText('Service start date');
    const billingDate = screen.getByLabelText('Billing start date');
    expect(serviceDate).toHaveValue('29 Aug 2026');
    expect(billingDate).toHaveValue('29 Aug 2026');
    expect(serviceDate.parentElement).toHaveClass('bg-background-tertiary');
    expect(billingDate.parentElement).toHaveClass('bg-background-tertiary');

    fireEvent.change(serviceDate, { target: { value: '1 Sep 2026' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      startDate: '2026-09-01',
      startDateOverridden: true,
    }));

    rerender(
      <ServiceItemEditor
        {...sharedProps}
        item={{ ...peggedItem, startDate: '2026-09-01', startDateOverridden: true }}
        agreementDate="2026-08-29"
      />,
    );
    expect(screen.getByLabelText('Service start date').parentElement)
      .toHaveClass('bg-oak-row-selected');
    expect(screen.getByLabelText('Billing start date')).toHaveValue('1 Sep 2026');

    fireEvent.change(screen.getByLabelText('Billing start date'), {
      target: { value: '5 Sep 2026' },
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      feeLines: [expect.objectContaining({
        billingStartDate: '2026-09-05',
        billingStartDateOverridden: true,
      })],
    }));

    rerender(
      <ServiceItemEditor
        {...sharedProps}
        item={{
          ...peggedItem,
          startDate: '2026-09-01',
          startDateOverridden: true,
          feeLines: peggedItem.feeLines.map((fee) => ({
            ...fee,
            billingStartDate: '2026-09-05',
            billingStartDateOverridden: true,
          })),
        }}
        agreementDate="2026-08-29"
      />,
    );
    const overriddenBillingDate = screen.getByLabelText('Billing start date');
    expect(overriddenBillingDate.parentElement).toHaveClass('bg-oak-row-selected');
    fireEvent.change(overriddenBillingDate, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      feeLines: [expect.objectContaining({
        billingStartDate: null,
        billingStartDateOverridden: false,
      })],
    }));

    fireEvent.change(screen.getByLabelText('Service start date'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      startDate: '2026-08-29',
      startDateOverridden: false,
    }));
  });
});
