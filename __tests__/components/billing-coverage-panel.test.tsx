import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  useBillingCoverage: vi.fn(),
}));

vi.mock('@/hooks/use-billing-coverage', () => ({
  useBillingCoverage: hooks.useBillingCoverage,
}));

import { BillingCoveragePanel } from '@/components/services/billing/billing-coverage-panel';

const issueRows = [
  {
    id: 'issue-1',
    type: 'MISSING_DISPOSITION' as const,
    severity: 'ERROR' as const,
    company: { id: 'company-1', name: 'Northstar Holdings Pte. Ltd.', displayLabel: 'Northstar' },
    service: { id: 'service-1', name: 'Corporate Secretary', familyName: 'Corp Sec', familyColor: '#3C7768' },
    feeLine: null,
    message: 'Missing billing disposition',
  },
  {
    id: 'issue-2',
    type: 'MISSING_START_DATE' as const,
    severity: 'WARNING' as const,
    company: { id: 'company-2', name: 'Fieldstone Consulting Pte. Ltd.', displayLabel: 'Fieldstone' },
    service: { id: 'service-2', name: 'Monthly Payroll', familyName: 'Payroll', familyColor: '#715DA8' },
    feeLine: { id: 'fee-2', description: 'Monthly payroll fee' },
    message: 'Missing billing start date',
  },
];

describe('BillingCoveragePanel', () => {
  beforeEach(() => hooks.useBillingCoverage.mockReset());

  it('keeps reconciliation collapsed and renders cards only for issues', () => {
    hooks.useBillingCoverage.mockReturnValue({
      data: { openIssueCount: 2, affectedServiceCount: 2, healthyActiveServiceCount: 0, issues: issueRows },
      isLoading: false,
      error: null,
    });

    render(<BillingCoveragePanel />);

    const toggle = screen.getByRole('button', { name: /Billing reconciliation.*2 issues.*1 error/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Missing billing disposition')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getByText('Missing billing disposition')).toBeVisible();
    expect(screen.getAllByTestId('billing-issue-card')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Northstar · Corporate Secretary' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Fieldstone · Monthly Payroll' })).toBeVisible();
    expect(screen.getByRole('button', { name: /1 error · 1 warning/ })).toBeVisible();
  });

  it('renders one compact healthy summary without healthy service cards', () => {
    hooks.useBillingCoverage.mockReturnValue({
      data: { openIssueCount: 0, affectedServiceCount: 0, healthyActiveServiceCount: 24, issues: [] },
      isLoading: false,
      error: null,
    });

    render(<BillingCoveragePanel />);

    expect(screen.getByText('24 active services have complete billing configuration')).toBeVisible();
    expect(screen.queryAllByTestId('billing-issue-card')).toHaveLength(0);
  });
});
