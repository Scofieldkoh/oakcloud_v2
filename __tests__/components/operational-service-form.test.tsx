import { useEffect, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationalServiceForm } from '@/components/companies/company-detail/operational-service-form';
import {
  type DeadlinePreviewState,
  type OperationalServiceValues,
  createManualPayload,
  validateOperationalServiceValues,
} from '@/components/companies/company-detail/client-service-form-state';
import type { ClientServiceProjectedDeadlineDto } from '@/services/client-service';
import type { DateOnly } from '@/services/service-schedule';

const uuid = () => crypto.randomUUID();

function baseValues(): OperationalServiceValues {
  return {
    status: 'ACTIVE',
    serviceCadence: 'ANNUALLY',
    customCadenceLabel: '',
    startDate: '2026-08-01',
    endDate: '',
    billingDisposition: 'CONFIGURED',
    billingNotRequiredReason: '',
    fields: [{ uiId: uuid(), key: 'filingMonth', label: 'Filing month', type: 'text', value: 'July', catalogDerived: true }],
    fees: [{
      uiId: uuid(),
      id: 'fee-1',
      description: 'Annual service fee',
      amount: '1200.00',
      currency: 'SGD',
      billingFrequency: 'ANNUALLY',
      customFrequencyLabel: '',
      billingStartDate: '2026-08-01',
      scheduleConfig: {
        schemaVersion: 1,
        cadence: 'ANNUALLY',
        startDate: '2026-08-01',
        customInterval: { unit: 'MONTH', count: 12 },
        scheduleEntries: [{
          key: 'default',
          label: 'Billing date',
          expression: { kind: 'DAY_OF_MONTH', day: 1 },
          businessDayAdjustment: 'NONE',
        }],
      },
      catalogDerived: true,
    }],
    deadlineRules: [],
  };
}

function Harness({ initial, errors }: { initial: OperationalServiceValues; errors?: Record<string, string | undefined> }) {
  const [values, setValues] = useState(initial);
  useEffect(() => { setValues(initial); }, [initial]);
  return <OperationalServiceForm values={values} onChange={setValues} errors={errors ?? {}} />;
}

function PreviewHarness({ initial, deadlinePreview }: { initial: OperationalServiceValues; deadlinePreview?: DeadlinePreviewState }) {
  const [values, setValues] = useState(initial);
  return <OperationalServiceForm values={values} onChange={setValues} errors={{}} deadlinePreview={deadlinePreview} />;
}

function projected(
  milestoneKey: string,
  milestoneName: string,
  calculatedDueDate: string,
  policy: 'ROLLING_HORIZON' | 'AUTHORITATIVE_ANNUAL_BACKLOG' = 'ROLLING_HORIZON',
): ClientServiceProjectedDeadlineDto {
  return {
    ruleId: 'rule-1',
    ruleCode: policy === 'AUTHORITATIVE_ANNUAL_BACKLOG' ? 'SG_ANNUAL_RETURN' : 'SG_ECI',
    ruleName: 'Rule name',
    materializationPolicy: policy,
    periodKey: '2027',
    milestoneKey,
    milestoneName,
    scheduleEntryKey: '',
    deadlineType: 'STATUTORY',
    calculatedDueDate: calculatedDueDate as DateOnly,
    explanation: [`Source Company.accountsDueDate = ${calculatedDueDate}`],
  };
}

function enabledRulesValues(): OperationalServiceValues {
  return {
    ...baseValues(),
    deadlineRules: [{
      uiId: 'rule-test',
      ruleId: 'r-1',
      code: 'TEST_RULE',
      name: 'Test Rule',
      enabled: true,
      parameterValues: {},
      parameterProvenance: {},
      scheduleEntries: [],
      parameters: [],
      catalogDerived: true,
    }],
  };
}

