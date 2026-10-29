import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyIncorporationReviewPanel } from '@/components/forms/company-incorporation-review-panel';
import { emptyIncorporationReview, evaluateIncorporationReadiness } from '@/lib/forms/company-incorporation-review';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  error: vi.fn(),
  view: null as unknown,
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: mocks.error }),
}));

vi.mock('@/hooks/use-company-incorporation-review', () => ({
  useCompanyIncorporationReview: () => ({ data: mocks.view, isLoading: false, error: null }),
  useKycSourceSearch: () => ({ data: [], isFetching: false }),
  useUpdateCompanyIncorporationReview: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

function buildView() {
  const review = emptyIncorporationReview();
  const subjects = [{
    subjectId: 'party_1',
    origin: 'party' as const,
    partyRowId: 'party_1',
    kind: 'individual' as const,
    name: 'Tan Mei Ling',
    roles: ['shareholder', 'director'],
    createdAt: '2026-09-29T00:00:00.000Z',
    createdBy: null,
  }];
  return {
    reference: 'ABC12345',
    intake: {
      templateKey: 'sg_company_incorporation',
      templateVersion: 1,
      profileVersion: 1,
      definitionHash: 'hash',
      evaluatedAt: '2026-09-29T00:00:00.000Z',
      issues: [{ code: 'office_firm_service', severity: 'staff_review', section: 'settings', message: 'Registered office service requested.' }],
      ownershipTotal: '100',
      ownershipFullyDecided: true,
      partyRows: [{ partyRowId: 'party_1', rowIndex: 0, kind: 'individual', name: 'Tan Mei Ling', roles: ['shareholder', 'director'], ownershipPercent: '100', ownershipUndecided: false }],
      ssic: { catalogue: 'SSIC 2025', primary: { code: '62011', label: '62011 Software development' }, secondary: null },
      definitionSnapshot: [],
    },
    subjects,
    review: { ...review, subjects: [] },
    linkStatus: {},
    readiness: evaluateIncorporationReadiness({ review: { ...review, subjects }, linkStatus: {} }),
    sourceCandidates: [],
  };
}

describe('CompanyIncorporationReviewPanel', () => {
  beforeEach(() => {
    mocks.view = buildView();
    mocks.mutateAsync.mockReset().mockResolvedValue(buildView());
  });

  it('shows the intake summary, people and a not-ready banner', () => {
    render(<CompanyIncorporationReviewPanel formId="form-1" submissionId="sub-1" />);

    expect(screen.getByText(/Not ready for filing preparation/)).toBeInTheDocument();
    expect(screen.getByText('62011 Software development')).toBeInTheDocument();
    expect(screen.getByText('Registered office service requested.')).toBeInTheDocument();
    expect(screen.getByText('Tan Mei Ling')).toBeInTheDocument();
    expect(screen.getByText('KYC source not linked')).toBeInTheDocument();
  });

  it('sends checklist decisions with the current revision', () => {
    render(<CompanyIncorporationReviewPanel formId="form-1" submissionId="sub-1" />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Registered office status' }), { target: { value: 'satisfied' } });
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      action: 'set_decision',
      areaKey: 'registered_office',
      state: 'satisfied',
      note: null,
      expectedRevision: 0,
    });
  });

  it('records a KYC source held outside Oakcloud', () => {
    render(<CompanyIncorporationReviewPanel formId="form-1" submissionId="sub-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Link KYC' }));
    fireEvent.click(screen.getByLabelText('Held elsewhere'));
    fireEvent.change(screen.getByLabelText('Where the KYC evidence is kept'), { target: { value: 'SharePoint > KYC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));

    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      action: 'link_kyc',
      subjectId: 'party_1',
      sourceKind: 'manual',
      manualLocation: 'SharePoint > KYC',
      reviewState: 'received',
    }));
  });
});
