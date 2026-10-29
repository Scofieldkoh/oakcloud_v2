import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientServiceEditor } from '@/components/companies/company-detail/client-service-editor';
import type { ClientServiceDto } from '@/services/client-service';

const previewMock = vi.hoisted(() => vi.fn());
const refetchMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }));
const archiveMock = vi.hoisted(() => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }));
const deleteMock = vi.hoisted(() => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }));

const companyObligationsMock = vi.hoisted(() => vi.fn(() => ({ data: { items: [], notices: [] }, isLoading: false, error: null })));

vi.mock('@/hooks/use-client-services', () => ({
  isHttpRequestError: (error: unknown, status?: number) => {
    const value = error as { status?: number };
    return error instanceof Error && (status === undefined || value.status === status);
  },
  previewClientServiceDeadlineImpact: previewMock,
  useClientService: () => ({ refetch: refetchMock, isFetching: false }),
  useUpdateClientService: () => updateMock,
  useArchiveClientService: () => archiveMock,
  useDeleteClientServicePermanently: () => deleteMock,
  useCompanyObligations: companyObligationsMock,
  useSetCompanyObligationStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmFinancialPeriod: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetEngagementStart: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const service: ClientServiceDto = {
  id: '11111111-1111-4111-8111-111111111111',
  companyId: 'company-1',
  company: { name: 'Test Co', uen: '202400001A' },
  source: 'MANUAL',
  agreementId: null,
  agreementItemId: null,
  serviceVariantId: 'variant-1',
  familyName: 'Corporate Secretarial',
  serviceName: 'Test Service',
  status: 'ACTIVE',
  serviceCadence: 'ANNUALLY',
  customCadenceLabel: null,
  startDate: '2026-08-01',
  endDate: null,
  billingDisposition: 'NOT_REQUIRED',
  billingNotRequiredReason: 'No fees',
  fieldValues: {},
  feeLines: [],
  deadlineRules: [{
    id: 'client-rule-1',
    ruleId: 'rule-1',
    enabled: true,
    parameterValues: {},
    parameterProvenance: {},
    scheduleEntries: [],
    lastEvaluatedVersionId: null,
    applicabilityState: 'APPLICABLE',
    applicabilityReason: null,
    configHash: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
    rule: {
      id: 'rule-1',
      code: 'SG_ANNUAL_RETURN',
      name: 'Annual Return',
      isActive: true,
      archivedAt: null,
      currentVersionId: null,
      currentVersion: null,
    },
  }],
  openDeadlineOccurrences: [
    {
      id: 'deadline-open-1',
      ruleId: 'rule-1',
      ruleCode: 'SG_ANNUAL_RETURN',
      ruleName: 'Annual Return',
      periodKey: '2027',
      milestoneKey: 'annual-return-due',
      milestoneName: 'Annual Return due',
      scheduleEntryKey: 'annual-return',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2027-07-31',
      operativeDueDate: '2027-07-31',
      origin: 'RULE',
      notes: null,
    },
    {
      id: 'deadline-open-2',
      ruleId: 'rule-1',
      ruleCode: 'SG_ANNUAL_RETURN',
      ruleName: 'Annual Return',
      periodKey: '2028',
      milestoneKey: 'annual-return-due',
      milestoneName: 'Annual Return due',
      scheduleEntryKey: 'annual-return',
      deadlineType: 'STATUTORY',
      calculatedDueDate: '2028-07-31',
      operativeDueDate: '2028-07-31',
      origin: 'RULE',
      notes: null,
    },
  ],
  openBillingOccurrences: [
    {
      id: 'billing-open-1',
      feeLineId: 'fee-1',
      description: 'Annual compliance fee',
      amount: '500.00',
      currency: 'SGD',
      billingFrequency: 'ANNUALLY',
      customFrequencyLabel: null,
      billingPeriodKey: '2027',
      scheduleEntryKey: 'annual-billing',
      calculatedExpectedDate: '2027-07-30',
      operativeExpectedDate: '2027-07-30',
      status: 'OPEN',
      notes: null,
    },
    {
      id: 'billing-open-2',
      feeLineId: 'fee-1',
      description: 'Annual compliance fee',
      amount: '500.00',
      currency: 'SGD',
      billingFrequency: 'ANNUALLY',
      customFrequencyLabel: null,
      billingPeriodKey: '2028',
      scheduleEntryKey: 'annual-billing',
      calculatedExpectedDate: '2028-07-30',
      operativeExpectedDate: '2028-07-30',
      status: 'OPEN',
      notes: null,
    },
  ],
  agreement: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const projectedDeadline = {
  ruleId: 'rule-1',
  ruleCode: 'SG_ANNUAL_RETURN',
  ruleName: 'Annual Return',
  materializationPolicy: 'AUTHORITATIVE_ANNUAL_BACKLOG',
  periodKey: '2027',
  milestoneKey: 'annual-return-due',
  milestoneName: 'Annual Return due',
  scheduleEntryKey: '',
  deadlineType: 'STATUTORY',
  calculatedDueDate: '2027-07-31',
  explanation: ['Source Company.accountsDueDate = 2027-07-31'],
};

function impactResponse(overrides: Record<string, unknown> = {}) {
  return {
    clientServiceId: service.id,
    expectedUpdatedAt: service.updatedAt,
    proposedConfigHash: 'a'.repeat(64),
    previewFingerprint: 'f'.repeat(64),
    counts: { created: 0, recalculated: 0, cancelled: 0, preserved: 0, noChange: 0, inapplicable: 0, missingInput: 0, conflicts: 0, warnings: 0 },
    samples: [],
    warnings: [],
    projectedDeadlines: [{ ...projectedDeadline }],
    ...overrides,
  };
}

function renderEditor(options: { readOnly?: boolean } = {}) {
  return render(<ClientServiceEditor service={service} isOpen onClose={vi.fn()} {...options} />);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(350);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function changeCadence(value: string) {
  const cadence = screen.getByLabelText('Cadence');
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  nativeSetter?.call(cadence, value);
  cadence.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ClientServiceEditor deadline preview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    previewMock.mockResolvedValue(impactResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a read-only View service modal without mutation controls', () => {
    renderEditor({ readOnly: true });

    expect(screen.getByRole('dialog', { name: 'View service' })).toBeVisible();
    expect(screen.getByLabelText('Service name')).toBeDisabled();
    expect(screen.getByLabelText('Cadence')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive service' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete service permanently' })).not.toBeInTheDocument();
  });

  it('keeps the service family read-only while editing a service', () => {
    renderEditor();

    expect(screen.getByLabelText('Service family')).toHaveProperty('readOnly', true);
  });

  it('renders every stored open deadline and billing occurrence in read-only mode', async () => {
    renderEditor({ readOnly: true });

    expect(screen.getByRole('tab', { name: /Deadline2/ })).toBeVisible();
    expect(screen.getByText('Open deadline items')).toBeVisible();
    expect(screen.getByText('2 open items')).toBeVisible();
    expect(screen.getByText('31 Jul 2027')).toBeVisible();
    expect(screen.getByText('31 Jul 2028')).toBeVisible();
    await act(async () => {
      screen.getByRole('tab', { name: /Billing/ }).click();
      await Promise.resolve();
    });
    expect(screen.getByRole('tab', { name: /Billing2/ })).toBeVisible();
    expect(screen.getByText('Open billing items')).toBeVisible();
    expect(screen.getByText('2 open billing items')).toBeVisible();
    expect(screen.getByText('30 Jul 2027')).toBeVisible();
    expect(screen.getByText('30 Jul 2028')).toBeVisible();
  });

  it('renders the company name and UEN above the service configuration panels', () => {
    renderEditor();

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

  it('requests a preview when the editor opens and renders the server dates', async () => {
    renderEditor();
    await advanceDebounce();

    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('31 Jul 2027')).toBeVisible();
  });

  it('debounces schedule edits into one request after 300 ms', async () => {
    renderEditor();
    await advanceDebounce();
    expect(previewMock).toHaveBeenCalledTimes(1);

    act(() => {
      changeCadence('MONTHLY');
      changeCadence('QUARTERLY');
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

  it('does not let a slower earlier response overwrite a newer response', async () => {
    let resolveFirst!: (value: unknown) => void;
    previewMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    renderEditor();
    await advanceDebounce();

    previewMock.mockImplementationOnce(() => Promise.resolve(impactResponse({
      previewFingerprint: 'e'.repeat(64),
      projectedDeadlines: [{ ...projectedDeadline, calculatedDueDate: '2027-06-30' }],
    })));
    act(() => {
      changeCadence('MONTHLY');
    });
    await advanceDebounce();
    expect(screen.getByText('30 Jun 2027')).toBeVisible();

    await act(async () => {
      await resolveFirst(impactResponse());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('30 Jun 2027')).toBeVisible();
    expect(screen.queryByText('31 Jul 2027')).not.toBeInTheDocument();
  });

  it('aborts the pending preview request when the editor closes', async () => {
    let capturedSignal: AbortSignal | undefined;
    previewMock.mockImplementationOnce((_id: string, _input: unknown, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });
    renderEditor();
    await advanceDebounce();

    await act(async () => {
      screen.getByRole('button', { name: 'Cancel' }).click();
    });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('reuses the latest fingerprint on save without issuing another preview', async () => {
    renderEditor();
    await advanceDebounce();
    expect(screen.getByText('31 Jul 2027')).toBeVisible();

    act(() => {
      changeCadence('MONTHLY');
    });
    await advanceDebounce();
    expect(previewMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      screen.getByRole('button', { name: 'Save changes' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateMock.mutateAsync).toHaveBeenCalled();
    expect(previewMock).toHaveBeenCalledTimes(2);
    const data = updateMock.mutateAsync.mock.calls[0][0].data;
    expect(data.impactFingerprint).toBe('f'.repeat(64));
  });

  it('does not invalidate a still-current fingerprint for display-name-only edits', async () => {
    renderEditor();
    await advanceDebounce();
    expect(screen.getByText('31 Jul 2027')).toBeVisible();

    const nameInput = screen.getByLabelText('Service name');
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(nameInput, 'Test Service Renamed');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(previewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByRole('button', { name: 'Save changes' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateMock.mutateAsync).toHaveBeenCalled();
    expect(previewMock).toHaveBeenCalledTimes(1);
    const data = updateMock.mutateAsync.mock.calls[0][0].data;
    expect(data.impactFingerprint).toBeUndefined();
  });

  it('surfaces a preview error without falling back to guessed dates', async () => {
    previewMock.mockRejectedValueOnce(new Error('Preview request failed'));
    renderEditor();
    await advanceDebounce();

    expect(screen.getByText(/Deadline preview is unavailable/)).toBeVisible();
    expect(screen.queryByText('31 Jul 2027')).not.toBeInTheDocument();
  });
});
