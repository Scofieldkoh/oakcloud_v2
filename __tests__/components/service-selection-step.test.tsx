import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceSelectionStep } from '@/components/documents/service-agreement/service-selection-step';
import type { ServiceVariantDto } from '@/services/service-catalog/types';

const variant: ServiceVariantDto = {
  id: 'variant-1',
  familyId: 'family-1',
  code: 'CORP_SECRETARIAL',
  name: 'Corporate Secretarial Services',
  description: 'Keep statutory registers and annual filings up to date.',
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

const variantWithoutDescription: ServiceVariantDto = {
  ...variant,
  id: 'variant-2',
  code: 'PAYROLL_SUPPORT',
  name: 'Payroll Support',
  description: null,
  displayOrder: 1,
};

describe('ServiceSelectionStep', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ variants: [variant, variantWithoutDescription] }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows variant descriptions from an info control without selecting the variant', async () => {
    const user = userEvent.setup();
    render(
      <ServiceSelectionStep
        entities={[{ id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202600001A', status: 'LIVE' }]}
        agreementDate="2026-08-29"
        items={[]}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Service variant' });
    expect(trigger.closest('div.rounded-xl')).not.toBeInTheDocument();
    await user.click(trigger);

    expect(await screen.findByRole('listbox')).toHaveClass('fixed');

    const fallbackInfo = await screen.findByRole('button', {
      name: `Show description for ${variantWithoutDescription.name}`,
    });
    await user.hover(fallbackInfo);
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'No description is available for this service variant.',
    );
    await user.unhover(fallbackInfo);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    const info = await screen.findByRole('button', {
      name: `Show description for ${variant.name}`,
    });
    await user.hover(info);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass('fixed');
    expect(tooltip.closest('[role="listbox"]')).not.toBeInTheDocument();
    expect(tooltip).toHaveTextContent(variant.description!);
    await user.unhover(info);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.click(info);
    expect(screen.getByRole('tooltip')).toHaveTextContent(variant.description!);
    expect(trigger).toHaveTextContent('Select a service');

    await user.click(screen.getByRole('option', { name: variant.name }));
    expect(trigger).toHaveTextContent(variant.name);
  });
});
