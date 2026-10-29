import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  merge: vi.fn(),
  reject: vi.fn(),
  refetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  invalidateRejections: vi.fn(),
  currentPage: 1,
}));

const ids = {
  recommended: '11111111-1111-4111-8111-111111111111',
  alternate: '22222222-2222-4222-8222-222222222222',
  third: '33333333-3333-4333-8333-333333333333',
};

const contacts = [
  {
    id: ids.recommended, contactType: 'INDIVIDUAL', fullName: 'Alex Tan', firstName: 'Alex', lastName: 'Tan',
    corporateName: null, alias: 'A. Tan', identificationType: 'NRIC', identificationNumber: 'S1234567A',
    corporateUen: null, nationality: 'Singaporean', dateOfBirth: '1990-01-01', fullAddress: '1 Oak Street',
    contactDetails: [{ detailType: 'EMAIL', value: 'alex@example.com', companyId: null }],
    companies: [{ id: 'company-1', name: 'Oak Pte Ltd', uen: '202000001A' }],
    referenceCounts: { companyRelations: 1, officerPositions: 1, shareholdings: 0, chargeHoldings: 0, contactDetails: 1, noteTabs: 1, documentRevisions: 2, aliases: 1 },
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: ids.alternate, contactType: 'INDIVIDUAL', fullName: 'Alex TÃ¡n', firstName: 'Alex', lastName: 'TÃ¡n',
    corporateName: null, alias: null, identificationType: 'NRIC', identificationNumber: 'S7654321B',
    corporateUen: null, nationality: 'Singaporean', dateOfBirth: '1990-01-01', fullAddress: '1 Oak Street',
    contactDetails: [{ detailType: 'PHONE', value: '+65 6123 4567', companyId: null }], companies: [],
    referenceCounts: { companyRelations: 0, officerPositions: 0, shareholdings: 1, chargeHoldings: 0, contactDetails: 1, noteTabs: 0, documentRevisions: 0, aliases: 0 },
    createdAt: '2025-02-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: ids.third, contactType: 'INDIVIDUAL', fullName: 'A Tan', firstName: 'A', lastName: 'Tan',
    corporateName: null, alias: null, identificationType: 'PASSPORT', identificationNumber: 'P9999999',
    corporateUen: null, nationality: null, dateOfBirth: null, fullAddress: null,
    contactDetails: [], companies: [],
    referenceCounts: { companyRelations: 0, officerPositions: 0, shareholdings: 0, chargeHoldings: 1, contactDetails: 0, noteTabs: 0, documentRevisions: 0, aliases: 0 },
    createdAt: '2025-03-01T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z',
  },
];

const group = {
  contactIds: Object.values(ids), contacts, reasons: ['EXACT_CANONICAL_NAME', 'FUZZY_NAME'], confidence: 92,
  conflicts: [{ field: 'identificationNumber', incomingValue: 'S7654321B', existingValue: 'S1234567A' }],
  blockedByIdentifierConflict: true,
  fingerprints: { [ids.recommended]: 'a'.repeat(64), [ids.alternate]: 'b'.repeat(64), [ids.third]: 'c'.repeat(64) },
  recommendedMasterId: ids.recommended,
};

let queryData: { groups: typeof group[]; total: number; page: number; limit: number; totalPages: number };
let queryError: Error | null;

vi.mock('@/hooks/use-contacts', () => ({
  useContactDuplicateGroups: (page: number) => {
    mocks.currentPage = page;
    return { data: queryData, isLoading: false, isFetching: false, error: queryError, refetch: mocks.refetch };
  },
  useRejectContactDuplicate: () => ({ mutateAsync: mocks.reject, isPending: false, invalidateQueries: mocks.invalidateRejections }),
  useMergeContacts: () => ({ mutateAsync: mocks.merge, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error }),
}));

import { ContactDuplicateReviewModal } from '@/components/contacts/contact-duplicate-review-modal';