describe('OperationalServiceForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('updates status, cadence, and dates through controlled changes', () => {
    render(<Harness initial={baseValues()} />);
    const status = screen.getByLabelText('Status');
    fireEvent.change(status, { target: { value: 'PAUSED' } });
    expect(status).toHaveValue('PAUSED');
    fireEvent.change(screen.getByLabelText('Cadence'), { target: { value: 'MONTHLY' } });
    expect(screen.getByLabelText('Cadence')).toHaveValue('MONTHLY');
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } });
    expect(screen.getByLabelText('Start date')).toHaveValue('1 Sep 2026');
  });

  it('shows the custom cadence control only for custom cadence', () => {
    const { rerender } = render(<Harness initial={baseValues()} />);
    expect(screen.queryByLabelText('Custom cadence')).not.toBeInTheDocument();
    const custom = { ...baseValues(), serviceCadence: 'CUSTOM' as const };
    rerender(<Harness initial={custom} />);
    expect(screen.getByLabelText('Custom cadence')).toBeVisible();
  });

  it('adds and removes optional service fields', () => {
    render(<Harness initial={baseValues()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.getByLabelText('Field 2 name')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
    expect(screen.queryByLabelText('Field 2 name')).not.toBeInTheDocument();
  });

  it('adds fees and protects the last remaining fee row', () => {
    render(<Harness initial={baseValues()} />);
    expect(screen.getByRole('button', { name: 'Remove fee' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add fee' }));
    expect(screen.getByLabelText('Fee 2 description')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Remove fee' })[0]).toBeEnabled();
  });

  it('rejects blank frequencies and blank or negative amounts while accepting 0.00', () => {
    const values = baseValues();
    const errors = validateOperationalServiceValues(values);
    expect(Object.values(errors).filter(Boolean)).toHaveLength(0);

    expect(Object.values(validateOperationalServiceValues({
      ...values,
      fees: [{ ...values.fees[0], amount: '' }],
    })).filter(Boolean)).not.toHaveLength(0);
    expect(Object.values(validateOperationalServiceValues({
      ...values,
      fees: [{ ...values.fees[0], amount: '-1.00' }],
    })).filter(Boolean)).not.toHaveLength(0);
    expect(Object.values(validateOperationalServiceValues({
      ...values,
      fees: [{ ...values.fees[0], billingFrequency: '' }],
    })).filter(Boolean)).not.toHaveLength(0);
    expect(Object.values(validateOperationalServiceValues({
      ...values,
      fees: [{ ...values.fees[0], amount: '0.00' }],
    })).filter(Boolean)).toHaveLength(0);
  });

  it('normalizes a blank not-required billing reason before submitting', () => {
    const payload = createManualPayload('variant-1', {
      ...baseValues(),
      billingDisposition: 'NOT_REQUIRED',
      billingNotRequiredReason: '   ',
      fees: [],
    }, false);

    expect(payload).toMatchObject({
      billingDisposition: 'NOT_REQUIRED',
      billingNotRequiredReason: null,
      feeLines: [],
    });
  });

  it('accepts custom frequency with interval months without requiring a manual label', () => {
    const values = baseValues();
    const valid = validateOperationalServiceValues({
      ...values,
      fees: [{ ...values.fees[0], billingFrequency: 'CUSTOM', customFrequencyLabel: '' }],
    });
    expect(valid[`fee-${values.fees[0].uiId}-custom-frequency`]).toBeUndefined();
  });

  it('requires a materializable billing schedule for configured fees', () => {
    const values = baseValues();
    expect(validateOperationalServiceValues({
      ...values,
      startDate: '',
      fees: [{ ...values.fees[0], billingStartDate: '' }],
    }).feeLines).toBeTruthy();
    expect(validateOperationalServiceValues({
      ...values,
      fees: [{ ...values.fees[0], scheduleConfig: { ...values.fees[0].scheduleConfig!, scheduleEntries: [] } }],
    }).feeLines).toBeTruthy();
  });

  it('lets custom billing schedules choose a non-default month interval', () => {
    const values = {
      ...baseValues(),
      fees: [{
        ...baseValues().fees[0],
        billingFrequency: 'CUSTOM' as const,
        customFrequencyLabel: 'Every 18 months',
        scheduleConfig: {
          schemaVersion: 1 as const,
          cadence: 'CUSTOM' as const,
          startDate: '2026-08-01' as const,
          customInterval: { unit: 'MONTH' as const, count: 1 },
          scheduleEntries: [{
            key: 'default', label: 'Billing date',
            expression: { kind: 'DAY_OF_MONTH' as const, day: 1 },
            businessDayAdjustment: 'NONE' as const,
          }],
        },
      }],
    };
    render(<Harness initial={values} />);
    const interval = screen.getByLabelText('Fee 1 custom interval months');
    expect(interval).toHaveValue(1);
    fireEvent.change(interval, { target: { value: '18' } });
    expect(interval).toHaveValue(18);
  });

  it('preserves every authored schedule entry when cadence or start date changes', () => {
    const values = baseValues();
    const repeatableValues: OperationalServiceValues = {
      ...values,
      deadlineRules: [{
        uiId: 'rule-test',
        ruleId: 'r-1',
        code: 'TEST_RULE',
        name: 'Test Rule',
        enabled: true,
        parameterValues: {},
        parameterProvenance: {},
        scheduleEntries: [
          {
            key: 'primary',
            label: 'Primary filing date',
            expression: { kind: 'DAY_OF_MONTH' as const, day: 1 },
            businessDayAdjustment: 'NONE' as const,
          },
          {
            key: 'follow-up',
            label: 'Follow-up filing date',
            expression: { kind: 'DAY_OF_MONTH' as const, day: 15 },
            businessDayAdjustment: 'NEXT' as const,
          },
        ],
        parameters: [],
        catalogDerived: true,
      }],
    };
    render(<Harness initial={repeatableValues} />);
    fireEvent.click(screen.getByText('Test Rule'));
    const labels = () => screen.getAllByLabelText('Entry label').map((input) => (input as HTMLInputElement).value);
    const keys = () => screen.getAllByLabelText('Entry label').map((input) => input.id.replace(/^schedule-/, '').replace(/-label$/, ''));

    expect(labels()).toEqual(['Primary filing date', 'Follow-up filing date']);
    expect(keys()).toEqual(['primary', 'follow-up']);
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } });
    expect(labels()).toEqual(['Primary filing date', 'Follow-up filing date']);
    expect(keys()).toEqual(['primary', 'follow-up']);
    fireEvent.change(screen.getByLabelText('Cadence'), { target: { value: 'MONTHLY' } });
    expect(labels()).toEqual(['Primary filing date', 'Follow-up filing date']);
    expect(keys()).toEqual(['primary', 'follow-up']);
    expect(screen.getAllByLabelText('Day of month').map((input) => (input as HTMLInputElement).value)).toEqual(['1', '15']);
  });

  it('associates field-addressable errors with their controls', () => {
    const values = baseValues();
    const feeId = values.fees[0].uiId;
    render(<Harness initial={values} errors={{ [`fee-${feeId}-amount`]: 'Enter a non-negative amount with at most two decimals.' }} />);
    const amount = screen.getByLabelText('Fee 1 amount');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    const errorId = amount.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toHaveTextContent('Enter a non-negative amount with at most two decimals.');
  });

  it('renders catalog labels and type-appropriate field controls', () => {
    const values: OperationalServiceValues = {
      ...baseValues(),
      fields: [
        { uiId: 'text', key: 'software', label: 'Accounting software', type: 'text', value: 'Xero', catalogDerived: true },
        { uiId: 'date', key: 'renewalDate', label: 'Renewal date', type: 'date', value: '2026-08-01', catalogDerived: true },
        { uiId: 'number', key: 'headcount', label: 'Headcount', type: 'number', value: '25', catalogDerived: true },
        { uiId: 'currency', key: 'budget', label: 'Budget', type: 'currency', value: '1200.00', catalogDerived: true },
        { uiId: 'boolean', key: 'gstRegistered', label: 'GST registered', type: 'boolean', value: 'true', catalogDerived: true },
        { uiId: 'textarea', key: 'notes', label: 'Service notes', type: 'textarea', value: 'Priority filing', catalogDerived: true },
      ],
    };
    render(<Harness initial={values} />);

    expect(screen.getByLabelText('Renewal date')).toBeVisible();
    expect(screen.getByLabelText('Renewal date')).toHaveValue('1 Aug 2026');
    expect(screen.getByLabelText('Headcount')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText('Budget')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText('GST registered').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Service notes').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Accounting software')).toHaveValue('Xero');
  });

  it('associates catalog field errors with the matching field control', () => {
    const values: OperationalServiceValues = {
      ...baseValues(),
      fields: [{ uiId: 'software', key: 'software', label: 'Software', type: 'text', value: '', catalogDerived: true }],
    };
    render(<Harness initial={values} errors={{ 'field-software-value': 'Enter a value.' }} />);
    const field = screen.getByLabelText('Software');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const errorId = field.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toHaveTextContent('Enter a value.');
  });

  it('renders cadence and billing frequency options in proper case', () => {
    render(<Harness initial={baseValues()} />);
    const cadenceSelect = screen.getByLabelText('Cadence');
    const cadenceOptionLabels = Array.from(cadenceSelect.querySelectorAll('option')).map((opt) => opt.textContent);
    expect(cadenceOptionLabels).toEqual([
      'Monthly',
      'Quarterly',
      'Semi-annually',
      'Annually',
      'One-time',
      'Ad-hoc',
      'Custom',
    ]);

    const frequencySelect = screen.getByLabelText('Fee 1 frequency');
    const frequencyOptionLabels = Array.from(frequencySelect.querySelectorAll('option')).map((opt) => opt.textContent);
    expect(frequencyOptionLabels).toEqual([
      'Select frequency',
      'Monthly',
      'Quarterly',
      'Semi-annually',
      'Annually',
      'One-time',
      'Custom',
    ]);
  });

  it('shows tooltip guidance for custom cadence', () => {
    const customValues: OperationalServiceValues = {
      ...baseValues(),
      serviceCadence: 'CUSTOM',
      customCadenceLabel: 'Every 18 months',
    };
    render(<Harness initial={customValues} />);
    expect(screen.getByText('Custom cadence help')).toBeInTheDocument();
  });

  it('shows archive confirmation in edit mode when switching to NOT_REQUIRED with existing fees', () => {
    function EditHarness() {
      const [values, setValues] = useState(baseValues());
      return <OperationalServiceForm mode="edit" values={values} onChange={setValues} errors={{}} />;
    }
    render(<EditHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'No billing required' }));
    expect(screen.getByRole('dialog', { name: 'Hide billing schedules?' })).toBeInTheDocument();
    expect(screen.getByText(/This will archive the active billing schedules/)).toBeInTheDocument();
  });

  it('does not show archive confirmation in create mode when switching to NOT_REQUIRED', () => {
    function CreateHarness() {
      const [values, setValues] = useState(baseValues());
      return <OperationalServiceForm mode="create" values={values} onChange={setValues} errors={{}} />;
    }
    render(<CreateHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'No billing required' }));
    expect(screen.queryByRole('dialog', { name: 'Hide billing schedules?' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No billing required' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('counts no billing items on the Billing tab once billing is not required', () => {
    render(<Harness initial={{ ...baseValues(), billingDisposition: 'NOT_REQUIRED' }} />);
    expect(screen.getByRole('tab', { name: /Billing/ })).toHaveTextContent('Billing0');
    fireEvent.click(screen.getByRole('button', { name: 'Billing configured' }));
    expect(screen.getByRole('tab', { name: /Billing/ })).toHaveTextContent('Billing2');
  });

  it('lets staff pick a filing status per obligation and confirm the first financial period', () => {
    const onStatus = vi.fn();
    const onConfirm = vi.fn();
    render(
      <OperationalServiceForm
        mode="create"
        values={{ ...baseValues(), deadlineRules: [] }}
        onChange={() => undefined}
        errors={{}}
        monitoringProfiles={['CORPORATE_TAX']}
        companyObligationStatuses={{}}
        onCompanyObligationStatusChange={onStatus}
        onConfirmFirstPeriod={onConfirm}
        companyObligations={{
          isLoading: false,
          error: null,
          notices: ['Confirm the first financial year end after incorporation.'],
          firstPeriodUnconfirmed: true,
          statusEditable: true,
          firstYearOfAssessment: null,
          items: [{
            obligationCode: 'SG_ECI',
            obligationName: 'Estimated Chargeable Income (ECI)',
            periodKey: 'FY2024-12-31',
            milestoneName: 'ECI filing',
            dueDate: '2025-03-31' as DateOnly,
            yearOfAssessment: 2025,
            periodProvisional: true,
            coverageTiming: 'DURING',
            explanation: [],
            recordedStatus: null,
            projectedStatus: 'TO_BE_CONFIRMED',
          }],
        }}
      />,
    );

    expect(screen.getByText('YA 2025')).toBeInTheDocument();
    expect(screen.queryByText('YA 2025?')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm the first financial year end after incorporation.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm first FYE' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    const select = screen.getByRole('combobox', { name: /Filing status for Estimated Chargeable Income/ });
    expect(select).toHaveValue('TO_BE_CONFIRMED');
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'To be confirmed', 'Pending filing', 'Filed', 'Managed externally', 'Not required',
    ]);
    fireEvent.change(select, { target: { value: 'FILED' } });
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ obligationCode: 'SG_ECI', periodKey: 'FY2024-12-31' }), 'FILED');
  });

  it('labels ACRA rows and a corporate secretarial engagement start by financial year', () => {
    const onEngagementStart = vi.fn();
    const item = (obligationCode: string, obligationName: string, dueDate: string) => ({
      obligationCode,
      obligationName,
      periodKey: 'FY2026-12-31',
      milestoneName: obligationName,
      dueDate: dueDate as DateOnly,
      yearOfAssessment: 2027,
      periodProvisional: false,
      coverageTiming: 'DURING' as const,
      explanation: [],
      recordedStatus: null,
      projectedStatus: 'PENDING_FILING' as const,
    });
    render(
      <OperationalServiceForm
        mode="create"
        values={{ ...baseValues(), deadlineRules: [] }}
        onChange={() => undefined}
        errors={{}}
        monitoringProfiles={['CORPORATE_SECRETARIAL']}
        companyObligationStatuses={{}}
        onCompanyObligationStatusChange={() => undefined}
        engagementStartYearOfAssessment={2027}
        onEngagementStartChange={onEngagementStart}
        companyObligations={{
          isLoading: false,
          error: null,
          notices: [],
          firstPeriodUnconfirmed: false,
          statusEditable: true,
          firstYearOfAssessment: 2026,
          items: [
            item('SG_AGM_DUE', 'Annual general meeting (AGM)', '2027-06-30'),
            item('SG_ANNUAL_RETURN', 'Annual return (AR)', '2027-07-31'),
          ],
        }}
      />,
    );

    expect(screen.getByText('Corporate secretarial: AGM and annual return, tracked from the service start date once saved.')).toBeInTheDocument();
    expect(screen.getAllByText('FY 2026', { selector: 'span' })).toHaveLength(2);
    expect(screen.queryByText('YA 2027')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filing status for Annual general meeting (AGM) FY 2026' })).toHaveValue('PENDING_FILING');
    const start = screen.getByRole('combobox', { name: 'Our engagement starts from' });
    expect([...start.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Not set', 'FY 2026', 'FY 2025']);
    fireEvent.change(start, { target: { value: '2026' } });
    expect(onEngagementStart).toHaveBeenCalledWith(2026);
  });

  it('sets the engagement start YA, shows projected statuses and tints rows by status', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T10:00:00+08:00'));
    const onEngagementStart = vi.fn();
    const item = (periodKey: string, yearOfAssessment: number, dueDate: string, overrides: Record<string, unknown> = {}) => ({
      obligationCode: 'SG_ECI',
      obligationName: 'Estimated Chargeable Income (ECI)',
      periodKey,
      milestoneName: 'ECI filing',
      dueDate: dueDate as DateOnly,
      yearOfAssessment,
      periodProvisional: false,
      coverageTiming: 'DURING' as const,
      explanation: [],
      recordedStatus: null,
      projectedStatus: 'TO_BE_CONFIRMED' as const,
      ...overrides,
    });
    render(
      <OperationalServiceForm
        mode="create"
        values={{ ...baseValues(), deadlineRules: [] }}
        onChange={() => undefined}
        errors={{}}
        monitoringProfiles={['CORPORATE_TAX']}
        companyObligationStatuses={{}}
        onCompanyObligationStatusChange={() => undefined}
        engagementStartYearOfAssessment={2027}
        onEngagementStartChange={onEngagementStart}
        companyObligations={{
          isLoading: false,
          error: null,
          notices: [],
          firstPeriodUnconfirmed: false,
          statusEditable: true,
          firstYearOfAssessment: 2024,
          items: [
            item('FY2025-12-31', 2026, '2026-03-31', { recordedStatus: 'FILED' }),
            item('FY2026-12-31', 2027, '2027-03-31', { projectedStatus: 'PENDING_FILING' }),
          ],
        }}
      />,
    );

    const start = screen.getByRole('combobox', { name: 'Our engagement starts from' });
    expect(start).toHaveValue('2027');
    expect([...start.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Not set', 'YA 2027', 'YA 2026', 'YA 2025', 'YA 2024']);
    fireEvent.change(start, { target: { value: '2026' } });
    expect(onEngagementStart).toHaveBeenCalledWith(2026);

    const filed = screen.getByRole('combobox', { name: /YA 2026$/ });
    const pending = screen.getByRole('combobox', { name: /YA 2027$/ });
    expect(filed).toHaveValue('FILED');
    expect(pending).toHaveValue('PENDING_FILING');
    expect(filed.closest('[data-status]')).toHaveClass('bg-status-success/10');
    expect(pending.closest('[data-status]')).toHaveClass('bg-background-elevated');

    // The YA badge sits before the due date.
    const row = pending.closest('[data-status]') as HTMLElement;
    const badge = within(row).getByText('YA 2027');
    const date = within(row).getByText('31 Mar 2027');
    expect(badge.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Due dates after today are green; past ones stay plain.
    expect(date.closest('[data-upcoming]')).toHaveClass('text-status-success');
    expect(within(filed.closest('[data-status]') as HTMLElement).getByText('31 Mar 2026').closest('[data-upcoming]')).toBeNull();
    vi.useRealTimers();
  });

  it('lists the company obligations a monitored service tracks and counts them on the Deadline tab', () => {
    const { rerender } = render(<OperationalServiceForm values={{ ...baseValues(), deadlineRules: [] }} onChange={() => undefined} errors={{}} />);
    expect(screen.queryByRole('heading', { name: 'Company obligations' })).not.toBeInTheDocument();

    rerender(
      <OperationalServiceForm
        mode="create"
        values={{ ...baseValues(), deadlineRules: [] }}
        onChange={() => undefined}
        errors={{}}
        monitoringProfiles={['CORPORATE_TAX']}
        companyObligations={{
          isLoading: false,
          error: null,
          notices: ['Corporate income tax return is monitored but its SG_FORM_C rule is not published yet.'],
          items: [{
            obligationCode: 'SG_ECI',
            obligationName: 'Estimated Chargeable Income (ECI)',
            periodKey: 'FY2026-12-31',
            milestoneName: 'ECI filing',
            dueDate: '2027-03-31' as DateOnly,
            yearOfAssessment: 2027,
            periodProvisional: false,
            coverageTiming: 'DURING',
            explanation: ['Due three months after the financial year ends'],
            recordedStatus: null,
            projectedStatus: 'TO_BE_CONFIRMED',
          }],
          firstPeriodUnconfirmed: false,
          statusEditable: false,
          firstYearOfAssessment: null,
        }}
      />,
    );

    expect(screen.getByRole('tab', { name: /Deadline/ })).toHaveTextContent('Deadline1');
    expect(screen.getByRole('heading', { name: 'Company obligations' })).toBeInTheDocument();
    expect(screen.getByText('Estimated Chargeable Income (ECI)')).toBeInTheDocument();
    expect(screen.getByText('31 Mar 2027')).toBeInTheDocument();
    expect(screen.getByText('YA 2027')).toBeInTheDocument();
    expect(screen.getByText('To be confirmed')).toBeInTheDocument();
    expect(screen.queryByText(/Due three months/)).not.toBeInTheDocument();
    expect(screen.getByText(/SG_FORM_C rule is not published yet/)).toBeInTheDocument();
    expect(screen.queryByText('No deadline rules are associated with this service.')).not.toBeInTheDocument();
  });

  it('renders rules collapsed by default and expands on click to reveal parameters and schedule', () => {
    const valuesWithRules: OperationalServiceValues = {
      ...baseValues(),
      deadlineRules: [{
        uiId: 'rule-agm',
        ruleId: 'r-1',
        code: 'SG_AGM',
        name: 'Singapore Annual General Meeting',
        enabled: true,
        parameterValues: {},
        parameterProvenance: {},
        scheduleEntries: [{
          key: 'e-1',
          label: 'AGM Milestone',
          expression: { kind: 'DAY_OF_MONTH', day: 30 },
          businessDayAdjustment: 'NONE',
        }],
        parameters: [{
          key: 'meetingType',
          label: 'Meeting type',
          type: 'STRING',
          description: null,
          required: false,
          defaultValue: null,
          validation: null,
          helpText: null,
          displayOrder: 0,
        }],
        catalogDerived: true,
      }],
    };

    render(<Harness initial={valuesWithRules} />);
    expect(screen.getByText('Singapore Annual General Meeting')).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Enable Singapore Annual General Meeting' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Add custom schedule for Singapore Annual General Meeting' })).toBeVisible();
    expect(screen.queryByLabelText('Meeting type')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Singapore Annual General Meeting'));
    expect(screen.getByLabelText('Meeting type')).toBeVisible();
    expect(screen.getByLabelText('Entry label')).toHaveValue('AGM Milestone');
  });

  it('does not expand rules without parameters or custom schedules until Add custom schedule is clicked', () => {
    const valuesWithSimpleRule: OperationalServiceValues = {
      ...baseValues(),
      deadlineRules: [{
        uiId: 'rule-simple',
        ruleId: 'r-simple',
        code: 'SIMPLE_RULE',
        name: 'Simple Statutory Rule',
        enabled: true,
        parameterValues: {},
        parameterProvenance: {},
        scheduleEntries: [],
        parameters: [],
        catalogDerived: true,
      }],
    };

    render(<Harness initial={valuesWithSimpleRule} />);
    expect(screen.getByRole('heading', { name: 'Simple Statutory Rule' })).toBeVisible();
    expect(screen.queryByLabelText('Entry label')).not.toBeInTheDocument();

    // Clicking header should not expand since there's no custom schedule
    fireEvent.click(screen.getByRole('heading', { name: 'Simple Statutory Rule' }));
    expect(screen.queryByLabelText('Entry label')).not.toBeInTheDocument();

    // Clicking "Add custom schedule" automatically creates entry and expands
    fireEvent.click(screen.getByRole('button', { name: 'Add custom schedule for Simple Statutory Rule' }));
    expect(screen.getByLabelText('Entry label')).toBeVisible();
  });

  it('renders canonical server-projected deadline dates verbatim without local recomputation', () => {
    render(<PreviewHarness initial={enabledRulesValues()} deadlinePreview={{
      state: 'SUCCESS',
      items: [
        projected('agm-due', 'AGM due', '2027-06-30'),
        projected('annual-return-due', 'Annual Return', '2027-07-31'),
      ],
      warnings: [],
      fingerprint: 'f'.repeat(64),
      payloadHash: 'payload',
    }} />);

    expect(screen.getByText('Canonical deadline preview')).toBeVisible();
    expect(screen.getByRole('tab', { name: /Deadline2/ })).toBeVisible();
    expect(screen.getByText('30 Jun 2027')).toBeVisible();
    expect(screen.getByText('31 Jul 2027')).toBeVisible();
    expect(screen.getByText('2 scheduled milestones')).toBeVisible();
  });

  it('sorts supplied canonical items chronologically and renders server explanations', () => {
    render(<PreviewHarness initial={enabledRulesValues()} deadlinePreview={{
      state: 'SUCCESS',
      items: [
        projected('annual-return-due', 'Annual Return', '2027-07-31'),
        projected('agm-due', 'AGM due', '2027-06-30'),
      ],
      warnings: [],
      fingerprint: 'f'.repeat(64),
      payloadHash: 'payload',
    }} />);

    const dates = screen.getAllByText(/2027$/);
    expect(dates.map((node) => node.textContent)).toEqual(['30 Jun 2027', '31 Jul 2027']);
    expect(screen.getAllByText(/Source Company\.accountsDueDate/).length).toBe(2);
  });

  it('renders an authoritative backlog badge only for pre-today authoritative items', () => {
    render(<PreviewHarness initial={enabledRulesValues()} deadlinePreview={{
      state: 'SUCCESS',
      items: [
        projected('agm-due', 'AGM due', '2024-06-30', 'AUTHORITATIVE_ANNUAL_BACKLOG'),
        projected('annual-return-due', 'Annual Return', '2027-07-31', 'AUTHORITATIVE_ANNUAL_BACKLOG'),
        projected('eci-due', 'ECI due', '2027-03-31', 'ROLLING_HORIZON'),
      ],
      warnings: [],
      fingerprint: 'f'.repeat(64),
      payloadHash: 'payload',
    }} />);

    expect(screen.getAllByText('Authoritative backlog')).toHaveLength(1);
    expect(screen.getByText('30 Jun 2024')).toBeVisible();
    expect(screen.getAllByText('Scheduled').length).toBe(2);
  });

  it('renders loading, empty, and error states without guessing local dates', () => {
    const { rerender } = render(<PreviewHarness initial={enabledRulesValues()} deadlinePreview={{
      state: 'LOADING',
      items: [projected('agm-due', 'AGM due', '2027-06-30')],
      warnings: [],
    }} />);
    expect(screen.getByText(/Refreshing deadline preview/)).toBeVisible();
    expect(screen.getByText('30 Jun 2027')).toBeVisible();

    rerender(<PreviewHarness initial={enabledRulesValues()} deadlinePreview={{
      state: 'IDLE',
      items: [],
      warnings: [],
    }} />);
    expect(screen.getByText('No canonical deadlines projected for the active rules.')).toBeVisible();

    rerender(<PreviewHarness initial={enabledRulesValues()} deadlinePreview={{
      state: 'ERROR',
      items: [],
      warnings: [],
      message: 'Preview request failed',
    }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Deadline preview is unavailable: Preview request failed');
  });

  it('never renders a guessed schedule count in create mode without a server preview', () => {
    render(<OperationalServiceForm mode="create" values={enabledRulesValues()} onChange={vi.fn()} errors={{}} />);
    expect(screen.queryByText('Canonical deadline preview')).not.toBeInTheDocument();
    expect(screen.queryByText(/scheduled milestone/)).not.toBeInTheDocument();
    expect(screen.getByText(/Deadlines are generated by the deadline engine when this service is saved/)).toBeVisible();
  });

  it('renders truncation warnings prominently instead of hiding them', () => {
    render(<PreviewHarness initial={enabledRulesValues()} deadlinePreview={{
      state: 'SUCCESS',
      items: [projected('annual-return-due', 'Annual Return', '2027-07-31', 'AUTHORITATIVE_ANNUAL_BACKLOG')],
      warnings: ['Annual deadline backlog was truncated: 8 older cycles excluded; oldest retained year is 2008.'],
      fingerprint: 'f'.repeat(64),
      payloadHash: 'payload',
    }} />);

    expect(screen.getByRole('status')).toHaveTextContent('8 older cycles excluded');
  });

  it('renders a billing preview panel with calculated billing dates and amounts', () => {
    const valuesWithFees: OperationalServiceValues = {
      ...baseValues(),
      deadlineRules: [],
      startDate: '2026-08-01',
      fees: [
        {
          uiId: 'fee-1',
          id: 'f-1',
          description: 'Corporate Secretarial Annual Fee',
          amount: '1200.00',
          currency: 'SGD',
          billingFrequency: 'ANNUALLY',
          customFrequencyLabel: '',
          billingStartDate: '2026-08-01',
          scheduleConfig: null,
          catalogDerived: true,
        },
      ],
    };

    render(<Harness initial={valuesWithFees} />);
    expect(screen.getByText('Billing Preview')).toBeVisible();
    expect(screen.getAllByText('Corporate Secretarial Annual Fee')[0]).toBeVisible();
    expect(screen.getAllByText('1 Aug 2026')[0]).toBeVisible();
    expect(screen.getByText(/Annual billing \(Year 1\) · SGD 1200.00/)).toBeVisible();
  });

  it('generates 12 monthly occurrences in billing preview for monthly fees', () => {
    const valuesWithMonthlyFee: OperationalServiceValues = {
      ...baseValues(),
      deadlineRules: [],
      startDate: '2026-08-01',
      fees: [
        {
          uiId: 'fee-monthly',
          id: 'f-m',
          description: 'Monthly Bookkeeping',
          amount: '500.00',
          currency: 'SGD',
          billingFrequency: 'MONTHLY',
          customFrequencyLabel: '',
          billingStartDate: '2026-08-01',
          scheduleConfig: null,
          catalogDerived: true,
        },
      ],
    };

    render(<Harness initial={valuesWithMonthlyFee} />);
    expect(screen.getByRole('tab', { name: /Billing12/ })).toBeVisible();
    expect(screen.getByText('12 billing items')).toBeVisible();
    expect(screen.getByText('Month 1 of 12 · SGD 500.00')).toBeVisible();
    expect(screen.getByText('Month 12 of 12 · SGD 500.00')).toBeVisible();
    expect(screen.getByText('1 Jul 2027')).toBeVisible();
  });
});
