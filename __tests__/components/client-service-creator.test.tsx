import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientServiceCreator } from '@/components/companies/company-detail/client-service-creator';
import type { ClientServiceDto } from '@/services/client-service';

const previewMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }));
const catalogDataMock = vi.hoisted(() => ({
  companyContext: { id: 'company-1', name: 'Test Co', uen: '202400001A', accountsDueDate: null },
  variants: [{
    id: 'variant-1',
    name: 'Corporate Secretarial Services',
    family: { id: 'family-1', name: 'Corporate Secretarial', displayColor: '#0F766E' },
    serviceCadence: 'ANNUALLY',
    customCadenceLabel: null,
    deadlineRules: [{
      ruleId: 'rule-agm',
      code: 'SG_AGM_DUE',
      name: 'Singapore AGM Due Date',
      enabledByDefault: true,
      parameterDefaults: {},
      parameters: [],
      scheduleDefaults: [],
    }],
    parameters: [],
    fields: [],
    feeTemplates: [],
  }],
}));

const companyObligationsMock = vi.hoisted(() => vi.fn(() => ({ data: { items: [], notices: [] }, isLoading: false, error: null })));

vi.mock('@/hooks/use-client-services', () => ({
  isHttpRequestError: (error: unknown, status?: number) => {
    const value = error as { status?: number };
    return error instanceof Error && (status === undefined || value.status === status);
  },
  previewClientServiceDeadlineDraft: previewMock,
  useManualClientServiceCatalogOptions: () => ({
    data: catalogDataMock,
    isLoading: false,
    error: null,
  }),
  useCreateManualClientService: () => createMock,
  useCompanyObligations: companyObligationsMock,
  useSetCompanyObligationStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmFinancialPeriod: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetEngagementStart: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: ({ label, options, value, onChange, disabled }: {
    label: string;
    options: Array<{ value: string; label: string }>;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select service</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

const draftResponse = {
  companyId: 'company-1',
  serviceVariantId: 'variant-1',
  today: '2026-08-27',
  horizonEnd: '2027-08-27',
  counts: { applicable: 0, disabled: 0, inapplicable: 0, missingInput: 0, warnings: 0 },
  warnings: [],
  projectedDeadlines: [
    {
      ruleId: 'rule-agm',
      ruleCode: 'SG_AGM_DUE',
      ruleName: 'Singapore AGM Due Date',
      materializationPolicy: 'AUTHORITATIVE_ANNUAL_BACKLOG',
      periodKey: '2027',
      milestoneKey: 'agm-due',
      milestoneName: 'AGM due',
      scheduleEntryKey: '',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2027-06-30',
      explanation: ['Source Company.accountsDueDate = 2027-07-31'],
    },
    {
      ruleId: 'rule-ar',
      ruleCode: 'SG_ANNUAL_RETURN',
      ruleName: 'Singapore Annual Return',
      materializationPolicy: 'AUTHORITATIVE_ANNUAL_BACKLOG',
      periodKey: '2027',
      milestoneKey: 'annual-return-due',
      milestoneName: 'Annual Return due',
      scheduleEntryKey: '',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2027-07-31',
      explanation: ['Source Company.accountsDueDate = 2027-07-31'],
    },
  ],
};

function renderCreator() {
  return render(<ClientServiceCreator companyId="company-1" isOpen onClose={vi.fn()} onCreated={vi.fn((_service: ClientServiceDto) => {})} />);
}

async function selectVariant() {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'variant-1' } });
  });
}

async function advanceDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(350);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ClientServiceCreator draft deadline preview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    previewMock.mockResolvedValue(draftResponse);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the company name and UEN above the service configuration panels', () => {
    renderCreator();

    expect(screen.getByLabelText('Company details')).toHaveClass('grid-cols-2');
    expect(screen.getByText('Company Name:')).toBeVisible();
    expect(screen.getByText('Company Name:').parentElement).toHaveClass('flex', 'items-baseline');
    expect(screen.getByText('Test Co')).toBeVisible();
    expect(screen.getByText('UEN:')).toBeVisible();
    expect(screen.getByText('UEN:').parentElement).toHaveClass('flex', 'items-baseline');
    expect(screen.getByText('202400001A')).toBeVisible();
    expect(screen.getByText('Service')).toBeVisible();
    expect(screen.getByText('Deadline')).toBeVisible();
    expect(screen.getByText('Billing')).toBeVisible();
  });

  it('requests a draft preview after selecting a variant and renders the server dates', async () => {
    renderCreator();
    await selectVariant();
    await advanceDebounce();

    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(previewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        serviceVariantId: 'variant-1',
        deadlineRules: expect.any(Array),
        scheduleSnapshot: expect.objectContaining({ serviceCadence: 'ANNUALLY' }),
      }),
      expect.any(AbortSignal),
    );
    expect(screen.getByText('30 Jun 2027')).toBeVisible();
    expect(screen.getByText('31 Jul 2027')).toBeVisible();
  });

  it('debounces schedule edits into one draft request', async () => {
    renderCreator();
    await selectVariant();
    await advanceDebounce();
    expect(previewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PAUSED' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(previewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(previewMock).toHaveBeenCalledTimes(2);
  });

  it('does not send a preview while no variant is selected', async () => {
    renderCreator();
    await advanceDebounce();
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('aborts the pending draft preview when the dialog closes', async () => {
    let capturedSignal: AbortSignal | undefined;
    previewMock.mockImplementationOnce((_input: unknown, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });
    renderCreator();
    await selectVariant();
    await advanceDebounce();

    await act(async () => {
      screen.getByRole('button', { name: 'Cancel' }).click();
    });
    expect(capturedSignal?.aborted).toBe(false);

    await act(async () => {
      screen.getByRole('button', { name: 'Discard' }).click();
    });
    expect(capturedSignal?.aborted).toBe(true);
  });
});