describe('ContactDuplicateReviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryData = { groups: [group], total: 1, page: 1, limit: 20, totalPages: 1 };
    queryError = null;
    mocks.refetch.mockResolvedValue({ data: queryData });
    mocks.merge.mockResolvedValue({ survivingContactId: ids.recommended });
    mocks.reject.mockResolvedValue({ rejected: true });
    mocks.invalidateRejections.mockResolvedValue(undefined);
  });

  it('renders confidence reasons, the recommended master, and responsive contact cards', async () => {
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);

    expect(await screen.findByText('92% confidence')).toBeVisible();
    expect(screen.getByText('Exact canonical name')).toBeVisible();
    expect(screen.getByText('Fuzzy name')).toBeVisible();
    expect(screen.getByLabelText('Use Alex Tan as master')).toBeChecked();
    expect(screen.getAllByTestId('duplicate-contact-mobile-card')).toHaveLength(3);
    expect(screen.getByText('Oak Pte Ltd')).toBeVisible();
    const firstCard = screen.getAllByTestId('duplicate-contact-mobile-card')[0];
    expect(within(firstCard).getByText(/Officers 1/)).toBeVisible();
    expect(within(firstCard).getByText(/Shareholders 0/)).toBeVisible();
    expect(within(firstCard).getByText(/Charges 0/)).toBeVisible();
    expect(within(firstCard).getByText(/Notes 1/)).toBeVisible();
    expect(within(firstCard).getByText(/Documents 2/)).toBeVisible();
    expect(within(firstCard).getByText(/Aliases 1/)).toBeVisible();
    expect(within(firstCard).queryByText(/Workflow/)).not.toBeInTheDocument();
  });

  it('offers every unique conflicting value in a multi-source group', async () => {
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('Use identification number P9999999'));
    fireEvent.click(screen.getByRole('button', { name: /merge contacts/i }));
    fireEvent.click(await screen.findByRole('button', { name: /permanently merge/i }));

    await waitFor(() => expect(mocks.merge).toHaveBeenCalled());
    expect(mocks.merge.mock.calls[0][0].fieldDecisions).toMatchObject({
      identificationType: 'PASSPORT',
      identificationNumber: 'P9999999',
    });
  });

  it('allows an alternate master while keeping every other group member as a source', async () => {
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('Use Alex TÃ¡n as master'));
    fireEvent.click(screen.getByLabelText(/use master identification number/i));
    fireEvent.click(screen.getByRole('button', { name: /merge contacts/i }));
    fireEvent.click(await screen.findByRole('button', { name: /permanently merge/i }));

    await waitFor(() => expect(mocks.merge).toHaveBeenCalled());
    expect(mocks.merge.mock.calls[0][0]).toMatchObject({
      masterContactId: ids.alternate,
      sourceContactIds: [ids.recommended, ids.third],
    });
  });

  it('requires conflict resolution and warns that sources are permanently deleted', async () => {
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    expect(await screen.findByText(/identifier conflict blocks this merge/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /merge contacts/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /merge contacts/i })).toHaveClass('min-h-11');
    fireEvent.click(screen.getByLabelText(/use master identification number/i));
    expect(screen.getByRole('button', { name: /merge contacts/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /merge contacts/i }));

    const confirmation = await screen.findByRole('dialog', { name: /permanently merge contacts/i });
    expect(within(confirmation).getByText('The duplicate source records will be permanently deleted. Only the selected master contact will remain.')).toBeVisible();
  });

  it('requires a rejection reason before rejecting the recommendation', async () => {
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /reject recommendation/i }));
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'These are different people' } });
    fireEvent.click(screen.getByRole('button', { name: /^reject all pairs$/i }));

    await waitFor(() => expect(mocks.reject).toHaveBeenCalledTimes(3));
    expect(mocks.reject.mock.calls.map(([input]) => [input.leftContactId, input.rightContactId])).toEqual([
      [ids.recommended, ids.alternate],
      [ids.recommended, ids.third],
      [ids.alternate, ids.third],
    ]);
  });

  it('keeps partial group rejection failures visible and retryable', async () => {
    mocks.reject.mockResolvedValueOnce({ rejected: true }).mockRejectedValueOnce(new Error('Temporary rejection failure')).mockResolvedValueOnce({ rejected: true });
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /reject recommendation/i }));
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'These are different people' } });
    fireEvent.click(screen.getByRole('button', { name: /^reject all pairs$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/rejected 2 of 3 pairs/i);
    expect(screen.getByRole('dialog', { name: /reject duplicate recommendation/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /reject all pairs/i })).toBeEnabled();
    expect(screen.getByLabelText('Rejection reason')).toHaveValue('These are different people');
  });

  it('keeps the failed review open and refreshes a stale recommendation', async () => {
    mocks.merge.mockRejectedValueOnce(new Error('Duplicate recommendation is stale'));
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/use master identification number/i));
    fireEvent.click(screen.getByRole('button', { name: /merge contacts/i }));
    fireEvent.click(await screen.findByRole('button', { name: /permanently merge/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed.*review again/i);
    const refresh = screen.getByRole('button', { name: /refresh recommendations/i });
    expect(refresh).toHaveClass('min-h-11');
    fireEvent.click(refresh);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: /review duplicate contacts/i })).toBeVisible();
  });

  it('reuses one idempotency key across retry failures', async () => {
    mocks.merge.mockRejectedValueOnce(new Error('Temporary merge failure')).mockResolvedValueOnce({ survivingContactId: ids.recommended });
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/use master identification number/i));
    fireEvent.click(screen.getByRole('button', { name: /merge contacts/i }));
    fireEvent.click(await screen.findByRole('button', { name: /permanently merge/i }));
    await waitFor(() => expect(mocks.merge).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /permanently merge/i }));
    await waitFor(() => expect(mocks.merge).toHaveBeenCalledTimes(2));

    expect(mocks.merge.mock.calls[0][0].idempotencyKey).toBe(mocks.merge.mock.calls[1][0].idempotencyKey);
  });

  it('starts a new idempotency key when the merge selection changes', async () => {
    mocks.merge.mockRejectedValueOnce(new Error('Temporary merge failure')).mockResolvedValueOnce({ survivingContactId: ids.alternate });
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/use master identification number/i));
    fireEvent.click(screen.getByRole('button', { name: /merge contacts/i }));
    fireEvent.click(await screen.findByRole('button', { name: /permanently merge/i }));
    await waitFor(() => expect(mocks.merge).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    fireEvent.click(screen.getByLabelText('Use Alex TÃ¡n as master'));
    fireEvent.click(screen.getByLabelText(/use master identification number/i));
    fireEvent.click(screen.getByRole('button', { name: /merge contacts/i }));
    fireEvent.click(await screen.findByRole('button', { name: /permanently merge/i }));
    await waitFor(() => expect(mocks.merge).toHaveBeenCalledTimes(2));

    expect(mocks.merge.mock.calls[0][0].idempotencyKey).not.toBe(mocks.merge.mock.calls[1][0].idempotencyKey);
  });

  it('moves keyboard focus into the open review dialog', async () => {
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: /review duplicate contacts/i });
    await waitFor(() => expect(dialog.firstElementChild).toHaveFocus());
  });

  it('clamps the current page after a mutation shrinks the result set', async () => {
    queryData = { groups: [group], total: 2, page: 1, limit: 1, totalPages: 2 };
    mocks.merge.mockImplementationOnce(async () => {
      queryData = { groups: [group], total: 1, page: 1, limit: 1, totalPages: 1 };
      return { survivingContactId: ids.recommended };
    });
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    const next = await screen.findByRole('button', { name: /next group/i });
    expect(next).toHaveClass('min-h-11');
    fireEvent.click(next);
    expect(screen.getByText('Page 2 of 2')).toBeVisible();
    fireEvent.click(screen.getByLabelText(/use master identification number/i));
    fireEvent.click(screen.getByRole('button', { name: /merge contacts/i }));
    fireEvent.click(await screen.findByRole('button', { name: /permanently merge/i }));

    await waitFor(() => expect(mocks.currentPage).toBe(1));
    expect(screen.queryByRole('button', { name: /next group/i })).not.toBeInTheDocument();
  });

  it('offers a retry action when duplicate recommendations fail to load', async () => {
    queryError = new Error('Failed to load duplicate recommendations');
    render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load/i);
    fireEvent.click(screen.getByRole('button', { name: /retry loading recommendations/i }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
